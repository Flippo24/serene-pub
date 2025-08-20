import { db } from "$lib/server/db"
import { eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"

export const tagsList: Handler<Sockets.Tags.List.Params, Sockets.Tags.List.Response> = {
	event: "tags:list",
	handler: async (socket, params, emitToUser) => {
		const tagsList = await db.query.tags.findMany({
			orderBy: (t, { asc }) => asc(t.name)
		})
		const res: Sockets.Tags.List.Response = { tagsList }
		emitToUser("tags:list", res)
		return res
	}
}

export const tagsCreate: Handler<Sockets.Tags.Create.Params, Sockets.Tags.Create.Response> = {
	event: "tags:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const [tag] = await db
				.insert(schema.tags)
				.values(params.tag)
				.returning()

			const res: Sockets.Tags.Create.Response = { tag }
			emitToUser("tags:create", res)

			// Also emit updated tags list
			await tagsList.handler(socket, {}, emitToUser)
			return res
		} catch (error) {
			console.error("Error creating tag:", error)
			emitToUser("tags:create:error", {
				error: "Failed to create tag. Tag name might already exist."
			})
			throw error
		}
	}
}

export const tagsUpdate: Handler<Sockets.Tags.Update.Params, Sockets.Tags.Update.Response> = {
	event: "tags:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const [tag] = await db
				.update(schema.tags)
				.set({
					name: params.tag.name,
					description: params.tag.description,
					colorPreset: params.tag.colorPreset
				})
				.where(eq(schema.tags.id, params.tag.id))
				.returning()

			const res: Sockets.Tags.Update.Response = { tag }
			emitToUser("tags:update", res)

			// Also emit updated tags list
			await tagsList.handler(socket, {}, emitToUser)
			return res
		} catch (error) {
			console.error("Error updating tag:", error)
			emitToUser("tags:update:error", {
				error: "Failed to update tag. Tag name might already exist."
			})
			throw error
		}
	}
}

export const tagsDelete: Handler<Sockets.Tags.Delete.Params, Sockets.Tags.Delete.Response> = {
	event: "tags:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			// First delete all character tag associations
			await db
				.delete(schema.characterTags)
				.where(eq(schema.characterTags.tagId, params.id))

			// Also delete persona tag associations
			await db
				.delete(schema.personaTags)
				.where(eq(schema.personaTags.tagId, params.id))

			// Also delete lorebook tag associations
			await db
				.delete(schema.lorebookTags)
				.where(eq(schema.lorebookTags.tagId, params.id))

			// Then delete the tag
			await db.delete(schema.tags).where(eq(schema.tags.id, params.id))

			const res: Sockets.Tags.Delete.Response = { success: "Tag deleted successfully" }
			emitToUser("tags:delete", res)

			// Also emit updated tags list
			await tagsList.handler(socket, {}, emitToUser)
			return res
		} catch (error) {
			console.error("Error deleting tag:", error)
			emitToUser("tags:delete:error", {
				error: "Failed to delete tag."
			})
			throw error
		}
	}
}

export const tagsGetRelatedData: Handler<Sockets.Tags.GetRelatedData.Params, Sockets.Tags.GetRelatedData.Response> = {
	event: "tags:getRelatedData",
	handler: async (socket, params, emitToUser) => {
		// Get the tag
		const tag = await db.query.tags.findFirst({
			where: eq(schema.tags.id, params.tagId)
		})

		if (!tag) {
			throw new Error("Tag not found")
		}

		// Get related characters
		const characters = await db.query.characterTags.findMany({
			where: eq(schema.characterTags.tagId, params.tagId),
			with: {
				character: {
					columns: {
						id: true,
						name: true,
						avatar: true
					}
				}
			}
		})

		// Get related personas
		const personas = await db.query.personaTags.findMany({
			where: eq(schema.personaTags.tagId, params.tagId),
			with: {
				persona: {
					columns: {
						id: true,
						name: true,
						avatar: true
					}
				}
			}
		})

		// Get related lorebooks
		const lorebooks = await db.query.lorebookTags.findMany({
			where: eq(schema.lorebookTags.tagId, params.tagId),
			with: {
				lorebook: {
					columns: {
						id: true,
						name: true
					}
				}
			}
		})

		const res: Sockets.Tags.GetRelatedData.Response = {
			tagData: {
				tag,
				characters: characters.map(ct => ct.character),
				personas: personas.map(pt => pt.persona),
				lorebooks: lorebooks.map(lt => lt.lorebook)
			}
		}
		emitToUser("tags:getRelatedData", res)
		return res
	}
}

export const tagsAddToCharacter: Handler<Sockets.Tags.AddToCharacter.Params, Sockets.Tags.AddToCharacter.Response> = {
	event: "tags:addToCharacter",
	handler: async (socket, params, emitToUser) => {
		try {
			await db
				.insert(schema.characterTags)
				.values({
					characterId: params.characterId,
					tagId: params.tagId
				})
				.onConflictDoNothing()

			const res: Sockets.Tags.AddToCharacter.Response = { success: true }
			emitToUser("tags:addToCharacter", res)
			return res
		} catch (error) {
			console.error("Error adding tag to character:", error)
			emitToUser("tags:addToCharacter:error", {
				error: "Failed to add tag to character."
			})
			throw error
		}
	}
}

export const tagsRemoveFromCharacter: Handler<Sockets.Tags.RemoveFromCharacter.Params, Sockets.Tags.RemoveFromCharacter.Response> = {
	event: "tags:removeFromCharacter",
	handler: async (socket, params, emitToUser) => {
		try {
			await db
				.delete(schema.characterTags)
				.where(
					and(
						eq(schema.characterTags.characterId, params.characterId),
						eq(schema.characterTags.tagId, params.tagId)
					)
				)

			const res: Sockets.Tags.RemoveFromCharacter.Response = { success: true }
			emitToUser("tags:removeFromCharacter", res)
			return res
		} catch (error) {
			console.error("Error removing tag from character:", error)
			emitToUser("tags:removeFromCharacter:error", {
				error: "Failed to remove tag from character."
			})
			throw error
		}
	}
}

// Registration function for all tag handlers
export function registerTagHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, tagsList, emitToUser)
	register(socket, tagsCreate, emitToUser)
	register(socket, tagsUpdate, emitToUser)
	register(socket, tagsDelete, emitToUser)
	register(socket, tagsGetRelatedData, emitToUser)
	register(socket, tagsAddToCharacter, emitToUser)
	register(socket, tagsRemoveFromCharacter, emitToUser)
}
