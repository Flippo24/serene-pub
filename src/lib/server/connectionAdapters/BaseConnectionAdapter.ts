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
	 * Compile assistant mode prompt (simple message history)
	 * Can be overridden by subclasses for custom formatting
	 */
	protected async compileAssistantPrompt(args: {}): Promise<PromptBuilderCompiledPrompt> {
		const messages: any[] = []
		
		// Add system message
		messages.push({
			role: "system",
			content: this.getSystemPrompt()
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
}

export interface AdapterExports {
	Adapter: new (args: BaseConnectionAdapterParams) => BaseConnectionAdapter
	listModels: ListModelsFn
	testConnection: TestConnectionFn
	connectionDefaults: Record<string, any>
	samplingKeyMap: Record<string, string>
}
