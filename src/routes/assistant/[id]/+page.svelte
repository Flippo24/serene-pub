<script lang="ts">
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import * as skio from "sveltekit-io"
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import ChatContainer from "$lib/client/components/chatMessages/ChatContainer.svelte"
	import ChatMessage from "$lib/client/components/chatMessages/ChatMessage.svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import AssistantDataManager from "$lib/client/components/assistant/AssistantDataManager.svelte"
	import CharacterDraftPreview from "$lib/client/components/assistant/CharacterDraftPreview.svelte"
	import GeneratingAnimation from "$lib/client/components/chatMessages/GeneratingAnimation.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { getContext, onMount, untrack } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { ChatTypes } from "$lib/shared/constants/ChatTypes"

	let chat: Sockets.Chats.Get.Response["chat"] | undefined = $state()
	let newMessage = $state("")
	const socket = skio.get()
	let userCtx: UserCtx = getContext("userCtx")
	let messagesContainer: HTMLDivElement | null = $state(null)
	let isSending = $state(false)
	let openMobileMsgControls: number | undefined = $state(undefined)
	
	// Scroll tracking for autoscroll
	let lastSeenMessageId: number | null = $state(null)
	let lastSeenMessageContent: string = $state("")
	let isInitialLoad = $state(true)
	
	// Function calling state
	let pendingFunctionCall: {
		messageId: number
		reasoning: string
		functionCalls: Array<{ name: string; args: Record<string, any> }>
		results?: any[]
	} | undefined = $state(undefined)
	
	// Character draft state
	let characterDraft: any | null = $state(null)
	let draftValidationStatus: 'valid' | 'invalid' | 'validating' | null = $state(null)
	let draftErrors: any | null = $state(null)
	let draftGeneratedFields: string[] = $state([])
	let isDraftGenerating = $state(false)
	let draftCurrentField: string | null = $state(null)
	let draftCurrentFieldIndex = $state(0)
	let draftTotalFields = $state(0)
	let isDraftCorrecting = $state(false)
	let draftCorrectionAttempt = $state(0)

	// Get chat id from route params if it exists
	let chatId: number | undefined = $derived.by(() => {
		const id = page.params.id
		return id ? Number(id) : undefined
	})

	let lastMessage: SelectChatMessage | undefined = $derived.by(() => {
		if (chat && chat.chatMessages.length > 0) {
			return chat.chatMessages[chat.chatMessages.length - 1]
		}
		return undefined
	})

	let hasGeneratingMessage = $derived.by(() => {
		return chat?.chatMessages?.some((msg) => msg.isGenerating) || false
	})

	// Extract tagged entities from chat metadata
	let taggedEntities = $derived.by(() => {
		if (!chat?.metadata) return {}
		
		const metadata = typeof chat.metadata === 'string' 
			? JSON.parse(chat.metadata) 
			: chat.metadata
		
		console.log('[Page] Chat metadata:', metadata)
		console.log('[Page] Tagged entities:', metadata?.taggedEntities)
		
		return metadata?.taggedEntities || {}
	})
	
	// Extract character draft from chat metadata (stored separately from tagged entities)
	// Only update when the draft content actually changes
	$effect(() => {
		// Track chat.metadata to detect changes
		const metadata = chat?.metadata
		
		if (!metadata) {
			if (characterDraft !== null) {
				characterDraft = null
				console.log('[Page] No chat metadata, clearing draft')
			}
			return
		}
		
		const parsedMetadata = typeof metadata === 'string' 
			? JSON.parse(metadata) 
			: metadata
		
		// Draft is in dataEditor.create.characters[0], NOT in taggedEntities
		const extractedDraft = parsedMetadata?.dataEditor?.create?.characters?.[0] || null
		
		// Only update if the draft actually changed (deep comparison by stringifying)
		const currentDraftStr = characterDraft ? JSON.stringify(characterDraft) : null
		const extractedDraftStr = extractedDraft ? JSON.stringify(extractedDraft) : null
		
		if (currentDraftStr !== extractedDraftStr) {
			characterDraft = extractedDraft
			console.log('[Page] Draft changed, updating')
			console.log('[Page] Extracted character draft:', extractedDraft)
		}
	})

	// Check if we can send a message
	let canSendMessage = $derived.by(() => {
		return (
			!!chat &&
			newMessage.trim().length > 0 &&
			!hasGeneratingMessage &&
			!isSending
		)
	})

	// Load assistant chat on mount
	onMount(() => {
		if (!socket) return

		// Set up listeners first
		socket.on("chatMessage", handleChatMessage)
		socket.on("chats:get", handleChatGetResponse)
		socket.on("chats:sendAssistantMessage", handleSendMessageResponse)
		socket.on("chats:titleGenerated", handleTitleGenerated)
		socket.on("assistant:reasoningDetected", handleReasoningDetected)
		socket.on("assistant:functionResults", handleFunctionResults)
		socket.on("assistant:selectionComplete", handleSelectionComplete)
		socket.on("assistant:unlinkSuccess", handleUnlinkSuccess)
		socket.on("assistant:draftProgress", handleDraftProgress)
		socket.on("assistant:editDraftSuccess", handleEditDraftSuccess)
		socket.on("assistant:editDraftError", handleEditDraftError)

		if (chatId) {
			// Load specific chat
			socket.emit("chats:get", { id: chatId })
		}

		// Cleanup listeners on unmount
		return () => {
			socket.off("chatMessage", handleChatMessage)
			socket.off("chats:get", handleChatGetResponse)
			socket.off("chats:sendAssistantMessage", handleSendMessageResponse)
			socket.off("chats:titleGenerated", handleTitleGenerated)
			socket.off("assistant:reasoningDetected", handleReasoningDetected)
			socket.off("assistant:functionResults", handleFunctionResults)
			socket.off("assistant:selectionComplete", handleSelectionComplete)
			socket.off("assistant:unlinkSuccess", handleUnlinkSuccess)
			socket.off("assistant:draftProgress", handleDraftProgress)
			socket.off("assistant:editDraftSuccess", handleEditDraftSuccess)
			socket.off("assistant:editDraftError", handleEditDraftError)
		}
	})
	
	// Watch for chat ID changes to reset scroll tracking
	$effect(() => {
		if (chatId) {
			isInitialLoad = true
			lastSeenMessageId = null
			lastSeenMessageContent = ""
			// Load the chat
			socket?.emit("chats:get", { id: chatId })
		}
	})

	function handleChatGetResponse(res: Sockets.Chats.Get.Response) {
		if (!res.chat) {
			toaster.error({ title: "Chat not found" })
			goto("/assistant")
			return
		}

		// Verify it's an assistant chat
		if (res.chat.chatType !== ChatTypes.ASSISTANT) {
			toaster.error({ title: "This is not an assistant chat" })
			goto("/")
			return
		}
		
		chat = res.chat
		
		// Check for initial message from URL params (when chat was just created)
		const urlParams = new URLSearchParams(window.location.search)
		const initialMessage = urlParams.get('msg')
		
		if (initialMessage && initialMessage.trim()) {
			// Set the message and send it
			newMessage = initialMessage.trim()
			// Clean up the URL
			goto(`/assistant/${res.chat.id}`, { replaceState: true })
			// Send the message after a short delay to ensure chat state is ready
			setTimeout(() => {
				if (newMessage.trim()) {
					sendMessage()
				}
			}, 100)
		}
		
		scrollToBottom()
	}

	function handleSendMessageResponse(res: Sockets.Chats.SendAssistantMessage.Response) {
		isSending = false
		
		if (res.error) {
			toaster.error({ title: res.error })
		}
	}

	function handleTitleGenerated(data: Sockets.Chats.TitleGenerated.Call) {
		// Update current chat if it matches
		if (chat && data.chatId === chat.id) {
			chat = { ...chat, name: data.title }
		}

		console.log(`Chat ${data.chatId} title updated to: "${data.title}"`)
	}

	function handleReasoningDetected(data: any) {
		if (!chat || data.chatId !== chat.id) return
		
		console.log("=== REASONING DETECTED ===", data)
		console.log("Chat ID:", chat.id)
		console.log("Function calls:", data.functionCalls)
		
		// Message is already updated on the server with reasoning in metadata
		// Just update our local state to ensure UI is in sync
		const messageIndex = chat.chatMessages.findIndex(m => m.id === data.messageId)
		if (messageIndex >= 0) {
			const currentMetadata = chat.chatMessages[messageIndex].metadata || {}
			// Create a new message object to avoid mutation issues
			const updatedMessage = {
				...chat.chatMessages[messageIndex],
				isGenerating: false,
				content: "", // Content stays empty - reasoning is in metadata
				metadata: {
					...currentMetadata,
					reasoning: data.reasoning,
					waitingForFunctionSelection: true
				}
			}
			// Create new array to trigger reactivity properly
			chat.chatMessages[messageIndex] = updatedMessage
		}
		
		// Store the function call and execute it
		pendingFunctionCall = {
			messageId: data.messageId,
			reasoning: data.reasoning,
			functionCalls: data.functionCalls
		}
		
		console.log("Pending function call set:", pendingFunctionCall)
		
		// Execute the functions
		if (socket) {
			console.log("Emitting assistant:executeFunctions")
			socket.emit("assistant:executeFunctions", {
				chatId: chat.id,
				functionCalls: data.functionCalls
			})
		} else {
			console.error("Socket not available!")
		}
	}

	function handleFunctionResults(data: any) {
		console.log("=== FUNCTION RESULTS HANDLER CALLED ===")
		console.log("Data received:", data)
		console.log("Current chat:", chat?.id)
		console.log("Pending function call EXISTS:", !!pendingFunctionCall)
		console.log("Pending function call value:", pendingFunctionCall)
		console.log("Data chat ID:", data.chatId)
		
		if (!chat) {
			console.error("❌ No chat available!")
			return
		}
		
		if (!pendingFunctionCall) {
			console.error("❌ No pending function call! This should not happen.")
			console.error("Data:", data)
			// Try to recover by creating a minimal pendingFunctionCall
			pendingFunctionCall = {
				messageId: 0, // We don't know the message ID
				reasoning: "",
				functionCalls: []
			}
		}
		
		if (data.chatId !== chat.id) {
			console.error("❌ Chat ID mismatch!", data.chatId, "!==", chat.id)
			return
		}
		
		console.log("=== FUNCTION RESULTS RECEIVED ===", data)
		console.log("Results count:", data.results?.length)
		console.log("Results data:", data.results)
		
		// Store results
		pendingFunctionCall = {
			...pendingFunctionCall,
			results: data.results
		}
		
		console.log("✅ Updated pending function call:", pendingFunctionCall)
		
		// If there are no results to select (e.g., draft functions that don't return data),
		// automatically trigger the conversational response
		if (!data.results || data.results.length === 0) {
			console.log("🎯 No results to select, auto-triggering conversational response")
			// Simulate selection complete with empty selection
			handleSelectionComplete({
				chatId: chat.id,
				taggedEntities: {}
			})
		} else {
			console.log("📋 Has results for selection, count:", data.results.length)
		}
		
		scrollToBottom()
	}

	function handleSelectionComplete(data: any) {
		console.log("=== HANDLE SELECTION COMPLETE CALLED ===")
		console.log("Data:", data)
		console.log("Current chat:", chat?.id)
		console.log("Chat ID match:", chat?.id === data.chatId)
		
		if (!chat || data.chatId !== chat.id) {
			console.log("❌ Exiting early - no chat or ID mismatch")
			return
		}
		
		console.log("✅ Selection complete:", data)
		console.log("Current chat.metadata:", chat.metadata)
		console.log("New taggedEntities from server:", data.taggedEntities)
		
		// Reload the chat from server to get updated metadata (including draft)
		console.log("📡 Requesting chat refresh from server...")
		socket.emit("chats:get", { id: chat.id })
		
		// Parse existing metadata if it's a string
		const existingMetadata = typeof chat.metadata === 'string' 
			? JSON.parse(chat.metadata) 
			: (chat.metadata || {})
		
		console.log("Parsed existing metadata:", existingMetadata)
		
		// Update chat metadata with new tagged entities (server already merged them)
		chat.metadata = {
			...existingMetadata,
			taggedEntities: data.taggedEntities
		}
		
		console.log("Updated chat.metadata:", chat.metadata)
		
		// Check if this is a draft function (no tagged entities to select)
		const isDraftFunction = !data.taggedEntities || Object.keys(data.taggedEntities).length === 0
		console.log("Is draft function?", isDraftFunction)
		
		// Clear pending function call
		pendingFunctionCall = undefined
		
	// Trigger a follow-up generation to answer the original question
	// The tagged entity data will be automatically included in the system prompt
	if (socket && chat?.chatMessages) {
		// Find the last assistant message to regenerate
		const lastAssistantMessage = chat.chatMessages
			.filter((m: any) => m.role === 'assistant')
			.pop()
		
		console.log("Last assistant message:", lastAssistantMessage?.id)
		
		if (lastAssistantMessage) {
			// Clear the waitingForFunctionSelection flag before regenerating
			// This ensures we don't re-enter the reasoning loop
			// BUT preserve the reasoning metadata so it can be displayed with the pre-content section
			const currentMetadata = lastAssistantMessage.metadata || {}
			const updatedMessage = {
				...lastAssistantMessage,
				content: "", // Clear content so regeneration starts fresh
				metadata: {
					...currentMetadata,
					waitingForFunctionSelection: false
					// Keep reasoning: it will be displayed in the pre-content section
				}
			}
			
			// Update the message in our local state
			const messageIndex = chat.chatMessages.findIndex(m => m.id === lastAssistantMessage.id)
			if (messageIndex >= 0) {
				chat.chatMessages[messageIndex] = updatedMessage
			}
			
			// Trigger regeneration - the adapter will see the mode and respond appropriately
			// For draft functions (no tagged entities), it will use conversational mode
			// For data retrieval functions (with tagged entities), it will use conversational mode with entity data
			console.log("🚀 Triggering regeneration for conversational response")
			socket.emit("chatMessages:regenerate", {
				id: lastAssistantMessage.id
			})
		}
	}
	
	toaster.success({ title: isDraftFunction ? "Draft updated!" : "Data linked!" })
}	function handleSelectionCompleted() {
		// Clear the pending function call UI
		pendingFunctionCall = undefined
		scrollToBottom()
	}

	function handleUnlinkSuccess(data: any) {
		if (!chat || data.chatId !== chat.id) return
		
		console.log("Entity unlinked successfully:", data)
		
		// Parse existing metadata if it's a string
		const existingMetadata = typeof chat.metadata === 'string' 
			? JSON.parse(chat.metadata) 
			: (chat.metadata || {})
		
		// Update chat metadata with new tagged entities (server already removed the entity)
		chat.metadata = {
			...existingMetadata,
			taggedEntities: data.taggedEntities
		}
		
	// Force reactivity
	chat = chat
	
	toaster.success({ title: "Entity unlinked successfully" })
}

