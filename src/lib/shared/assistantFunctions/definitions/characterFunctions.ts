/**
 * Character-related assistant functions
 */

import type { AssistantFunction } from '../types'

export const characterFunctions: Record<string, AssistantFunction> = {
	listCharacters: {
		name: 'listCharacters',
		description: 'Find and retrieve character information. Use this for ANY character-related query including: finding characters, getting character details, summarizing characters, describing characters, or answering questions about characters. Returns full character data including name, description, personality, and all other details.',
		requiresConfirmation: false,
		requiresAdmin: false,
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Search by exact or partial character name'
				},
				nickname: {
					type: 'string',
					description: 'Search by character nickname'
				},
				search: {
					type: 'string',
					description: 'General search term - searches across name, nickname, and description. Use this when you have a character name.'
				}
			},
			required: []
		}
	},
	draftCharacter: {
		name: 'draftCharacter',
		description: `Create or update a character draft based on user requirements. The draft is saved to the chat and shown to the user for review before being saved to the database. 

**When to use**: User asks to create/draft a character, provides character details, or asks you to help create a character.

**How to call**:
{reasoning: "User wants to create [type of character]", functions: [draftCharacter(userRequest:"[exact user request here]", additionalFields:["personality","scenario"])]}

**Examples**:
- User: "Create a cowboy character" → {reasoning: "Creating cowboy character", functions: [draftCharacter(userRequest:"Create a cowboy character", additionalFields:["personality","scenario"])]}
- User: "Make a detective named Sarah who is cynical" → {reasoning: "Creating detective character", functions: [draftCharacter(userRequest:"Make a detective named Sarah who is cynical", additionalFields:["personality","scenario"])]}
- User: "I need a fantasy wizard" → {reasoning: "Creating wizard character", functions: [draftCharacter(userRequest:"I need a fantasy wizard", additionalFields:["personality","scenario","firstMessage"])]}

**CRITICAL**: NEVER create character details yourself. NEVER output JSON schemas or API endpoints. Only call this function with the exact format shown above.`,
		requiresConfirmation: false,
		requiresAdmin: false,
		parameters: {
			type: 'object',
			properties: {
				userRequest: {
					type: 'string',
					description: 'The EXACT user request describing what character they want. Copy it word-for-word from the user message.'
				},
				additionalFields: {
					type: 'array',
					items: {
						type: 'string',
						enum: [
							'nickname',
							'personality',
							'scenario',
							'firstMessage',
							'alternateGreetings',
							'exampleDialogues',
							'creatorNotes',
							'groupOnlyGreetings',
							'postHistoryInstructions',
							'source',
							'characterVersion'
						]
					},
					description: 'Optional fields to populate in addition to required fields (name, description). Default: ["personality","scenario"]'
				}
			},
			required: ['userRequest']
		}
	}
}
