import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, eq, inArray } from "drizzle-orm"
import { generateResponse } from "../utils/generateResponse"
import { getNextCharacterTurn } from "$lib/server/utils/getNextCharacterTurn"
import type { BaseConnectionAdapter } from "../connectionAdapters/BaseConnectionAdapter"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
import { InterpolationEngine } from "../utils/promptBuilder"
import { dev } from "$app/environment"
import type { Handler } from "$lib/shared/events"

// Helper function to process tags for chat creation/update
async function processChatTags(chatId: number, tagNames: string[]) {
	if (!tagNames || tagNames.length === 0) return

	// First, remove all existing tags for this chat
	await db
		.delete(schema.chatTags)
		.where(eq(schema.chatTags.chatId, chatId))

	// Process each tag name
	const tagIds: number[] = []

	for (const tagName of tagNames) {
		if (!tagName.trim()) continue

		// Check if tag exists
		let existingTag = await db.query.tags.findFirst({
			where: eq(schema.tags.name, tagName.trim())
		})

		// Create tag if it doesn't exist
		if (!existingTag) {
			const [newTag] = await db
				.insert(schema.tags)
				.values({
					name: tagName.trim()
					// description and colorPreset will use database defaults
				})
				.returning()
			existingTag = newTag
		}

		tagIds.push(existingTag.id)
	}

	// Link all tags to the chat
	if (tagIds.length > 0) {
		const chatTagsData = tagIds.map((tagId) => ({
			chatId,
			tagId
		}))

		await db
			.insert(schema.chatTags)
			.values(chatTagsData)
			.onConflictDoNothing() // In case of race conditions
	}
}

// --- Global map for active adapters ---
export const activeAdapters = new Map<string, BaseConnectionAdapter>()

export const chatsListHandler: Handler<Sockets.Chats.List.Params, Sockets.Chats.List.Response> = {
	event: "chats:list",
	async handler(socket, params, emitToUser) {
		const userId = 1 // Replace with actual user id
		const chatsList = await db.query.chats.findMany({
			with: {
				chatCharacters: {
					with: {
						character: true
					},
					orderBy: (cc, { asc }) => asc(cc.position)
				},
				chatPersonas: {
					with: {
						persona: true
					}
				},
				chatTags: {
					with: {
						tag: true
					}
				}
			},
			where: (c, { eq }) => eq(c.userId, userId)
		})

		// Drizzle may not properly handle orderby,
		// Lets sort it manually
		// Order the chatCharacters by position
		chatsList.forEach((chat) => {
			chat.chatCharacters.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
			// Sort chatPersonas by position if it exists
			if (chat.chatPersonas) {
				chat.chatPersonas.sort(
					(a, b) => (a.position ?? 0) - (b.position ?? 0)
				)
			}
		})

		return { chatList: chatsList as any }
	}
}

// List all chats for the current user
export async function chatsList(
	socket: any,
	message: Sockets.Chats.List.Params,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chatsList = await db.query.chats.findMany({
		with: {
			chatCharacters: {
				with: {
					character: true
				},
				orderBy: (cc, { asc }) => asc(cc.position)
			},
			chatPersonas: {
				with: {
					persona: true
				}
			},
			chatTags: {
				with: {
					tag: true
				}
			}
		},
		where: (c, { eq }) => eq(c.userId, userId)
	})

	// Drizzle may not properly handle orderby,
	// Lets sort it manually
	// Order the chatCharacters by position
	chatsList.forEach((chat) => {
		chat.chatCharacters.sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0)
		)
		// Sort chatPersonas by position if it exists
		if (chat.chatPersonas) {
			chat.chatPersonas.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
		}
	})

	const res: Sockets.Chats.List.Response = { chatList: chatsList as any }
	emitToUser("chats:list", res)
}

export const chatsCreateHandler: Handler<Sockets.Chats.Create.Params, Sockets.Chats.Create.Response> = {
	event: "chats:create", 
	handler: async (socket, params, emitToUser) => {
		const userId = 1 // Replace with actual user id
		const tags = params.tags || []

		// Remove tags from chat data as it will be handled separately
		const chatDataWithoutTags = { ...params.chat }

		const chatData: InsertChat = {
			...chatDataWithoutTags,
			userId,
			isGroup: params.characterIds.length > 1
		}
		const [newChat] = await db
			.insert(schema.chats)
			.values(chatData)
			.returning()

		// Process tags after chat creation
		if (tags.length > 0) {
			await processChatTags(newChat.id, tags)
		}
		for (const personaId of params.personaIds) {
			await db.insert(schema.chatPersonas).values({
				chatId: newChat.id,
				personaId
			})
		}
		for (const characterId of params.characterIds) {
			const position = params.characterPositions[characterId] || 0
			await db.insert(schema.chatCharacters).values({
				chatId: newChat.id,
				characterId,
				position
			})
		}
		// Insert a first message for every character assigned to the chat, ordered by position
		const chatCharacters = await db.query.chatCharacters.findMany({
			where: (cc, { eq }) => eq(cc.chatId, newChat.id),
			with: { character: true },
			orderBy: (cc, { asc }) => asc(cc.position ?? 0)
		})
		const chatPersona = await db.query.chatPersonas.findFirst({
			where: (cp, { eq, and, isNotNull }) =>
				and(eq(cp.chatId, newChat.id), isNotNull(cp.personaId)),
			with: { persona: true },
			orderBy: (cp, { asc }) => asc(cp.position ?? 0)
		})
		for (const cc of chatCharacters) {
			if (!cc.character) continue
			const greetings = buildCharacterFirstChatMessage({
				character: cc.character,
				persona: chatPersona?.persona,
				isGroup: !!newChat.isGroup
			})
			if (greetings.length > 0) {
				const newMessage: InsertChatMessage = {
					userId,
					chatId: newChat.id,
					personaId: null,
					characterId: cc.character.id,
					role: "assistant",
					content: greetings[0],
					isGenerating: false,
					metadata: {
						isGreeting: true,
						swipes: {
							currentIdx: 0,
							history: greetings as any // Patch: force string[]
						}
					}
				}
				await db.insert(schema.chatMessages).values(newMessage)
			}
		}
		const resChat = await getChatFromDB(newChat.id, userId)
		if (!resChat) throw new Error("Failed to fetch created chat")
		
		await chatsListHandler.handler(socket, {}, emitToUser) // Refresh chat list
		const res: Sockets.Chats.Create.Response = { chat: resChat as any }
		emitToUser("chats:create", res)
		return res
	}
}

export async function createChat(
	socket: any,
	message: Sockets.CreateChat.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const userId = 1 // Replace with actual user id
		const tags = message.chat.tags || []

		// Remove tags from chat data as it will be handled separately
		const chatDataWithoutTags = { ...message.chat }
		delete chatDataWithoutTags.tags

		const chatData: InsertChat = {
			...chatDataWithoutTags,
			userId,
			isGroup: message.characterIds.length > 1
		}
		const [newChat] = await db
			.insert(schema.chats)
			.values(chatData)
			.returning()

		// Process tags after chat creation
		if (tags.length > 0) {
			await processChatTags(newChat.id, tags)
		}
		for (const personaId of message.personaIds) {
			await db.insert(schema.chatPersonas).values({
				chatId: newChat.id,
				personaId
			})
		}
		for (const characterId of message.characterIds) {
			const position = message.characterPositions[characterId] || 0
			await db.insert(schema.chatCharacters).values({
				chatId: newChat.id,
				characterId,
				position
			})
		}
		// Insert a first message for every character assigned to the chat, ordered by position
		const chatCharacters = await db.query.chatCharacters.findMany({
			where: (cc, { eq }) => eq(cc.chatId, newChat.id),
			with: { character: true },
			orderBy: (cc, { asc }) => asc(cc.position ?? 0)
		})
		const chatPersona = await db.query.chatPersonas.findFirst({
			where: (cp, { eq, and, isNotNull }) =>
				and(eq(cp.chatId, newChat.id), isNotNull(cp.personaId)),
			with: { persona: true },
			orderBy: (cp, { asc }) => asc(cp.position ?? 0)
		})
		for (const cc of chatCharacters) {
			if (!cc.character) continue
			const greetings = buildCharacterFirstChatMessage({
				character: cc.character,
				persona: chatPersona?.persona,
				isGroup: !!newChat.isGroup
			})
			if (greetings.length > 0) {
				const newMessage: InsertChatMessage = {
					userId,
					chatId: newChat.id,
					personaId: null,
					characterId: cc.character.id,
					role: "assistant",
					content: greetings[0],
					isGenerating: false,
					metadata: {
						isGreeting: true,
						swipes: {
							currentIdx: 0,
							history: greetings as any // Patch: force string[]
						}
					}
				}
				await db.insert(schema.chatMessages).values(newMessage)
			}
		}
		const resChat = await getChatFromDB(newChat.id, userId)
		if (!resChat) return
		await chatsList(socket, {}, emitToUser) // Refresh chat list
		const res: Sockets.CreateChat.Response = { chat: resChat as any }
		emitToUser("createChat", res)
	} catch (error) {
		console.error("Error creating chat:", error)
		emitToUser("error", { error: "Failed to create chat." })
	}
}

