import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import type { AuthenticatedSocket } from "./auth"

export const userSettingsGet: Handler<
	Sockets.UserSettings.Get.Params,
	Sockets.UserSettings.Get.Response
> = {
	event: "userSettings:get",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			let settings = await db.query.userSettings.findFirst({
				where: (t, { eq }) => eq(t.userId, userId),
				columns: {
					id: false, // We don't need the ID in the response
					userId: false // We don't need the userId in the response
				}
			})

			// If no user settings found, create default ones
			if (!settings) {
				await db.insert(schema.userSettings).values({
					userId: userId,
					theme: "hamlindigo",
					darkMode: true,
					showHomePageBanner: true,
					enableEasyPersonaCreation: true,
					enableEasyCharacterCreation: true,
					showAllCharacterFields: false
				})

				// Fetch the newly created settings
				settings = await db.query.userSettings.findFirst({
					where: (t, { eq }) => eq(t.userId, userId),
					columns: {
						id: false,
						userId: false
					}
				})
			}

			if (!settings) {
				throw new Error("Failed to create user settings")
			}

			const res: Sockets.UserSettings.Get.Response = {
				userSettings: {
					activeConnectionId: settings.activeConnectionId,
					activeSamplingConfigId: settings.activeSamplingConfigId,
					activeContextConfigId: settings.activeContextConfigId,
					activePromptConfigId: settings.activePromptConfigId,
					theme: settings.theme || "hamlindigo",
					darkMode:
						settings.darkMode !== null ? settings.darkMode : true,
					showHomePageBanner: settings.showHomePageBanner ?? true,
					enableEasyPersonaCreation:
						settings.enableEasyPersonaCreation,
					enableEasyCharacterCreation:
						settings.enableEasyCharacterCreation,
					showAllCharacterFields: settings.showAllCharacterFields
				}
			}

			emitToUser("userSettings:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching user settings:", error)
			emitToUser("userSettings:get:error", {
				error: "Failed to fetch user settings"
			})
			throw error
		}
	}
}

export const userSettingsUpdateShowHomePageBanner: Handler<
	Sockets.UserSettings.UpdateShowHomePageBanner.Params,
	Sockets.UserSettings.UpdateShowHomePageBanner.Response
> = {
	event: "userSettings:updateShowHomePageBanner",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					showHomePageBanner: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateShowHomePageBanner.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateShowHomePageBanner", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update show home page banner error:", error)
			emitToUser("userSettings:updateShowHomePageBanner:error", {
				error: "Failed to update show home page banner setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateEasyPersonaCreation: Handler<
	Sockets.UserSettings.UpdateEasyPersonaCreation.Params,
	Sockets.UserSettings.UpdateEasyPersonaCreation.Response
> = {
	event: "userSettings:updateEasyPersonaCreation",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					enableEasyPersonaCreation: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateEasyPersonaCreation.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateEasyPersonaCreation", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update easy persona creation error:", error)
			emitToUser("userSettings:updateEasyPersonaCreation:error", {
				error: "Failed to update easy persona creation setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateEasyCharacterCreation: Handler<
	Sockets.UserSettings.UpdateEasyCharacterCreation.Params,
	Sockets.UserSettings.UpdateEasyCharacterCreation.Response
> = {
	event: "userSettings:updateEasyCharacterCreation",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					enableEasyCharacterCreation: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateEasyCharacterCreation.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateEasyCharacterCreation", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update easy character creation error:", error)
			emitToUser("userSettings:updateEasyCharacterCreation:error", {
				error: "Failed to update easy character creation setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateShowAllCharacterFields: Handler<
	Sockets.UserSettings.UpdateShowAllCharacterFields.Params,
	Sockets.UserSettings.UpdateShowAllCharacterFields.Response
> = {
	event: "userSettings:updateShowAllCharacterFields",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					showAllCharacterFields: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateShowAllCharacterFields.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateShowAllCharacterFields", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update show all character fields error:", error)
			emitToUser("userSettings:updateShowAllCharacterFields:error", {
				error: "Failed to update show all character fields setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateTheme: Handler<
	Sockets.UserSettings.UpdateTheme.Params,
	Sockets.UserSettings.UpdateTheme.Response
> = {
	event: "userSettings:updateTheme",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({ theme: params.theme })
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateTheme.Response = {
				success: true,
				theme: params.theme
			}
			emitToUser("userSettings:updateTheme", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update theme error:", error)
			emitToUser("userSettings:updateTheme:error", {
				error: "Failed to update theme"
			})
			throw error
		}
	}
}

export const userSettingsUpdateDarkMode: Handler<
	Sockets.UserSettings.UpdateDarkMode.Params,
	Sockets.UserSettings.UpdateDarkMode.Response
> = {
	event: "userSettings:updateDarkMode",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({ darkMode: params.enabled })
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateDarkMode.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("userSettings:updateDarkMode", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update dark mode error:", error)
			emitToUser("userSettings:updateDarkMode:error", {
				error: "Failed to update dark mode"
			})
			throw error
		}
	}
}

// Registration function for all user settings handlers
export function registerUserSettingsHandlers(
	socket: AuthenticatedSocket,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: AuthenticatedSocket,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, userSettingsGet, emitToUser)
	register(socket, userSettingsUpdateShowHomePageBanner, emitToUser)
	register(socket, userSettingsUpdateEasyPersonaCreation, emitToUser)
	register(socket, userSettingsUpdateEasyCharacterCreation, emitToUser)
	register(socket, userSettingsUpdateShowAllCharacterFields, emitToUser)
	register(socket, userSettingsUpdateTheme, emitToUser)
	register(socket, userSettingsUpdateDarkMode, emitToUser)
}