function handleSaveDraft() {
	if (!socket || !chat || !characterDraft) return
	
	console.log("Saving character draft:", characterDraft)
	socket.emit("assistant:saveDraft", { chatId: chat.id })
}

function handleDraftProgress(data: any) {
	console.log("=== DRAFT PROGRESS ===", data)
	
	// Only process if it's for the current chat
	if (!chat || data.chatId !== chat.id) return
			// Update state based on status
		switch (data.status) {
			case 'started':
				isDraftGenerating = true
				draftCurrentField = null
				draftCurrentFieldIndex = 0
				draftTotalFields = data.totalFields || 0
				draftGeneratedFields = []
				isDraftCorrecting = false
				draftCorrectionAttempt = 0
				console.log("Draft generation started")
				break
				
			case 'generating_field':
				draftCurrentField = data.field || null
				draftCurrentFieldIndex = data.currentField || 0
				console.log(`Generating field: ${draftCurrentField} (${draftCurrentFieldIndex}/${draftTotalFields})`)
				break
				
			case 'field_complete':
				if (data.field && !draftGeneratedFields.includes(data.field)) {
					draftGeneratedFields = [...draftGeneratedFields, data.field]
				}
				if (data.draft) {
					characterDraft = data.draft
				}
				console.log(`Field complete: ${data.field}`)
				break
				
			case 'field_error':
				console.error(`Field error for ${data.field}:`, data.error)
				toaster.error({ 
					title: `Error generating ${data.field}`,
					description: data.message || data.error 
				})
				break
				
			case 'validating':
				draftValidationStatus = 'validating'
				console.log("Validating draft...")
				break
				
			case 'correcting':
				isDraftCorrecting = true
				draftCorrectionAttempt = data.attempt || 0
				console.log(`Auto-correcting errors (attempt ${draftCorrectionAttempt}/3)...`)
				break
				
			case 'complete':
				isDraftGenerating = false
				isDraftCorrecting = false
				draftValidationStatus = 'valid'
				if (data.draft) {
					characterDraft = data.draft
				}
				if (data.fields) {
					draftGeneratedFields = data.fields
				}
				console.log("Draft generation complete!")
			toaster.success({ title: "Character draft created successfully!" })
			scrollToBottom()
			break
			
		case 'validation_failed':
			isDraftGenerating = false
			isDraftCorrecting = false
			draftValidationStatus = 'invalid'
			if (data.draft) {
				characterDraft = data.draft
			}
			if (data.errors) {
				draftErrors = data.errors
			}
			console.error("Draft validation failed:", data.errors)
			toaster.warning({ 
				title: "Draft needs review",
				description: "Some fields need to be adjusted"
			})
			scrollToBottom()
			break
	}
}

