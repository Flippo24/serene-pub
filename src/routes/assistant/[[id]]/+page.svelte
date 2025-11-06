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
	import { getContext, onMount } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { ChatTypes } from "$lib/shared/constants/ChatTypes"

	let chat: Sockets.Chats.Get.Response["chat"] | undefined = $state()
	let assistantChats: SelectChat[] = $state([])
	let newMessage = $state("")
	const socket = skio.get()
	let userCtx: UserCtx = getContext("userCtx")
	let messagesContainer: HTMLDivElement | null = $state(null)
	let isCreatingChat = $state(false)
	let isSending = $state(false)
	let openMobileMsgControls: number | undefined = $state(undefined)
	let showDeleteChatModal = $state(false)
	let chatToDelete: SelectChat | null = $state(null)
	
	// Bulk delete state
	let isSelectMode = $state(false)
	let selectedChatIds = $state(new Set<number>())
	let showBulkDeleteModal = $state(false)
	
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
	$effect(() => {
		if (!chat?.metadata) {
			characterDraft = null
			console.log('[Page] No chat metadata, clearing draft')
			return
		}
		
		const metadata = typeof chat.metadata === 'string' 
			? JSON.parse(chat.metadata) 
			: chat.metadata
		
		// Draft is in dataEditor.create.characters[0], NOT in taggedEntities
		const extractedDraft = metadata?.dataEditor?.create?.characters?.[0] || null
		characterDraft = extractedDraft
		
		console.log('[Page] Metadata keys:', Object.keys(metadata))
		console.log('[Page] dataEditor:', metadata?.dataEditor)
		console.log('[Page] Extracted character draft:', extractedDraft)
		console.log('[Page] characterDraft is now:', characterDraft)
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

	// Check if we can create a new chat with the current message
	let canCreateNewChat = $derived.by(() => {
		return (
			!chat &&
			!isCreatingChat &&
			newMessage.trim().length > 0
		)
	})

	// Load or create assistant chat on mount
	onMount(() => {
		if (!socket) return

		// Set up listeners first
		socket.on("chatMessage", handleChatMessage)
		socket.on("chats:get", handleChatGetResponse)
		socket.on("chats:list", handleChatsListResponse)
		socket.on("chats:createAssistant", handleCreateAssistantResponse)
		socket.on("chats:sendAssistantMessage", handleSendMessageResponse)
		socket.on("chats:titleGenerated", handleTitleGenerated)
		socket.on("assistant:reasoningDetected", handleReasoningDetected)
		socket.on("assistant:functionResults", handleFunctionResults)
		socket.on("assistant:selectionComplete", handleSelectionComplete)
		socket.on("assistant:unlinkSuccess", handleUnlinkSuccess)
		socket.on("chats:delete", handleChatDeleted)
		socket.on("assistant:draftProgress", handleDraftProgress)

		// Load list of assistant chats
		socket.emit("chats:list", { chatType: ChatTypes.ASSISTANT })

		if (chatId) {
			// Load specific chat if ID provided
			socket.emit("chats:get", { id: chatId })
		}
		// Otherwise show the recents list

		// Cleanup listeners on unmount
		return () => {
			socket.off("chatMessage", handleChatMessage)
			socket.off("chats:get", handleChatGetResponse)
			socket.off("chats:list", handleChatsListResponse)
			socket.off("chats:createAssistant", handleCreateAssistantResponse)
			socket.off("chats:sendAssistantMessage", handleSendMessageResponse)
			socket.off("chats:titleGenerated", handleTitleGenerated)
			socket.off("assistant:reasoningDetected", handleReasoningDetected)
			socket.off("assistant:functionResults", handleFunctionResults)
			socket.off("assistant:selectionComplete", handleSelectionComplete)
			socket.off("assistant:unlinkSuccess", handleUnlinkSuccess)
			socket.off("chats:delete", handleChatDeleted)
			socket.off("assistant:draftProgress", handleDraftProgress)
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

	function handleChatsListResponse(res: Sockets.Chats.List.Response) {
		if (res.chatList) {
			// Sort by most recent (server already filters by chatType)
			assistantChats = (res.chatList as SelectChat[])
				.sort((a: SelectChat, b: SelectChat) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
		}
	}

	function handleCreateAssistantResponse(res: Sockets.Chats.CreateAssistant.Response) {
		isCreatingChat = false
		
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}

		if (res.chat) {
			// Navigate to the new chat - it will be loaded by the Get handler
			// Pass the initial message via URL params so it survives navigation
			const initialMessage = newMessage.trim()
			if (initialMessage) {
				goto(`/assistant/${res.chat.id}?msg=${encodeURIComponent(initialMessage)}`, { replaceState: true })
			} else {
				goto(`/assistant/${res.chat.id}`, { replaceState: true })
			}
		}
	}

	function handleChatGetResponse(res: Sockets.Chats.Get.Response) {
		if (!res.chat) {
			toaster.error({ title: "Chat not found" })
			goto("/")
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
		
		// Update in the chat list
		assistantChats = assistantChats.map(c => 
			c.id === data.chatId ? { ...c, name: data.title } : c
		)

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
			chat.chatMessages[messageIndex] = {
				...chat.chatMessages[messageIndex],
				isGenerating: false,
				content: "", // Content stays empty - reasoning is in metadata
				metadata: {
					...currentMetadata,
					reasoning: data.reasoning,
					waitingForFunctionSelection: true
				}
			}
			// Trigger reactivity
			chat = chat
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
		console.log("Pending function call:", pendingFunctionCall)
		console.log("Data chat ID:", data.chatId)
		
		if (!chat) {
			console.error("❌ No chat available!")
			return
		}
		
		if (!pendingFunctionCall) {
			console.error("❌ No pending function call!")
			return
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
		
		scrollToBottom()
	}

	function handleSelectionComplete(data: any) {
		if (!chat || data.chatId !== chat.id) return
		
		console.log("Selection complete:", data)
		console.log("Current chat.metadata:", chat.metadata)
		console.log("New taggedEntities from server:", data.taggedEntities)
		
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
		
		// Force reactivity
		chat = chat
		
		// Clear pending function call
		pendingFunctionCall = undefined
		
		// Trigger a follow-up generation to answer the original question
		// The tagged entity data will be automatically included in the system prompt
		if (socket) {
			// Find the last assistant message to regenerate
			const lastAssistantMessage = chat.chatMessages
				.filter((m: any) => m.role === 'assistant')
				.pop()
			
			if (lastAssistantMessage) {
				// Clear the waitingForFunctionSelection flag before regenerating
				// This ensures we don't re-enter the reasoning loop
				// BUT preserve the reasoning metadata so it can be displayed with the final response
				const currentMetadata = lastAssistantMessage.metadata || {}
				lastAssistantMessage.metadata = {
					...currentMetadata,
					waitingForFunctionSelection: false
					// Keep reasoning: it will be displayed in the pre-content section
				}
				
				// Update the message in our local state
				const messageIndex = chat.chatMessages.findIndex(m => m.id === lastAssistantMessage.id)
				if (messageIndex >= 0) {
					chat.chatMessages[messageIndex] = lastAssistantMessage
					chat = chat
				}
				
				// Trigger regeneration - the adapter will see the tagged entities and use conversational mode
				socket.emit("chatMessages:regenerate", {
					id: lastAssistantMessage.id
				})
			}
		}
		
		toaster.success({ title: "Data linked, generating response..." })
	}

	function handleSelectionCompleted() {
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
	
	function handleChatDeleted(res: any) {
		console.log("handleChatDeleted called with:", res)
		
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}
		
		// Check for both chatId and id in response
		const deletedChatId = res.chatId || res.id
		
		if (deletedChatId) {
			console.log("Removing chat from list:", deletedChatId)
			console.log("Before filter:", assistantChats.length)
			
			// Remove from list
			assistantChats = assistantChats.filter(c => c.id !== deletedChatId)
			
			console.log("After filter:", assistantChats.length)
			
			// If we deleted the current chat, navigate to index
			if (chat && chat.id === deletedChatId) {
				chat = undefined
				goto('/assistant', { replaceState: true })
			}
			
			toaster.success({ title: "Chat deleted" })
		} else {
			console.error("No chat ID in delete response:", res)
		}
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
	
	function openDeleteChatModal(chatToDeleteParam: SelectChat) {
		chatToDelete = chatToDeleteParam
		showDeleteChatModal = true
	}
	
	function confirmDeleteChat() {
		if (!chatToDelete || !socket) return
		
		socket.emit("chats:delete", { id: chatToDelete.id })
		showDeleteChatModal = false
		chatToDelete = null
	}
	
	function cancelBulkDelete() {
		showBulkDeleteModal = false
	}
	
	function confirmBulkDelete() {
		if (!socket || selectedChatIds.size === 0) return
		
		const deleteCount = selectedChatIds.size
		
		// Emit delete for each selected chat
		selectedChatIds.forEach(chatId => {
			socket.emit("chats:delete", { id: chatId })
		})
		
		// Clear selection and exit select mode
		selectedChatIds.clear()
		selectedChatIds = selectedChatIds
		isSelectMode = false
		showBulkDeleteModal = false
		
		toaster.success({ title: `Deleting ${deleteCount} conversation${deleteCount !== 1 ? 's' : ''}...` })
	}
	
	function cancelDeleteChat() {
		showDeleteChatModal = false
		chatToDelete = null
	}
	
	function handleSaveDraft() {
		if (!socket || !chat || !characterDraft) return
		
		console.log("Saving character draft:", characterDraft)
		socket.emit("assistant:saveDraft", { chatId: chat.id })
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

	function handleChatMessage(data: Sockets.ChatMessage.Call) {
		if (!chat || !data.chatMessage || data.chatMessage.chatId !== chat.id) return

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
		if (chatId) {
			// If viewing a specific chat, go back to assistant index
			goto("/assistant")
		} else {
			// If on index, go back to home
			goto("/")
		}
	}
</script>

<div class="flex h-full w-full flex-col">
	<!-- Header -->
	<div class="preset-filled-surface-100-950 border-b border-surface-400-600 flex items-center gap-4 p-4">
		<button
			class="btn preset-tonal-surface"
			onclick={handleBackButton}
			title={chatId ? "Back to Serenity" : "Back to Home"}
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
		{#if !chatId && !chat && !isCreatingChat}
			<!-- Select mode toggle button - only show on recents list -->
			<button
				class="btn preset-tonal-surface"
				onclick={() => {
					isSelectMode = !isSelectMode
					if (!isSelectMode) {
						selectedChatIds.clear()
						selectedChatIds = selectedChatIds
					}
				}}
				title={isSelectMode ? "Cancel selection" : "Select conversations"}
			>
				{#if isSelectMode}
					<Icons.X size={20} />
					<span class="hidden sm:inline ml-2">Cancel</span>
				{:else}
					<Icons.CheckSquare size={20} />
					<span class="hidden sm:inline ml-2">Select</span>
				{/if}
			</button>
		{/if}
	</div>

	<!-- Main Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if isCreatingChat}
			<div class="flex flex-1 items-center justify-center">
				<div class="text-center">
					<div class="loading mb-4"></div>
					<p class="text-muted">Starting conversation with Serenity...</p>
				</div>
			</div>
		{:else if !chatId && !chat}
			<!-- Recents List View (like Claude.ai) -->
			<div class="flex flex-1 flex-col overflow-y-auto">
				<div class="mx-auto w-full max-w-3xl p-6">
					<!-- Message Input for Creating New Chat -->
					<form
						class="mb-8"
						onsubmit={(e) => {
							e.preventDefault()
							if (canCreateNewChat) {
								isCreatingChat = true
								socket?.emit("chats:createAssistant", {})
							}
						}}
					>
						<div class="relative">
							<input
								type="text"
								class="input w-full text-lg py-4 px-6 pr-14"
								placeholder="Ask Serenity anything about Serene Pub..."
								bind:value={newMessage}
								disabled={isCreatingChat}
								aria-label="Start a new conversation"
							/>
							<button
								type="submit"
								class="btn preset-filled-primary absolute right-2 top-1/2 -translate-y-1/2"
								disabled={!canCreateNewChat}
								title="Start conversation"
							>
								{#if isCreatingChat}
									<Icons.Loader2 size={20} class="animate-spin" />
								{:else}
									<Icons.Send size={20} />
								{/if}
							</button>
						</div>
					</form>

					<!-- Recent Chats List -->
					{#if assistantChats.length > 0}
						<div class="space-y-2">
							<div class="flex items-center justify-between mb-3">
								<h2 class="text-sm font-semibold text-muted">Recent Conversations</h2>
								{#if isSelectMode}
									<div class="flex items-center gap-3">
										<!-- Select All Checkbox -->
										<label class="flex items-center gap-2 cursor-pointer">
											<input
												type="checkbox"
												class="checkbox"
												checked={selectedChatIds.size === assistantChats.length && assistantChats.length > 0}
												onchange={(e) => {
													if (e.currentTarget.checked) {
														selectedChatIds = new Set(assistantChats.map(c => c.id))
													} else {
														selectedChatIds = new Set()
													}
												}}
											/>
											<span class="text-sm">Select All</span>
										</label>
										<!-- Delete Selected Button -->
										<button
											class="btn preset-filled-error-500 btn-sm"
											disabled={selectedChatIds.size === 0}
											onclick={() => {
												if (selectedChatIds.size > 0) {
													showBulkDeleteModal = true
												}
											}}
											title="Delete selected conversations"
										>
											<Icons.Trash2 size={16} />
											<span>Delete ({selectedChatIds.size})</span>
										</button>
									</div>
								{/if}
							</div>
							{#each assistantChats as assistantChat (assistantChat.id)}
								<div
									class="preset-tonal-surface w-full rounded-lg border border-surface-400-600 hover:preset-filled-surface-100-950 transition-colors flex items-start gap-2"
								>
									{#if isSelectMode}
										<!-- Checkbox in select mode -->
										<label class="flex items-center p-4 cursor-pointer">
											<input
												type="checkbox"
												class="checkbox"
												checked={selectedChatIds.has(assistantChat.id)}
												onchange={(e) => {
													const newSet = new Set(selectedChatIds)
													if (e.currentTarget.checked) {
														newSet.add(assistantChat.id)
													} else {
														newSet.delete(assistantChat.id)
													}
													selectedChatIds = newSet
												}}
												onclick={(e) => e.stopPropagation()}
											/>
										</label>
									{/if}
									<button
										class="flex-1 text-left p-4"
										onclick={() => {
											if (!isSelectMode) {
												goto(`/assistant/${assistantChat.id}`)
											}
										}}
										disabled={isSelectMode}
									>
										<div class="flex items-start justify-between gap-4">
											<div class="flex-1 min-w-0">
												<h3 class="font-medium truncate">
													{assistantChat.name || "Conversation with Serenity"}
												</h3>
												<p class="text-sm text-muted mt-1">
													{new Date(assistantChat.updatedAt).toLocaleDateString()}
												</p>
											</div>
										</div>
									</button>
									{#if !isSelectMode}
										<!-- Trash button in normal mode -->
										<button
											class="btn-icon btn-icon-sm hover:variant-filled-error p-2 m-2"
											onclick={(e) => {
												e.stopPropagation()
												openDeleteChatModal(assistantChat)
											}}
											title="Delete conversation"
											aria-label="Delete conversation"
										>
											<Icons.Trash2 size={16} />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<div class="text-center py-12">
							<Icons.BotMessageSquare size={48} class="text-muted mx-auto mb-4" />
							<p class="text-muted">No conversations yet. Start one above!</p>
						</div>
					{/if}
				</div>
			</div>
		{:else if !chat}
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

<!-- Delete Chat Confirmation Modal -->
<Modal
	open={showDeleteChatModal}
	onOpenChange={(e) => {
		if (!e.open) cancelDeleteChat()
	}}
	contentBase="card bg-surface-100-900 p-6 w-[90vw] max-w-md"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div class="space-y-4">
			<div class="flex items-start gap-3">
				<div class="flex-1">
					<h3 class="h3">Delete Conversation?</h3>
					<p class="text-sm opacity-80 mt-2">
						Are you sure you want to delete this conversation? This action cannot be undone.
					</p>
					{#if chatToDelete}
						<p class="text-sm font-medium mt-2">
							"{chatToDelete.name || 'Untitled Conversation'}"
						</p>
					{/if}
				</div>
			</div>
			
			<div class="flex gap-2 justify-end">
				<button
					class="btn preset-tonal-surface"
					onclick={cancelDeleteChat}
				>
					Cancel
				</button>
				<button
					class="btn preset-filled-error-500"
					onclick={confirmDeleteChat}
				>
					<Icons.Trash2 size={16} />
					Delete
				</button>
			</div>
		</div>
	{/snippet}
</Modal>

<!-- Bulk Delete Confirmation Modal -->
<Modal
	open={showBulkDeleteModal}
	onOpenChange={(e) => {
		if (!e.open) cancelBulkDelete()
	}}
	contentBase="card bg-surface-100-900 p-6 w-[90vw] max-w-md"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div class="space-y-4">
			<div class="flex items-start gap-3">
				<div class="flex-1">
					<h3 class="h3">Delete {selectedChatIds.size} Conversation{selectedChatIds.size !== 1 ? 's' : ''}?</h3>
					<p class="text-sm opacity-80 mt-2">
						Are you sure you want to delete {selectedChatIds.size} selected conversation{selectedChatIds.size !== 1 ? 's' : ''}? This action cannot be undone.
					</p>
				</div>
			</div>
			
			<div class="flex gap-2 justify-end">
				<button
					class="btn preset-tonal-surface"
					onclick={cancelBulkDelete}
				>
					Cancel
				</button>
				<button
					class="btn preset-filled-error-500"
					onclick={confirmBulkDelete}
				>
					<Icons.Trash2 size={16} />
					Delete {selectedChatIds.size}
				</button>
			</div>
		</div>
	{/snippet}
</Modal>
