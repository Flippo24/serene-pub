import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import { v4 as uuidv4 } from "uuid"
import { activeAdapters, chatMessage } from "../sockets/chats"
import { getConnectionAdapter } from "./getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { getUserConfigurations } from "./getUserConfigurations"

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

	await chatMessage(socket, req, emitToUser)

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

	const adapter = new Adapter({
		chat,
		connection: connection,
		sampling: sampling,
		contextConfig: contextConfig,
		promptConfig: promptConfig,
		currentCharacterId: generatingMessage.characterId!,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent
	})
	// Store adapter in global map
	activeAdapters.set(adapterId, adapter)

	const currentCharacter = chat?.chatCharacters?.find(
		(cc) => cc.character?.id === adapter.currentCharacterId
	)

	const charName =
		currentCharacter?.character?.nickname ||
		currentCharacter?.character?.name ||
		""
	const startString = `${charName}:`

	// Generate completion
	let { completionResult, compiledPrompt, isAborted } =
		await adapter.generate() // TODO: save compiledPrompt to chatMessages
	let content = ""
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
					await chatMessage(socket, chatMsgReq, emitToUser)
				} else {
					const chatMsgReq: Sockets.ChatMessage.Call = {
						id: generatingMessage.id
					}
					await chatMessage(socket, chatMsgReq, emitToUser)
					console.warn(
						"[generateResponse] Generating terminated early",
						generatingMessage.id
					)
					ok = false
				}
			})
			// Final update: mark as not generating, clear adapterId
			content = content.replace(startString, "").trim()
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
			// Instead of getChat, emit the chatMessage
			await chatMessage(
				socket,
				{
					chatMessage: {
						...generatingMessage,
						content,
						isGenerating: false,
						adapterId: null
					}
				},
				emitToUser
			)
		} else {
			content = completionResult.replace(startString, "").trim()

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
			await chatMessage(
				socket,
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
				},
				emitToUser
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
	// Instead of getChat, emit the chatMessage
	await chatMessage(socket, { chatMessage: updatedMsg! }, emitToUser)
	return !isAborted // Whether there were no interruptions
}