export async function chat(
	socket: any,
	message: Sockets.Chat.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const limit = message.limit || 25
	const offset = message.offset || 0

	const chat = await getChatFromDB(message.id, userId, limit, offset)
	if (chat) {
		// Get total message count for pagination
		const totalMessages = await db.query.chatMessages.findMany({
			where: (cm, { eq }) => eq(cm.chatId, message.id)
		})

		const hasMore = offset + limit < totalMessages.length

		const res: Sockets.Chat.Response = {
			chat: chat as any,
			pagination: {
				total: totalMessages.length,
				hasMore
			}
		}
		emitToUser("chat", res)
	}
}

export const getChat = chat

// Helper to get chat with userId
async function getChatFromDB(
	chatId: number,
	userId: number,
	limit?: number,
	offset?: number
) {
	const res = db.query.chats.findFirst({
		where: (c, { eq, and }) => and(eq(c.id, chatId), eq(c.userId, userId)),
		with: {
			chatPersonas: {
				with: { persona: true },
				orderBy: (cp, { asc }) => asc(cp.position)
			},
			chatCharacters: { with: { character: true } },
			chatMessages: {
				orderBy: (cm, { desc }) => desc(cm.id),
				limit: limit,
				offset: offset
			},
			chatTags: {
				with: {
					tag: true
				}
			}
		}
	})

	// Drizzle may not properly handle orderby,
	// Lets sort it manually
	const chat = await res
	if (chat) {
		// Order the chatCharacters by position
		chat.chatCharacters.sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0)
		)
		// Sort chatPersonas by position if it exists
		if (chat.chatPersonas) {
			chat.chatPersonas.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
		}
		// Sort messages by id ascending (oldest first) for correct display order
		// When paginating, we fetched newest first (DESC) but want to display oldest first
		chat.chatMessages.sort((a, b) => a.id - b.id)

		// Transform chat tags to include tags as string array
		const chatWithTags = {
			...chat,
			tags: chat.chatTags?.map((ct) => ct.tag.name) || []
		}
		return chatWithTags
	}
	return chat
}

// Returns complete chat data for prompt compilation
async function getPromptChatFromDb(chatId: number, userId: number) {
	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) => and(eq(c.id, chatId), eq(c.userId, userId)),
		with: {
			chatMessages: {
				where: (cm, { eq }) => eq(cm.isHidden, false),
				orderBy: (cm, { asc }) => asc(cm.id)
			},
			chatCharacters: {
				with: {
					character: {
						// with: { lorebook: true }
					}
				},
				orderBy: (cc, { asc }) => asc(cc.position ?? 0)
			},
			chatPersonas: {
				with: {
					persona: {
						// with: { lorebook: true }
					}
				},
				orderBy: (cp, { asc }) => asc(cp.position ?? 0)
			},
			lorebook: {
				with: {
					lorebookBindings: {
						with: { character: true, persona: true }
					},
					worldLoreEntries: true,
					characterLoreEntries: {
						with: {
							lorebookBinding: {
								with: {
									character: true,
									persona: true
								}
							}
						}
					},
					historyEntries: true
				}
			}
		}
	})

	if (chat) {
		// Order the chatCharacters by position
		chat.chatCharacters.sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0)
		)
		// Sort chatPersonas by position if it exists
		if (chat.chatPersonas) {
			chat.chatPersonas.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
		}
	}
	return chat
}

export async function sendPersonaMessage(
	socket: any,
	message: Sockets.SendPersonaMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const { chatId, personaId, content } = message
	const userId = 1 // Replace with actual user id
	let chat = await getPromptChatFromDb(chatId, userId)
	if (!chat) {
		// Return a valid but empty chatMessage object with required fields set to null or default
		const res: Sockets.SendPersonaMessage.Response = {
			chatMessage: null as any
		}
		emitToUser("sendPersonaMessage", res)
		return
	}
	const newMessage: InsertChatMessage = {
		userId,
		chatId,
		personaId,
		role: "user",
		content
	}
	const [inserted] = await db
		.insert(schema.chatMessages)
		.values(newMessage)
		.returning()
	// Instead of refreshing the chat, emit the new chatMessage
	await chatMessage(socket, { chatMessage: inserted as any }, emitToUser)
	const res: Sockets.SendPersonaMessage.Response = {
		chatMessage: inserted as any
	}
	emitToUser("sendPersonaMessage", res)

	// --- Auto-response logic ---
	let maxTurns = 20 // Prevent infinite loops in case of data issues
	let currentTurn = 1

	// Determine if we should auto-generate responses:
	// - For single character chats: Generate one response only
	// - For group chats: Continue based on reply strategy (not manual)
	const shouldAutoRespond = chat.isGroup 
		? chat.groupReplyStrategy !== GroupReplyStrategies.MANUAL
		: true // Single character chat gets one response

	if (shouldAutoRespond) {
		const abortedCharacters = new Set<number>() // Track characters whose responses were aborted

		while (
			chat &&
			chat.chatCharacters.length > 0 &&
			currentTurn <= maxTurns
		) {
			currentTurn++
			// Always fetch the latest chat state at the start of each loop
			chat = await getPromptChatFromDb(chatId, userId)
			if (!chat) break

			// Check if there are any ongoing generations before starting a new one
			const hasGeneratingMessages = chat.chatMessages.some(
				(msg) => msg.isGenerating
			)
			if (hasGeneratingMessages) {
				console.log(
					"Generation already in progress, stopping auto-response loop"
				)
				break
			}

			const nextCharacterId = getNextCharacterTurn(
				{
					chatMessages: chat!.chatMessages,
					chatCharacters: chat!.chatCharacters
						.filter((cc) => cc.character !== null && cc.isActive)
						.sort(
							(a, b) => (a.position ?? 0) - (b.position ?? 0)
						) as any,
					chatPersonas: chat!.chatPersonas.filter(
						(cp) => cp.persona !== null
					) as any
				},
				{ triggered: false }
			)
			if (!nextCharacterId) {
				break
			}

			// Skip this character if their response was aborted in this turn cycle
			if (abortedCharacters.has(nextCharacterId)) {
				console.log(
					`Skipping character ${nextCharacterId} due to previous abort`
				)
				break
			}

			const nextCharacter = chat.chatCharacters.find(
				(cc) => cc.character && cc.character.id === nextCharacterId
			)

			if (!nextCharacter || !nextCharacter.character) break
			const assistantMessage: InsertChatMessage = {
				userId,
				chatId,
				personaId: null,
				characterId: nextCharacter.character.id,
				content: "",
				role: "assistant",
				isGenerating: true
			}
			const [generatingMessage] = await db
				.insert(schema.chatMessages)
				.values(assistantMessage)
				.returning()

			const generationResult = await generateResponse({
				socket,
				emitToUser,
				chatId,
				userId,
				generatingMessage: generatingMessage as any
			})

			// If generation was aborted (returned false), track this character and stop the loop
			if (!generationResult) {
				abortedCharacters.add(nextCharacterId)
				console.log(
					`Character ${nextCharacterId} response was aborted, stopping auto-response loop`
				)
				break
			}

			// For single character chats, stop after one response
			if (!chat.isGroup) {
				console.log("Single character chat - stopping after one response")
				break
			}
		}
	}
}

export async function deleteChatMessage(
	socket: any,
	message: Sockets.DeleteChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const chatMsg = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, message.id),
		columns: {
			chatId: true,
			adapterId: true,
			isGenerating: true
		}
	})
	if (!chatMsg) {
		const res = { error: "Message not found." }
		emitToUser("error", res)
		return
	}

	// If the message being deleted is currently generating, abort it first
	if (chatMsg.isGenerating && chatMsg.adapterId) {
		const adapter = activeAdapters.get(chatMsg.adapterId)
		if (adapter) {
			try {
				adapter.abort()
				console.log(
					`Aborted generating message ${message.id} before deletion`
				)
			} catch (e) {
				console.warn(
					`Failed to abort adapter for message ${message.id}:`,
					e
				)
			}
		}
		activeAdapters.delete(chatMsg.adapterId)
	}

	const userId = 1 // Replace with actual user id
	await db
		.delete(schema.chatMessages)
		.where(
			and(
				eq(schema.chatMessages.id, message.id),
				eq(schema.chatMessages.userId, userId)
			)
		)

	// Emit the delete response first
	const res: Sockets.DeleteChatMessage.Response = { id: message.id }
	emitToUser("deleteChatMessage", res)

	// Then refresh the chat to ensure UI is updated with latest state
	await getChat(socket, { id: chatMsg.chatId }, emitToUser)
}

export async function updateChatMessage(
	socket: any,
	message: Sockets.UpdateChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const data = { ...message.chatMessage }
	delete data.id // Remove id to avoid conflicts with update
	const [updated] = await db
		.update(schema.chatMessages)
		.set({ ...data })
		.where(
			and(
				eq(schema.chatMessages.id, message.chatMessage.id),
				eq(schema.chatMessages.userId, userId)
			)
		)
		.returning()
	// Instead of refreshing the chat, emit the updated chatMessage
	await chatMessage(socket, { chatMessage: updated as any }, emitToUser)
	const res: Sockets.UpdateChatMessage.Response = {
		chatMessage: updated as any
	}
	emitToUser("updateChatMessage", res)
}

export const chatsDeleteHandler: Handler<Sockets.Chats.Delete.Params, Sockets.Chats.Delete.Response> = {
	event: "chats:delete",
	async handler(socket, params, emitToUser) {
		try {
			const userId = 1 // Replace with actual user id
			await db
				.delete(schema.chats)
				.where(
					and(
						eq(schema.chats.id, params.id),
						eq(schema.chats.userId, userId)
					)
				)
			return { success: "Chat deleted successfully" }
		} catch (error) {
			throw error
		}
	}
}

