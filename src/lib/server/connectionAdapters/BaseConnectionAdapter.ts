import { PromptBuilder, type CompiledPrompt as PromptBuilderCompiledPrompt } from "../utils/promptBuilder"
import type { TokenCounters } from "../utils/TokenCounterManager"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { AssistantPrompts } from "$lib/shared/constants/AssistantPrompts"

export interface BasePromptChat extends SelectChat {
	chatCharacters?: (SelectChatCharacter & {
		character: SelectCharacter & { lorebook?: SelectLorebook }
	})[]
	chatPersonas?: (SelectChatPersona & {
		persona: SelectPersona & { lorebook?: SelectLorebook }
	})[]
	chatMessages: SelectChatMessage[]
	lorebook: SelectLorebook & {
		lorebookBindings: (SelectLorebookBinding & {
			character?: SelectCharacter
			persona?: SelectPersona
		})[]
	}
}

// Generic interface for constructor parameters
export interface BaseConnectionAdapterParams {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BasePromptChat
	currentCharacterId: number | null
	tokenCounter: TokenCounters
	tokenLimit: number
	contextThresholdPercent: number
	isAssistantMode?: boolean
}

// Types for abstract functions
export type ListModelsFn = (
	connection: SelectConnection
) => Promise<{ models: any[]; error?: string }>
export type TestConnectionFn = (
	connection: SelectConnection
) => Promise<{ ok: boolean; error?: string }>