function handleCancelDraft() {
	characterDraft = null
	draftValidationStatus = null
	draftErrors = null
	draftGeneratedFields = []
	isDraftGenerating = false
	draftCurrentField = null
	draftCurrentFieldIndex = 0
	draftTotalFields = 0
	isDraftCorrecting = false
	draftCorrectionAttempt = 0
	
	toaster.info({ title: "Draft cancelled" })
}

function handleRegenerateField(event: CustomEvent<{ field: string }>) {
		if (!socket || !chat) return
		
		console.log("Regenerating field:", event.detail.field)
		// TODO: Implement field regeneration
		toaster.info({ title: `Regenerating ${event.detail.field}...` })
	}
	
	function handleEditField(event: CustomEvent<{ field: string; value: any }>) {
		if (!characterDraft) return
		
		console.log("Editing field:", event.detail.field, "=", event.detail.value)
		characterDraft = {
			...characterDraft,
			[event.detail.field]: event.detail.value
		}
	}

	// Handle updateField event (triggered on blur) - sends to server
	let draftPreviewComponent: any = $state(null)
	
	function handleUpdateField(event: CustomEvent<{ field: string; value: any }>) {
		if (!socket || !chat || !characterDraft) return
		
		const { field, value } = event.detail
		
		// Parse value for array fields
		let finalValue = value
		if (field === 'alternateGreetings' || field === 'exampleDialogues' || field === 'groupOnlyGreetings' || field === 'source') {
			// Split by newlines and filter empty lines
			finalValue = value.split('\n').filter((line: string) => line.trim().length > 0)
		}
		
		console.log("Updating field via socket:", field, "=", finalValue)
		
		// Emit to server with new modular structure
		socket.emit('assistant:editDraft', {
			chatId: chat.id,
			operation: 'create',  // Currently creating new character
			entityType: 'characters',  // Entity type
			entityIndex: 0,  // Index in the array
			field,
			value: finalValue
		})
	}

	function handleEditDraftSuccess(data: {
		chatId: number
		operation: 'create' | 'edit'
		entityType: 'characters' | 'personas'
		entityIndex: number
		field: string
		value: any
		draft: any
		chat?: any
	}) {
		console.log("Draft field updated successfully:", data.field)
		
		// Update the local draft
		if (characterDraft && data.operation === 'create' && data.entityType === 'characters' && data.entityIndex === 0) {
			characterDraft = {
				...characterDraft,
				[data.field]: data.value
			}
			
			// Clear saving state in the preview component
			if (draftPreviewComponent) {
				draftPreviewComponent.clearSavingState(data.field)
			}
		}
		
		// Update the chat with the latest metadata if provided
		if (data.chat && chat && data.chat.id === chat.id) {
			chat = {
				...chat,
				metadata: data.chat.metadata,
				updatedAt: data.chat.updatedAt
			}
			console.log('[editDraftSuccess] Updated chat metadata')
		}
		
		// Show success toast
		toaster.success({ 
			title: 'Field Updated', 
			description: `${data.field} has been saved` 
		})
	}

	function handleEditDraftError(data: { error: string; field?: string; value?: any }) {
		console.error("Failed to update draft field:", data.error)
		
		// Clear saving state if field is specified
		if (data.field && draftPreviewComponent) {
			draftPreviewComponent.clearSavingState(data.field)
		}
		
		// Show error toast
		toaster.error({ 
			title: 'Update Failed', 
			description: data.error 
		})
	}

	function handleChatMessage(data: Sockets.ChatMessage.Call) {
		if (!chat || !data.chatMessage || data.chatMessage.chatId !== chat.id) return
		
		// Ensure chatMessages array exists
		if (!chat.chatMessages) {
			chat.chatMessages = []
		}

		const existingIndex = chat.chatMessages.findIndex(
			(m) => m.id === data.chatMessage!.id
		)

		if (existingIndex >= 0) {
			// Update existing message
			chat.chatMessages[existingIndex] = data.chatMessage
		} else {
			// Add new message
			chat.chatMessages.push(data.chatMessage)
		}

		// Trigger reactivity
		chat = chat

		// Auto-scroll to bottom when new message arrives
		if (data.chatMessage.role === "assistant" || !data.chatMessage.isGenerating) {
			setTimeout(scrollToBottom, 100)
		}
	}

	async function sendMessage() {
		if (!canSendMessage || !chat || !socket) return

		const content = newMessage.trim()
		newMessage = "" // Clear input immediately
		isSending = true

		socket.emit("chats:sendAssistantMessage", {
			chatId: chat.id,
			content
		})
	}

	function scrollToBottom() {
		if (messagesContainer) {
			setTimeout(() => {
				messagesContainer?.scrollTo({
					top: messagesContainer.scrollHeight,
					behavior: "smooth"
				})
			}, 50)
		}
	}
	
	// Helper function to perform autoscroll with retries
	function performAutoscroll(attempt = 1, maxAttempts = 3) {
		if (!messagesContainer) return

		const scrollHeight = messagesContainer.scrollHeight
		const clientHeight = messagesContainer.clientHeight

		// Check if there's actually content to scroll to
		if (scrollHeight > clientHeight) {
			messagesContainer.scrollTo({
				top: scrollHeight,
				behavior: isInitialLoad ? "instant" : "smooth"
			})
			return
		}

		// If no content yet and we haven't exceeded max attempts, retry
		if (attempt < maxAttempts) {
			const delay = attempt === 1 ? 100 : 300
			setTimeout(() => performAutoscroll(attempt + 1, maxAttempts), delay)
		}
	}
	
	// Auto-scroll to bottom on new messages, initial load, or last message content updates
	$effect(() => {
		// React to changes in messages and container
		const messagesLength = chat?.chatMessages?.length ?? 0
		const lastMsg = chat?.chatMessages?.[messagesLength - 1]
		const currentLastMessageId = lastMsg?.id
		const currentLastMessageContent = lastMsg?.content || ""

		if (messagesContainer && messagesLength > 0) {
			// Determine if we should autoscroll
			const isNewMessage =
				currentLastMessageId &&
				(!lastSeenMessageId || currentLastMessageId > lastSeenMessageId)
			const isLastMessageContentUpdated =
				currentLastMessageId === lastSeenMessageId &&
				currentLastMessageContent !== lastSeenMessageContent

			const shouldAutoscroll =
				isInitialLoad || isNewMessage || isLastMessageContentUpdated

			if (shouldAutoscroll) {
				performAutoscroll()
				isInitialLoad = false
			}

			// Update tracking variables
			if (currentLastMessageId) {
				lastSeenMessageId = currentLastMessageId
				lastSeenMessageContent = currentLastMessageContent
			}
		}
	})

	// Simple handlers for ChatMessage component
	function getMessageCharacter(msg: SelectChatMessage) {
		// For assistant chat, we can create a simple assistant "character" object
		if (msg.role === "assistant") {
			return {
				name: "Serenity",
				avatar: null
			} as any
		}
		// For user messages, return the user
		return {
			name: userCtx.user?.displayName || userCtx.user?.username || "You",
			avatar: null
		} as any
	}

	function canControlMessage(msg: SelectChatMessage) {
		// Can only delete own messages in assistant chat
		return msg.role === "user"
	}

	function showSwipeControls() {
		return false // No swipe controls in assistant chat
	}

	function canSwipeRight() {
		return false
	}

	function handleDeleteMessage(event: MouseEvent, msg: SelectChatMessage) {
		if (!socket) return
		// Simplified delete - just call the socket
		if (confirm("Delete this message?")) {
			socket.emit("chatMessages:delete", { id: msg.id })
		}
	}

	function handleRegenerateMessage(event: MouseEvent, msg: SelectChatMessage) {
		if (!chat || !socket) return
		socket.emit("chatMessages:regenerate", { id: msg.id })
	}

	function handleAbortMessage(event: MouseEvent, msg: SelectChatMessage) {
		if (!socket) return
		socket.emit("chatMessages:cancel", { messageId: msg.id })
	}

	function handleScroll(event: Event) {
		// No pagination in assistant chat for now
	}

	// Placeholder functions to satisfy component requirements
	function noop() {}

	function handleBackButton() {
		// Go back to assistant index
		goto("/assistant")
	}