export const chatsGetHandler: Handler<Sockets.Chats.Get.Params, Sockets.Chats.Get.Response> = {
	event: "chats:get",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			const chatData = await getChatFromDB(params.id, userId)
			
			if (!chatData) {
				const res: Sockets.Chats.Get.Response = {
					chat: null,
					messages: null
				}
				emitToUser("chats:get", res)
				return res
			}

			const res: Sockets.Chats.Get.Response = {
				chat: chatData as any,
				messages: (chatData as any).chatMessages || null
			}
			emitToUser("chats:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching chat:", error)
			emitToUser("chats:get:error", {
				error: "Failed to fetch chat"
			})
			throw error
		}
	}
}

export const chatsUpdateHandler: Handler<Sockets.Chats.Update.Params, Sockets.Chats.Update.Response> = {
	event: "chats:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			
			// Update the chat
			await db
				.update(schema.chats)
				.set(params.chat)
				.where(
					and(
						eq(schema.chats.id, params.chat.id!),
						eq(schema.chats.userId, userId)
					)
				)

			// Fetch updated chat
			const updatedChat = await getChatFromDB(params.chat.id!, userId)
			if (!updatedChat) {
				throw new Error("Failed to fetch updated chat")
			}

			const res: Sockets.Chats.Update.Response = {
				chat: updatedChat as any
			}
			emitToUser("chats:update", res)
			await chatsListHandler.handler(socket, {}, emitToUser) // Refresh chat list
			return res
		} catch (error: any) {
			console.error("Error updating chat:", error)
			emitToUser("chats:update:error", {
				error: "Failed to update chat"
			})
			throw error
		}
	}
}

export const chatMessagesSendPersonaMessageHandler: Handler<Sockets.ChatMessages.SendPersonaMessage.Params, Sockets.ChatMessages.SendPersonaMessage.Response> = {
	event: "chatMessages:sendPersonaMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			const { chatId, personaId, content } = params
			const userId = 1 // Replace with actual user id
			
			// Check if chat exists
			const chat = await getPromptChatFromDb(chatId, userId)
			if (!chat) {
				const res: Sockets.ChatMessages.SendPersonaMessage.Response = {
					chatMessage: undefined,
					error: "Chat not found"
				}
				emitToUser("chatMessages:sendPersonaMessage", res)
				return res
			}

			// Create the new message
			const newMessage: InsertChatMessage = {
				userId,
				chatId,
				personaId: personaId || null,
				role: "user",
				content
			}

			const [inserted] = await db
				.insert(schema.chatMessages)
				.values(newMessage)
				.returning()

			const res: Sockets.ChatMessages.SendPersonaMessage.Response = {
				chatMessage: inserted as any
			}
			emitToUser("chatMessages:sendPersonaMessage", res)
			return res
		} catch (error: any) {
			console.error("Error sending persona message:", error)
			const res: Sockets.ChatMessages.SendPersonaMessage.Response = {
				chatMessage: undefined,
				error: "Failed to send message"
			}
			emitToUser("chatMessages:sendPersonaMessage:error", res)
			throw error
		}
	}
}

export const chatMessagesUpdateHandler: Handler<Sockets.ChatMessages.Update.Params, Sockets.ChatMessages.Update.Response> = {
	event: "chatMessages:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const { id, content } = params
			const userId = 1 // Replace with actual user id
			
			// Update the message
			const [updated] = await db
				.update(schema.chatMessages)
				.set({ content })
				.where(
					and(
						eq(schema.chatMessages.id, id),
						eq(schema.chatMessages.userId, userId)
					)
				)
				.returning()

			if (!updated) {
				const res: Sockets.ChatMessages.Update.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:update", res)
				return res
			}

			const res: Sockets.ChatMessages.Update.Response = {
				chatMessage: updated as any
			}
			emitToUser("chatMessages:update", res)
			return res
		} catch (error: any) {
			console.error("Error updating chat message:", error)
			const res: Sockets.ChatMessages.Update.Response = {
				chatMessage: undefined,
				error: "Failed to update message"
			}
			emitToUser("chatMessages:update:error", res)
			throw error
		}
	}
}

export const chatMessagesDeleteHandler: Handler<Sockets.ChatMessages.Delete.Params, Sockets.ChatMessages.Delete.Response> = {
	event: "chatMessages:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			
			// Delete the message
			await db
				.delete(schema.chatMessages)
				.where(
					and(
						eq(schema.chatMessages.id, params.id),
						eq(schema.chatMessages.userId, userId)
					)
				)

			const res: Sockets.ChatMessages.Delete.Response = {
				success: "Message deleted successfully"
			}
			emitToUser("chatMessages:delete", res)
			return res
		} catch (error: any) {
			console.error("Error deleting chat message:", error)
			const res: Sockets.ChatMessages.Delete.Response = {
				error: "Failed to delete message"
			}
			emitToUser("chatMessages:delete:error", res)
			throw error
		}
	}
}

export const chatMessagesRegenerateHandler: Handler<Sockets.ChatMessages.Regenerate.Params, Sockets.ChatMessages.Regenerate.Response> = {
	event: "chatMessages:regenerate",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			
			// Get the message to regenerate
			const messageToRegenerate = await db.query.chatMessages.findFirst({
				where: (cm, { and, eq }) => and(
					eq(cm.id, params.id),
					eq(cm.userId, userId)
				)
			})

			if (!messageToRegenerate) {
				const res: Sockets.ChatMessages.Regenerate.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:regenerate", res)
				return res
			}

			// Clear the content and set as generating
			const [updated] = await db
				.update(schema.chatMessages)
				.set({ 
					content: "",
					isGenerating: true
				})
				.where(eq(schema.chatMessages.id, params.id))
				.returning()

			const res: Sockets.ChatMessages.Regenerate.Response = {
				chatMessage: updated as any
			}
			emitToUser("chatMessages:regenerate", res)
			return res
		} catch (error: any) {
			console.error("Error regenerating chat message:", error)
			const res: Sockets.ChatMessages.Regenerate.Response = {
				chatMessage: undefined,
				error: "Failed to regenerate message"
			}
			emitToUser("chatMessages:regenerate:error", res)
			throw error
		}
	}
}

export const chatMessagesSwipeLeftHandler: Handler<Sockets.ChatMessages.SwipeLeft.Params, Sockets.ChatMessages.SwipeLeft.Response> = {
	event: "chatMessages:swipeLeft",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			
			// Get the message
			const message = await db.query.chatMessages.findFirst({
				where: (cm, { and, eq }) => and(
					eq(cm.id, params.id),
					eq(cm.userId, userId)
				)
			})

			if (!message) {
				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			// Handle swipe left logic (move to previous swipe)
			const metadata = message.metadata as any
			if (metadata?.swipes && metadata.swipes.currentIdx > 0) {
				metadata.swipes.currentIdx -= 1
				const newContent = metadata.swipes.history[metadata.swipes.currentIdx]
				
				const [updated] = await db
					.update(schema.chatMessages)
					.set({ 
						content: newContent,
						metadata: metadata
					})
					.where(eq(schema.chatMessages.id, params.id))
					.returning()

				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: updated as any
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			const res: Sockets.ChatMessages.SwipeLeft.Response = {
				chatMessage: message as any
			}
			emitToUser("chatMessages:swipeLeft", res)
			return res
		} catch (error: any) {
			console.error("Error swiping left chat message:", error)
			const res: Sockets.ChatMessages.SwipeLeft.Response = {
				chatMessage: undefined,
				error: "Failed to swipe left"
			}
			emitToUser("chatMessages:swipeLeft:error", res)
			throw error
		}
	}
}

export const chatMessagesSwipeRightHandler: Handler<Sockets.ChatMessages.SwipeRight.Params, Sockets.ChatMessages.SwipeRight.Response> = {
	event: "chatMessages:swipeRight",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			
			// Get the message
			const message = await db.query.chatMessages.findFirst({
				where: (cm, { and, eq }) => and(
					eq(cm.id, params.id),
					eq(cm.userId, userId)
				)
			})

			if (!message) {
				const res: Sockets.ChatMessages.SwipeRight.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:swipeRight", res)
				return res
			}

			// Handle swipe right logic (move to next swipe)
			const metadata = message.metadata as any
			if (metadata?.swipes && metadata.swipes.currentIdx < metadata.swipes.history.length - 1) {
				metadata.swipes.currentIdx += 1
				const newContent = metadata.swipes.history[metadata.swipes.currentIdx]
				
				const [updated] = await db
					.update(schema.chatMessages)
					.set({ 
						content: newContent,
						metadata: metadata
					})
					.where(eq(schema.chatMessages.id, params.id))
					.returning()

				const res: Sockets.ChatMessages.SwipeRight.Response = {
					chatMessage: updated as any
				}
				emitToUser("chatMessages:swipeRight", res)
				return res
			}

			const res: Sockets.ChatMessages.SwipeRight.Response = {
				chatMessage: message as any
			}
			emitToUser("chatMessages:swipeRight", res)
			return res
		} catch (error: any) {
			console.error("Error swiping right chat message:", error)
			const res: Sockets.ChatMessages.SwipeRight.Response = {
				chatMessage: undefined,
				error: "Failed to swipe right"
			}
			emitToUser("chatMessages:swipeRight:error", res)
			throw error
		}
	}
}

