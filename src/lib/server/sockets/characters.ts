import { db } from "$lib/server/db"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as fsPromises from "fs/promises"
import { getCharacterDataDir, handleCharacterAvatarUpload } from "../utils"
import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import { fileTypeFromBuffer } from "file-type"
import type { Handler } from "$lib/shared/events"

// Helper function to process tags for character creation/update
async function processCharacterTags(
	characterId: number,
	tagNames: string[],
	userId: number
) {
	// Get existing tags for this character that belong to the user
	const existingCharacterTags = await db.query.characterTags.findMany({
		where: eq(schema.characterTags.characterId, characterId),
		with: {
			tag: true
		}
	})

	// Filter to only tags that belong to this user
	const userCharacterTags = existingCharacterTags.filter(
		(ct) => ct.tag.userId === userId
	)
	const existingTagNames = userCharacterTags.map((ct) => ct.tag.name)

	// Normalize tag names for comparison
	const normalizedNewTags = (tagNames || [])
		.map((t) => t.trim())
		.filter((t) => t.length > 0)

	// Find tags to remove (exist in DB but not in new list)
	const tagsToRemove = userCharacterTags.filter(
		(ct) => !normalizedNewTags.includes(ct.tag.name)
	)

	// Find tags to add (exist in new list but not in DB)
	const tagsToAdd = normalizedNewTags.filter(
		(tagName) => !existingTagNames.includes(tagName)
	)

	// Remove tags that are no longer in the list
	if (tagsToRemove.length > 0) {
		const tagIdsToRemove = tagsToRemove.map((ct) => ct.tagId)
		await db
			.delete(schema.characterTags)
			.where(
				and(
					eq(schema.characterTags.characterId, characterId),
					inArray(schema.characterTags.tagId, tagIdsToRemove)
				)
			)
	}

	// Add new tags
	for (const tagName of tagsToAdd) {
		// Check if tag exists for this user
		let existingTag = await db.query.tags.findFirst({
			where: (t, { and, eq }) =>
				and(eq(t.name, tagName), eq(t.userId, userId))
		})

		// Create tag if it doesn't exist
		if (!existingTag) {
			const [newTag] = await db
				.insert(schema.tags)
				.values({
					name: tagName,
					userId
				})
				.returning()
			existingTag = newTag
		}

		// Link tag to character
		await db
			.insert(schema.characterTags)
			.values({
				characterId,
				tagId: existingTag.id
			})
			.onConflictDoNothing()
	}
}

export const charactersList: Handler<
	Sockets.Characters.List.Params,
	Sockets.Characters.List.Response
> = {
	event: "characters:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const characterList = await db.query.characters.findMany({
			columns: {
				id: true,
				name: true,
				nickname: true,
				avatar: true,
				isFavorite: true,
				description: true,
				creatorNotes: true
			},
			with: {
				characterTags: {
					with: {
						tag: true
					}
				}
			},
			where: (c, { eq }) => eq(c.userId, userId),
			orderBy: (c, { asc }) => asc(c.id)
		})
		const res: Sockets.Characters.List.Response = { characterList }
		emitToUser("characters:list", res)
		return res
	}
}

export const charactersGet: Handler<
	Sockets.Characters.Get.Params,
	Sockets.Characters.Get.Response
> = {
	event: "characters:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { and, eq }) =>
				and(eq(c.id, params.id), eq(c.userId, userId)),
			with: {
				characterTags: {
					with: {
						tag: true
					}
				}
			}
		})
		if (character) {
			// Transform the character data to include tags as string array
			const characterWithTags = {
				...character,
				tags: character.characterTags.map((ct) => ct.tag.name)
			}
			const { characterTags, ...characterWithoutTags } = characterWithTags

			const res: Sockets.Characters.Get.Response = {
				character: characterWithoutTags
			}
			emitToUser("characters:get", res)
			return res
		}
		const res: Sockets.Characters.Get.Response = { character: null }
		emitToUser("characters:get", res)
		return res
	}
}

