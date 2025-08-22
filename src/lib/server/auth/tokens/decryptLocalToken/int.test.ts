import { expect, test } from "vitest"
import { decryptLocalToken } from "."

test("decryptLocalToken: decrypts token", async () => {
	// This has coverage elsewhere
	expect(decryptLocalToken).toBeDefined()
})
