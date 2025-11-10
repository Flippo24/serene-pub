/**
 * Character Draft Generator Utilities
 * 
 * Utilities for generating character drafts field-by-field using LLM
 */

import type { Socket } from 'socket.io'
import type { AssistantCreateCharacter } from '$lib/server/db/zodSchemas'

/**
 * Initialize an empty draft structure with all fields set to appropriate empty/default values
 * This ensures all properties exist before any field generation begins
 */
export function initializeEmptyDraft(): Partial<AssistantCreateCharacter> {
	return {
		// Required text fields
		name: '',
		description: '',
		
		// Optional text fields
		nickname: undefined,
		personality: undefined,
		scenario: undefined,
		firstMessage: undefined,
		creatorNotes: undefined,
		postHistoryInstructions: undefined,
		characterVersion: undefined,
		
		// Array fields - initialize as empty arrays to prevent undefined access
		alternateGreetings: [],
		exampleDialogues: [],
		groupOnlyGreetings: [],
		source: [],
		
		// Object fields - initialize as empty objects
		creatorNotesMultilingual: undefined
	}
}

/**
 * Fields that are required for character creation
 */
export const REQUIRED_CHARACTER_FIELDS = ['name', 'description'] as const

/**
 * Optional fields that can be included in character drafts
 */
export const OPTIONAL_CHARACTER_FIELDS = [
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
] as const

/**
 * Field generation prompts and guidance
 */
export const FIELD_GENERATION_GUIDANCE: Record<string, {
	prompt: string
	maxLength?: number
	isArray?: boolean
}> = {
	name: {
		prompt: 'Generate a character name. Keep it concise (1-50 characters). Return ONLY the name, nothing else.',
		maxLength: 50
	},
	description: {
		prompt: 'Generate a detailed character description including personality, appearance, and background. Aim for vivid detail but be efficient (minimum 10 characters). Return ONLY the description text, nothing else.',
		maxLength: undefined
	},
	nickname: {
		prompt: 'Generate an optional nickname or alternative name for this character. Keep it concise (max 50 characters). Return ONLY the nickname, nothing else.',
		maxLength: 50
	},
	personality: {
		prompt: 'Generate the character\'s personality traits and behavioral patterns. Be detailed but efficient. Return ONLY the personality description, nothing else.',
		maxLength: undefined
	},
	scenario: {
		prompt: 'Generate the scenario or setting where this character exists. Keep it under 2000 characters. Return ONLY the scenario text, nothing else.',
		maxLength: 2000
	},
	firstMessage: {
		prompt: 'Generate the character\'s greeting or opening message. Keep it under 2000 characters and write it in the character\'s voice. Return ONLY the greeting message, nothing else.',
		maxLength: 2000
	},
	alternateGreetings: {
		prompt: 'Generate 2-3 alternative greeting messages for this character. Return as a JSON array of strings. Each greeting should be in the character\'s voice.',
		isArray: true
	},
	exampleDialogues: {
		prompt: 'Generate 2-3 example conversation snippets showing how this character talks. Return as a JSON array of strings. Format each as "{{user}}: message\n{{char}}: response"',
		isArray: true
	},
	creatorNotes: {
		prompt: 'Generate creator notes about this character - design philosophy, inspiration, usage tips. Return ONLY the notes text, nothing else.',
		maxLength: undefined
	},
	groupOnlyGreetings: {
		prompt: 'Generate 1-2 greeting messages specifically for when this character joins a group chat. Return as a JSON array of strings.',
		isArray: true
	},
	postHistoryInstructions: {
		prompt: 'Generate instructions for how the character should behave after chat history. Keep it under 2000 characters. Return ONLY the instruction text, nothing else.',
		maxLength: 2000
	},
	source: {
		prompt: 'List the sources for this character (e.g., "Original Creation", book titles, show names). Return as a JSON array of strings.',
		isArray: true
	},
	characterVersion: {
		prompt: 'Specify the character card version (typically "1.0" or "2.0"). Return ONLY the version string, nothing else.',
		maxLength: 20
	}
}

/**
 * Generate a system prompt for creating a specific field value
 */