export const chatsGetResponseOrderHandler: Handler<Sockets.Chats.GetResponseOrder.Params, Sockets.Chats.GetResponseOrder.Response> = {
	event: "chats:getResponseOrder",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			const chat = await getPromptChatFromDb(params.chatId, userId)

			if (!chat) {
				const res: Sockets.Chats.GetResponseOrder.Response = {
					characterId: null
				}
				emitToUser("chats:getResponseOrder", res)
				return res
			}

			// Get next character turn using existing logic
			const nextCharacterId = getNextCharacterTurn(
				{
					chatMessages: chat.chatMessages,
					chatCharacters: chat.chatCharacters
						.filter((cc) => cc.character !== null && cc.isActive)
						.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) as any,
					chatPersonas: chat.chatPersonas.filter(
						(cp) => cp.persona !== null
					) as any
				},
				{ triggered: false }
			)

			const res: Sockets.Chats.GetResponseOrder.Response = {
				characterId: nextCharacterId
			}
			emitToUser("chats:getResponseOrder", res)
			return res
		} catch (error: any) {
			console.error("Error getting chat response order:", error)
			const res: Sockets.Chats.GetResponseOrder.Response = {
				characterId: null
			}
			emitToUser("chats:getResponseOrder:error", res)
			throw error
		}
	}
}

export const chatMessagesCancelHandler: Handler<Sockets.ChatMessages.Cancel.Params, Sockets.ChatMessages.Cancel.Response> = {
	event: "chatMessages:cancel",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			
			// Find messages being generated for this chat
			const generatingMessages = await db.query.chatMessages.findMany({
				where: (cm, { and, eq }) => and(
					eq(cm.chatId, params.chatId),
					eq(cm.isGenerating, true),
					eq(cm.userId, userId)
				)
			})

			// Stop generation for all messages in this chat
			for (const message of generatingMessages) {
				await db
					.update(schema.chatMessages)
					.set({ 
						isGenerating: false,
						adapterId: null
					})
					.where(eq(schema.chatMessages.id, message.id))

				// If there's an active adapter, try to abort it
				if (message.adapterId) {
					const adapter = activeAdapters.get(message.adapterId)
					if (adapter) {
						try {
							adapter.abort()
						} catch (e) {
							// Silent fail for abort
							console.warn("Failed to abort adapter:", e)
						}
					}
				}
			}

			const res: Sockets.ChatMessages.Cancel.Response = {
				success: `Cancelled ${generatingMessages.length} generating messages`
			}
			emitToUser("chatMessages:cancel", res)
			return res
		} catch (error: any) {
			console.error("Error cancelling chat messages:", error)
			const res: Sockets.ChatMessages.Cancel.Response = {
				error: "Failed to cancel messages"
			}
			emitToUser("chatMessages:cancel:error", res)
			throw error
		}
	}
}

export const updateChatHandler: Handler<Sockets.UpdateChat.Call, Sockets.UpdateChat.Response> = {
	event: "updateChat",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			const tags = params.chat.tags || []

			// Select the chat to compare data
			const existingChat = await getPromptChatFromDb(params.chat.id, userId)

			// Remove tags and id from chat data as they will be handled separately
			const { tags: _, id: __, ...chatDataWithoutTags } = params.chat

			await db
				.update(schema.chats)
				.set({
					...chatDataWithoutTags,
					isGroup: params.characterIds.length > 1,
					userId: undefined
				})
				.where(
					and(
						eq(schema.chats.id, params.chat.id),
						eq(schema.chats.userId, userId)
					)
				)

			// Process tags after chat update
			await processChatTags(params.chat.id, tags)

			// Remove any characters that are not in the new list
			const deletedCharacterIds =
				existingChat?.chatCharacters
					.filter(
						(c) => !params.characterIds.includes(c.characterId || 0)
					)
					.map((c) => c.characterId)
					.filter(
						(id): id is number => id !== null && id !== undefined
					) || []

			// Remove any personas that are not in the new list
			const deletedPersonaIds =
				existingChat?.chatPersonas
					.filter((p) => !params.personaIds.includes(p.personaId || 0))
					.map((p) => p.personaId)
					.filter(
						(id): id is number => id !== null && id !== undefined
					) || []

			// Delete removed characters
			if (deletedCharacterIds.length > 0) {
				await db
					.delete(schema.chatCharacters)
					.where(
						and(
							eq(schema.chatCharacters.chatId, params.chat.id),
							inArray(schema.chatCharacters.characterId, deletedCharacterIds)
						)
					)
			}

			// Delete removed personas
			if (deletedPersonaIds.length > 0) {
				await db
					.delete(schema.chatPersonas)
					.where(
						and(
							eq(schema.chatPersonas.chatId, params.chat.id),
							inArray(schema.chatPersonas.personaId, deletedPersonaIds)
						)
					)
			}

			// Add new characters
			for (const characterId of params.characterIds) {
				const position = params.characterPositions[characterId] || 0
				await db
					.insert(schema.chatCharacters)
					.values({
						chatId: params.chat.id,
						characterId,
						position,
						isActive: true
					})
					.onConflictDoUpdate({
						target: [schema.chatCharacters.chatId, schema.chatCharacters.characterId],
						set: { position, isActive: true }
					})
			}

			// Add new personas
			for (const personaId of params.personaIds) {
				await db
					.insert(schema.chatPersonas)
					.values({
						chatId: params.chat.id,
						personaId
					})
					.onConflictDoNothing()
			}

			// Fetch updated chat
			const updatedChat = await getPromptChatFromDb(params.chat.id, userId)

			const res: Sockets.UpdateChat.Response = {
				chat: updatedChat
			}
			emitToUser("updateChat", res)
			return res
		} catch (error: any) {
			console.error("Error updating chat:", error)
			const res: Sockets.UpdateChat.Response = {
				error: "Failed to update chat"
			}
			emitToUser("updateChat:error", res)
			throw error
		}
	}
}

export async function deleteChat(
	socket: any,
	message: Sockets.Chats.Delete.Params,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const userId = 1 // Replace with actual user id
		await db
			.delete(schema.chats)
			.where(
				and(
					eq(schema.chats.id, message.id),
					eq(schema.chats.userId, userId)
				)
			)
		const res: Sockets.Chats.Delete.Response = { success: "Chat deleted successfully" }
		emitToUser("deleteChat", res)
	} catch (error) {
		// Optionally emit a separate error event
	}
}

export async function regenerateChatMessage(
	socket: any,
	message: Sockets.RegenerateChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chatMessage = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, message.id)
	})
	if (!chatMessage) {
		const res: Sockets.RegenerateChatMessage.Response = {
			error: "Message not found."
		}
		emitToUser("regenerateChatMessage", res)
		return
	}
	const chat = await getPromptChatFromDb(chatMessage.chatId, userId)
	if (!chat) {
		const res: Sockets.RegenerateChatMessage.Response = {
			error: "Error Regenerating Message: Chat not found."
		}
		emitToUser("regenerateChatMessage", res)
		return
	}

	const data: InsertChatMessage = {
		...chatMessage,
		content: "",
		isGenerating: true
	}
	delete data.id // Remove id to avoid conflicts with update

	// Check if we need to clear swipe history
	if (
		typeof (data.metadata?.swipes?.currentIdx || null) === "number" &&
		(data.metadata?.swipes?.history.length || 0) > 0
	) {
		data.metadata!.swipes!.history[data.metadata!.swipes!.currentIdx!] = ""
	}

	await db
		.update(schema.chatMessages)
		.set(data)
		.where(eq(schema.chatMessages.id, chatMessage.id))

	try {
		await generateResponse({
			socket,
			emitToUser,
			chatId: chat.id,
			userId,
			generatingMessage: {
				...chatMessage,
				isGenerating: true,
				content: ""
			} as any
		})
	} catch (error) {
		console.log("Error during regeneration:", error)
		let [canceledMsg] = await db
			.update(schema.chatMessages)
			.set({
				isGenerating: false
			})
			.where(eq(schema.chatMessages.id, message.id))
			.returning()
		emitToUser("chatMessage", { chatMessage: canceledMsg })
		emitToUser("error", {
			error: "Failed to regenerate message."
		})
	}
}

