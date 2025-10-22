/**
 * Assistant Functions Socket Handler
 * 
 * Handles execution of assistant function calls and user selections
 */

import type { Socket, Server } from 'socket.io'
import { getFunction } from '$lib/server/assistantFunctions/serverRegistry'
import { db } from '$lib/server/db'
import * as schema from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'

export function handleAssistantFunctions(io: Server, socket: Socket, userId: number) {
	/**
	 * Execute function calls from reasoning format
	 */
	socket.on(
		'assistant:executeFunctions',
		async (data: {
			chatId: number
			functionCalls: Array<{ name: string; args: Record<string, any> }>
		}) => {
			try {
				const { chatId, functionCalls } = data

				// Execute all function calls
				const results = await Promise.all(
					functionCalls.map(async (call) => {
						const fn = getFunction(call.name)
						if (!fn || !fn.handler) {
							return {
								success: false,
								error: `Function '${call.name}' not found`
							}
						}

						// Execute the function handler
						const result = await fn.handler({
							userId,
							chatId,
							args: call.args,
							socket
						})

						return result
					})
				)

				// Combine all results and remove duplicates (by id)
				const allData: any[] = []
				const seenIds = new Set<string>()

				for (const result of results) {
					if (result.success && result.data) {
						// Handle different data structures
						// If data.characters exists (from listCharacters), use that
						const items = result.data.characters || result.data
						
						// Ensure items is an array
						const itemsArray = Array.isArray(items) ? items : [items]
						
						for (const item of itemsArray) {
							const itemId = String(item.id)
							if (!seenIds.has(itemId)) {
								seenIds.add(itemId)
								allData.push(item)
							}
						}
					}
				}

				console.log('[AssistantFunctions] Function results:', {
					totalResults: results.length,
					allDataCount: allData.length,
					allData: allData,
					rawResults: results
				})

				// Emit combined results to client
				socket.emit('assistant:functionResults', {
					chatId,
					results: allData
				})
			} catch (error) {
				console.error('Error executing assistant functions:', error)
				socket.emit('assistant:functionError', {
					error: 'Failed to execute functions'
				})
			}
		}
	)

	/**
	 * Handle user selection of function results
	 */
	socket.on(
		'assistant:selectFunctionResults',
		async (data: { chatId: number; selectedIds: number[]; type: string }) => {
			try {
				const { chatId, selectedIds, type } = data
				
				console.log('='.repeat(80))
				console.log('[selectFunctionResults] Received selection:', { chatId, selectedIds, type })

				// Get current chat metadata
				const chat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId)
				})

				if (!chat) {
					socket.emit('assistant:selectionError', { error: 'Chat not found' })
					return
				}

				console.log('[selectFunctionResults] Current chat.metadata:', chat.metadata)

				// Update chat metadata with tagged entities
				const metadata = typeof chat.metadata === 'string' 
					? JSON.parse(chat.metadata) 
					: (chat.metadata || {})
				
				console.log('[selectFunctionResults] Parsed metadata:', metadata)
				
				const taggedEntities = metadata.taggedEntities || {}
				
				console.log('[selectFunctionResults] Existing taggedEntities:', taggedEntities)

				// Add/update tagged entities for this type
				if (!taggedEntities[type]) {
					taggedEntities[type] = []
				}

				// Add selected IDs (avoid duplicates)
				for (const id of selectedIds) {
					if (!taggedEntities[type].includes(id)) {
						taggedEntities[type].push(id)
					}
				}
				
				console.log('[selectFunctionResults] Updated taggedEntities:', taggedEntities)

				// Save updated metadata
				await db
					.update(schema.chats)
					.set({
						metadata: JSON.stringify({ ...metadata, taggedEntities })
					})
					.where(eq(schema.chats.id, chatId))

				console.log('[selectFunctionResults] Emitting selectionComplete with:', { chatId, taggedEntities })
				console.log('='.repeat(80))

				// Emit success and continue generation
				socket.emit('assistant:selectionComplete', {
					chatId,
					taggedEntities
				})
			} catch (error) {
				console.error('Error saving function result selection:', error)
				socket.emit('assistant:selectionError', {
					error: 'Failed to save selection'
				})
			}
		}
	)

	/**
	 * Handle unlinking entities from chat
	 */
	socket.on(
		'assistant:unlinkEntity',
		async (data: { chatId: number; entityId: number; type: string }) => {
			try {
				const { chatId, entityId, type } = data

				// Get current chat metadata
				const chat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId)
				})

				if (!chat) {
					socket.emit('assistant:unlinkError', { error: 'Chat not found' })
					return
				}

				// Update chat metadata by removing the entity
				const metadata = (chat.metadata as any) || {}
				const taggedEntities = metadata.taggedEntities || {}

				if (taggedEntities[type]) {
					taggedEntities[type] = taggedEntities[type].filter(
						(id: number) => id !== entityId
					)
					
					// Remove the type key if array is empty
					if (taggedEntities[type].length === 0) {
						delete taggedEntities[type]
					}
				}

				// Save updated metadata
				await db
					.update(schema.chats)
					.set({
						metadata: JSON.stringify({ ...metadata, taggedEntities })
					})
					.where(eq(schema.chats.id, chatId))

				// Emit success
				socket.emit('assistant:unlinkSuccess', {
					chatId,
					entityId,
					type,
					taggedEntities
				})
			} catch (error) {
				console.error('Error unlinking entity:', error)
				socket.emit('assistant:unlinkError', {
					error: 'Failed to unlink entity'
				})
			}
		}
	)
}
