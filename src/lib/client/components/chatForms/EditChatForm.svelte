<script lang="ts">
	import * as skio from "sveltekit-io"
	import CharacterSelectModal from "../modals/CharacterSelectModal.svelte"
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import { dndzone } from "svelte-dnd-action"
	import RemoveFromChatModal from "../modals/RemoveFromChatModal.svelte"
	import { onDestroy, onMount } from "svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
	import { ChatCharacterVisibility } from "$lib/shared/constants/ChatCharacterVisibility"
	import { z } from "zod"

	// Zod validation schema
	const chatSchema = z.object({
		name: z.string().min(1, "Chat name is required").trim(),
		scenario: z.string().optional(),
		groupReplyStrategy: z.string().optional()
	})

	type ValidationErrors = Record<string, string>

	interface Props {
		editChatId?: number | null // If provided, edit mode; else create mode
		showEditChatForm: boolean // Controls visibility of the form
		hasChanges?: boolean // Track if the form has unsaved changes
	}

	let {
		editChatId = $bindable(null),
		showEditChatForm = $bindable(),
		hasChanges = $bindable(false)
	}: Props = $props()

	const socket = skio.get()

	// STATE VARIABLES

	// Tag-related state
	let tagsList: SelectTag[] = $state([])
	let tagSearchInput = $state("")
	let showTagSuggestions = $state(false)
	let selectedTags: string[] = $state([])

	let chat: Sockets.Chat.Response["chat"] | undefined = $state()
	let isCreating = $state(!chat)
	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let personas: Sockets.Personas.List.Response["personaList"] = $state([])
	let lorebookList: Sockets.Lorebooks.List.Response["lorebookList"] = $state(
		[]
	)

	// Data structure to hold chat and selected characters/personas
	let data:
		| {
				chat: {
					id: number | undefined
					name: string
					scenario: string
					groupReplyStrategy: string
					lorebookId?: number | null
					tags: string[]
				}
				characterIds: number[]
				personaIds: number[]
				characterPositions: Record<number, number>
		  }
		| undefined = $state()

	let originalData:
		| {
				chat: {
					id: number | undefined
					name: string
					scenario: string
					groupReplyStrategy: string
					lorebookId?: number | null
					tags: string[]
				}
				characterIds: number[]
				personaIds: number[]
				characterPositions: Record<number, number>
		  }
		| undefined = $state()

	// DATA FIELDS
	let name = $state("")
	let scenario = $state("")
	let groupReplyStrategy = $state("ordered")
	let lorebookId: number | null = $state(null)

	// MODALS
	let showCharacterModal = $state(false)
	let showPersonaModal = $state(false)

	// FORM SUBMIT STATE
	let isDirty: boolean = $derived(
		JSON.stringify(data) !== JSON.stringify(originalData)
	)
	let canSave: boolean = $derived(
		(!!editChatId && isDirty) ||
			(!editChatId &&
				data?.chat.name.trim() &&
				data?.characterIds.length > 0 &&
				data?.personaIds.length > 0)
	)

	// Sync hasChanges with isDirty
	$effect(() => {
		hasChanges = isDirty
	})

	// SELECTED CHARACTERS AND PERSONAS
	let selectedCharacters: SelectCharacter[] = $state([])
	let selectedPersonas: SelectPersona[] = $state([])
	let showRemoveModal = $state(false)
	let removeType: "character" | "persona" = $state("character")
	let removeName = $state("")
	let removeId: number | null = $state(null)
	let validationErrors: ValidationErrors = $state({})

	// Filtered tags for suggestions
	let filteredTags = $derived.by(() => {
		if (!tagSearchInput)
			return tagsList.filter(
				(tag) =>
					!selectedTags.some(
						(selectedTag) =>
							selectedTag.toLowerCase() === tag.name.toLowerCase()
					)
			)
		return tagsList.filter(
			(tag) =>
				tag.name.toLowerCase().includes(tagSearchInput.toLowerCase()) &&
				!selectedTags.some(
					(selectedTag) =>
						selectedTag.toLowerCase() === tag.name.toLowerCase()
				)
		)
	})

	// Tag helper functions
	function addTag(tagName: string) {
		const trimmedName = tagName.trim()
		if (!trimmedName) return

		// Check for case-insensitive duplicates
		const isDuplicate = selectedTags.some(
			(existingTag) =>
				existingTag.toLowerCase() === trimmedName.toLowerCase()
		)
		if (isDuplicate) return

		selectedTags = [...selectedTags, trimmedName]
		tagSearchInput = ""
		showTagSuggestions = false
	}

	function removeTag(tagName: string) {
		selectedTags = selectedTags.filter((tag) => tag !== tagName)
	}

	function handleTagInputKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && tagSearchInput.trim()) {
			e.preventDefault()
			addTag(tagSearchInput)
		} else if (e.key === "Escape") {
			showTagSuggestions = false
		}
	}

	$effect(() => {
		const _name = name.trim()
		const _scenario = scenario.trim()
		const _groupReplyStrategy = groupReplyStrategy || "ordered"
		const _selectedCharacters = selectedCharacters
		const _selectedPersonas = selectedPersonas
		const _lorebookId = lorebookId || null
		const _tags = selectedTags
		data = {
			chat: {
				id: chat?.id,
				name: _name,
				scenario: _scenario,
				groupReplyStrategy: _groupReplyStrategy || "ordered",
				lorebookId: _lorebookId,
				tags: _tags
			},
			characterIds: _selectedCharacters.map((cc) => cc.id),
			personaIds: _selectedPersonas.map((cp) => cp.id),
			characterPositions: Object.fromEntries(
				_selectedCharacters.map((cc, i) => [cc.id, i])
			)
		}

		if (!originalData) {
			originalData = JSON.parse(JSON.stringify(data))
		}
	})

	$effect(() => {
		if (editChatId) {
			socket.emit("chats:get", { id: editChatId })
		}
	})

	function handleAddCharacter(char: SelectCharacter & { id: number }) {
		if (!selectedCharacters.some((c) => c.id === char.id))
			selectedCharacters = [...selectedCharacters, char]
		showCharacterModal = false
	}

	function handleRemoveCharacter(id: number) {
		selectedCharacters = selectedCharacters.filter((c) => c.id !== id)
	}

	function handleAddPersona(p: SelectPersona & { id: number }) {
		if (!selectedPersonas.some((pp) => pp.id === p.id))
			selectedPersonas = [...selectedPersonas, p]
		showPersonaModal = false
		// Sync data.personaIds
	}

	function handleRemovePersona(id: number) {
		selectedPersonas = selectedPersonas.filter((p) => p.id !== id)
	}

	function handleSave() {
		if (!validateForm()) return
		if (
			!data?.chat.name.trim() ||
			selectedCharacters.length === 0 ||
			selectedPersonas.length === 0
		)
			return
		const chatData: any = { name: data.chat.name }
		if (data.chat.scenario.trim()) chatData.scenario = data.chat.scenario
		if (selectedCharacters.length > 1)
			chatData.group_reply_strategy = data.chat.groupReplyStrategy
		const characterIds = selectedCharacters.map((c) => c.id)
		const personaIds = selectedPersonas.map((p) => p.id)
		// characterPositions is now always up-to-date in data.characterPositions
		if (chat && chat.id) {
			const updateChat: Sockets.UpdateChat.Call = data
			socket.emit("chats:update", updateChat)
		} else {
			const createChat: Sockets.CreateChat.Call = data
			socket.emit("chats:create", createChat)
		}
		isCreating = false
	}

	function confirmRemoveCharacter(id: number, name: string) {
		removeType = "character"
		removeName = name
		removeId = id
		showRemoveModal = true
	}

	function confirmRemovePersona(id: number, name: string) {
		removeType = "persona"
		removeName = name
		removeId = id
		showRemoveModal = true
	}

	function handleRemoveConfirm() {
		if (removeType === "character") handleRemoveCharacter(removeId!)
		else if (removeType === "persona") handleRemovePersona(removeId!)
		showRemoveModal = false
		removeId = null
		removeName = ""
	}

	function handleRemoveCancel() {
		showRemoveModal = false
		removeId = null
		removeName = ""
	}

	function validateForm(): boolean {
		const result = chatSchema.safeParse({
			name: name,
			scenario: scenario,
			groupReplyStrategy: groupReplyStrategy
		})

		if (result.success) {
			validationErrors = {}
			return true
		} else {
			const errors: ValidationErrors = {}
			result.error.errors.forEach((error) => {
				if (error.path.length > 0) {
					errors[error.path[0] as string] = error.message
				}
			})
			validationErrors = errors
			return false
		}
	}

	function handleCloseForm() {
		// TODO handle unsaved changes if any
		showEditChatForm = false
	}

	onMount(() => {
		socket.on("chats:get", (msg: Sockets.Chats.Get.Response) => {
			if (msg.chat && msg.chat.id === editChatId) {
				chat = msg.chat
				name = chat.name || ""
				scenario = chat.scenario || ""
				groupReplyStrategy = chat.groupReplyStrategy || "ordered"
				selectedCharacters =
					chat.chatCharacters?.map((cc) => cc.character) || []
				selectedPersonas =
					chat.chatPersonas?.map((cp) => cp.persona) || []
				lorebookId = chat.lorebookId || null
				selectedTags = chat.tags || []
				// Reset originalData to null so it gets re-initialized with the loaded data
				originalData = undefined
			}
		})
		socket.on(
			"characters:list",
			(msg: Sockets.Characters.List.Response) => {
				characters = msg.characterList || []
			}
		)
		socket.on("personas:list", (msg: Sockets.Personas.List.Response) => {
			personas = msg.personaList || []
		})
		socket.on("lorebooks:list", (msg: Sockets.Lorebooks.List.Response) => {
			lorebookList = msg.lorebookList || []
		})
		socket.on("tags:list", (msg: any) => {
			tagsList = msg.tagsList || []
		})
		socket.on(
			"toggleChatCharacterActive",
			(msg: Sockets.ToggleChatCharacterActive.Response) => {
				if (chat && chat.id === msg.chatId) {
					toaster.success({
						title: `Character ${msg.isActive ? "activated" : "deactivated"}`
					})
				}
			}
		)
		socket.on(
			"updateChatCharacterVisibility",
			(msg: Sockets.UpdateChatCharacterVisibility.Response) => {
				if (chat && chat.id === msg.chatId) {
					const visibilityLabel =
						ChatCharacterVisibility.options.find(
							(opt) => opt.value === msg.visibility
						)?.label || msg.visibility
					toaster.success({
						title: `Character visibility set to ${visibilityLabel}`
					})
				}
			}
		)
		socket.on("chats:create", (res: any) => {
			toaster.success({
				title: "Chat Created",
				description: `Chat "${res.chat.name || "Unnamed Chat"}" created successfully.`
			})
			showEditChatForm = false
		})
		socket.on("chats:update", (res: any) => {
			toaster.success({
				title: "Chat Updated",
				description: `Chat "${res.chat.name || "Unnamed Chat"}" updated successfully.`
			})
			showEditChatForm = false
		})
		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		socket.emit("lorebooks:list", {})
		socket.emit("tags:list", {})
	})

	onDestroy(() => {
		socket.off("chats:get")
		socket.off("characters:list")
		socket.off("personas:list")
		socket.off("lorebooks:list")
		socket.off("tags:list")
		socket.off("toggleChatCharacterActive")
		socket.off("updateChatCharacterVisibility")
		socket.off("createChat")
		socket.off("updateChat")
	})

	function toggleCharacterActive(
		e: { checked: boolean },
		c: SelectCharacter
	): void {
		const req: Sockets.ToggleChatCharacterActive.Call = {
			chatId: chat!.id,
			characterId: c.id
		}
		socket.emit("chats:toggleCharacterActive", req)
	}

	function updateCharacterVisibility(
		c: SelectCharacter,
		visibility: string
	): void {
		const req: Sockets.UpdateChatCharacterVisibility.Call = {
			chatId: chat!.id,
			characterId: c.id,
			visibility
		}
		socket.emit("chats:updateCharacterVisibility", req)
	}

	function getVisibilityIcon(visibility: string) {
		switch (visibility) {
			case ChatCharacterVisibility.VISIBLE:
				return Icons.Eye
			case ChatCharacterVisibility.MINIMAL:
				return Icons.EyeClosed
			case ChatCharacterVisibility.HIDDEN:
				return Icons.EyeOff
			default:
				return Icons.Eye
		}
	}

	function getVisibilityColor(visibility: string) {
		switch (visibility) {
			case ChatCharacterVisibility.VISIBLE:
				return "text-success-500"
			case ChatCharacterVisibility.MINIMAL:
				return "text-warning-500"
			case ChatCharacterVisibility.HIDDEN:
				return "text-error-500"
			default:
				return "text-success-500"
		}
	}

	function getNextVisibility(current: string): string {
		switch (current) {
			case ChatCharacterVisibility.VISIBLE:
				return ChatCharacterVisibility.MINIMAL
			case ChatCharacterVisibility.MINIMAL:
				return ChatCharacterVisibility.HIDDEN
			case ChatCharacterVisibility.HIDDEN:
				return ChatCharacterVisibility.VISIBLE
			default:
				return ChatCharacterVisibility.VISIBLE
		}
	}
