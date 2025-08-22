import { db } from "$lib/server/db"
import { eq, and, desc, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { z } from "zod"
import * as passphrase from "$lib/server/providers/users/passphrase"
import { cookies } from "$lib/server/auth"
import * as userTokens from "$lib/server/providers/users/tokens"

// Passphrase validation schema
const passphraseSchema = z.string()
	.min(6, "Passphrase must be at least 6 characters long")
	.regex(/[a-z]/, "Passphrase must contain at least one lowercase letter")
	.regex(/[A-Z]/, "Passphrase must contain at least one uppercase letter")
	.regex(/[^a-zA-Z0-9]/, "Passphrase must contain at least one special character")

// Display name validation schema
const displayNameSchema = z.string()
	.min(3, "Display name must be at least 3 characters long")
	.max(50, "Display name must not exceed 50 characters")
	.trim()

export const usersGet: Handler<Sockets.Users.Get.Params, Sockets.Users.Get.Response> = {
	event: "users:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id || 1 // Fallback for backwards compatibility
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

export const usersCurrent: Handler<Sockets.Users.Get.Params, Sockets.Users.Get.Response> = {
	event: "users:current",
	handler: async (socket, params, emitToUser) => {
		// Get the authenticated user from socket (set by auth middleware)
		const userId = socket.user?.id
		
		if (!userId) {
			console.error("[usersCurrent] No authenticated user found on socket")
			emitToUser("users:current:error", { error: "Not authenticated" })
			throw new Error("Not authenticated")
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

		if (!user) {
			console.error(`[usersCurrent] User with ID ${userId} not found`)
			emitToUser("users:current:error", { error: "User not found" })
			throw new Error("User not found")
		}

		const res: Sockets.Users.Get.Response = { user }
		emitToUser("users:current", res)
		return res
	}
}

export const usersSetTheme: Handler<Sockets.Users.SetTheme.Params, Sockets.Users.SetTheme.Response> = {
	event: "users:setTheme",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id || 1 // Fallback for backwards compatibility
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

export const usersCurrentSetPassphrase: Handler<Sockets.Users.SetPassphrase.Params, Sockets.Users.SetPassphrase.Response> = {
	event: "users:current:setPassphrase",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id
		
		if (!userId) {
			console.error("[usersCurrentSetPassphrase] No authenticated user found on socket")
			emitToUser("users:current:setPassphrase:error", { error: "Not authenticated" })
			throw new Error("Not authenticated")
		}

		try {
			// Validate passphrase
			passphraseSchema.parse(params.passphrase)
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errorMessage = error.errors.map(e => e.message).join(", ")
				const res: Sockets.Users.SetPassphrase.Response = { 
					success: false, 
					message: errorMessage 
				}
				emitToUser("users:current:setPassphrase", res)
				return res
			}
			throw error
		}

		// Set the new passphrase using the existing provider
		await passphrase.set({
			userId: userId.toString(),
			passphrase: params.passphrase
		})

		const res: Sockets.Users.SetPassphrase.Response = { 
			success: true, 
			message: "Passphrase set successfully" 
		}
		emitToUser("users:current:setPassphrase", res)
		return res
	}
}

export const usersCurrentHasPassphrase: Handler<Sockets.Users.HasPassphrase.Params, Sockets.Users.HasPassphrase.Response> = {
	event: "users:current:hasPassphrase",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id
		
		if (!userId) {
			console.error("[usersCurrentHasPassphrase] No authenticated user found on socket")
			emitToUser("users:current:hasPassphrase:error", { error: "Not authenticated" })
			throw new Error("Not authenticated")
		}

		try {
			// Check if user has a current (non-invalidated) passphrase
			const currentPassphrase = await db.query.passphrases.findFirst({
				where: (p, { eq, and, isNull }) => and(
					eq(p.userId, userId),
					isNull(p.invalidatedAt)
				),
				orderBy: (p, { desc }) => [desc(p.createdAt)]
			})

			const res: Sockets.Users.HasPassphrase.Response = { 
				hasPassphrase: !!currentPassphrase 
			}
			emitToUser("users:current:hasPassphrase", res)
			return res
		} catch (error) {
			console.error("[usersCurrentHasPassphrase] Database error:", error)
			emitToUser("users:current:hasPassphrase:error", { error: "Database error checking passphrase" })
			throw error
		}
	}
}

// Legacy functions for compatibility
export async function user(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	const userId = socket.user?.id || 1 // Fallback for backwards compatibility
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

export const usersCurrentUpdateDisplayName: Handler<Sockets.Users.UpdateDisplayName.Params, Sockets.Users.UpdateDisplayName.Response> = {
	event: "users:current:updateDisplayName",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id

		if (!userId) {
			console.error("[usersCurrentUpdateDisplayName] No authenticated user found on socket")
			emitToUser("users:current:updateDisplayName:error", { error: "Not authenticated" })
			throw new Error("Not authenticated")
		}

		try {
			// Validate display name
			displayNameSchema.parse(params.displayName)
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errorMessage = error.errors[0]?.message || "Invalid display name"
				console.error("[usersCurrentUpdateDisplayName] Validation error:", errorMessage)
				emitToUser("users:current:updateDisplayName:error", { error: errorMessage })
				throw new Error(errorMessage)
			}
		}

		try {
			// Update the user's display name
			await db
				.update(schema.users)
				.set({ displayName: params.displayName })
				.where(eq(schema.users.id, userId))

			const res: Sockets.Users.UpdateDisplayName.Response = {
				success: true,
				displayName: params.displayName
			}

			emitToUser("users:current:updateDisplayName", res)
			// Refresh current user data
			await usersCurrent.handler(socket, {}, emitToUser)
			return res
		} catch (error: any) {
			console.error("[usersCurrentUpdateDisplayName] Database error:", error)
			emitToUser("users:current:updateDisplayName:error", { error: "Failed to update display name" })
			throw error
		}
	}
}

