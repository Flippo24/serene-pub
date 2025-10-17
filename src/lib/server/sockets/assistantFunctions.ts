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

				// Get current chat metadata
				const chat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId)
				})

				if (!chat) {
					socket.emit('assistant:selectionError', { error: 'Chat not found' })
					return
				}

				// Update chat metadata with tagged entities
				const metadata = (chat.metadata as any) || {}
				const taggedEntities = metadata.taggedEntities || {}

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

				// Save updated metadata
				await db
					.update(schema.chats)
					.set({
						metadata: JSON.stringify({ ...metadata, taggedEntities })
					})
					.where(eq(schema.chats.id, chatId))

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
}
