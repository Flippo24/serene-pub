import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import { v4 as uuidv4 } from "uuid"
import { activeAdapters, chatMessage } from "../sockets/chats"
import { getConnectionAdapter } from "./getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { getUserConfigurations } from "./getUserConfigurations"
import { broadcastToChatUsers } from "../sockets/utils/broadcastHelpers"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { generateChatTitle } from "./generateChatTitle"
import { parseReasoningFormat } from "./parseReasoningFormat"

export async function generateResponse({
	socket,
	emitToUser,
	chatId,
	userId,
	generatingMessage
}: {
	socket: any
	emitToUser: (event: string, data: any) => void
	chatId: number
	userId: number
	generatingMessage: SelectChatMessage
}): Promise<boolean> {
	// Generate a UUID for this adapter instance
	const adapterId = uuidv4()
	// Save the adapterId to the chatMessage (set isGenerating true, content empty, and adapterId)
	await db
		.update(schema.chatMessages)
		.set({ isGenerating: true, content: "", adapterId })
		.where(eq(schema.chatMessages.id, generatingMessage.id))
	// Instead of getChat, emit the chatMessage

	const req: Sockets.ChatMessage.Call = {
		chatMessage: {
			...generatingMessage,
			isGenerating: true,
			content: "",
			adapterId
		}
	}

	await broadcastToChatUsers(
		socket.io,
		generatingMessage.chatId,
		"chatMessage",
		req
	)

	const chat = await db.query.chats.findFirst({
		where: (c, { eq }) => eq(c.id, chatId),
		with: {
			chatCharacters: {
				with: {
					character: true
				}
			},
			chatPersonas: {
				with: {
					persona: true
				}
			},
			chatMessages: {
				where: (cm, { ne }) => ne(cm.id, generatingMessage.id),
				orderBy: (cm, { asc }) => asc(cm.id)
			},
			lorebook: true
		}
	})

	// Get user and their configurations with fallbacks
	const { connection, sampling, contextConfig, promptConfig } =
		await getUserConfigurations(userId)

	const { Adapter } = getConnectionAdapter(connection.type)

	const tokenCounter = new TokenCounters("estimate")
	const tokenLimit = 4096
	const contextThresholdPercent = 0.8

	// Detect assistant mode
	const isAssistantMode = chat?.chatType === ChatTypes.ASSISTANT

	// CRITICAL: Load fresh metadata from DB before creating adapter
	// This ensures the adapter knows if we're regenerating a message with existing reasoning
	const freshMessageBeforeGen = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
	})
	const freshMetadata = (freshMessageBeforeGen?.metadata as any) || {}
	const shouldCheckForReasoning = isAssistantMode && 
		!(freshMetadata.reasoning && !freshMetadata.waitingForFunctionSelection)
	
	console.log('='.repeat(80))
	console.log('[AssistantFunctions] PRE-GENERATION CHECK')
	console.log('[AssistantFunctions] Message ID:', generatingMessage.id)
	console.log('[AssistantFunctions] Fresh message from DB:', freshMessageBeforeGen)
	console.log('[AssistantFunctions] Fresh metadata (raw):', freshMessageBeforeGen?.metadata)
	console.log('[AssistantFunctions] Fresh metadata (parsed):', JSON.stringify(freshMetadata, null, 2))
	console.log('[AssistantFunctions] Has reasoning:', !!freshMetadata.reasoning)
	console.log('[AssistantFunctions] waitingForFunctionSelection:', freshMetadata.waitingForFunctionSelection)
	console.log('[AssistantFunctions] shouldCheckForReasoning:', shouldCheckForReasoning)
	console.log('[AssistantFunctions] Passing to adapter:', JSON.stringify(freshMetadata, null, 2))
	console.log('='.repeat(80))

	const adapter = new Adapter({
		chat,
		connection: connection,
		sampling: sampling,
		contextConfig: contextConfig,
		promptConfig: promptConfig,
		currentCharacterId: isAssistantMode
			? null
			: generatingMessage.characterId!,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		isAssistantMode,
		generatingMessageMetadata: freshMetadata  // Pass the fresh metadata we loaded
	})
	// Store adapter in global map
	activeAdapters.set(adapterId, adapter)

	// For assistant mode, no character name prefix
	const currentCharacter = chat?.chatCharacters?.find(
		(cc: any) => cc.character?.id === adapter.currentCharacterId
	)

	const charName = isAssistantMode
		? ""
		: currentCharacter?.character?.nickname ||
		  currentCharacter?.character?.name ||
		  ""
	const startString = charName ? `${charName}:` : ""

	// Generate completion
	let { completionResult, compiledPrompt, isAborted } =
		await adapter.generate() // TODO: save compiledPrompt to chatMessages
	let content = ""
	let reasoningDetectedDuringStream = false
	
	try {
		if (typeof completionResult === "function") {
			let ok = true
			await completionResult(async (chunk: string) => {
				if (!ok) {
					return
				}
				content += chunk

				let stagedContent = content.replace(startString, "")
				// If stagedContent length is <= startString, remove partial startString
				if (stagedContent.length <= startString.length) {
					// Check if content starts with startString substring
					if (
						content.startsWith(
							startString.substring(0, stagedContent.length)
						)
					) {
						stagedContent = ""
					}
				}

				// Check for reasoning format during streaming to prevent it from being saved/broadcast
				// Use the flag we determined BEFORE generation started (with fresh DB metadata)
				if (shouldCheckForReasoning && !reasoningDetectedDuringStream) {
					// Try to detect reasoning format early
					const reasoningParsed = parseReasoningFormat(stagedContent.trim())
					if (reasoningParsed && reasoningParsed.functionCalls.length > 0) {
						console.log('[AssistantFunctions] 🛑 REASONING DETECTED DURING STREAM - STOPPING')
						reasoningDetectedDuringStream = true
						ok = false // Stop streaming immediately
						return // Don't broadcast this chunk
					}
				}

				// --- SWIPE HISTORY LOGIC ---
				let updateData: any = {
					content: stagedContent.trim(),
					isGenerating: true
				}
				if (
					generatingMessage.metadata &&
					generatingMessage.metadata.swipes &&
					typeof generatingMessage.metadata.swipes.currentIdx ===
						"number" &&
					generatingMessage.metadata.swipes.currentIdx > 0 &&
					Array.isArray(generatingMessage.metadata.swipes.history)
				) {
					const idx = generatingMessage.metadata.swipes.currentIdx
					const history: string[] = [
						...generatingMessage.metadata.swipes.history
					]
					history[idx] = content
					updateData = {
						...updateData,
						metadata: {
							...generatingMessage.metadata,
							swipes: {
								...generatingMessage.metadata.swipes,
								history
							}
						}
					}
				}

				const [updatedChatMsg] = await db
					.update(schema.chatMessages)
					.set(updateData)
					.where(
						and(
							eq(schema.chatMessages.id, generatingMessage.id),
							eq(schema.chatMessages.isGenerating, true)
						)
					)
					.returning()
				if (!!updatedChatMsg) {
					const chatMsgReq: Sockets.ChatMessage.Call = {
						chatMessage: updatedChatMsg
					}
					await broadcastToChatUsers(
						socket.io,
						generatingMessage.chatId,
						"chatMessage",
						chatMsgReq
					)
				} else {
					const chatMsgReq: Sockets.ChatMessage.Call = {
						id: generatingMessage.id
					}
					await broadcastToChatUsers(
						socket.io,
						generatingMessage.chatId,
						"chatMessage",
						chatMsgReq
					)
					console.warn(
						"[generateResponse] Generating terminated early",
						generatingMessage.id
					)
					ok = false
				}
			})
			// Final update: mark as not generating, clear adapterId
			content = content.replace(startString, "").trim()
			
			console.log('='.repeat(80))
			console.log('[AssistantFunctions] POST-GENERATION CHECK')
			console.log('[AssistantFunctions] shouldCheckForReasoning:', shouldCheckForReasoning)
			console.log('[AssistantFunctions] reasoningDetectedDuringStream:', reasoningDetectedDuringStream)
			console.log('[AssistantFunctions] Content length:', content.length)
			console.log('[AssistantFunctions] Content preview:', content.substring(0, 200))
			console.log('='.repeat(80))
			
			// Only check for reasoning if we determined we should (before generation started)
			if (shouldCheckForReasoning) {
				const reasoningParsed = parseReasoningFormat(content)
				console.log('[AssistantFunctions] Parsed result:', reasoningParsed)
				
				if (reasoningParsed && reasoningParsed.functionCalls.length > 0) {
					console.log('[AssistantFunctions] Function calls detected!', reasoningParsed.functionCalls)
					// Emit function calls to client for execution
					socket.emit('assistant:reasoningDetected', {
						chatId,
						messageId: generatingMessage.id,
						reasoning: reasoningParsed.reasoning,
						functionCalls: reasoningParsed.functionCalls
					})
					
					// Update message: store reasoning in metadata, keep content empty, mark as waiting
					const currentMetadata = (typeof generatingMessage.metadata === 'object' && generatingMessage.metadata !== null) 
						? generatingMessage.metadata 
						: {}
					
					await db
						.update(schema.chatMessages)
						.set({ 
							content: "",  // Keep content empty - reasoning goes in metadata
							isGenerating: false, 
							adapterId: null,
							metadata: {
								...currentMetadata,
								reasoning: reasoningParsed.reasoning,  // Store reasoning in metadata
								waitingForFunctionSelection: true
							}
						})
						.where(eq(schema.chatMessages.id, generatingMessage.id))
					
					// Broadcast the updated message
					const updatedMessage = await db.query.chatMessages.findFirst({
						where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
					})
					
					if (updatedMessage) {
						await broadcastToChatUsers(
							socket.io,
							chatId,
							"chatMessage",
							{ chatMessage: updatedMessage }
						)
					}
					
					activeAdapters.delete(adapterId)
					return true // Wait for user selection
				} else {
					console.log('[AssistantFunctions] No function calls found in response')
				}
			} else {
				console.log('[AssistantFunctions] Skipping reasoning detection - shouldCheckForReasoning is false')
			}
			
			const ret = await db
				.update(schema.chatMessages)
				.set({ content, isGenerating: false, adapterId: null })
				.where(
					and(
						eq(schema.chatMessages.id, generatingMessage.id),
						eq(schema.chatMessages.isGenerating, true)
					)
				)
				.returning()
			if (!ret || ret.length === 0) {
				console.error(
					"[generateResponse] Failed to update generating message:",
					generatingMessage.id
				)
				activeAdapters.delete(adapterId)
				return false
			}
			// Broadcast the chatMessage to all chat participants
			await broadcastToChatUsers(
				socket.io,
				generatingMessage.chatId,
				"chatMessage",
				{
					chatMessage: {
						...generatingMessage,
						content,
						isGenerating: false,
						adapterId: null
					}
				}
			)
		} else {
			content = completionResult.replace(startString, "").trim()

			// Check for reasoning format in assistant mode
			if (isAssistantMode) {
				console.log('[AssistantFunctions] (Non-streaming) Checking for reasoning format in content:', content.substring(0, 200))
				const reasoningParsed = parseReasoningFormat(content)
				console.log('[AssistantFunctions] (Non-streaming) Parsed result:', reasoningParsed)
				
				if (reasoningParsed && reasoningParsed.functionCalls.length > 0) {
					console.log('[AssistantFunctions] (Non-streaming) Function calls detected!', reasoningParsed.functionCalls)
					// Emit function calls to client for execution
					socket.emit('assistant:reasoningDetected', {
						chatId,
						messageId: generatingMessage.id,
						reasoning: reasoningParsed.reasoning,
						functionCalls: reasoningParsed.functionCalls
					})
					
					// Update message with reasoning content and mark as waiting for function
					await db
						.update(schema.chatMessages)
						.set({ 
							content: reasoningParsed.reasoning, 
							isGenerating: false, 
							adapterId: null,
							metadata: {
								...generatingMessage.metadata,
								waitingForFunctionSelection: true
							} as any
						})
						.where(eq(schema.chatMessages.id, generatingMessage.id))
					
					activeAdapters.delete(adapterId)
					return true // Wait for user selection
				} else {
					console.log('[AssistantFunctions] (Non-streaming) No function calls found in response')
				}
			}

			// --- SWIPE HISTORY LOGIC (non-streamed) ---
			let updateData: any = {
				content,
				isGenerating: false,
				adapterId: null
			}
			if (
				generatingMessage.metadata &&
				generatingMessage.metadata.swipes &&
				typeof generatingMessage.metadata.swipes.currentIdx ===
					"number" &&
				generatingMessage.metadata.swipes.currentIdx > 0 &&
				Array.isArray(generatingMessage.metadata.swipes.history)
			) {
				const idx = generatingMessage.metadata.swipes.currentIdx
				const history: string[] = [
					...generatingMessage.metadata.swipes.history
				]
				history[idx] = content
				updateData = {
					...updateData,
					metadata: {
						...generatingMessage.metadata,
						swipes: {
							...generatingMessage.metadata.swipes,
							history
						}
					}
				}
			}

			const ret = await db
				.update(schema.chatMessages)
				.set(updateData)
				.where(
					and(
						eq(schema.chatMessages.id, generatingMessage.id),
						eq(schema.chatMessages.isGenerating, true)
					)
				)
				.returning()
			// Instead of getChat, emit the chatMessage
			if (!ret || ret.length === 0) {
				console.error(
					"[generateResponse] Failed to update generating message:",
					generatingMessage.id
				)
				activeAdapters.delete(adapterId)
				return false
			}
			await broadcastToChatUsers(
				socket.io,
				generatingMessage.chatId,
				"chatMessage",
				{
					chatMessage: {
						...generatingMessage,
						content,
						isGenerating: false,
						adapterId: null,
						...(updateData.metadata
							? { metadata: updateData.metadata }
							: {})
					}
				}
			)
		}
	} finally {
		// Remove adapter from global map
		activeAdapters.delete(adapterId)
	}
	// Fetch the updated message for the response
	const updatedMsg = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
	})
	const response: Sockets.SendPersonaMessage.Response = {
		chatMessage: updatedMsg!
	}
	socket.io.to("user_" + userId).emit("personaMessageReceived", response)
	// Broadcast the chatMessage to all chat participants
	await broadcastToChatUsers(socket.io, updatedMsg!.chatId, "chatMessage", {
		chatMessage: updatedMsg!
	})

	// ASYNC: Generate chat title if this is the first assistant message in an assistant chat
	if (isAssistantMode && chat && !isAborted) {
		// Don't await - run this asynchronously to not block the response
		generateChatTitleIfNeeded(
			chatId,
			userId,
			socket.io,
			connection,
			sampling
		).catch((error) => {
			console.error("Background title generation failed:", error)
		})
	}

	return !isAborted // Whether there were no interruptions
}

