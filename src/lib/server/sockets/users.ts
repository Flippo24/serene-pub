import { db } from "$lib/server/db"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"

export const usersGet: Handler<Sockets.Users.Get.Params, Sockets.Users.Get.Response> = {
	event: "users:get",
	handler: async (socket, params, emitToUser) => {
		const userId = 1 // Replace with actual user id
		const user = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId),
			with: {
				activeConnection: true,
				activeSamplingConfig: true,
				activeContextConfig: true,
				activePromptConfig: true
			}
		})
		const res: Sockets.Users.Get.Response = { user: user! }
		emitToUser("users:get", res)
		return res
	}
}

export const usersSetTheme: Handler<Sockets.Users.SetTheme.Params, Sockets.Users.SetTheme.Response> = {
	event: "users:setTheme",
	handler: async (socket, params, emitToUser) => {
		const userId = 1 // Replace with actual user id
		const { theme, darkMode } = params

		if (!theme) {
			console.error("[setTheme] No theme provided")
			emitToUser("users:setTheme:error", { error: "No theme provided" })
			throw new Error("No theme provided")
		}

		await db
			.update(schema.users)
			.set({ theme, darkMode })
			.where(eq(schema.users.id, userId))

		const res: Sockets.Users.SetTheme.Response = {}
		emitToUser("users:setTheme", res)
		await usersGet.handler(socket, {}, emitToUser)
		return res
	}
}

// Legacy functions for compatibility
export async function user(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const user = await db.query.users.findFirst({
		where: (u, { eq }) => eq(u.id, userId),
		with: {
			activeConnection: true,
			activeSamplingConfig: true,
			activeContextConfig: true,
			activePromptConfig: true
		}
	})
	socket.server.to("user_" + userId).emit("user", { user })
}

export async function setTheme(
	socket: any,
	message: { theme: string, darkMode: boolean },
	emitToUser: (event: string, data: any) => void
) {
	await usersSetTheme.handler(socket, message, emitToUser)
}

// Registration function for all user handlers
export function registerUserHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, usersGet, emitToUser)
	register(socket, usersSetTheme, emitToUser)
}
