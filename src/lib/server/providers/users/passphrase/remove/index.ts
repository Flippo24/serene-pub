import { db, schema } from "$lib/server/db"
import { eq } from "drizzle-orm"

export async function remove({
	tx = db,
	userId,
	returning
}: {
	tx?: DbTransaction | typeof db
	userId: string
	returning?: ReturningSelect
}): PromisedQueryResult<typeof returning> {
	const query = tx
		.delete(schema.passphrases)
		.where(eq(schema.passphrases.userId, userId))

	// Returning?
	if (returning) {
		query.returning(returning)
	}

	// Return result
	return await query
}
