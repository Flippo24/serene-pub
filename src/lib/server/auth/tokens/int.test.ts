import { expect, test } from "vitest"
import { secretKey } from "."

test("secretKey: exists", () => {
	expect(secretKey).toBeDefined()
})