/**
 * Generate a title for a new assistant chat after the first exchange
 * This runs asynchronously and doesn't block the main response
 */
async function generateChatTitleIfNeeded(
	chatId: number,
	userId: number,
	io: any,
	connection: any,
	sampling: any
) {
	try {
		// Check if this is the first assistant message
		const assistantMessages = await db.query.chatMessages.findMany({
			where: (cm, { eq, and }) =>
				and(eq(cm.chatId, chatId), eq(cm.role, "assistant"))
		})

		// Only generate title if this is the first assistant response
		if (assistantMessages.length !== 1) {
			return
		}

		// Get the first user message
		const userMessage = await db.query.chatMessages.findFirst({
			where: (cm, { eq, and }) =>
				and(eq(cm.chatId, chatId), eq(cm.role, "user")),
			orderBy: (cm, { asc }) => asc(cm.id)
		})

		if (!userMessage || !userMessage.content) {
			return
		}

		const assistantMessage = assistantMessages[0]
		if (!assistantMessage.content) {
			return
		}

		// Generate the title
		const title = await generateChatTitle({
			userMessage: userMessage.content,
			assistantMessage: assistantMessage.content,
			connection,
			sampling
		})

		// Update the chat with the new title
		await db
			.update(schema.chats)
			.set({ name: title })
			.where(eq(schema.chats.id, chatId))

		// Broadcast the updated chat name to the user
		io.to("user_" + userId).emit("chats:titleGenerated", {
			chatId,
			title
		})

		console.log(`Generated title for chat ${chatId}: "${title}"`)
	} catch (error) {
		console.error("Error in generateChatTitleIfNeeded:", error)
		// Don't throw - this is a background task
	}
}
