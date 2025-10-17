/**
 * Assistant Function Registry
 * 
 * Central registry of all available functions for the assistant.
 */

import { characterFunctions } from './definitions/characterFunctions'
import type { AssistantFunction } from './types'

export const assistantFunctionRegistry: Record<string, AssistantFunction> = {
	...characterFunctions
}

export function getFunction(name: string): AssistantFunction | undefined {
	return assistantFunctionRegistry[name]
}

export function getFunctionList(): AssistantFunction[] {
	return Object.values(assistantFunctionRegistry)
}

/**
 * Generates function definitions formatted for the LLM's system prompt
 */
export function getFunctionDefinitionsForPrompt(): string {
	console.log('[Registry] ========== getFunctionDefinitionsForPrompt START ==========')
	console.log('[Registry] About to call getFunctionList()')
	
	const functions = getFunctionList()
	
	console.log('[Registry] getFunctionList() returned')
	console.log('[Registry] getFunctionDefinitionsForPrompt called, functions count:', functions.length)
	console.log('[Registry] Function names:', functions.map(f => f.name))
	console.log('[Registry] assistantFunctionRegistry keys:', Object.keys(assistantFunctionRegistry))

	const result = `# Available Functions

**YOU HAVE EXACTLY ONE FUNCTION: listCharacters**

**CRITICAL:** When users ask about characters (find, search, summarize, describe, who is, tell me about, etc.), you MUST use listCharacters - it's the ONLY function that exists.

## ⚠️ DO NOT INVENT FUNCTION NAMES ⚠️

❌ summarizeCharacter - DOES NOT EXIST
❌ getCharacter - DOES NOT EXIST  
❌ getCharacterDetails - DOES NOT EXIST
❌ searchLibrary - DOES NOT EXIST

✅ listCharacters - THIS IS THE ONLY FUNCTION

## Required Format

{reasoning: "brief explanation", functions?: [listCharacters(search:"name")]}

## Examples

**User:** "Summarize character Hina"
**You:** {reasoning: "User wants summary of Hina", functions?: [listCharacters(search:"Hina")]}

**User:** "Describe Alex"
**You:** {reasoning: "Getting Alex's info", functions?: [listCharacters(search:"Alex")]}

**User:** "Who is Maria?"
**You:** {reasoning: "Looking up Maria", functions?: [listCharacters(search:"Maria")]}

---

${functions
	.map(
		(f) => `
## ${f.name} ← THE ONLY FUNCTION
${f.description}

**Parameters:**
${Object.entries(f.parameters.properties)
	.map(([key, prop]) => `- ${key} (${prop.type}): ${prop.description}${prop.enum ? ` [${prop.enum.join(', ')}]` : ''}`)
	.join('\n')}

**When to use:** ${f.description}
**No confirmation needed** - Execute immediately when user requests this action.
`
	)
	.join('\n---\n')}

---

## Important Rules

1. **Format is everything**: Use ONLY {reasoning: "...", functions?: [...]} - nothing before or after
2. **No explanations**: Don't explain what you'll do, just do it
3. **No confirmations**: Don't ask permission, execute immediately  
4. **Multiple searches OK**: {reasoning: "...", functions?: [fn1(...), fn2(...)]}
5. **After results**: Once you receive results, answer the user's original question naturally
`
	
	console.log('[Registry] Returning function definitions, length:', result.length)
	console.log('[Registry] ========== getFunctionDefinitionsForPrompt END ==========')
	return result
}

