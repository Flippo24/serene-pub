import { db } from "$lib/server/db/schema"
import { schema } from "$lib/server/db/schema"

/**
 * Creates a new user.
 * @param {typeof db} args.tx - The database transaction. Defaults to `db`.
 * @param {string} args.username - The username of the new user.
 * @param {bool} args.isVerified - Whether the new user is verified. Defaults to `false`.
 * @param {ReturningSelect} args.returning - The fields to return after creating the new user. Defaults to `null`.
 * @returns {PromisedQueryResult<typeof params.returning>} The results of args.returning, or void.
 *
 * @example
 *  import { db, schema } from "$lib/server/db"
 *  import { users } from "$server/providers"
 *
 * // Start a transaction
 *  db.transaction(async tx => {
 *      const [{ userId }] = await users.create({
 *          tx,
 *          username: "johnDoe",
 *          returning: {
 *              id: schema.users.id,
 *          }
 *      })
 *      // ... Set a password?
 *      // ... Create a user email?
 *      // ... Send a verification email?
 *  })
 */
export async function create({
	tx = db,
	username,
	isVerified = false,
	isAdmin = false,
	isSuperUser = false,
	returning = null
}: {
	tx?: typeof db
	username: string
	isVerified?: boolean
	isAdmin?: boolean
	isSuperUser?: boolean
	returning?: ReturningSelect
}): PromisedQueryResult<typeof returning> {
	// Create user
	const query = tx.insert(schema.users).values({
		username,
		verifiedAt: isVerified ? new Date() : null,
		isAdmin,
		isSuperUser
	})

	// Returning?
	if (returning) {
		query.returning(returning)
	}

	// Return result
	return await query
}