export abstract class BaseConnectionAdapter {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BasePromptChat
	currentCharacterId: number | null
	isAborting = false
	isAssistantMode = false
	promptBuilder: PromptBuilder

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		chat,
		currentCharacterId,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		isAssistantMode = false
	}: BaseConnectionAdapterParams) {
		this.connection = connection
		this.sampling = sampling
		this.contextConfig = contextConfig
		this.promptConfig = promptConfig
		this.chat = chat
		this.currentCharacterId = currentCharacterId
		this.isAssistantMode = isAssistantMode || chat.chatType === ChatTypes.ASSISTANT
		this.promptBuilder = new PromptBuilder({
			connection: this.connection,
			sampling: this.sampling,
			contextConfig: this.contextConfig,
			promptConfig: this.promptConfig,
			chat: this.chat,
			currentCharacterId: this.currentCharacterId,
			tokenCounter,
			tokenLimit,
			contextThresholdPercent,
			isAssistantMode: this.isAssistantMode
		})
	}

	async compilePrompt(args: {}): Promise<PromptBuilderCompiledPrompt> {
		this.promptBuilder.tokenLimit = await this.getContextTokenLimit()
		
		// Use assistant prompt compilation for assistant mode
		if (this.isAssistantMode) {
			return await this.compileAssistantPrompt(args)
		}
		
		return await this.promptBuilder.compilePrompt(args)
	}

	abstract generate(): Promise<{
		completionResult:
			| string
			| ((cb: (chunk: string) => void) => Promise<void>)
		compiledPrompt: PromptBuilderCompiledPrompt
		isAborted: boolean
	}>

	abort() {
		this.isAborting = true
	}

	async getContextTokenLimit(): Promise<number> {
		return this.sampling.contextTokensEnabled
			? this.sampling.contextTokens || 4096
			: 4096
	}

	/**
	 * Get the system prompt for the current mode
	 * Override this in subclasses if needed
	 */
	protected getSystemPrompt(): string {
		if (this.isAssistantMode) {
			return AssistantPrompts.getSystemPrompt()
		}
		return this.promptConfig.systemPrompt
	}

	/**
	 * Determine which assistant prompt mode to use based on chat state
	 */
	protected getAssistantPromptMode(): 'function-calling' | 'conversational' | 'default' {
		const metadata = this.chat.metadata as any
		
		// If we have tagged entities, use conversational mode (they already selected what they want)
		if (metadata?.taggedEntities && Object.keys(metadata.taggedEntities).length > 0) {
			return 'conversational'
		}
		
		// Check if last message was asking about an entity
		const lastUserMessage = [...this.chat.chatMessages]
			.reverse()
			.find((m: any) => m.role === 'user')
		
		if (lastUserMessage) {
			const content = lastUserMessage.content.toLowerCase()
			const functionTriggers = [
				'find', 'search', 'tell me about', 'who is', 'what is',
				'show me', 'look up', 'get', 'fetch', 'summarize',
				'describe', 'explain', 'details about', 'information about',
				'tell me more about'
			]
			
			const hasTrigger = functionTriggers.some(trigger => content.includes(trigger))
			if (hasTrigger) {
				return 'function-calling'
			}
		}
		
		return 'default'
	}

	/**
	 * Compile assistant mode prompt (simple message history)
	 * Can be overridden by subclasses for custom formatting
	 */
	protected async compileAssistantPrompt(args: {}): Promise<PromptBuilderCompiledPrompt> {
		const messages: any[] = []
		
		// Determine which prompt mode to use
		const promptMode = this.getAssistantPromptMode()
		
		// Get appropriate system prompt
		let systemContent: string
		switch (promptMode) {
			case 'function-calling':
				systemContent = AssistantPrompts.getFunctionCallingPrompt()
				console.log('[AssistantPrompt] Using FUNCTION-CALLING mode')
				console.log('[AssistantPrompt] System prompt preview:', systemContent.substring(0, 500))
				break
			case 'conversational':
				systemContent = AssistantPrompts.getConversationalPrompt()
				console.log('[AssistantPrompt] Using CONVERSATIONAL mode (has tagged entities)')
				break
			default:
				systemContent = AssistantPrompts.getSystemPrompt()
				console.log('[AssistantPrompt] Using DEFAULT mode')
				break
		}
		
		// Load and append tagged entities context (for conversational mode)
		const taggedEntitiesContext = await this.loadTaggedEntitiesContext()
		if (taggedEntitiesContext) {
			systemContent += "\n\n" + taggedEntitiesContext
		}
		
		messages.push({
			role: "system",
			content: systemContent
		})

		// Add chat messages in order (simple conversion)
		for (const msg of this.chat.chatMessages) {
			// Skip hidden messages
			if (msg.isHidden) continue
			
			messages.push({
				role: msg.role === "assistant" ? "assistant" : "user",
				content: msg.content
			})
		}

		const totalTokens = await this.promptBuilder.tokenCounter.countTokens(
			JSON.stringify(messages)
		)

		return {
			prompt: undefined,
			messages,
			meta: {
				promptFormat: "chat",
				templateName: "assistant",
				timestamp: new Date().toISOString(),
				truncationReason: null,
				currentTurnCharacterId: null,
				tokenCounts: {
					total: totalTokens,
					limit: await this.getContextTokenLimit()
				},
				chatMessages: {
					included: this.chat.chatMessages.filter((m: SelectChatMessage) => !m.isHidden).length,
					total: this.chat.chatMessages.length,
					includedIds: this.chat.chatMessages.filter((m: SelectChatMessage) => !m.isHidden).map((m: SelectChatMessage) => m.id),
					excludedIds: this.chat.chatMessages.filter((m: SelectChatMessage) => m.isHidden).map((m: SelectChatMessage) => m.id)
				},
				sources: {
					characters: [],
					personas: [],
					scenario: null
				}
			}
		}
	}

	/**
	 * Load tagged entities from chat metadata and format for context
	 */
	private async loadTaggedEntitiesContext(): Promise<string> {
		// Parse metadata if it's a string
		let metadata = this.chat.metadata
		if (typeof metadata === 'string') {
			try {
				metadata = JSON.parse(metadata)
			} catch (e) {
				console.error('[BaseConnectionAdapter] Failed to parse metadata:', e)
				return ""
			}
		}
		
		if (!metadata || !(metadata as any).taggedEntities) {
			return ""
		}

		const sections: string[] = []
		const taggedEntities = (metadata as any).taggedEntities

		// Load tagged characters
		if (taggedEntities.characters && Array.isArray(taggedEntities.characters)) {
			const { db } = await import("../db")
			const characterIds = taggedEntities.characters
			
			if (characterIds.length > 0) {
				const characters = await db.query.characters.findMany({
					where: (c: any, { inArray, eq, and }: any) =>
						and(
							inArray(c.id, characterIds),
							eq(c.userId, this.chat.userId)
						),
					columns: {
						id: true,
						name: true,
						nickname: true,
						description: true,
						avatar: true,
						createdAt: true
					}
				})

				if (characters.length > 0) {
					sections.push("## Referenced Characters\n")
					for (const char of characters) {
						sections.push(`### ${char.name}${char.nickname ? ` ("${char.nickname}")` : ""}`)
						if (char.description) {
							sections.push(`${char.description}`)
						}
						if (char.avatar) {
							sections.push(`Avatar: ${char.avatar}`)
						}
						sections.push("") // Empty line between characters
					}
				}
			}
		}

		return sections.length > 0 ? sections.join("\n") : ""
	}
}

export interface AdapterExports {
	Adapter: new (args: BaseConnectionAdapterParams) => BaseConnectionAdapter
	listModels: ListModelsFn
	testConnection: TestConnectionFn
	connectionDefaults: Record<string, any>
	samplingKeyMap: Record<string, string>
}
