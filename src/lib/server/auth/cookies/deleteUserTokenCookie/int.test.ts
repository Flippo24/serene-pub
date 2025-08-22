import { expect, test } from "vitest"
import { fn } from "jest-mock"
import { deleteUserTokenCookie } from "."
import type { RequestEvent } from "@sveltejs/kit"

test("deleteUserTokenCookie: deletes userToken cookie", async () => {
	const deleteMock = fn()

	const event = {
		cookies: {
			delete: deleteMock,
			get: () => "userToken",
			getAll: () => [{ name: "userToken", value: "token" }],
			set: (name: string, value: string, opts) => null,
			serialize: (name: string, value: string, opts) => `${name}=${value}` // Mock serialize method
		}
	} as unknown as RequestEvent

	deleteUserTokenCookie({ event })

	expect(deleteMock).toHaveBeenCalledWith("userToken", {
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "strict"
	})
})