export async function promptTokenCount(
	socket: any,
	message: Sockets.PromptTokenCount.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const userId = 1 // Replace with actual user id
		const chat = await getPromptChatFromDb(message.chatId, userId)
		if (!chat) {
			emitToUser("error", {
				error: "Error Generating Prompt Token Count: Chat not found."
			})
			return
		}
		const user = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId),
			with: {
				activeConnection: true,
				activeSamplingConfig: true,
				activeContextConfig: true,
				activePromptConfig: true
			}
		})
		if (
			!chat ||
			!user ||
			!user.activeConnection ||
			!user.activeSamplingConfig ||
			!user.activeContextConfig ||
			!user.activePromptConfig
		) {
			emitToUser("error", {
				error: "Incomplete configuration, failed to calculate token count."
			})
			return
		}
		let chatForPrompt = { ...chat, chatMessages: [...chat.chatMessages] }
		// if (message.content && message.role) {
		// 	// chatForPrompt.chatMessages.push({
		// 	// 	id: -1,
		// 	// 	chatId: chat.id,
		// 	// 	userId: userId,
		// 	// 	personaId: message.personaId ?? null,
		// 	// 	characterId: null,
		// 	// 	role: message.role,
		// 	// 	content: message.content,
		// 	// 	isEdited: 0,
		// 	// 	metadata: null,
		// 	// 	isGenerating: false,
		// 	// 	adapterId: null,
		// 	// 	isHidden: null
		// 	// })
		// }
		const currentCharacterId = getNextCharacterTurn(
			{
				chatMessages: chat.chatMessages,
				chatCharacters: chat.chatCharacters
					.filter(
						(cc: any) => cc && cc.character != null && cc.isActive
					)
					.sort(
						(a, b) => (a.position ?? 0) - (b.position ?? 0)
					) as any,
				chatPersonas: chat.chatPersonas.filter(
					(cp: any) => cp && cp.persona != null
				) as any
			},
			{ triggered: true }
		)

		if (!currentCharacterId) {
			emitToUser("error", { error: "No character available for prompt." })
			return
		}

		const { Adapter } = getConnectionAdapter(user.activeConnection.type)

		// Provide required params for Adapter (use defaults if not available)
		const tokenCounter = new TokenCounters("estimate")
		const tokenLimit = 4096
		const contextThresholdPercent = 0.8

		const adapter = new Adapter({
			chat: chatForPrompt,
			connection: user.activeConnection,
			sampling: user.activeSamplingConfig,
			contextConfig: user.activeContextConfig,
			promptConfig: user.activePromptConfig,
			currentCharacterId,
			tokenCounter,
			tokenLimit,
			contextThresholdPercent
		})
		const promptResult: Sockets.PromptTokenCount.Response =
			await adapter.compilePrompt({})
		emitToUser(
			"promptTokenCount",
			promptResult as Sockets.PromptTokenCount.Response
		)
	} catch (error) {
		console.error("Error in promptTokenCount:", error)
		emitToUser("error", {
			error: "Failed to calculate prompt token count."
		})
	}
}

export async function abortChatMessage(
	socket: any,
	message: Sockets.AbortChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	let chatMsg = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, message.id)
	})

	if (!chatMsg) {
		return
	}

	const adapterId = chatMsg.adapterId
	if (!adapterId) {
		// Already cleared above
		return
	}

	;[chatMsg] = await db
		.update(schema.chatMessages)
		.set({ isGenerating: false, adapterId: null })
		.where(eq(schema.chatMessages.id, message.id))
		.returning()

	const req: Sockets.ChatMessage.Call = {
		chatMessage: chatMsg
	}
	// Send updated chatMessage to the user
	await chatMessage(socket, req, emitToUser)

	const adapter = activeAdapters.get(adapterId)
	if (!adapter) {
		const res: Sockets.AbortChatMessage.Response = {
			id: message.id,
			success: true,
			info: "No active adapter, forcibly cleared."
		}
		emitToUser("chatMessage", res)
		emitToUser("abortChatMessage", res)
		return
	}
	try {
		adapter.abort()
		const res: Sockets.AbortChatMessage.Response = {
			id: message.id,
			success: true
		}
		emitToUser("chatMessage", res)
		emitToUser("abortChatMessage", res)
	} catch (e: any) {
		const res: Sockets.AbortChatMessage.Response = {
			id: message.id,
			success: false,
			error: e?.message || String(e)
		}
		emitToUser("chatMessage", res)
		emitToUser("abortChatMessage", res)
	}
}

export async function triggerGenerateMessage(
	socket: any,
	message: Sockets.TriggerGenerateMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id

	const msgLimit = 10
	let currentMsg = 1
	let triggered = true
	let ok = true

	while (currentMsg <= msgLimit && ok) {
		let chat = await getPromptChatFromDb(message.chatId, userId)
		if (!chat) {
			const res: Sockets.TriggerGenerateMessage.Response = {
				error: "Error Triggering Chat Message: Chat not found."
			}
			emitToUser("triggerGenerateMessage", res)
			return
		}

		// Check if there are any ongoing generations before starting a new one
		const hasGeneratingMessages = chat.chatMessages.some(
			(msg) => msg.isGenerating
		)
		if (hasGeneratingMessages) {
			console.log("Generation already in progress, stopping trigger loop")
			break
		}

		// Find the next character who should reply (using triggered: true)
		const nextCharacterId =
			message.characterId ||
			getNextCharacterTurn(
				{
					chatMessages: chat.chatMessages,
					chatCharacters: chat.chatCharacters
						.filter((cc) => cc.character !== null && cc.isActive)
						.sort(
							(a, b) => (a.position ?? 0) - (b.position ?? 0)
						) as any,
					chatPersonas: chat.chatPersonas.filter(
						(cp) => cp.persona !== null
					) as any
				},
				{ triggered }
			)

		if (!nextCharacterId) {
			break
		}
		if (chat && chat.chatCharacters.length > 0 && nextCharacterId) {
			const nextCharacter = chat.chatCharacters.find(
				(cc) => cc.character && cc.character.id === nextCharacterId
			)
			if (!nextCharacter || !nextCharacter.character) return
			const assistantMessage: InsertChatMessage = {
				userId,
				chatId: message.chatId,
				personaId: null,
				characterId: nextCharacter.character.id,
				content: "",
				role: "assistant",
				isGenerating: true
			}
			const [generatingMessage] = await db
				.insert(schema.chatMessages)
				.values(assistantMessage)
				.returning()
			await chatMessage(
				socket,
				{ chatMessage: generatingMessage },
				emitToUser
			)
			ok = await generateResponse({
				socket,
				emitToUser,
				chatId: message.chatId,
				userId,
				generatingMessage: generatingMessage as any
			})

			// If generation was aborted, stop the loop
			if (!ok) {
				console.log("Generation was aborted, stopping trigger loop")
				break
			}
		}
		if (message.once) {
			break
		}
		currentMsg++
		triggered = false // After the first message, we don't trigger again
	}
}

export const chatMessageHandler: Handler<Sockets.ChatMessage.Call, Sockets.ChatMessage.Response> = {
	event: "chatMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			if (params.chatMessage) {
				// If chatMessage object is provided, emit it directly
				const res: Sockets.ChatMessage.Response = {
					chatMessage: params.chatMessage
				}
				emitToUser("chatMessage", res)
				return res
			} else if (params.id) {
				// If id is provided, fetch from database
				const chatMessage = await db.query.chatMessages.findFirst({
					where: (m, { eq }) => eq(m.id, params.id!)
				})
				if (!chatMessage) {
					const res: Sockets.ChatMessage.Response = {
						error: "Chat message not found."
					}
					emitToUser("chatMessage:error", res)
					throw new Error("Chat message not found")
				}
				const res: Sockets.ChatMessage.Response = { chatMessage }
				emitToUser("chatMessage", res)
				return res
			} else {
				const res: Sockets.ChatMessage.Response = {
					error: "Must provide either id or chatMessage."
				}
				emitToUser("chatMessage:error", res)
				throw new Error("Must provide either id or chatMessage")
			}
		} catch (error: any) {
			console.error("Error in chatMessage handler:", error)
			const res: Sockets.ChatMessage.Response = {
				error: "Failed to get chat message"
			}
			emitToUser("chatMessage:error", res)
			throw error
		}
	}
}

export async function chatMessage(
	socket: any,
	message: Sockets.ChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	if (message.chatMessage) {
		// If chatMessage object is provided, emit it directly
		const res: Sockets.ChatMessage.Response = {
			chatMessage: message.chatMessage
		}
		emitToUser("chatMessage", res)
		return
	} else if (message.id) {
		// If id is provided, fetch from database
		const chatMessage = await db.query.chatMessages.findFirst({
			where: (m, { eq }) => eq(m.id, message.id!)
		})
		if (!chatMessage) {
			emitToUser("error", { error: "Chat message not found." })
			return
		}
		const res: Sockets.ChatMessage.Response = { chatMessage }
		emitToUser("chatMessage", res)
		return
	} else {
		emitToUser("error", { error: "Must provide either id or chatMessage." })
	}
}

