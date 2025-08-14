import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { handlePersonaAvatarUpload } from "../utils"
import type { Handler } from "$lib/shared/events"

// Helper function to process tags for persona creation/update
async function processPersonaTags(personaId: number, tagNames: string[]) {
	if (!tagNames || tagNames.length === 0) return

	// First, remove all existing tags for this persona
	await db
		.delete(schema.personaTags)
		.where(eq(schema.personaTags.personaId, personaId))

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

	// Link all tags to the persona
	if (tagIds.length > 0) {
		const personaTagsData = tagIds.map((tagId) => ({
			personaId,
			tagId
		}))

		await db
			.insert(schema.personaTags)
			.values(personaTagsData)
			.onConflictDoNothing() // In case of race conditions
	}
}

export const personasList: Handler<Sockets.Personas.List.Params, Sockets.Personas.List.Response> = {
	event: "personas:list",
	handler: async (socket, params, emitToUser) => {
		const personaList = await db.query.personas.findMany({
			columns: {
				id: true,
				name: true,
				avatar: true,
				isDefault: true,
				description: true,
				position: true
			},
			with: {
				personaTags: {
					with: {
						tag: true
					}
				}
			},
			where: (p, { eq }) => eq(p.userId, 1) // TODO: Replace with actual user id
		})
		const res: Sockets.Personas.List.Response = { personaList }
		emitToUser("personas:list", res)
		return res
	}
}

export const personasGet: Handler<Sockets.Personas.Get.Params, Sockets.Personas.Get.Response> = {
	event: "personas:get",
	handler: async (socket, params, emitToUser) => {
		const persona = await db.query.personas.findFirst({
			where: (p, { eq }) => eq(p.id, params.id),
			with: {
				personaTags: {
					with: {
						tag: true
					}
				}
			}
		})
		if (persona) {
			// Transform the persona data to include tags as string array
			const personaWithTags = {
				...persona,
				tags: persona.personaTags.map((pt) => pt.tag.name)
			}
			// @ts-ignore - Remove the junction table data
			delete personaWithTags.personaTags

			const res: Sockets.Personas.Get.Response = { persona: personaWithTags }
			emitToUser("personas:get", res)
			return res
		} else {
			const res: Sockets.Personas.Get.Response = { persona: null }
			emitToUser("personas:get", res)
			return res
		}
	}
}

export const personasCreate: Handler<Sockets.Personas.Create.Params, Sockets.Personas.Create.Response> = {
	event: "personas:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.persona }
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database insert
			delete (data as any).avatar // Remove avatar from persona data to avoid conflicts
			delete (data as any).tags // Remove tags - will be handled separately

			const [persona] = await db
				.insert(schema.personas)
				.values({ ...data, userId: 1 })
				.returning()

			// Process tags after persona creation
			if (tags.length > 0) {
				await processPersonaTags(persona.id, tags)
			}

			if (params.avatarFile) {
				await handlePersonaAvatarUpload({
					persona,
					avatarFile: params.avatarFile
				})
			}

			await personasList.handler(socket, {}, emitToUser)
			const res: Sockets.Personas.Create.Response = { persona }
			emitToUser("personas:create", res)
			return res
		} catch (e: any) {
			console.error("Error creating persona:", e)
			emitToUser("personas:create:error", { error: e.message || String(e) })
			throw e
		}
	}
}

export const personasUpdate: Handler<Sockets.Personas.Update.Params, Sockets.Personas.Update.Response> = {
	event: "personas:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.persona }
			const id = data.id
			const userId = 1 // Replace with actual userId
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database update
			if ("userId" in data) (data as any).userId = undefined
			if ("id" in data) (data as any).id = undefined
			delete (data as any).avatar // Remove avatar from persona data to avoid conflicts
			delete (data as any).tags // Remove tags - will be handled separately

			const [updated] = await db
				.update(schema.personas)
				.set(data)
				.where(
					and(
						eq(schema.personas.id, id),
						eq(schema.personas.userId, userId)
					)
				)
				.returning()

			// Process tags after persona update
			await processPersonaTags(id, tags)

			if (params.avatarFile) {
				await handlePersonaAvatarUpload({
					persona: updated,
					avatarFile: params.avatarFile
				})
			}

			await personasGet.handler(socket, { id }, emitToUser)
			await personasList.handler(socket, {}, emitToUser)
			const res: Sockets.Personas.Update.Response = { persona: updated }
			emitToUser("personas:update", res)
			return res
		} catch (e: any) {
			console.error("Error updating persona:", e)
			emitToUser("personas:update:error", {
				error: e.message || "Failed to update persona."
			})
			throw e
		}
	}
}

export const personasDelete: Handler<Sockets.Personas.Delete.Params, Sockets.Personas.Delete.Response> = {
	event: "personas:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = 1 // Replace with actual userId

		// Delete persona tags first (cascade should handle this, but being explicit)
		await db
			.delete(schema.personaTags)
			.where(eq(schema.personaTags.personaId, params.id))

		// Delete the persona
		await db
			.delete(schema.personas)
			.where(
				and(
					eq(schema.personas.id, params.id),
					eq(schema.personas.userId, userId)
				)
			)
		await personasList.handler(socket, {}, emitToUser)
		const res: Sockets.Personas.Delete.Response = { success: "Persona deleted successfully" }
		emitToUser("personas:delete", res)
		return res
	}
}

// Registration function for all persona handlers
export function registerPersonaHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, personasList, emitToUser)
	register(socket, personasGet, emitToUser)
	register(socket, personasCreate, emitToUser)
	register(socket, personasUpdate, emitToUser)
	register(socket, personasDelete, emitToUser)
}
