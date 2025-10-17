<script lang="ts">
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import * as skio from "sveltekit-io"
	import * as Icons from "@lucide/svelte"
	import ChatContainer from "$lib/client/components/chatMessages/ChatContainer.svelte"
	import ChatMessage from "$lib/client/components/chatMessages/ChatMessage.svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import CharacterSelector from "$lib/client/components/assistant/CharacterSelector.svelte"
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
	
	// Function calling state
	let pendingFunctionCall: {
		messageId: number
		reasoning: string
		functionCalls: Array<{ name: string; args: Record<string, any> }>
		results?: any[]
	} | undefined = $state(undefined)

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
		
		console.log("Reasoning detected:", data)
		
		// Store the function call and execute it
		pendingFunctionCall = {
			messageId: data.messageId,
			reasoning: data.reasoning,
			functionCalls: data.functionCalls
		}
		
		// Execute the functions
		if (socket) {
			socket.emit("assistant:executeFunctions", {
				chatId: chat.id,
				functionCalls: data.functionCalls
			})
		}
	}

	function handleFunctionResults(data: any) {
		if (!chat || !pendingFunctionCall || data.chatId !== chat.id) return
		
		console.log("Function results:", data)
		
		// Store results
		pendingFunctionCall = {
			...pendingFunctionCall,
			results: data.results
		}
		
		scrollToBottom()
	}

	function handleSelectionComplete(data: any) {
		if (!chat || data.chatId !== chat.id) return
		
		console.log("Selection complete:", data)
		
		// Store the original user message for context  
		const originalMessage = chat.chatMessages
			.filter((m: any) => m.role === 'user')
			.pop()?.content || ''
		
		// Clear pending function call
		pendingFunctionCall = undefined
		
		// Trigger a follow-up generation to answer the original question
		// The assistant will now have access to the tagged entity data
		if (socket && originalMessage) {
			// Send a continuation prompt WITHOUT trigger words to avoid re-entering function-calling mode
			const continuationPrompt = `You now have the character information. Please provide a response based on what was requested.`
			
			socket.emit("chats:sendAssistantMessage", {
				chatId: chat.id,
				content: continuationPrompt  // ✅ FIXED: changed from 'message' to 'content'
			})
		}
		
		toaster.success({ title: "Character selected, generating response..." })
	}

	function handleSelectionCompleted() {
		// Clear the pending function call UI
		pendingFunctionCall = undefined
		scrollToBottom()
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

	// Simple handlers for ChatMessage component
	function getMessageCharacter(msg: SelectChatMessage) {
		// For assistant chat, we can create a simple assistant "character" object
		if (msg.role === "assistant") {
			return {
				name: "Serene Pub Assistant",
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

<div class="flex h-screen w-full flex-col">
	<!-- Header -->
	<div class="preset-filled-surface-100-950 border-b border-surface-400-600 flex items-center gap-4 p-4">
		<button
			class="btn preset-tonal-surface"
			onclick={handleBackButton}
			title={chatId ? "Back to Assistant" : "Back to Home"}
		>
			<Icons.ArrowLeft size={20} />
		</button>
		<div class="flex-1">
			<h1 class="text-xl font-bold">
				<Icons.BotMessageSquare class="inline" size={24} />
				{chat?.name || "Serene Pub Assistant"}
			</h1>
			<p class="text-muted text-sm">
				Get help, suggestions, and creative ideas
			</p>
		</div>
	</div>

	<!-- Main Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if isCreatingChat}
			<div class="flex flex-1 items-center justify-center">
				<div class="text-center">
					<div class="loading mb-4"></div>
					<p class="text-muted">Creating assistant chat...</p>
				</div>
			</div>
		{:else if !chatId && !chat}
			<!-- Recents List View (like Claude.ai) -->
			<div class="flex flex-1 flex-col overflow-hidden p-6">
				<div class="mx-auto w-full max-w-3xl">
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
								placeholder="Ask me anything about Serene Pub..."
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
							<h2 class="text-sm font-semibold text-muted mb-3">Recent Conversations</h2>
							{#each assistantChats as assistantChat (assistantChat.id)}
								<button
									class="preset-tonal-surface w-full text-left p-4 rounded-lg hover:preset-filled-surface-100-950 transition-colors border border-surface-400-600"
									onclick={() => goto(`/assistant/${assistantChat.id}`)}
								>
									<div class="flex items-start justify-between gap-4">
										<div class="flex-1 min-w-0">
											<h3 class="font-medium truncate">
												{assistantChat.name || "Conversation with Assistant"}
											</h3>
											<p class="text-sm text-muted mt-1">
												Click to continue this conversation
											</p>
										</div>
										<div class="text-xs text-muted whitespace-nowrap">
											{new Date(assistantChat.updatedAt).toLocaleDateString()}
										</div>
									</div>
								</button>
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
						{#snippet generatingAnimation()}
							<div class="wrapper">
								<div class="circle"></div>
								<div class="circle"></div>
								<div class="circle"></div>
								<div class="shadow"></div>
								<div class="shadow"></div>
								<div class="shadow"></div>
							</div>
						{/snippet}
					</ChatMessage>
				{/snippet}

				{#snippet ComposerComponent()}
					<!-- Character Selection UI -->
					{#if pendingFunctionCall && pendingFunctionCall.results && chat}
						<div class="preset-filled-surface-50-950 border-t border-surface-400-600 p-4">
							<CharacterSelector
								chatId={chat.id}
								messageId={pendingFunctionCall.messageId}
								reasoning={pendingFunctionCall.reasoning}
								results={pendingFunctionCall.results}
								onSelect={handleSelectionCompleted}
							/>
						</div>
					{/if}
					
					<div class="preset-filled-surface-50-950 border-t border-surface-400-600 p-4">
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
						{#if hasGeneratingMessage}
							<p class="text-muted mt-2 text-xs">
								<Icons.Loader2 size={12} class="inline animate-spin" />
								Assistant is thinking...
							</p>
						{/if}
					</div>
				{/snippet}
			</ChatContainer>
		{/if}
	</div>
</div>

<style>
	/* Generating animation */
	.wrapper {
		width: 60px;
		height: 30px;
		position: relative;
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
	}

	.circle {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background-color: rgb(var(--color-primary-500));
		animation: bounce 0.6s ease-in-out infinite;
	}

	.circle:nth-child(2) {
		animation-delay: 0.2s;
	}

	.circle:nth-child(3) {
		animation-delay: 0.4s;
	}

	.shadow {
		width: 12px;
		height: 3px;
		border-radius: 50%;
		background-color: rgba(0, 0, 0, 0.2);
		position: absolute;
		bottom: 0;
		animation: shadowExpand 0.6s ease-in-out infinite;
	}

	.shadow:nth-child(5) {
		left: 24px;
		animation-delay: 0.2s;
	}

	.shadow:nth-child(6) {
		left: 48px;
		animation-delay: 0.4s;
	}

	@keyframes bounce {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-15px);
		}
	}

	@keyframes shadowExpand {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.5;
		}
		50% {
			transform: scale(1.5);
			opacity: 0.3;
		}
	}
</style>
