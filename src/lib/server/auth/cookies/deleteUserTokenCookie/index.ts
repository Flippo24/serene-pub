import type { RequestEvent } from "@sveltejs/kit"

/**
 * Deletes the userToken cookie from the incoming request
 *
 * @param args.event The incoming request
 */
export function deleteUserTokenCookie({ event }: { event: RequestEvent }) {
	event.cookies.delete("userToken", {
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "strict"
	})
}