</script>

{#if data}
	<div class="flex min-h-full flex-col gap-6">
		<div class="mt-4 flex gap-2">
			<button
				class="btn btn-sm preset-filled-surface-500 w-full"
				onclick={handleCloseForm}
			>
				Cancel
			</button>
			<button
				class="btn btn-sm preset-filled-success-500 w-full"
				onclick={handleSave}
				disabled={!canSave}
			>
				{chat ? "Save Changes" : "Create Chat"}
			</button>
		</div>
		<div>
			<label class="font-semibold" for="chatName">Chat Name*</label>
			<input
				id="chatName"
				class="input input-lg w-full {validationErrors.name
					? 'border-red-500'
					: ''}"
				type="text"
				placeholder="Enter chat name"
				bind:value={name}
				required
				oninput={() => {
					if (validationErrors.name) {
						const { name, ...rest } = validationErrors
						validationErrors = rest
					}
				}}
			/>
			{#if validationErrors.name}
				<p class="mt-1 text-sm text-red-500" role="alert">
					{validationErrors.name}
				</p>
			{/if}
		</div>
		<div>
			<span class="mb-2 font-semibold">Characters*</span>
			{#key chat?.chatCharacters}
				<div
					class="relative mb-2 flex flex-col gap-3"
					use:dndzone={{
						items: selectedCharacters,
						flipDurationMs: 150,
						dragDisabled: !(selectedCharacters.length > 1),
						dropFromOthersDisabled: true
					}}
					onconsider={(e) => (selectedCharacters = e.detail.items)}
					onfinalize={(e) => (selectedCharacters = e.detail.items)}
				>
					{#each selectedCharacters as c (c.id)}
						{@const isActive = chat
							? !!chat?.chatCharacters?.find(
									(cc) => cc.characterId === c.id
								)?.isActive
							: true}
						{@const visibility = chat
							? chat?.chatCharacters?.find(
									(cc) => cc.characterId === c.id
								)?.visibility || ChatCharacterVisibility.VISIBLE
							: ChatCharacterVisibility.VISIBLE}
						<div class="flex gap-2">
							<div
								class="group preset-outlined-surface-400-600 hover:preset-filled-surface-500 relative flex w-full gap-3 overflow-hidden rounded p-3"
								data-dnd-handle
							>
								<div class="relative w-fit">
									<span
										class="text-surface-400 hover:text-primary-500 absolute -top-2 -left-2 z-10 cursor-grab"
										data-dnd-handle
										class:hidden={selectedCharacters.length <=
											1}
										title="Drag to reorder"
									>
										<Icons.GripVertical size={20} />
									</span>
									<Avatar char={c} />
								</div>
								<div
									class="relative flex w-0 min-w-0 flex-1 flex-col"
								>
									<div
										class="w-full truncate text-left font-semibold select-none"
									>
										{c.nickname || c.name}
									</div>
									<div
										class="text-surface-500 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs select-none"
									>
										{c.creatorNotes || c.description || ""}
									</div>
								</div>
							</div>
							<div
								class="flex flex-col justify-between gap-2 py-1 text-center"
							>
								<!-- Show remove button only when creating (no chat) -->
								{#if !chat}
									<button
										class="preset-tonal-error btn btn-sm opacity-75"
										onclick={() =>
											confirmRemoveCharacter(
												c.id,
												c.nickname || c.name
											)}
										title="Remove"
									>
										<Icons.X size={16} />
									</button>
								{/if}
								<!-- Show character controls only when editing (chat exists) -->
								{#if chat}
									<div class="flex flex-col gap-1">
										<span title="Toggle Character Active">
											<Switch
												name="toggle-character-active-{c.id}"
												controlWidth="w-9"
												controlActive="preset-filled-success-500"
												controlDisabled="preset-filled-surface-500"
												compact
												checked={isActive}
												onCheckedChange={(e) =>
													toggleCharacterActive(e, c)}
												aria-label="Toggle character {c.name} active status"
											>
												{#snippet inactiveChild()}<Icons.Meh
														size="20"
													/>{/snippet}
												{#snippet activeChild()}<Icons.Smile
														size="20"
													/>{/snippet}
											</Switch>
										</span>
										<button
											class="btn btn-sm {getVisibilityColor(
												visibility
											)} transition-transform hover:scale-110"
											onclick={() =>
												updateCharacterVisibility(
													c,
													getNextVisibility(
														visibility
													)
												)}
											title="Context Optimization: {ChatCharacterVisibility.options.find(
												(opt) =>
													opt.value === visibility
											)?.label || 'Full Info'}"
										>
											<svelte:component
												this={getVisibilityIcon(
													visibility
												)}
												size={20}
											/>
										</button>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/key}
			<div>
				<button
					class="btn btn-sm preset-filled-primary-500 flex items-center"
					onclick={() => (showCharacterModal = true)}
				>
					<Icons.Plus size={16} /> Add Character
				</button>
			</div>
		</div>
		<div>
			<span class="mb-2 font-semibold">Personas*</span>
			<div class="relative mb-2 flex flex-col gap-3">
				{#each selectedPersonas as p}
					<div class="flex gap-2">
						<div
							class="group preset-outlined-surface-400-600 hover:preset-filled-surface-500 relative flex w-full gap-3 overflow-hidden rounded p-3"
						>
							<div class="w-fit">
								<Avatar char={p} />
							</div>
							<div
								class="relative flex w-0 min-w-0 flex-1 flex-col"
							>
								<div
									class="w-full truncate text-left font-semibold select-none"
								>
									{p.name}
								</div>
								<div
									class="text-surface-500 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs select-none"
								>
									{p.description || ""}
								</div>
							</div>
							<!-- Show remove button only when creating (no chat) -->
							{#if !chat}
								<button
									class="text-text-error-500 absolute -top-2 -right-2 z-10 mt-2 mr-2 opacity-0 group-hover:opacity-100"
									onclick={() =>
										confirmRemovePersona(p.id, p.name)}
									title="Remove"
								>
									<Icons.X size={26} class="text-error-500" />
								</button>
							{/if}
						</div>
						<!-- Show remove button only when creating (no chat) -->
						{#if !chat}
							<div
								class="flex flex-col justify-between py-1 text-center"
							>
								<button
									class="preset-tonal-error btn btn-sm opacity-75"
									onclick={() =>
										confirmRemovePersona(p.id, p.name)}
									title="Remove"
								>
									<Icons.X size={16} />
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<div>
				<button
					class="btn btn-sm preset-filled-primary-500 flex items-center gap-1"
					disabled={selectedPersonas.length > 0}
					onclick={() => (showPersonaModal = true)}
				>
					<Icons.Plus size={16} /> Add Persona
				</button>
			</div>
		</div>
		{#if selectedCharacters.length > 1}
			<div>
				<label class="font-semibold" for="groupReplyStrategy">
					Group Reply Strategy
				</label>
				<select
					id="groupReplyStrategy"
					class="select input-lg w-full"
					bind:value={groupReplyStrategy}
				>
					{#each GroupReplyStrategies.options as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
		{/if}
		<div>
			<label class="flex gap-1 font-semibold" for="scenario">
				Scenario <span
					class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
					title="This field will be visible in prompts"
				>
					<Icons.ScanEye
						size={16}
						class="relative top-[1px] inline"
					/>
				</span>
			</label>
			<textarea
				id="scenario"
				class="textarea input-lg w-full"
				placeholder="Describe the chat scenario, setting, or context (optional)"
				bind:value={scenario}
				rows={3}
			></textarea>
		</div>
		<div>
			<label class="flex gap-1 font-semibold" for="lorebook">
				Lorebook <span
					class="flex items-center opacity-50 transition-opacity duration-200 hover:opacity-100"
					title="The chat will use world lore, character lore and history entries from this lorebook"
				>
					<Icons.MessageCircleQuestion
						size={16}
						class="relative top-[1px] inline"
					/>
				</span>
			</label>
			<select
				id="lorebook"
				class="select input-lg w-full"
				bind:value={lorebookId}
			>
				<option value={null}>None</option>
				{#each lorebookList as lorebook (lorebook.id)}
					<option value={lorebook.id}>{lorebook.name}</option>
				{/each}
			</select>
		</div>

		<!-- Tags Section -->
		<div class="pb-10">
			<label class="font-semibold" for="tagInput">Tags</label>
			<div class="relative">
				<input
					id="tagInput"
					type="text"
					bind:value={tagSearchInput}
					class="input input-lg w-full"
					placeholder="Add a tag..."
					onfocus={() => (showTagSuggestions = true)}
					onblur={() =>
						setTimeout(() => (showTagSuggestions = false), 200)}
					onkeydown={handleTagInputKeydown}
				/>

				<!-- Tag suggestions dropdown -->
				{#if showTagSuggestions && filteredTags.length > 0}
					<div
						class="bg-surface-100-900 absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border shadow-lg"
					>
						{#each filteredTags as tag}
							<button
								type="button"
								class="hover:bg-surface-200-800 w-full px-3 py-2 text-left transition-colors"
								onclick={() => addTag(tag.name)}
							>
								<span
									class="chip mr-2 {tag.colorPreset ||
										'preset-filled-primary-500'}"
								>
									{tag.name}
								</span>
								{#if tag.description}
									<span class="text-muted-foreground text-sm">
										- {tag.description}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Selected tags display -->
			{#if selectedTags.length > 0}
				<div class="mt-2 flex flex-wrap gap-2">
					{#each selectedTags as tagName}
						{@const tag = tagsList.find((t) => t.name === tagName)}
						<button
							type="button"
							class="chip {tag?.colorPreset ||
								'preset-filled-primary-500'} group relative"
							onclick={() => removeTag(tagName)}
							title="Click to remove tag"
						>
							{tagName}
							<Icons.X
								size={14}
								class="ml-1 opacity-60 group-hover:opacity-100"
							/>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
	<CharacterSelectModal
		open={showCharacterModal}
		characters={characters.filter(
			(c) => !selectedCharacters.some((sel) => sel.id === c.id)
		)}
		onOpenChange={(e) => (showCharacterModal = e.open)}
		onSelect={handleAddCharacter}
	/>
	<PersonaSelectModal
		open={showPersonaModal}
		personas={personas.filter(
			(p) => !selectedPersonas.some((sel) => sel.id === p.id)
		)}
		onOpenChange={(e) => (showPersonaModal = e.open)}
		onSelect={handleAddPersona}
	/>
	<RemoveFromChatModal
		open={showRemoveModal}
		onOpenChange={(e) => (showRemoveModal = e.open)}
		onConfirm={handleRemoveConfirm}
		onCancel={handleRemoveCancel}
		name={removeName}
		type={removeType}
	/>
{/if}
