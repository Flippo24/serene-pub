import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { generateResponse } from "../utils/generateResponse"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import type { Handler } from "$lib/shared/events"
import { broadcastToChatUsers } from "./utils/broadcastHelpers"

/**
 * Create a new assistant chat
 */
export const chatsCreateAssistantHandler: Handler<
	Sockets.Chats.CreateAssistant.Params,
	Sockets.Chats.CreateAssistant.Response
> = {
	event: "chats:createAssistant",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Create assistant chat
			const [chat] = await db
				.insert(schema.chats)
				.values({
					userId,
					name: "Assistant Chat",
					isGroup: false,
					chatType: ChatTypes.ASSISTANT
				})
				.returning()

			const res: Sockets.Chats.CreateAssistant.Response = {
				chat
			}
			emitToUser("chats:createAssistant", res)
			return res
		} catch (error) {
			console.error("Error in chatsCreateAssistantHandler:", error)
			const res: Sockets.Chats.CreateAssistant.Response = {
				error: "Failed to create assistant chat."
			}
			emitToUser("chats:createAssistant", res)
			return res
		}
	}
}

/**
 * Send a message in an assistant chat and get a response
 */
export const chatsSendAssistantMessageHandler: Handler<
	Sockets.Chats.SendAssistantMessage.Params,
	Sockets.Chats.SendAssistantMessage.Response
> = {
	event: "chats:sendAssistantMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Verify chat exists and is an assistant chat
			const chat = await db.query.chats.findFirst({
				where: (c, { eq }) => eq(c.id, params.chatId)
			})

			if (!chat) {
				const res: Sockets.Chats.SendAssistantMessage.Response = {
					error: "Chat not found."
				}
				emitToUser("chats:sendAssistantMessage", res)
				return res
			}

			if (chat.chatType !== ChatTypes.ASSISTANT) {
				const res: Sockets.Chats.SendAssistantMessage.Response = {
					error: "This is not an assistant chat."
				}
				emitToUser("chats:sendAssistantMessage", res)
				return res
			}

			if (chat.userId !== userId) {
				const res: Sockets.Chats.SendAssistantMessage.Response = {
					error: "Access denied."
				}
				emitToUser("chats:sendAssistantMessage", res)
				return res
			}

			// Create user message
			const [userMessage] = await db
				.insert(schema.chatMessages)
				.values({
					chatId: params.chatId,
					userId,
					role: "user",
					content: params.content,
					isGenerating: false
				})
				.returning()

			// Broadcast user message
			await broadcastToChatUsers(
				socket.io,
				params.chatId,
				"chatMessage",
				{
					chatMessage: userMessage
				}
			)

			// Create assistant message placeholder
			const [assistantMessage] = await db
				.insert(schema.chatMessages)
				.values({
					chatId: params.chatId,
					userId,
					role: "assistant",
					content: "",
					isGenerating: true
				})
				.returning()

			// Trigger generation
			await generateResponse({
				socket,
				emitToUser,
				chatId: params.chatId,
				userId,
				generatingMessage: assistantMessage
			})

			const res: Sockets.Chats.SendAssistantMessage.Response = {
				userMessage,
				assistantMessage
			}
			emitToUser("chats:sendAssistantMessage", res)
			return res
		} catch (error) {
			console.error("Error in chatsSendAssistantMessageHandler:", error)
			const res: Sockets.Chats.SendAssistantMessage.Response = {
				error: "Failed to send message."
			}
			emitToUser("chats:sendAssistantMessage", res)
			return res
		}
	}
}
