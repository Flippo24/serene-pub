import { db } from "$lib/server/db"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as fsPromises from "fs/promises"
import * as fs from "fs"
import * as path from "path"
import { getCharacterDataDir, handleCharacterAvatarUpload } from "../utils"
import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import { fileTypeFromBuffer } from "file-type"
import type { Handler } from "$lib/shared/events"
import extract from "png-chunks-extract"
import encode from "png-chunks-encode"
import text from "png-chunk-text"

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
		// @ts-expect-error - Drizzle ORM type inference issue with relations
		(ct) => ct.tag.userId === userId
	)
	const existingTagNames = userCharacterTags.map(
		// @ts-expect-error - Drizzle ORM type inference issue with relations
		(ct) => ct.tag.name
	)

	// Normalize tag names for comparison
	const normalizedNewTags = (tagNames || [])
		.map((t) => t.trim())
		.filter((t) => t.length > 0)

	// Find tags to remove (exist in DB but not in new list)
	const tagsToRemove = userCharacterTags.filter(
		// @ts-expect-error - Drizzle ORM type inference issue with relations
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
				// @ts-expect-error - Drizzle ORM type inference issue with relations
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
				// @ts-expect-error - Drizzle ORM type inference issue with relations
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
				// @ts-expect-error - Drizzle ORM type inference issue with relations
				tags: character.characterTags.map((ct) => ct.tag.name)
			}
			// @ts-expect-error - Drizzle ORM type inference issue with relations
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
		console.log("[Import] Starting character import...")
		console.log("[Import] Params received:", Object.keys(params))
		
		try {
			const userId = socket.user!.id
			const { file } = params
			
			if (!file) {
				console.error("[Import] No file data provided")
				throw new Error("No file data provided")
			}
			
			console.log("[Import] Base64 file length:", file.length)
			
			// Decode base64 to buffer
			const buffer = Buffer.from(file, "base64")
			console.log("[Import] Buffer size:", buffer.length, "bytes")
			
			// Try to parse the character card
			let cardData: SpecV3.CharacterCardV3 | null = null
			let avatarBuffer: Buffer | null = null
			
			// Check if it's a JSON file
			const fileString = buffer.toString("utf-8")
			console.log("[Import] File starts with:", fileString.substring(0, 100))
			
			if (fileString.trim().startsWith("{")) {
				console.log("[Import] Detected JSON format")
				try {
					const parsed = JSON.parse(fileString)
					console.log("[Import] Parsed JSON, spec:", parsed.spec, "spec_version:", parsed.spec_version)
					cardData = parsed as SpecV3.CharacterCardV3
				} catch (parseErr: any) {
					console.error("[Import] Failed to parse JSON:", parseErr.message)
					throw new Error(`Invalid JSON format: ${parseErr.message}`)
				}
			} else {
				console.log("[Import] Detected image format, attempting to parse metadata")
				// Try to parse as image with embedded metadata
				try {
					const card = await CharacterCard.from_file(buffer)
					console.log("[Import] Successfully parsed image metadata")
					console.log("[Import] Card name:", card.name)
					// Convert to SpecV3
					cardData = card.toSpecV3()
					avatarBuffer = buffer
				} catch (imgErr: any) {
					console.error("[Import] Failed to parse image metadata:", imgErr.message)
					throw new Error(`Failed to parse character card from image: ${imgErr.message}`)
				}
			}
			
			if (!cardData) {
				console.error("[Import] No card data extracted")
				throw new Error("Failed to extract character data from file")
			}
			
			console.log("[Import] Card data extracted successfully")
			console.log("[Import] Character name:", cardData.data?.name)
			
			// Extract character data from card
			const characterData = cardData.data
			if (!characterData) {
				console.error("[Import] No character data in card")
				throw new Error("Character card missing data field")
			}
			
			console.log("[Import] Creating character in database...")
			
			// Prepare character insert data
			const insertData: any = {
				userId,
				name: characterData.name || "Imported Character",
				nickname: characterData.nickname || null,
				description: characterData.description || "",
				personality: characterData.personality || "",
				scenario: characterData.scenario || "",
				firstMessage: characterData.first_mes || "",
				alternateGreetings: characterData.alternate_greetings || [],
				exampleDialogues: characterData.mes_example ? [characterData.mes_example] : [],
				creatorNotes: characterData.creator_notes || "",
				creatorNotesMultilingual: characterData.creator_notes_multilingual || {},
				groupOnlyGreetings: characterData.group_only_greetings || [],
				postHistoryInstructions: characterData.post_history_instructions || "",
				characterVersion: characterData.character_version || null,
				systemPrompt: characterData.system_prompt || null,
				isFavorite: false
			}
			
			console.log("[Import] Insert data prepared, name:", insertData.name)
			
			// Insert character
			const [newCharacter] = await db
				.insert(schema.characters)
				.values(insertData)
				.returning()
			
			console.log("[Import] Character created with ID:", newCharacter.id)
			
			// Save avatar if present
			if (avatarBuffer && newCharacter.id) {
				console.log("[Import] Saving avatar image...")
				const characterDataDir = getCharacterDataDir({
					userId,
					characterId: newCharacter.id
				})
				await fsPromises.mkdir(characterDataDir, { recursive: true })
				
				const ext = ".png" // Default to PNG
				const avatarFilename = `avatar-${Date.now().toString(36)}${ext}`
				const avatarPath = path.join(characterDataDir, avatarFilename)
				
				await fsPromises.writeFile(avatarPath, avatarBuffer)
				console.log("[Import] Avatar saved to:", avatarPath)
				
				// Update character with avatar path
				const avatarUrl = `/images/data/users/${userId}/characters/${newCharacter.id}/${avatarFilename}`
				await db
					.update(schema.characters)
					.set({ avatar: avatarUrl })
					.where(eq(schema.characters.id, newCharacter.id))
				
				console.log("[Import] Character avatar URL updated:", avatarUrl)
			}
			
			// Handle tags
			if (characterData.tags && Array.isArray(characterData.tags)) {
				console.log("[Import] Processing", characterData.tags.length, "tags...")
				for (const tagName of characterData.tags) {
					try {
						// Find or create tag
						let [tag] = await db
							.select()
							.from(schema.tags)
							.where(and(eq(schema.tags.name, tagName), eq(schema.tags.userId, userId)))
						
						if (!tag) {
							[tag] = await db
								.insert(schema.tags)
								.values({ name: tagName, userId })
								.returning()
							console.log("[Import] Created new tag:", tagName)
						}
						
						// Link tag to character
						await db
							.insert(schema.characterTags)
							.values({ characterId: newCharacter.id, tagId: tag.id })
							.onConflictDoNothing()
					} catch (tagErr: any) {
						console.error("[Import] Error processing tag", tagName, ":", tagErr.message)
					}
				}
			}
			
			console.log("[Import] Character import completed successfully")
			
			const res: Sockets.Characters.ImportCard.Response = {
				character: newCharacter,
				book: cardData.data?.character_book || null
			}
			
			emitToUser("characters:importCard", res)
			await charactersList.handler(socket, {}, emitToUser)
			return res
		} catch (e: any) {
			console.error("[Import] Error importing character card:", e)
			console.error("[Import] Error stack:", e.stack)
			emitToUser("characters:importCard:error", {
				error: e.message || "Failed to import character card."
			})
			throw e
		}
	}
}

