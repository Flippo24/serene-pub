import { expect, test } from "vitest"
import { setUserTokenCookie } from "."
import type { RequestEvent } from "@sveltejs/kit"
import { fn } from "jest-mock"

test("setUserTokenCookie: sets userToken cookie", async () => {
	const setMock = fn()

	const event = {
		cookies: {
			set: setMock,
			get: () => "userToken",
			getAll: () => [{ name: "userToken", value: "token" }],
			delete: (name: string, opts) => null,
			serialize: (name: string, value: string, opts) => `${name}=${value}` // Mock serialize method
		}
	} as unknown as RequestEvent

	setUserTokenCookie({ event, token: "testToken" })

	expect(setMock).toHaveBeenCalledWith("userToken", "testToken", {
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "strict"
	})
})