export async function updateChat(
	socket: any,
	message: Sockets.UpdateChat.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		console.log("Updating chat with message:", message)
		const userId = 1 // Replace with actual user id
		const tags = message.chat.tags || []

		//  Select the chat to compare data
		const existingChat = await getPromptChatFromDb(message.chat.id, userId)

		// Remove tags from chat data as it will be handled separately
		const chatDataWithoutTags = { ...message.chat }
		delete chatDataWithoutTags.tags
		delete chatDataWithoutTags.id // Remove id to avoid conflicts

		await db
			.update(schema.chats)
			.set({
				...chatDataWithoutTags,
				isGroup: message.characterIds.length > 1,
				userId: undefined
			})
			.where(
				and(
					eq(schema.chats.id, message.chat.id),
					eq(schema.chats.userId, userId)
				)
			)

		// Process tags after chat update
		await processChatTags(message.chat.id, tags)

		// Remove any characters that are not in the new list
		const deletedCharacterIds =
			existingChat?.chatCharacters
				.filter(
					(c) => !message.characterIds.includes(c.characterId || 0)
				)
				.map((c) => c.characterId)
				.filter(
					(id): id is number => id !== null && id !== undefined
				) || []

		// Remove any personas that are not in the new list
		const deletedPersonaIds =
			existingChat?.chatPersonas
				.filter((p) => !message.personaIds.includes(p.personaId || 0))
				.map((p) => p.personaId)
				.filter(
					(id): id is number => id !== null && id !== undefined
				) || []

		// Find new character IDs that are not in the existing chat
		const newCharacterIds = message.characterIds.filter(
			(id) =>
				!existingChat?.chatCharacters.some((c) => c.characterId === id)
		)

		// Find new persona IDs that are not in the existing chat
		const newPersonaIds = message.personaIds.filter(
			(id) => !existingChat?.chatPersonas.some((p) => p.personaId === id)
		)

		// Delete characters that are no longer in the chat
		if (deletedCharacterIds.length > 0) {
			await db
				.delete(schema.chatCharacters)
				.where(
					and(
						eq(schema.chatCharacters.chatId, message.chat.id),
						inArray(
							schema.chatCharacters.characterId,
							deletedCharacterIds
						)
					)
				)
		}

		// Delete personas that are no longer in the chat
		if (deletedPersonaIds.length > 0) {
			await db
				.delete(schema.chatPersonas)
				.where(
					and(
						eq(schema.chatPersonas.chatId, message.chat.id),
						inArray(
							schema.chatPersonas.personaId,
							deletedPersonaIds
						)
					)
				)
		}

		// Insert new characters that are not already in the chat
		if (newCharacterIds.length > 0) {
			const newChatCharacters = newCharacterIds.map((characterId) => ({
				chatId: message.chat.id,
				characterId,
				position: message.characterPositions[characterId] ?? 0
			}))
			await db.insert(schema.chatCharacters).values(newChatCharacters)
		}

		// Insert new personas that are not already in the chat
		if (newPersonaIds.length > 0) {
			const newChatPersonas = newPersonaIds.map((personaId) => ({
				chatId: message.chat.id,
				personaId
			}))
			await db.insert(schema.chatPersonas).values(newChatPersonas)
		}

		// Update positions for all characters in the chat (not just new ones)
		if (message.characterPositions) {
			for (const characterId of message.characterIds) {
				const position = message.characterPositions[characterId]
				console.log(
					"Updating position for characterId",
					characterId,
					"to",
					position
				)
				if (typeof position === "number") {
					await db
						.update(schema.chatCharacters)
						.set({ position })
						.where(
							and(
								eq(
									schema.chatCharacters.chatId,
									message.chat.id
								),
								eq(
									schema.chatCharacters.characterId,
									characterId
								)
							)
						)
				}
			}
		}

		// After updating character positions in the DB, also update the position field for existing characters
		if (message.characterPositions) {
			for (const [characterId, position] of Object.entries(
				message.characterPositions
			)) {
				await db
					.update(schema.chatCharacters)
					.set({ position })
					.where(
						and(
							eq(schema.chatCharacters.chatId, message.chat.id),
							eq(
								schema.chatCharacters.characterId,
								Number(characterId)
							)
						)
					)
			}
		}

		// Insert a first message for every new character added to the chat, ordered by position
		if (newCharacterIds.length > 0) {
			const newChatCharacters = await db.query.chatCharacters.findMany({
				where: (cc, { eq }) => eq(cc.chatId, message.chat.id),
				with: { character: true },
				orderBy: (cc, { asc }) => asc(cc.position ?? 0)
			})
			const chatPersona = await db.query.chatPersonas.findFirst({
				where: (cp, { eq, and, isNotNull }) =>
					and(
						eq(cp.chatId, message.chat.id),
						isNotNull(cp.personaId)
					),
				with: { persona: true },
				orderBy: (cp, { asc }) => asc(cp.position ?? 0)
			})
			for (const cc of newChatCharacters) {
				if (!cc.character) continue
				if (!newCharacterIds.includes(cc.character.id)) continue
				const greetings = buildCharacterFirstChatMessage({
					character: cc.character,
					persona: chatPersona?.persona,
					isGroup: message.characterIds.length > 1
				})
				if (greetings.length > 0) {
					const newMessage: InsertChatMessage = {
						userId,
						chatId: message.chat.id,
						personaId: null,
						characterId: cc.character.id,
						role: "assistant",
						content: greetings[0],
						isGenerating: false,
						metadata: {
							isGreeting: true,
							swipes: {
								currentIdx: 0,
								history: greetings as any // Patch: force string[]
							}
						}
					}
					await db.insert(schema.chatMessages).values(newMessage)
				}
			}
		}

		// Fetch the updated chat with all relations
		const resChat = await getChatFromDB(message.chat.id, userId)

		if (!resChat) return
		const res: Sockets.UpdateChat.Response = { chat: resChat as any }
		await chatsList(socket, {}, emitToUser)
		emitToUser("updateChat", res)
	} catch (error) {
		console.error("Error updating chat:", error)
		emitToUser("error", { error: "Failed to update chat." })
	}
}

export async function chatMessageSwipeRight(
	socket: any,
	message: Sockets.ChatMessageSwipeRight.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) =>
			and(eq(c.id, message.chatId), eq(c.userId, userId)),
		with: {
			chatMessages: true
		}
	})
	if (!chat) {
		const res = {
			error: "Error Swiping Chat Message Right: Chat not found."
		}
		emitToUser("error", res)
		return
	}
	const chatMessage = chat.chatMessages.find(
		(cm) => cm.id === message.chatMessageId
	)
	if (!chatMessage) {
		const res = {
			error: "Chat message not found."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.isGenerating) {
		const res = {
			error: "Message is still generating, please wait."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.isHidden) {
		const res = {
			error: "Message is hidden, cannot swipe right."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.role !== "assistant") {
		const res = {
			error: "Only assistant messages can be swiped right."
		}
		emitToUser("error", res)
		return
	}

	interface MetaData {
		swipes?: {
			currentIdx: number | null
			history: string[]
		}
	}

	let isOnLastSwipe = false

	// Check if metadata.swipes, if not, initialize it
	const data: SelectChatMessage = {
		...chatMessage,
		metadata: {
			...chatMessage.metadata,
			swipes: {
				currentIdx: null,
				history: [],
				...(chatMessage.metadata?.swipes || {})
			}
		}
	}

	// Check if we are on the last swipe (or if there are no swipes)
	if (
		!data.metadata!.swipes!.history.length ||
		data.metadata!.swipes!.currentIdx === null
	) {
		isOnLastSwipe = true
	} else {
		isOnLastSwipe =
			data.metadata!.swipes!.currentIdx ===
			data.metadata!.swipes!.history.length - 1
	}

	if (!isOnLastSwipe) {
		// If not on the last swipe, just update the current index and content
		data.metadata!.swipes!.currentIdx =
			(data.metadata!.swipes!.currentIdx || 0) + 1
		data.content =
			data.metadata!.swipes!.history[data.metadata!.swipes!.currentIdx] ||
			""
	} else {
		if (data.metadata!.swipes!.currentIdx === null) {
			;((data.metadata!.swipes!.currentIdx = 0),
				data.metadata!.swipes!.history.push(data.content))
		}
		// Now increment the current index and content
		data.metadata!.swipes!.currentIdx += 1
		data.content = "" // Clear the message content
		data.isGenerating = true // Set generating state to true
		// Push the new empty content to history
		data.metadata!.swipes!.history.push("") // Add an empty string to history
	}

	delete data.id

	// Update the chat message in the database
	const [updatedMessage] = await db
		.update(schema.chatMessages)
		.set({ ...data })
		.where(eq(schema.chatMessages.id, chatMessage.id))
		.returning()

	if (!updatedMessage) {
		const res = {
			error: "Failed to update chat message."
		}
		emitToUser("error", res)
		return
	}

	if (!updatedMessage.isGenerating) {
		// If the message is not generating, emit the updated chatMessage
		const chatMsgRes: Sockets.ChatMessage.Response = {
			chatMessage: updatedMessage as any
		}
		emitToUser("chatMessage", chatMsgRes)
		const res: Sockets.ChatMessageSwipeRight.Response = {
			chatId: chat.id,
			chatMessageId: updatedMessage.id,
			done: true
		}

		emitToUser("chatMessageSwipeRight", res)
		return
	}

	// If the message is generating, we need to start generating a response
	await generateResponse({
		socket,
		emitToUser,
		chatId: chat.id,
		userId,
		generatingMessage: updatedMessage as any
	})

	const res: Sockets.ChatMessageSwipeRight.Response = {
		chatId: chat.id,
		chatMessageId: updatedMessage.id,
		done: true
	}

	emitToUser("chatMessageSwipeRight", res)
}

export async function chatMessageSwipeLeft(
	socket: any,
	message: Sockets.ChatMessageSwipeLeft.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) =>
			and(eq(c.id, message.chatId), eq(c.userId, userId)),
		with: {
			chatMessages: true
		}
	})
	if (!chat) {
		const res = {
			error: "Error Swiping Chat Message Left: Chat not found."
		}
		emitToUser("error", res)
		return
	}
	const chatMessage = chat.chatMessages.find(
		(cm) => cm.id === message.chatMessageId
	)
	if (!chatMessage) {
		const res = {
			error: "Chat message not found."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.isGenerating) {
		const res = {
			error: "Message is still generating, please wait."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.isHidden) {
		const res = {
			error: "Message is hidden, cannot swipe right."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.role !== "assistant") {
		const res = {
			error: "Only assistant messages can be swiped right."
		}
		emitToUser("error", res)
		return
	}

	interface MetaData {
		swipes?: {
			currentIdx: number | null
			history: string[]
		}
	}

	let isOnLastSwipe = false

	// Check if metadata.swipes, if not, initialize it
	const data: SelectChatMessage = {
		...chatMessage,
		metadata: {
			...chatMessage.metadata,
			swipes: {
				currentIdx: null,
				history: [],
				...(chatMessage.metadata?.swipes || {})
			}
		}
	}

	// Check if we are on the last left swipe (idx=0|null) (or if there are no swipes)
	if (
		!data.metadata!.swipes!.history.length ||
		data.metadata!.swipes!.currentIdx === null ||
		data.metadata!.swipes!.currentIdx === 0
	) {
		isOnLastSwipe = true
	} else {
		isOnLastSwipe =
			data.metadata!.swipes!.currentIdx === 0 &&
			data.metadata!.swipes!.history.length > 0
	}

	// If we are on the last left swipe, return an error
	if (isOnLastSwipe) {
		const res = {
			error: "Already on the last left swipe, cannot swipe left."
		}
		emitToUser("error", res)
		return
	}

	// If not on the last left swipe, just update the current index and content
	data.metadata!.swipes!.currentIdx =
		(data.metadata!.swipes!.currentIdx || 0) - 1
	data.content =
		data.metadata!.swipes!.history[data.metadata!.swipes!.currentIdx] || "" // Set content to the previous swipe content
	// Update the chat message in the database
	delete data.id
	const [updatedMessage] = await db
		.update(schema.chatMessages)
		.set({ ...data })
		.where(eq(schema.chatMessages.id, chatMessage.id))
		.returning()

	if (!updatedMessage) {
		const res = {
			error: "Failed to update chat message."
		}
		emitToUser("error", res)
		return
	}

	const chatRes: Sockets.ChatMessage.Response = {
		chatMessage: updatedMessage
	}
	socket.emit("chatMessage", chatRes)
	const res: Sockets.ChatMessageSwipeLeft.Response = {
		chatId: chat.id,
		chatMessageId: updatedMessage.id,
		done: true
	}
	emitToUser("chatMessageSwipeLeft", res)
}

// Builds the chatMessage history for the first chat message of a character, with history swipes for the user to choose from
function buildCharacterFirstChatMessage({
	character,
	persona,
	isGroup
}: {
	character: SelectCharacter
	persona: SelectPersona | undefined | null
	isGroup: boolean
}): string[] {
	if (dev) {
		console.log(
			"Building first chat message for character:",
			character.name,
			"with persona:",
			persona?.name
		)
	}
	const history: string[] = []
	const engine = new InterpolationEngine()
	const context = engine.createInterpolationContext({
		currentCharacterName: character.nickname || character.name,
		currentPersonaName: persona?.name || "User"
	})
	if (dev) {
		console.log("Interpolation context:", context)
	}
	if (!isGroup || !character.groupOnlyGreetings?.length) {
		if (character.firstMessage) {
			const interpolated = engine.interpolateString(
				character.firstMessage.trim(),
				context
			)!
			if (dev) {
				console.log(
					"Interpolated firstMessage:",
					character.firstMessage.trim(),
					"->",
					interpolated
				)
			}
			history.push(interpolated)
		}
		if (character.alternateGreetings) {
			history.push(
				...character.alternateGreetings.map((g) => {
					const interpolated = engine.interpolateString(
						g.trim(),
						context
					)!
					if (dev) {
						console.log(
							"Interpolated alternateGreeting:",
							g.trim(),
							"->",
							interpolated
						)
					}
					return interpolated
				})
			)
		}
	} else if (character.groupOnlyGreetings?.length) {
		// If this is a group chat, use only group greetings
		history.push(
			...character.groupOnlyGreetings.map((g) => {
				const interpolated = engine.interpolateString(
					g.trim(),
					context
				)!
				if (dev) {
					console.log(
						"Interpolated groupOnlyGreeting:",
						g.trim(),
						"->",
						interpolated
					)
				}
				return interpolated
			})
		)
	} else {
		// Fallback firstMessage if no greetings are available
		history.push(
			`Sits down at the table, "I didn't think you'd show up so soon."`
		)
	}
	return history
}

export async function toggleChatCharacterActive(
	socket: any,
	message: Sockets.ToggleChatCharacterActive.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	if (!userId) return

	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) =>
			and(eq(c.id, message.chatId), eq(c.userId, userId)),
		with: {
			chatCharacters: {
				where: (cc, { eq }) => eq(cc.characterId, message.characterId)
			}
		}
	})
	if (!chat) {
		const res = {
			error: "Error toggling character active: Chat not found."
		}
		emitToUser("error", res)
		return
	}

	if (!chat.chatCharacters || chat.chatCharacters.length === 0) {
		const res = {
			error: "Chat character not found."
		}
		emitToUser("error", res)
		return
	}

	const chatCharacter = chat.chatCharacters[0]

	await db
		.update(schema.chatCharacters)
		.set({ isActive: !chatCharacter.isActive })
		.where(
			and(
				eq(schema.chatCharacters.characterId, message.characterId),
				eq(schema.chatCharacters.chatId, message.chatId)
			)
		)

	const res: Sockets.ToggleChatCharacterActive.Response = {
		chatId: message.chatId,
		characterId: message.characterId,
		isActive: !chatCharacter.isActive
	}

	emitToUser("toggleChatCharacterActive", res)

	await getChat(socket, { id: chat.id }, emitToUser)
}

