import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, and, isNull } from "drizzle-orm"
import { z } from "zod"
import type { Handler } from "$lib/shared/events"

export const systemSettingsGet: Handler<
	Sockets.SystemSettings.Get.Params,
	Sockets.SystemSettings.Get.Response
> = {
	event: "systemSettings:get",
	handler: async (socket, params, emitToUser) => {
		// Allow systemSettings:get regardless of authentication status
		// This is needed for determining if accounts are enabled
		try {
			const settings = await db.query.systemSettings.findFirst({
				columns: {
					id: false // We don't need the ID in the response
				}
			})

			if (!settings) {
				throw new Error("System settings not found")
			}

			const res: Sockets.SystemSettings.Get.Response = {
				systemSettings: settings
			}

			emitToUser("systemSettings:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching system settings:", error)
			emitToUser("systemSettings:get:error", {
				error: "Failed to fetch system settings"
			})
			throw error
		}
	}
}

export const systemSettingsUpdateOllamaManagerEnabled: Handler<
	Sockets.SystemSettings.UpdateOllamaManagerEnabled.Params,
	Sockets.SystemSettings.UpdateOllamaManagerEnabled.Response
> = {
	event: "systemSettings:updateOllamaManagerEnabled",
	handler: async (socket, params, emitToUser) => {
		// Check system settings first
		const systemSettings = await db.query.systemSettings.findFirst()
		const isAccountsEnabled = systemSettings?.isAccountsEnabled ?? false

		// If accounts are disabled, use fallback admin user if no user is set
		if (!isAccountsEnabled && !socket.user) {
			const fallbackUser = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.isAdmin, true),
				orderBy: (u, { asc }) => [asc(u.id)],
				columns: { id: true, username: true, isAdmin: true }
			})
			if (fallbackUser) {
				socket.user = fallbackUser
			}
		}

		// Check if user is admin - strict requirement
		if (!socket.user?.isAdmin) {
			console.warn(
				`[systemSettingsUpdateOllamaManagerEnabled] Non-admin user ${socket.user?.id} attempted to update Ollama Manager settings`
			)
			const res = {
				error: "Access denied. Only admin users can modify system settings."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can modify system settings."
			)
		}

		try {
			await db
				.update(schema.systemSettings)
				.set({
					ollamaManagerEnabled: params.enabled
				})
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateOllamaManagerEnabled.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("systemSettings:updateOllamaManagerEnabled", res)
			await systemSettingsGet.handler(socket, {}, emitToUser) // Refresh system settings after update
			return res
		} catch (error: any) {
			console.error("Update Ollama Manager enabled error:", error)
			emitToUser("systemSettings:updateOllamaManagerEnabled:error", {
				error: "Failed to update Ollama Manager setting"
			})
			throw error
		}
	}
}

// URL validation schema
const urlSchema = z
	.string()
	.url()
	.refine((url) => {
		try {
			const parsed = new URL(url)
			return parsed.port !== "" || parsed.hostname === "localhost"
		} catch {
			return false
		}
	}, "URL must include a port (e.g., http://localhost:11434)")

export const systemSettingsUpdateOllamaManagerBaseUrl: Handler<
	Sockets.SystemSettings.UpdateOllamaManagerBaseUrl.Params,
	Sockets.SystemSettings.UpdateOllamaManagerBaseUrl.Response
> = {
	event: "systemSettings:updateOllamaManagerBaseUrl",
	handler: async (socket, params, emitToUser) => {
		// Check system settings first
		const systemSettings = await db.query.systemSettings.findFirst()
		const isAccountsEnabled = systemSettings?.isAccountsEnabled ?? false

		// If accounts are disabled, use fallback admin user if no user is set
		if (!isAccountsEnabled && !socket.user) {
			const fallbackUser = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.isAdmin, true),
				orderBy: (u, { asc }) => [asc(u.id)],
				columns: { id: true, username: true, isAdmin: true }
			})
			if (fallbackUser) {
				socket.user = fallbackUser
			}
		}

		// Check if user is admin - strict requirement
		if (!socket.user?.isAdmin) {
			console.warn(
				`[systemSettingsUpdateOllamaManagerBaseUrl] Non-admin user ${socket.user?.id} attempted to update Ollama Manager base URL`
			)
			const res = {
				error: "Access denied. Only admin users can modify system settings."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can modify system settings."
			)
		}

		try {
			// Validate URL format
			const result = urlSchema.safeParse(params.baseUrl)
			if (!result.success) {
				const errorResponse = {
					success: false,
					baseUrl: params.baseUrl
				} as Sockets.SystemSettings.UpdateOllamaManagerBaseUrl.Response
				emitToUser("systemSettings:updateOllamaManagerBaseUrl:error", {
					error:
						result.error.errors[0]?.message || "Invalid URL format"
				})
				return errorResponse
			}

			await db
				.update(schema.systemSettings)
				.set({
					ollamaManagerBaseUrl: params.baseUrl
				})
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateOllamaManagerBaseUrl.Response =
				{
					success: true,
					baseUrl: params.baseUrl
				}
			emitToUser("systemSettings:updateOllamaManagerBaseUrl", res)
			await systemSettingsGet.handler(socket, {}, emitToUser) // Refresh system settings after update
			return res
		} catch (error: any) {
			console.error("Update Ollama Manager base URL error:", error)
			emitToUser("systemSettings:updateOllamaManagerBaseUrl:error", {
				error: "Failed to update Ollama Manager base URL"
			})
			throw error
		}
	}
}

