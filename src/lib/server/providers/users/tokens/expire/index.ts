import { db, schema } from "$lib/server/db"
import { eq } from "drizzle-orm"

/**
 * Revoke a user token
 */
export async function expire({
	tx = db,
	userTokenId: tokenId,
	returning
}: {
	tx?: typeof db
	userTokenId: string
	returning?: any
}): Promise<any> {
	let query = tx
		.update(schema.userTokens)
		.set({
			expiresAt: new Date()
		})
		.where(eq(schema.userTokens.id, tokenId))

	// Returning?
	if (returning) {
		query = query.returning(returning)
	}

	// Return result
	return await query.execute()
}
