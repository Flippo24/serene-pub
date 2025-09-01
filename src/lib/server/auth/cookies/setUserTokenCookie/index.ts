import type { RequestEvent } from "@sveltejs/kit"

// Convert hours:string to number and calculate the max age for the cookie
const maxHours = process.env.USER_TOKEN_EXPIRATION_HOURS
const maxAge = 60 * 60 * Number(maxHours)

// Check if dev environment
const dev = process.env.NODE_ENV === "development"
const secure = !dev
const sameSite = dev ? "lax" : "strict"

export function setUserTokenCookie({
	event,
	token
}: {
	event: RequestEvent
	token: string
}) {
	event.cookies.set("userToken", token, {
		path: "/",
		httpOnly: true,
		secure,
		sameSite,
		maxAge
	})
}