export const charactersExportCard: Handler<
	Sockets.Characters.ExportCard.Params,
	Sockets.Characters.ExportCard.Response
> = {
	event: "characters:exportCard",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			
			// Fetch character with tags
			const character = await db.query.characters.findFirst({
				where: (c, { and, eq }) =>
					and(eq(c.id, params.id), eq(c.userId, userId)),
				with: {
					// @ts-expect-error - Drizzle ORM type inference issue with relations
					characterTags: {
						with: {
							tag: true
						}
					}
				}
			})

			if (!character) {
				throw new Error("Character not found")
			}

			// Extract tags (with type assertion for the relation)
			const tags = (character as any).characterTags.map((ct: any) => ct.tag.name)

			// Build SpecV3 character card  
			const cardData: SpecV3.CharacterCardV3 = {
				spec: "chara_card_v3",
				spec_version: "3.0",
				data: {
					name: character.name,
					description: character.description,
					tags: tags,
					creator: "", // Could be added to character schema later
					character_version: character.characterVersion ?? "1.0",
					mes_example: (character.exampleDialogues as string[]).join("\n\n"),
					extensions: (character.extensions as Record<string, any>) ?? {},
					system_prompt: "", // Not in current schema
					post_history_instructions: character.postHistoryInstructions ?? "",
					first_mes: character.firstMessage ?? "",
					alternate_greetings: (character.alternateGreetings as string[]) ?? [],
					personality: character.personality ?? "",
					scenario: character.scenario ?? "",
					creator_notes: character.creatorNotes ?? "",
					character_book: undefined, // TODO: Implement lorebook export
					assets: (character.assets as any[]) ?? [],
					nickname: character.nickname ?? undefined,
					creator_notes_multilingual: (character.creatorNotesMultilingual as Record<string, string>) ?? undefined,
					source: (character.source as string[]) ?? [],
					group_only_greetings: (character.groupOnlyGreetings as string[]) ?? [],
					creation_date: character.createdAt ? new Date(character.createdAt).getTime() : undefined,
					modification_date: character.updatedAt ? new Date(character.updatedAt).getTime() : undefined
				}
			}

			// Convert to JSON string
			const jsonString = JSON.stringify(cardData, null, 2)
			
			const format = params.format || "json"
			let blob: Buffer
			let filename: string

			if (format === "png" && character.avatar) {
				// Avatar is stored as URL path like /images/data/users/1/characters/23/avatar.png
				// Extract just the filename and construct the full file path
				const avatarFilename = path.basename(character.avatar)
				const avatarPath = path.join(
					getCharacterDataDir({ userId, characterId: character.id }),
					avatarFilename
				)
				
				try {
					const imageBuffer = await fsPromises.readFile(avatarPath)
					
					// Check if the file is actually a PNG
					const fileType = await fileTypeFromBuffer(imageBuffer)
					if (!fileType || fileType.mime !== 'image/png') {
						throw new Error(`Avatar is not a PNG file (detected: ${fileType?.mime || 'unknown'})`)
					}
					
					// Extract PNG chunks
					const chunks = extract(imageBuffer)
					
					// Create text chunk with character data
					// Use base64 encoding for the character data (common in character cards)
					const base64Data = Buffer.from(jsonString, 'utf-8').toString('base64')
					const textChunk = text.encode('chara', base64Data)
					
					// Insert text chunk before IEND chunk (last chunk)
					chunks.splice(-1, 0, textChunk)
					
					// Encode back to PNG
					blob = Buffer.from(encode(chunks))
					filename = `${character.name.replace(/[^a-z0-9]/gi, '_')}.png`
				} catch (err) {
					console.error("Error creating PNG with embedded data:", err)
					// Fallback to JSON if PNG creation fails
					blob = Buffer.from(jsonString, 'utf-8')
					filename = `${character.name.replace(/[^a-z0-9]/gi, '_')}.json`
				}
			} else {
				// Return as JSON file
				blob = Buffer.from(jsonString, 'utf-8')
				filename = `${character.name.replace(/[^a-z0-9]/gi, '_')}.json`
			}

			const res: Sockets.Characters.ExportCard.Response = {
				blob,
				filename
			}
			
			emitToUser("characters:exportCard", res)
			return res
		} catch (e: any) {
			console.error("Error exporting character card:", e)
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
	register(socket, charactersExportCard, emitToUser)
}
