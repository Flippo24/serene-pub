// Helper to determine which character's turn it is
export function getNextCharacterTurn(
	chat: {
		chatMessages: SelectChatMessage[]
		chatCharacters: (SelectChatCharacter & { character: SelectCharacter })[]
		chatPersonas: (SelectChatPersona & { persona: SelectPersona })[]
	},
	opts: { triggered?: boolean } = {}
): number | null {
	const { triggered = false } = opts

	if (!chat.chatCharacters?.length || !chat.chatPersonas?.length) {
		return null
	}

	// Sort ALL characters by position first with normalization, then filter active ones while preserving order
	const allCharactersSorted = chat.chatCharacters
		.slice()
		.map((cc, index) => ({
			...cc,
			normalizedPosition: cc.position ?? index
		}))
		.sort((a, b) => a.normalizedPosition - b.normalizedPosition)

	const activeCharacters = allCharactersSorted.filter((cc) => cc.isActive)

	// If no active characters, return null
	if (activeCharacters.length === 0) {
		return null
	}

	const personaIds = chat.chatPersonas.map((cp) => cp.persona.id)

	// Find the index of the last persona message
	let lastPersonaIdx = -1
	for (let i = chat.chatMessages.length - 1; i >= 0; --i) {
		const msg = chat.chatMessages[i]
		if (msg.role === "user" && personaIds.includes(msg.personaId ?? -1)) {
			lastPersonaIdx = i
			break
		}
	}

	// Pool of messages since the last persona message (exclusive)
	const pool = chat.chatMessages.slice(lastPersonaIdx + 1)

	if (!triggered) {
		// Round-robin: find first active character who hasn't replied since last user message
		for (const cc of activeCharacters) {
			const hasMessage = pool.some(
				(msg) =>
					msg.role === "assistant" &&
					msg.characterId === cc.character.id
			)
			if (!hasMessage) {
				return cc.character.id
			}
		}

		// If all active characters have replied, stop the turn cycle (return null)
		return null
	} else {
		// For triggered: check if each character has replied since the last user message
		for (const cc of activeCharacters) {
			const hasRecentReply = pool.some(
				(msg) =>
					msg.role === "assistant" &&
					msg.characterId === cc.character.id
			)
			if (!hasRecentReply) {
				return cc.character.id
			}
		}

		// If all have replied in the normal flow, select the character with the oldest most recent reply
		// (furthest removed from their latest response)

		// Find the most recent message for each character in the pool
		let oldestRecentCharacter: {
			id: number
			lastMessageIndex: number
		} | null = null

		for (const cc of activeCharacters) {
			// Find the most recent message from this character in the pool
			let lastMessageIndex = -1
			for (let i = pool.length - 1; i >= 0; i--) {
				const msg = pool[i]
				if (
					msg.role === "assistant" &&
					msg.characterId === cc.character.id
				) {
					lastMessageIndex = i
					break // Found the most recent message from this character
				}
			}

			// If this character has a message in the pool, compare their most recent message
			if (lastMessageIndex >= 0) {
				if (
					!oldestRecentCharacter ||
					lastMessageIndex < oldestRecentCharacter.lastMessageIndex
				) {
					oldestRecentCharacter = {
						id: cc.character.id,
						lastMessageIndex: lastMessageIndex
					}
				}
			}
		}

		if (oldestRecentCharacter) {
			return oldestRecentCharacter.id
		}

		// Fallback: if for some reason no character is found with a recent reply, return null
		return null
	}
}