export const charactersCreate: Handler<
	Sockets.Characters.Create.Params,
	Sockets.Characters.Create.Response
> = {
	event: "characters:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const data = { ...params.character }
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database insert
			// @ts-ignore - Remove avatar from character data to avoid conflicts
			delete data.avatar
			// @ts-ignore - Remove tags - will be handled separately
			delete (data as any).tags

			const [character] = await db
				.insert(schema.characters)
				.values({ ...data, userId })
				.returning()

			// Process tags after character creation
			if (tags && tags.length > 0) {
				await processCharacterTags(character.id, tags, userId)
			}
			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character,
					avatarFile: params.avatarFile
				})
			}

			await charactersList.handler(socket, {}, emitToUser)

			const res: Sockets.Characters.Create.Response = { character }
			emitToUser("characters:create", res)
			return res
		} catch (e: any) {
			console.error("Error creating character:", e)
			emitToUser("characters:create:error", {
				error: e.message || "Failed to create character."
			})
			throw e
		}
	}
}

export const charactersUpdate: Handler<
	Sockets.Characters.Update.Params,
	Sockets.Characters.Update.Response
> = {
	event: "characters:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.character }
			const id = data.id
			const userId = socket.user!.id
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database update
			if ("userId" in data) (data as any).userId = undefined
			if ("id" in data) (data as any).id = undefined
			// @ts-ignore - Remove avatar from character data to avoid conflicts
			delete data.avatar
			// @ts-ignore - Remove tags - will be handled separately
			delete (data as any).tags

			const [updated] = await db
				.update(schema.characters)
				.set(data)
				.where(
					and(
						eq(schema.characters.id, id),
						eq(schema.characters.userId, userId)
					)
				)
				.returning()

			// Process tags after character update
			await processCharacterTags(id, tags, userId)

			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character: updated,
					avatarFile: params.avatarFile
				})
			}

			const res: Sockets.Characters.Update.Response = {
				character: updated
			}
			await charactersList.handler(socket, {}, emitToUser)
			emitToUser("characters:update", res)
			return res
		} catch (e: any) {
			console.error("Error updating character:", e)
			emitToUser("characters:update:error", {
				error: e.message || "Failed to update character."
			})
			throw e
		}
	}
}

export const charactersDelete: Handler<
	Sockets.Characters.Delete.Params,
	Sockets.Characters.Delete.Response
> = {
	event: "characters:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Soft delete the character by setting isDeleted = true
		await db
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(
				and(
					eq(schema.characters.id, params.id),
					eq(schema.characters.userId, userId)
				)
			)

		await charactersList.handler(socket, {}, emitToUser)

		// Emit the delete event
		const res: Sockets.Characters.Delete.Response = {
			success: "Character deleted successfully"
		}
		emitToUser("characters:delete", res)
		return res
	}
}

export const charactersImportCard: Handler<
	Sockets.Characters.ImportCard.Params,
	Sockets.Characters.ImportCard.Response
> = {
	event: "characters:importCard",
	handler: async (socket, params, emitToUser) => {
		try {
			// TODO: Fix this handler - the file structure needs to be updated
			// For now, just return empty array to prevent errors
			const res: Sockets.Characters.ImportCard.Response = {
				characters: []
			}
			emitToUser("characters:importCard", res)
			await charactersList.handler(socket, {}, emitToUser)
			return res
		} catch (e: any) {
			console.error("Error importing character card:", e)
			emitToUser("characters:importCard:error", {
				error: e.message || "Failed to import character card."
			})
			throw e
		}
	}
}

// Registration function for all character handlers
export function registerCharacterHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, charactersList, emitToUser)
	register(socket, charactersGet, emitToUser)
	register(socket, charactersCreate, emitToUser)
	register(socket, charactersUpdate, emitToUser)
	register(socket, charactersDelete, emitToUser)
	register(socket, charactersImportCard, emitToUser)
}
