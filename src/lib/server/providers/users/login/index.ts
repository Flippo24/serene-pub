import { db, schema } from "$lib/server/db"
import { cookies } from "$lib/server/auth"
import type { RequestEvent } from "@sveltejs/kit"
import * as userTokens from "../tokens"

/**
 * Validates user credentials and generates a token and cookie.
 * Authenticates the user for the event.
 *
 * @param tx
 * @param event
 * @param username
 * @param passphrase
 */
export async function login({
	tx = db,
	event,
	userId,
	passphrase
}: {
	tx?: typeof db
	event: RequestEvent
	userId: string
	passphrase: string
}): Promise<SelectUser | void> {
	/**
	 * Find the user
	 */
	const user = await tx.query.users.findFirst({
		where: (users, { eq, isNotNull, and }) =>
			and(eq(users.id, userId), isNotNull(users.verifiedAt)),
		with: {
			passphrase: true
		}
	})

	/**
	 * Make sure we have a user and a passphrase set
	 */
	if (!user || !user.passphrase) {
		return
	}

	/**
	 * Validate the hash
	 */
	const hash = await users.passphrase.encrypt({
		passphrase,
		salt: user.passphrase.salt,
		iterations: Number(user.passphrase.iterations)
	})

	if (hash !== user.passphrase.hash) {
		return
	}

	/**
	 * Generate token
	 */
	const [{ token }] = await users.tokens.create({
		tx,
		event,
		userId: user.id,
		returning: {
			token: schema.userTokens.token // add token to the returning object
		}
	})

	/**
	 * Return token as a secure cookie
	 */
	cookies.setUserTokenCookie({ event, token })
	return user
}
