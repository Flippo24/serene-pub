import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/**
 * Generate a concise title for an assistant chat based on the first exchange
 * Uses direct API calls to avoid adapter complexity
 */
export async function generateChatTitle({
	userMessage,
	assistantMessage,
	connection,
	sampling
}: {
	userMessage: string
	assistantMessage: string
	connection: any // SelectConnection
	sampling: any // SelectSamplingConfig
}): Promise<string> {
	try {
		// Use a simple, focused prompt to generate a concise title
		const titlePrompt = `Based on this conversation, generate a short, descriptive title (maximum 6 words, no quotes or punctuation at the end):

User: ${userMessage.slice(0, 500)}
Assistant: ${assistantMessage.slice(0, 500)}

Title:`

		// Make direct API call based on connection type
		let title = ""

		if (connection.type === CONNECTION_TYPE.OPENAI_CHAT) {
			// OpenAI-compatible API
			const response = await fetch(`${connection.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${connection.apiKey}`
				},
				body: JSON.stringify({
					model: connection.model,
					messages: [{ role: "user", content: titlePrompt }],
					max_tokens: 30,
					temperature: 0.7,
					stream: false
				})
			})

			const data = await response.json()
			title = data.choices?.[0]?.message?.content || ""
		} else if (connection.type === CONNECTION_TYPE.OLLAMA) {
			// Ollama API
			const response = await fetch(`${connection.baseUrl}/api/chat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: connection.model,
					messages: [{ role: "user", content: titlePrompt }],
					stream: false,
					options: {
						num_predict: 30,
						temperature: 0.7
					}
				})
			})

			// Try JSON parsing first, fall back to text if it fails
			const contentType = response.headers.get('content-type')
			if (contentType?.includes('application/json')) {
				const data = await response.json()
				title = data.message?.content || ""
			} else {
				// Fallback to text parsing for non-JSON responses
				const text = await response.text()
				try {
					const data = JSON.parse(text)
					title = data.message?.content || ""
				} catch (e) {
					// If JSON parsing fails, use the text directly
					title = text
				}
			}
		} else {
			// Fallback for other connection types
			throw new Error(`Unsupported connection type: ${connection.type}`)
		}

		// Clean up the title
		title = title
			.trim()
			.replace(/^["']|["']$/g, "") // Remove quotes
			.replace(/\.$/, "") // Remove trailing period
			.replace(/^Title:\s*/i, "") // Remove "Title:" prefix if present
			.slice(0, 100) // Truncate if too long

		// Return the title or a fallback
		return title || "Conversation"
	} catch (error) {
		console.error("Error generating chat title:", error)
		// Return a fallback based on first few words of user message
		const fallback = userMessage
			.split(" ")
			.slice(0, 5)
			.join(" ")
			.slice(0, 50)
		return fallback || "Assistant Chat"
	}
}
