import { expire } from "../tokens"
import { db } from "$lib/server/db"
import type { RequestEvent } from "@sveltejs/kit"
import { cookies } from "$lib/server/auth"

export async function logout({
	tx = db,
	event
}: {
	tx?: typeof db
	event: RequestEvent
}) {
	await expire({ tx, userTokenId: (event.locals as any).userTokenId })
	cookies.deleteUserTokenCookie({ event })
}