export async function updateChatCharacterVisibility(
	socket: any,
	message: Sockets.UpdateChatCharacterVisibility.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	if (!userId) return

	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) =>
			and(eq(c.id, message.chatId), eq(c.userId, userId)),
		with: {
			chatCharacters: {
				where: (cc, { eq }) => eq(cc.characterId, message.characterId)
			}
		}
	})
	if (!chat) {
		const res = {
			error: "Error updating character visibility: Chat not found."
		}
		emitToUser("error", res)
		return
	}

	if (!chat.chatCharacters || chat.chatCharacters.length === 0) {
		const res = {
			error: "Chat character not found."
		}
		emitToUser("error", res)
		return
	}

	// Update visibility in database
	await db
		.update(schema.chatCharacters)
		.set({ visibility: message.visibility })
		.where(
			and(
				eq(schema.chatCharacters.characterId, message.characterId),
				eq(schema.chatCharacters.chatId, message.chatId)
			)
		)

	const res: Sockets.UpdateChatCharacterVisibility.Response = {
		chatId: message.chatId,
		characterId: message.characterId,
		visibility: message.visibility
	}

	emitToUser("updateChatCharacterVisibility", res)

	await getChat(socket, { id: chat.id }, emitToUser)
}

export async function getChatResponseOrder(
	socket: any,
	message: Sockets.GetChatResponseOrder.Call,
	emitToUser: (event: string, data: any) => void
) {
	// console.log('Debug - getChatResponseOrder called for chatId:', message.chatId)
	const userId = 1 // Replace with actual user id
	const chat = await getPromptChatFromDb(message.chatId, userId)

	if (!chat) {
		const res: Sockets.GetChatResponseOrder.Response = {
			error: "Chat not found.",
			chatId: message.chatId,
		characterIds: [],
		nextCharacterId: null
	}
	emitToUser("getChatResponseOrder", res)
	return
}	// Sort characters by position to get the response order (IDs only)
	// First try active characters, if none exist, use all characters
	const activeCharacters = chat.chatCharacters.filter(
		(cc) => cc.character && cc.isActive
	)
	const charactersToUse =
		activeCharacters.length > 0
			? activeCharacters
			: chat.chatCharacters.filter((cc) => cc.character)

	const sortedCharacterIds = charactersToUse
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
		.map((cc) => cc.character!.id)

	// console.log('Debug - Characters for next turn:', { totalCharacters: chat.chatCharacters.length, activeCharacters: activeCharacters.length, charactersToUse: charactersToUse.length, sortedCharacterIds })

	// Use getNextCharacterTurn to determine who should respond next based on message history
	const nextCharacterId = getNextCharacterTurn(
		{
			chatMessages: chat.chatMessages,
			chatCharacters: chat.chatCharacters
				.filter((cc) => cc.character !== null && cc.isActive)
				.sort(
					(a, b) => (a.position ?? 0) - (b.position ?? 0)
				) as any,
			chatPersonas: chat.chatPersonas.filter(
				(cp) => cp.persona !== null
			) as any
		},
		{ triggered: false }
	)

	// console.log('Debug - Next character logic simplified:', { sortedCharacterIds, nextCharacterId })

	const res: Sockets.GetChatResponseOrder.Response = {
		chatId: message.chatId,
		characterIds: sortedCharacterIds,
		nextCharacterId
	}

	// console.log('Debug - Sending response:', { chatId: res.chatId, characterIdsCount: res.characterIds.length, nextCharacterId: res.nextCharacterId })

	emitToUser("getChatResponseOrder", res)
}

// =============================================
// TYPE-SAFE CHAT HANDLERS
// =============================================

/**
 * Type-safe handler for calculating prompt token count
 */
export const promptTokenCountHandler: Handler<
	Sockets.Chats.PromptTokenCount.Params,
	Sockets.Chats.PromptTokenCount.Response