export const systemSettingsUpdateAccountsEnabled: Handler<
	Sockets.SystemSettings.UpdateAccountsEnabled.Params,
	Sockets.SystemSettings.UpdateAccountsEnabled.Response
> = {
	event: "systemSettings:updateAccountsEnabled",
	handler: async (socket, params, emitToUser) => {
		// Check system settings first
		const systemSettings = await db.query.systemSettings.findFirst()
		const isAccountsEnabled = systemSettings?.isAccountsEnabled ?? false

		// If accounts are disabled, use fallback admin user if no user is set
		if (!isAccountsEnabled && !socket.user) {
			const fallbackUser = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.isAdmin, true),
				orderBy: (u, { asc }) => [asc(u.id)],
				columns: { id: true, username: true, isAdmin: true }
			})
			if (fallbackUser) {
				socket.user = fallbackUser
			}
		}

		// Check if user is admin - strict requirement
		if (!socket.user?.isAdmin) {
			console.warn(
				`[systemSettingsUpdateAccountsEnabled] Non-admin user ${socket.user?.id} attempted to update accounts enabled setting`
			)
			const res = {
				error: "Access denied. Only admin users can modify system settings."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can modify system settings."
			)
		}

		try {
			// Check if accounts are already enabled
			const currentSettings = await db.query.systemSettings.findFirst()

			if (currentSettings?.isAccountsEnabled && !params.enabled) {
				// Don't allow disabling accounts once enabled
				const errorResponse = {
					success: false,
					enabled: params.enabled
				} as Sockets.SystemSettings.UpdateAccountsEnabled.Response
				emitToUser("systemSettings:updateAccountsEnabled:error", {
					error: "Accounts cannot be disabled once enabled"
				})
				return errorResponse
			}

			// If trying to enable accounts, check if current user has a passphrase set
			if (params.enabled && !currentSettings?.isAccountsEnabled) {
				const userPassphrase = await db.query.passphrases.findFirst({
					where: (p, { eq, and, isNull }) =>
						and(
							eq(p.userId, socket.user!.id),
							isNull(p.invalidatedAt)
						)
				})

				if (!userPassphrase) {
					const errorResponse = {
						success: false,
						enabled: false
					} as Sockets.SystemSettings.UpdateAccountsEnabled.Response
					emitToUser("systemSettings:updateAccountsEnabled:error", {
						error: "You must set a passphrase before enabling user accounts. Please set your passphrase first."
					})
					return errorResponse
				}
			}

			await db
				.update(schema.systemSettings)
				.set({
					isAccountsEnabled: params.enabled
				})
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateAccountsEnabled.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("systemSettings:updateAccountsEnabled", res)
			await systemSettingsGet.handler(socket, {}, emitToUser) // Refresh system settings after update
			return res
		} catch (error: any) {
			console.error("Update accounts enabled error:", error)
			emitToUser("systemSettings:updateAccountsEnabled:error", {
				error: "Failed to update accounts setting"
			})
			throw error
		}
	}
}

// Registration function for all system settings handlers
export function registerSystemSettingsHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, systemSettingsGet, emitToUser)
	register(socket, systemSettingsUpdateOllamaManagerEnabled, emitToUser)
	register(socket, systemSettingsUpdateOllamaManagerBaseUrl, emitToUser)
	register(socket, systemSettingsUpdateAccountsEnabled, emitToUser)
}
