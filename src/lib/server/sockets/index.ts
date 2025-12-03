import type { Handler } from "$lib/shared/events"
import type { AuthenticatedSocket } from "./auth"
import { registerConnectionHandlers } from "./connections"
import { registerSamplingConfigHandlers } from "./samplingConfigs"
import { registerCharacterHandlers } from "./characters"
import { registerPersonaHandlers } from "./personas"
import { registerContextConfigHandlers } from "./contextConfigs"
import { registerChatHandlers } from "./chats"
import {
	chatsListAssistantHandler,
	chatsCreateAssistantHandler,
	assistantUpdateDraftHandler
} from "./assistantChats"
import { handleAssistantFunctions } from "./assistantFunctions"
import { handleAssistantV2 } from "./assistantV2"
import { registerPromptConfigHandlers } from "./promptConfigs"
import { registerUserHandlers } from "./users"
import { registerLorebookHandlers } from "./lorebooks"
import { registerWorldLoreEntryHandlers } from "./worldLoreEntries"
import { registerCharacterLoreEntryHandlers } from "./characterLoreEntries"
import { registerHistoryEntryHandlers } from "./historyEntries"
import { registerTagHandlers } from "./tags"
import { registerSystemSettingsHandlers } from "./systemSettings"
import { registerUserSettingsHandlers } from "./userSettings"
import { registerOllamaHandlers } from "./ollama"
import { registerAuthHandlers } from "./auth.handlers"

export function connectSockets(io: {
	on: (arg0: string, arg1: (socket: any) => void) => void
	to: (room: string) => any
}) {
	io.on("connect", (socket: AuthenticatedSocket) => {
		// Get user from authenticated socket (set by middleware)
		const userId = socket.user?.id
		if (!userId) {
			console.warn("Unauthenticated socket connection rejected")
			socket.disconnect()
			return
		}

		// Attach io to socket for use in handlers
		socket.io = io
		socket.join("user_" + userId)

		// Helper to emit to all user sockets
		function emitToUser(event: string, data: any) {
			io.to("user_" + userId).emit(event, data)
		}

		// Register all handlers by module
		registerAuthHandlers(socket, emitToUser, register)
		registerUserHandlers(socket, emitToUser, register)
		registerSamplingConfigHandlers(socket, emitToUser, register)
		registerConnectionHandlers(socket, emitToUser, register)
		registerOllamaHandlers(socket, emitToUser, register)
		registerSystemSettingsHandlers(socket, emitToUser, register)
		registerUserSettingsHandlers(socket, emitToUser, register)
		registerCharacterHandlers(socket, emitToUser, register)
		registerPersonaHandlers(socket, emitToUser, register)
		registerContextConfigHandlers(socket, emitToUser, register)
		registerPromptConfigHandlers(socket, emitToUser, register)
		registerChatHandlers(socket, emitToUser, register)
		// Register assistant chat handlers
		register(socket, chatsListAssistantHandler, emitToUser)
		register(socket, chatsCreateAssistantHandler, emitToUser)
		register(socket, assistantUpdateDraftHandler, emitToUser)
		handleAssistantFunctions(io as any, socket, userId)
		// Register new assistant V2 handlers (tool-based)
		handleAssistantV2(io as any, socket, userId)
		registerLorebookHandlers(socket, emitToUser, register)
		registerWorldLoreEntryHandlers(socket, emitToUser, register)
		registerCharacterLoreEntryHandlers(socket, emitToUser, register)
		registerHistoryEntryHandlers(socket, emitToUser, register)
		registerTagHandlers(socket, emitToUser, register)
		console.log(`Socket connected: ${socket.id} for user ${userId}`)
	})
}

function register(
	socket: AuthenticatedSocket,
	handler: Handler<any, any>,
	emitToUser: (event: string, data: any) => void
) {
	socket.on(handler.event, async (message: any, callback?: (response: any) => void) => {
		try {
			const result = await handler.handler(socket, message, emitToUser)
			// If a callback was provided, send the result back
			if (callback && typeof callback === 'function') {
				callback(result)
			}
		} catch (error) {
			// Check if this is an expected authorization error (should not spam logs)
			const errorMessage = error instanceof Error ? error.message : String(error)
			const isAuthError = errorMessage.includes('Access denied') || errorMessage.includes('Permission denied')
			
			if (!isAuthError) {
				// Only log unexpected errors
				console.error(`Error handling event ${handler.event}:`, error)
			} else {
				// For auth errors, just log at debug level
				console.debug(`Authorization error on ${handler.event}:`, errorMessage)
			}
			
			const userId = socket.user?.id
			socket.io.to("user_" + userId).emit(`${handler.event}:error`, {
				error: "An error occurred while processing your request."
			})
			
			// If a callback was provided, send error response
			if (callback && typeof callback === 'function') {
				callback({
					success: false,
					error: "An error occurred while processing your request."
				})
			}
		}
	})
}
