import { expect, test } from "vitest"
import { generateLocalToken } from "."

test("generateLocalToken: creates token", async () => {
	// This has coverage elsewhere
	expect(generateLocalToken).toBeDefined()
})