export const usersCurrentChangePassphrase: Handler<Sockets.Users.ChangePassphrase.Params, Sockets.Users.ChangePassphrase.Response> = {
	event: "users:current:changePassphrase",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id

		if (!userId) {
			console.error("[usersCurrentChangePassphrase] No authenticated user found on socket")
			emitToUser("users:current:changePassphrase:error", { error: "Not authenticated" })
			throw new Error("Not authenticated")
		}

		try {
			// Validate current passphrase first
			const isCurrentValid = await passphrase.validate({
				userId: userId.toString(),
				passphrase: params.currentPassphrase
			})

			if (!isCurrentValid) {
				console.error("[usersCurrentChangePassphrase] Invalid current passphrase")
				emitToUser("users:current:changePassphrase:error", { error: "Current passphrase is incorrect" })
				throw new Error("Invalid current passphrase")
			}

			// Validate new passphrase format
			passphraseSchema.parse(params.newPassphrase)
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errorMessage = error.errors[0]?.message || "Invalid new passphrase"
				console.error("[usersCurrentChangePassphrase] New passphrase validation error:", errorMessage)
				emitToUser("users:current:changePassphrase:error", { error: errorMessage })
				throw new Error(errorMessage)
			}
			// Re-throw other errors (like invalid current passphrase)
			throw error
		}

		try {
			// Set the new passphrase
			await passphrase.set({
				userId: userId.toString(),
				passphrase: params.newPassphrase
			})

			const res: Sockets.Users.ChangePassphrase.Response = {
				success: true,
				message: "Passphrase changed successfully"
			}

			emitToUser("users:current:changePassphrase", res)
			return res
		} catch (error: any) {
			console.error("[usersCurrentChangePassphrase] Failed to set new passphrase:", error)
			emitToUser("users:current:changePassphrase:error", { error: "Failed to change passphrase" })
			throw error
		}
	}
}

export const usersCurrentLogout: Handler<Sockets.Users.Logout.Params, Sockets.Users.Logout.Response> = {
	event: "users:current:logout",
	handler: async (socket, params, emitToUser) => {
		try {
			// If user is authenticated, clean up socket state
			if (socket.user) {
				socket.leave(`user_${socket.user.id}`)
				socket.user = undefined
				socket.isAuthenticated = false
			}

			// Note: We cannot directly delete HTTP-only cookies from socket handlers
			// The client should make a request to /api/logout to clear the cookie
			const res: Sockets.Users.Logout.Response = {
				success: true
			}

			emitToUser("users:current:logout", res)
			return res
		} catch (error: any) {
			console.error("[usersCurrentLogout] Logout error:", error)
			emitToUser("users:current:logout:error", { error: "Logout failed" })
			throw error
		}
	}
}

// Registration function for all user handlers
export function registerUserHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, usersGet, emitToUser)
	register(socket, usersCurrent, emitToUser)
	register(socket, usersSetTheme, emitToUser)
	register(socket, usersCurrentSetPassphrase, emitToUser)
	register(socket, usersCurrentHasPassphrase, emitToUser)
	register(socket, usersCurrentUpdateDisplayName, emitToUser)
	register(socket, usersCurrentChangePassphrase, emitToUser)
	register(socket, usersCurrentLogout, emitToUser)
}
