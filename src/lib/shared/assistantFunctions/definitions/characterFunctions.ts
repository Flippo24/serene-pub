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
	}
}
