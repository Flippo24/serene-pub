/**
 * Reasoning Format Parser
 * 
 * Parses the assistant's reasoning response to extract function calls.
 * Format: {reasoning: "explanation", functions?: [fn(arg:"value"), fn2(arg:"value")]}
 */

export interface ParsedReasoning {
	reasoning: string
	functionCalls: Array<{
		name: string
		args: Record<string, any>
	}>
}

/**
 * Parse reasoning format from assistant response
 */
export function parseReasoningFormat(content: string): ParsedReasoning | null {
	// Match: {reasoning: "...", functions?: [...]}
	const reasoningPattern = /\{reasoning:\s*"([^"]+)"(?:,\s*functions\?:\s*\[([^\]]+)\])?\}/
	const match = content.match(reasoningPattern)

	if (!match) {
		return null
	}

	const reasoning = match[1]
	const functionsStr = match[2]

	const functionCalls = functionsStr ? parseFunctionCalls(functionsStr) : []

	return {
		reasoning,
		functionCalls
	}
}

/**
 * Parse function call strings into structured data
 * Example: listCharacters(name:"Sarah"), getCharacter(id:5)
 */
export function parseFunctionCalls(
	functionsStr: string
): Array<{ name: string; args: Record<string, any> }> {
	const calls: Array<{ name: string; args: Record<string, any> }> = []

	// Match patterns like: functionName(arg1:"value1", arg2:123)
	const functionPattern = /(\w+)\(([^)]*)\)/g
	let fnMatch

	while ((fnMatch = functionPattern.exec(functionsStr)) !== null) {
		const name = fnMatch[1]
		const argsStr = fnMatch[2]
		const args: Record<string, any> = {}

		if (argsStr.trim()) {
			// Parse arguments: arg:"value" or arg:number or arg:true
			const argPattern = /(\w+):(["']?)([^,"']+)\2/g
			let argMatch

			while ((argMatch = argPattern.exec(argsStr)) !== null) {
				const argName = argMatch[1]
				const argValue = argMatch[3]

				// Try to parse as number, boolean, or keep as string
				if (!isNaN(Number(argValue))) {
					args[argName] = Number(argValue)
				} else if (argValue === 'true' || argValue === 'false') {
					args[argName] = argValue === 'true'
				} else {
					args[argName] = argValue
				}
			}
		}

		calls.push({ name, args })
	}

	return calls
}
