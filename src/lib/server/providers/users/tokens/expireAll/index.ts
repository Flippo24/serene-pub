import { db, schema } from "$lib/server/db"
import { eq } from "drizzle-orm"

/**
 * Revoke all user tokens
 */
export async function expireAll({
	tx = db,
	userId,
	returning
}: {
	tx?: DbTransaction | typeof db
	userId: string
	returning?: ReturningSelect
}): PromisedQueryResult<typeof returning> {
	const query = tx
		.update(schema.userTokens)
		.set({
			expiresAt: new Date()
		})
		.where(eq(schema.userTokens.userId, userId))
		.execute()

	// Returning?
	if (returning) {
		query.returning(returning)
	}

	// Return result
	return await query
}
