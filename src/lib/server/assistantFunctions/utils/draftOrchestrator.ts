/**
 * Draft Orchestrator
 * 
 * High-level orchestration for character draft creation.
 * Coordinates field generation, validation, and progress updates.
 */

import type { Socket } from 'socket.io'
import type { AssistantCreateCharacter } from '$lib/server/db/zodSchemas'
import { assistantCreateCharacterSchema } from '$lib/server/db/zodSchemas'
import { 
	determineFieldsToPopulate,
	generateFieldPrompt,
	FIELD_GENERATION_GUIDANCE,
	initializeEmptyDraft
} from './characterDraftGenerator'
import { generateFieldWithProgress, type FieldGenerationProgressCallback } from './llmFieldGenerator'
import { retryValidationWithLLM } from './validationRetryHandler'

/**
 * Parse LLM response for a field value
 */
function parseFieldValue(fieldName: string, response: string): any {
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

/**
 * Options for draft generation
 */
export interface GenerateDraftOptions {
	userId: number
	chatId: number
	userRequest: string
	additionalFields?: string[]
	existingDraft?: Partial<AssistantCreateCharacter>
	socket?: Socket
}

/**
 * Result of draft generation
 */
export interface GenerateDraftResult {
	success: boolean
	draft: Partial<AssistantCreateCharacter>
	isValid: boolean
	validationErrors?: any[]
	errorMessage?: string
	generatedFields: string[]
	validationAttempts: number
}

/**
 * Generate a character draft with full LLM field generation and validation
 * 
 * This is the main orchestrator that:
 * 1. Determines which fields to populate
 * 2. Generates each field using LLM
 * 3. Validates the result
 * 4. Retries with auto-correction if needed
 * 5. Emits progress updates via socket
 */
export async function generateCharacterDraft({
	userId,
	chatId,
	userRequest,
	additionalFields = [],
	existingDraft,
	socket
}: GenerateDraftOptions): Promise<GenerateDraftResult> {
	console.log('[DraftOrchestrator] Starting character draft generation')
	
	const generatedFields: string[] = []
	
	// 1. Determine which fields to populate
	const fieldsToPopulate = determineFieldsToPopulate(
		userRequest,
		additionalFields,
		existingDraft || null
	)
	
	console.log('[DraftOrchestrator] Fields to populate:', fieldsToPopulate)
	
	// Emit initial status
	emitProgress(socket, chatId, {
		status: 'started',
		message: `Generating ${fieldsToPopulate.length} field(s)...`,
		totalFields: fieldsToPopulate.length
	})
	
	// 2. Initialize draft structure
	// If we have an existing draft, use it; otherwise create a fully initialized empty structure
	// This ensures all fields exist before field generation starts, preventing undefined access errors
	const draft: Partial<AssistantCreateCharacter> = existingDraft 
		? { ...existingDraft } 
		: initializeEmptyDraft()
	
	console.log('[DraftOrchestrator] Draft initialized with structure:', Object.keys(draft))
	
	// 3. Build draft by generating each field
	for (let i = 0; i < fieldsToPopulate.length; i++) {
		const field = fieldsToPopulate[i]
		const guidance = FIELD_GENERATION_GUIDANCE[field]
		
		if (!guidance) {
			console.warn(`[DraftOrchestrator] No guidance found for field: ${field}`)
			continue
		}
		
		try {
			// Generate prompt for this field
			const prompt = generateFieldPrompt(field, userRequest, draft)
			
			// Progress callback for this field
			const onProgress: FieldGenerationProgressCallback = (update) => {
				emitProgress(socket, chatId, {
					status: 'generating_field',
					field: update.field,
					fieldStatus: update.status,
					message: update.message,
					currentField: i + 1,
					totalFields: fieldsToPopulate.length
				})
			}
			
			// Generate the field value
			const rawValue = await generateFieldWithProgress({
				userId,
				field,
				prompt,
				maxTokens: guidance.maxLength ? Math.min(guidance.maxLength * 2, 1000) : 500,
				onProgress
			})
			
			// Parse the value based on field type
			let fieldValue: any = rawValue.trim()
			
			// Handle array fields
			if (guidance?.isArray) {
				try {
					const parsed = JSON.parse(rawValue.trim())
					if (Array.isArray(parsed)) {
						fieldValue = parsed
					} else {
						// Try to extract array from response
						const match = rawValue.match(/\[[\s\S]*\]/)
						if (match) {
							try {
								fieldValue = JSON.parse(match[0])
							} catch {
								fieldValue = []
							}
						} else {
							fieldValue = []
						}
					}
				} catch (error) {
					// If parsing fails, try to extract array from response
					const match = rawValue.match(/\[[\s\S]*\]/)
					if (match) {
						try {
							fieldValue = JSON.parse(match[0])
						} catch {
							fieldValue = []
						}
					} else {
						fieldValue = []
					}
				}
			}
			
			// Update draft
			(draft as any)[field] = fieldValue
			generatedFields.push(field)
			
			console.log(`[DraftOrchestrator] Generated field "${field}":`, fieldValue)
			
			// Emit field completion
			emitProgress(socket, chatId, {
				status: 'field_complete',
				field,
				value: fieldValue,
				currentField: i + 1,
				totalFields: fieldsToPopulate.length
			})
			
		} catch (error) {
			console.error(`[DraftOrchestrator] Error generating field "${field}":`, error)
			
			// Emit error for this field
			emitProgress(socket, chatId, {
				status: 'field_error',
				field,
				error: error instanceof Error ? error.message : 'Unknown error',
				currentField: i + 1,
				totalFields: fieldsToPopulate.length
			})
			
			// Continue with other fields
			continue
		}
	}
	
	console.log('[DraftOrchestrator] Field generation complete, validating...')
	
	// Emit validation status
	emitProgress(socket, chatId, {
		status: 'validating',
		message: 'Validating character draft...'
	})
	
	// 3. Validate and auto-correct if needed
	const validationResult = await retryValidationWithLLM({
		schema: assistantCreateCharacterSchema as any, // Type assertion needed due to Zod complexity
		draft,
		entityType: 'character',
		userId,
		maxAttempts: 3,
		onAttempt: async (attempt, errors, fields) => {
			console.log(`[DraftOrchestrator] Validation attempt ${attempt}, correcting fields:`, fields)
			
			emitProgress(socket, chatId, {
				status: 'correcting',
				message: `Fixing ${fields.length} validation error(s) (attempt ${attempt}/3)...`,
				attempt,
				fields
			})
		}
	})
	
	console.log('[DraftOrchestrator] Validation result:', {
		success: validationResult.success,
		attempts: validationResult.attempts,
		correctedFields: validationResult.correctedFields
	})
	
	// 4. Emit final status
	if (validationResult.success) {
		emitProgress(socket, chatId, {
			status: 'complete',
			message: 'Character draft created successfully!',
			draft: validationResult.data,
			generatedFields,
			correctedFields: validationResult.correctedFields
		})
		
		return {
			success: true,
			draft: validationResult.data!,
			isValid: true,
			generatedFields,
			validationAttempts: validationResult.attempts
		}
	} else {
		emitProgress(socket, chatId, {
			status: 'validation_failed',
			message: 'Character draft has validation errors',
			draft,
			errors: validationResult.errors,
			generatedFields
		})
		
		return {
			success: true, // Draft was created, just not valid
			draft,
			isValid: false,
			validationErrors: validationResult.errors,
			errorMessage: validationResult.errorMessage,
			generatedFields,
			validationAttempts: validationResult.attempts
		}
	}
}

/**
 * Emit progress update via socket
 */
function emitProgress(socket: Socket | undefined, chatId: number, update: any) {
	if (!socket) return
	
	socket.emit('assistant:draftProgress', {
		chatId,
		...update,
		timestamp: Date.now()
	})
}
