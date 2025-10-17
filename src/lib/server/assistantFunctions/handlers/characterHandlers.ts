/**
 * Character function handlers
 */

import { db } from '$lib/server/db'
import { like, or, eq, and } from 'drizzle-orm'
import * as schema from '$lib/server/db/schema'
import type { AssistantFunctionHandler } from '$lib/shared/assistantFunctions/types'

export const listCharactersHandler: AssistantFunctionHandler = async ({
	userId,
	args
}) => {
	try {
		const { name, nickname, search } = args

		// Build where conditions
		const conditions = []

		if (name) {
			conditions.push(like(schema.characters.name, `%${name}%`))
		}

		if (nickname) {
			conditions.push(like(schema.characters.nickname, `%${nickname}%`))
		}

		if (search) {
			conditions.push(
				or(
					like(schema.characters.name, `%${search}%`),
					like(schema.characters.nickname, `%${search}%`),
					like(schema.characters.description, `%${search}%`)
				)
			)
		}

		// Query characters
		const whereClause =
			conditions.length > 0
				? and(eq(schema.characters.userId, userId), or(...conditions))
				: eq(schema.characters.userId, userId)

		const characters = await db.query.characters.findMany({
			where: whereClause,
			columns: {
				id: true,
				name: true,
				nickname: true,
				description: true,
				avatar: true
			},
			limit: 50
		})

        console.log(`listCharactersHandler: Found ${characters.length} characters for userId ${userId}`)

		return {
			success: true,
			data: { characters }
		}
	} catch (error) {
		console.error('listCharactersHandler error:', error)
		return {
			success: false,
			error: 'Failed to search for characters'
		}
	}
}