> = {
	event: "chats:promptTokenCount",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			const chat = await getPromptChatFromDb(params.chatId, userId)
			if (!chat) {
				return {
					error: "Error Generating Prompt Token Count: Chat not found."
				}
			}
			
			const user = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.id, userId),
				with: {
					activeConnection: true,
					activeSamplingConfig: true,
					activeContextConfig: true,
					activePromptConfig: true
				}
			})
			
			if (
				!chat ||
				!user ||
				!user.activeConnection ||
				!user.activeSamplingConfig ||
				!user.activeContextConfig ||
				!user.activePromptConfig
			) {
				return {
					error: "Incomplete configuration, failed to calculate token count."
				}
			}
			
			let chatForPrompt = { ...chat, chatMessages: [...chat.chatMessages] }
			
			const currentCharacterId = getNextCharacterTurn(
				{
					chatMessages: chat.chatMessages,
					chatCharacters: chat.chatCharacters
						.filter(
							(cc: any) => cc && cc.character != null && cc.isActive
						)
						.sort(
							(a, b) => (a.position ?? 0) - (b.position ?? 0)
						) as any,
					chatPersonas: chat.chatPersonas.filter(
						(cp: any) => cp && cp.persona != null
					) as any
				},
				{ triggered: true }
			)

			if (!currentCharacterId) {
				return { error: "No character available for prompt." }
			}

			const { Adapter } = getConnectionAdapter(user.activeConnection.type)

			// Provide required params for Adapter (use defaults if not available)
			const tokenCounter = new TokenCounters("estimate")
			const tokenLimit = 4096
			const contextThresholdPercent = 0.8

			const adapter = new Adapter({
				chat: chatForPrompt,
				connection: user.activeConnection,
				sampling: user.activeSamplingConfig,
				contextConfig: user.activeContextConfig,
				promptConfig: user.activePromptConfig,
				currentCharacterId,
				tokenCounter,
				tokenLimit,
				contextThresholdPercent
			})
			
			const promptResult = await adapter.compilePrompt({})
			
			// Map CompiledPrompt to expected Ack format
			// Note: adapter.compilePrompt returns the app.d.ts CompiledPrompt format
			return {
				prompt: JSON.stringify(promptResult.prompt),
				tokenCount: undefined, // Not available in adapter CompiledPrompt format
				characterLimit: undefined, // Not available in adapter CompiledPrompt format  
				tokenLimit: undefined, // Not available in adapter CompiledPrompt format
				percentFull: undefined // Not available in adapter CompiledPrompt format
			}
		} catch (error) {
			console.error("Error in promptTokenCountHandler:", error)
			return {
				error: "Failed to calculate prompt token count."
			}
		}
	}
}

/**
 * Type-safe handler for triggering message generation
 */
export const triggerGenerateMessageHandler: Handler<
	Sockets.Chats.TriggerGenerateMessage.Params,
	Sockets.Chats.TriggerGenerateMessage.Response
> = {
	event: "chats:triggerGenerateMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			const msgLimit = 10
			let currentMsg = 1
			let triggered = true
			let ok = true

			while (currentMsg <= msgLimit && ok) {
				let chat = await getPromptChatFromDb(params.chatId, userId)
				if (!chat) {
					return {
						error: "Error Triggering Chat Message: Chat not found."
					}
				}

				// Check if there are any ongoing generations before starting a new one
				const hasGeneratingMessages = chat.chatMessages.some(
					(msg) => msg.isGenerating
				)
				if (hasGeneratingMessages) {
					console.log("Generation already in progress, stopping trigger loop")
					break
				}

				// Find the next character who should reply (using triggered: true)
				const nextCharacterId =
					params.characterId ||
					getNextCharacterTurn(
						{
							chatMessages: chat.chatMessages,
							chatCharacters: chat.chatCharacters
								.filter((cc) => cc.character !== null && cc.isActive)
								.sort(
									(a, b) => (a.position ?? 0) - (b.position ?? 0)
								) as any,
							chatPersonas: chat.chatPersonas.filter(
								(cp) => cp.persona !== null
							) as any
						},
						{ triggered }
					)

				if (!nextCharacterId) {
					break
				}
				
				if (chat && chat.chatCharacters.length > 0 && nextCharacterId) {
					const nextCharacter = chat.chatCharacters.find(
						(cc) => cc.character && cc.character.id === nextCharacterId
					)
					if (!nextCharacter || !nextCharacter.character) break
					
					const assistantMessage: InsertChatMessage = {
						userId,
						chatId: params.chatId,
						personaId: null,
						characterId: nextCharacter.character.id,
						content: "",
						role: "assistant",
						isGenerating: true
					}
					
					const [generatingMessage] = await db
						.insert(schema.chatMessages)
						.values(assistantMessage)
						.returning()
						
					if (emitToUser) {
						await chatMessage(
							socket,
							{ chatMessage: generatingMessage },
							emitToUser
						)
					}
					
					ok = await generateResponse({
						socket,
						emitToUser,
						chatId: params.chatId,
						userId,
						generatingMessage: generatingMessage as any
					})

					// If generation was aborted, stop the loop
					if (!ok) {
						console.log("Generation was aborted, stopping trigger loop")
						break
					}
				}
				currentMsg++
			}
			
			return { success: true }
		} catch (error) {
			console.error("Error in triggerGenerateMessageHandler:", error)
			return {
				error: "Failed to trigger message generation."
			}
		}
	}
}

/**
 * Type-safe handler for toggling chat character active status
 */
export const toggleChatCharacterActiveHandler: Handler<
	Sockets.Chats.ToggleChatCharacterActive.Params,
	Sockets.Chats.ToggleChatCharacterActive.Response
> = {
	event: "chats:toggleChatCharacterActive",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			if (!userId) {
				return { 
					chatId: params.chatId,
					characterId: params.characterId,
					isActive: false,
					error: "User not authenticated" 
				}
			}

			const chat = await db.query.chats.findFirst({
				where: (c, { eq, and }) =>
					and(eq(c.id, params.chatId), eq(c.userId, userId)),
				with: {
					chatCharacters: {
						where: (cc, { eq }) => eq(cc.characterId, params.characterId)
					}
				}
			})
			
			if (!chat) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					isActive: false,
					error: "Error toggling character active: Chat not found."
				}
			}

			if (!chat.chatCharacters || chat.chatCharacters.length === 0) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					isActive: false,
					error: "Chat character not found."
				}
			}

			const chatCharacter = chat.chatCharacters[0]
			const newActiveStatus = !chatCharacter.isActive

			await db
				.update(schema.chatCharacters)
				.set({ isActive: newActiveStatus })
				.where(
					and(
						eq(schema.chatCharacters.characterId, params.characterId),
						eq(schema.chatCharacters.chatId, params.chatId)
					)
				)

			// Refresh chat data
			if (emitToUser) {
				await getChat(socket, { id: chat.id }, emitToUser)
			}

			return {
				chatId: params.chatId,
				characterId: params.characterId,
				isActive: newActiveStatus
			}
		} catch (error) {
			console.error("Error in toggleChatCharacterActiveHandler:", error)
			return {
				chatId: params.chatId,
				characterId: params.characterId,
				isActive: false,
				error: "Failed to toggle character active status."
			}
		}
	}
}

/**
 * Type-safe handler for updating chat character visibility
 */
export const updateChatCharacterVisibilityHandler: Handler<
	Sockets.Chats.UpdateChatCharacterVisibility.Params,
	Sockets.Chats.UpdateChatCharacterVisibility.Response
> = {
	event: "chats:updateChatCharacterVisibility",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = 1 // Replace with actual user id
			if (!userId) {
				return { 
					chatId: params.chatId,
					characterId: params.characterId,
					visibility: params.visibility,
					error: "User not authenticated" 
				}
			}

			const chat = await db.query.chats.findFirst({
				where: (c, { eq, and }) =>
					and(eq(c.id, params.chatId), eq(c.userId, userId)),
				with: {
					chatCharacters: {
						where: (cc, { eq }) => eq(cc.characterId, params.characterId)
					}
				}
			})
			
			if (!chat) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					visibility: params.visibility,
					error: "Error updating character visibility: Chat not found."
				}
			}

			if (!chat.chatCharacters || chat.chatCharacters.length === 0) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					visibility: params.visibility,
					error: "Chat character not found."
				}
			}

			// Update visibility in database
			await db
				.update(schema.chatCharacters)
				.set({ visibility: params.visibility })
				.where(
					and(
						eq(schema.chatCharacters.characterId, params.characterId),
						eq(schema.chatCharacters.chatId, params.chatId)
					)
				)

			// Refresh chat data
			if (emitToUser) {
				await getChat(socket, { id: chat.id }, emitToUser)
			}

			return {
				chatId: params.chatId,
				characterId: params.characterId,
				visibility: params.visibility
			}
		} catch (error) {
			console.error("Error in updateChatCharacterVisibilityHandler:", error)
			return {
				chatId: params.chatId,
				characterId: params.characterId,
				visibility: params.visibility,
				error: "Failed to update character visibility."
			}
		}
	}
}

// Registration function for all chat handlers
export function registerChatHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, chatsListHandler, emitToUser)
	register(socket, chatsCreateHandler, emitToUser)
	register(socket, chatsDeleteHandler, emitToUser)
	register(socket, chatsGetHandler, emitToUser)
	register(socket, chatsUpdateHandler, emitToUser)
	register(socket, chatMessagesSendPersonaMessageHandler, emitToUser)
	register(socket, chatMessagesUpdateHandler, emitToUser)
	register(socket, chatMessagesDeleteHandler, emitToUser)
	register(socket, chatMessagesRegenerateHandler, emitToUser)
	register(socket, chatMessagesSwipeLeftHandler, emitToUser)
	register(socket, chatMessagesSwipeRightHandler, emitToUser)
	register(socket, chatsGetResponseOrderHandler, emitToUser)
	register(socket, chatMessagesCancelHandler, emitToUser)
	register(socket, updateChatHandler, emitToUser)
	register(socket, chatMessageHandler, emitToUser)
	register(socket, promptTokenCountHandler, emitToUser)
	register(socket, triggerGenerateMessageHandler, emitToUser)
	register(socket, toggleChatCharacterActiveHandler, emitToUser)
	register(socket, updateChatCharacterVisibilityHandler, emitToUser)
}