export function generateFieldPrompt(
	fieldName: string,
	userRequest: string,
	existingDraft: Partial<AssistantCreateCharacter>
): string {
	const guidance = FIELD_GENERATION_GUIDANCE[fieldName]
	if (!guidance) {
		throw new Error(`No guidance found for field: ${fieldName}`)
	}

	const contextParts: string[] = [
		'You are helping to create a character based on the user\'s request.',
		'',
		`User request: "${userRequest}"`,
		''
	]

	// Add existing field values for context
	if (Object.keys(existingDraft).length > 0) {
		contextParts.push('Existing character details:')
		for (const [key, value] of Object.entries(existingDraft)) {
			if (value !== null && value !== undefined) {
				contextParts.push(`- ${key}: ${JSON.stringify(value)}`)
			}
		}
		contextParts.push('')
	}

	contextParts.push(`Your task: ${guidance.prompt}`)

	if (guidance.maxLength) {
		contextParts.push(`Maximum length: ${guidance.maxLength} characters`)
	}

	contextParts.push('')
	contextParts.push('IMPORTANT: Return ONLY the requested content, no explanations or additional text.')

	return contextParts.join('\n')
}

/**
 * Determine which fields to populate based on user request and existing draft
 */
export function determineFieldsToPopulate(
	userRequest: string,
	additionalFields: string[] = [],
	existingDraft: Partial<AssistantCreateCharacter> | null
): string[] {
	const fields: string[] = []
	
	// Detect if this is a regeneration/modification request
	const regenerationKeywords = ['reroll', 'regenerate', 'change', 'modify', 'update', 'redo', 'remake', 'rewrite', 'remove', 'add', 'adjust', 'fix', 'correct']
	const isRegenerationRequest = regenerationKeywords.some(keyword => 
		userRequest.toLowerCase().includes(keyword)
	)
	
	// Detect which fields are mentioned in the user request
	const requestLower = userRequest.toLowerCase()
	const mentionedFields: string[] = []
	
	// Check for field names mentioned in the request
	const allFields = [...REQUIRED_CHARACTER_FIELDS, ...OPTIONAL_CHARACTER_FIELDS]
	for (const field of allFields) {
		// Match field name with word boundaries or as part of common phrases
		if (
			requestLower.includes(field) || 
			(field === 'name' && requestLower.match(/\bname\b/)) ||
			(field === 'nickname' && requestLower.match(/\bnick|alias\b/)) ||
			(field === 'personality' && requestLower.match(/\bpersonality|traits?\b/)) ||
			(field === 'description' && requestLower.match(/\bdescription|appearance|look\b/)) ||
			(field === 'scenario' && requestLower.match(/\bscenario|setting|background\b/))
		) {
			mentionedFields.push(field)
		}
	}

	// Always include required fields if not already present
	for (const field of REQUIRED_CHARACTER_FIELDS) {
		if (!existingDraft || !(field in existingDraft)) {
			fields.push(field)
		}
	}

	// Add requested additional fields
	for (const field of additionalFields) {
		if (OPTIONAL_CHARACTER_FIELDS.includes(field as any)) {
			// If this is a regeneration request, include the field even if it exists
			// Otherwise, only include if missing
			if (isRegenerationRequest) {
				fields.push(field)
			} else if (!existingDraft || !(field in existingDraft)) {
				fields.push(field)
			}
		}
	}
	
	// Add fields mentioned in the request (if modification is requested)
	if (isRegenerationRequest && mentionedFields.length > 0) {
		for (const field of mentionedFields) {
			if (!fields.includes(field)) {
				console.log(`[determineFieldsToPopulate] Adding mentioned field: ${field}`)
				fields.push(field)
			}
		}
	}

	return fields
}

/**
 * Parse LLM response for a field value
 */
export function parseFieldValue(fieldName: string, response: string): any {
	const guidance = FIELD_GENERATION_GUIDANCE[fieldName]
	
	if (guidance?.isArray) {
		// Try to parse as JSON array
		try {
			const parsed = JSON.parse(response.trim())
			if (Array.isArray(parsed)) {
				return parsed
			}
		} catch (error) {
			// If parsing fails, try to extract array from response
			const match = response.match(/\[[\s\S]*\]/)
			if (match) {
				try {
					return JSON.parse(match[0])
				} catch {
					// Fall through to return empty array
				}
			}
		}
		return []
	}

	// For non-array fields, return trimmed response
	return response.trim()
}