</script>

<div class="flex h-full w-full flex-col">
	<!-- Header -->
	<div class="preset-filled-surface-100-950 border-b border-surface-400-600 flex items-center gap-4 p-4">
		<button
			class="btn preset-tonal-surface"
			onclick={handleBackButton}
			title="Back to Serenity"
		>
			<Icons.ArrowLeft size={20} />
		</button>
		<div class="flex-1">
			<h1 class="text-xl font-bold">
				<Icons.BotMessageSquare class="inline" size={24} />
				{chat?.name || "Serenity"}
			</h1>
			<p class="text-muted text-sm">
				Your AI assistant for Serene Pub
			</p>
		</div>
	</div>

	<!-- Main Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if !chat}
			<!-- Loading specific chat -->
			<div class="flex flex-1 items-center justify-center">
				<div class="text-center">
					<Icons.BotMessageSquare size={48} class="text-muted mx-auto mb-4" />
					<p class="text-muted">Loading conversation...</p>
				</div>
			</div>
		{:else}
			<ChatContainer
				{chat}
				pagination={undefined}
				loadingOlderMessages={false}
				bind:chatMessagesContainer={messagesContainer}
				onScroll={handleScroll}
				getMessageCharacter={getMessageCharacter}
				canControlMessage={canControlMessage}
				showSwipeControls={showSwipeControls}
				canSwipeRight={canSwipeRight}
				onSwipeLeft={noop}
				onSwipeRight={noop}
				onEditMessage={noop}
				onDeleteMessage={handleDeleteMessage}
				onHideMessage={noop}
				onRegenerateMessage={handleRegenerateMessage}
				onAbortMessage={handleAbortMessage}
				editChatMessage={undefined}
				canRegenerateLastMessage={false}
				isGuest={false}
			>
				{#snippet MessageComponent({ msg, index, chat, isLastMessage })}
					<ChatMessage
						{msg}
						{index}
						{chat}
						{isLastMessage}
						messagesLength={chat.chatMessages.length}
						getMessageCharacter={getMessageCharacter}
						canControlMessage={canControlMessage}
						showSwipeControls={showSwipeControls}
						canSwipeRight={canSwipeRight}
						onSwipeLeft={noop}
						onSwipeRight={noop}
						onEditMessage={noop}
						onDeleteMessage={handleDeleteMessage}
						onHideMessage={noop}
						onRegenerateMessage={handleRegenerateMessage}
						onAbortMessage={handleAbortMessage}
						onCharacterNameClick={noop}
						onAvatarClick={noop}
						onCancelEditMessage={noop}
						onSaveEditMessage={noop}
						bind:openMobileMsgControls={openMobileMsgControls}
						editChatMessage={undefined}
						canRegenerateLastMessage={false}
						isGuest={false}
						lastPersonaMessage={undefined}
					>
						{#snippet GeneratingAnimationComponent()}
							<GeneratingAnimation
								text={msg.metadata?.reasoning
									? "Assistant is answering"
									: "Assistant is deciding"}
							/>
						{/snippet}
					</ChatMessage>
				{/snippet}

				{#snippet ComposerComponent()}
					<div class="preset-filled-surface-50-950 border-t border-surface-400-600">
						<!-- Character Draft Preview above data manager -->
						{#if characterDraft && chat}
							{@const _ = console.log('[Render] Showing draft preview')}
							<div class="pt-4">
								<CharacterDraftPreview 
									bind:this={draftPreviewComponent}
									draft={characterDraft}
									validationStatus={draftValidationStatus}
									errors={draftErrors}
									generatedFields={draftGeneratedFields}
									isGenerating={isDraftGenerating}
									currentField={draftCurrentField}
									currentFieldIndex={draftCurrentFieldIndex}
									totalFields={draftTotalFields}
									isCorrecting={isDraftCorrecting}
									correctionAttempt={draftCorrectionAttempt}
									on:save={handleSaveDraft}
									on:cancel={handleCancelDraft}
									on:regenerateField={handleRegenerateField}
									on:editField={handleEditField}
									on:updateField={handleUpdateField}
								/>
							</div>
						{/if}
						
						<!-- Data Manager above input -->
						{#if chat}
						<div class="p-4 pb-2">
							<AssistantDataManager 
								chatId={chat.id}
								taggedEntities={taggedEntities}
								pendingSelection={pendingFunctionCall ? {
									messageId: pendingFunctionCall.messageId,
									reasoning: pendingFunctionCall.reasoning,
									results: pendingFunctionCall.results || [],
									type: 'characters'
								} : null}
								onSelectionComplete={handleSelectionCompleted}
							/>
						</div>
						{/if}
						
						<!-- Message Input -->
						<div class="p-4 pt-2">
						<form
							class="flex gap-2"
							onsubmit={(e) => {
								e.preventDefault()
								sendMessage()
							}}
						>
							<input
								type="text"
								class="input flex-1"
								placeholder="Ask me anything about Serene Pub..."
								bind:value={newMessage}
								disabled={hasGeneratingMessage || isSending}
								aria-label="Message input"
							/>
							<button
								type="submit"
								class="btn preset-filled-primary"
								disabled={!canSendMessage}
								title="Send message"
							>
								{#if isSending}
									<Icons.Loader2 size={20} class="animate-spin" />
								{:else}
									<Icons.Send size={20} />
								{/if}
							</button>
						</form>
						</div>
					</div>
				{/snippet}
			</ChatContainer>
		{/if}
	</div>
</div>
