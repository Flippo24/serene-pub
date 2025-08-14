<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Avatar from "../Avatar.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		chat: Sockets.Chats.List.Response["chatList"][0]
		onclick?: (chat: Sockets.Chats.List.Response["chatList"][0]) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
	}

	let {
		chat,
		onclick,
		onEdit,
		onDelete,
		showControls = true,
		contentTitle = "Go to chat",
		classes = ""
	}: Props = $props()

	const avatars = $derived([
		...(chat.chatCharacters || []).map((cc) => ({
			type: "character",
			data: cc.character
		})),
		...(chat.chatPersonas || []).map((cp) => ({
			type: "persona",
			data: cp.persona
		}))
	])

	function handleClick() {
		onclick?.(chat)
	}

	function handleEditClick(e: MouseEvent) {
		e.stopPropagation()
		onEdit?.(chat.id!)
	}

	function handleDeleteClick(e: MouseEvent) {
		e.stopPropagation()
		onDelete?.(chat.id!)
	}
</script>

<SidebarListItem
	itemType="Chat"
	onclick={handleClick}
	{contentTitle}
	{classes}
>
	{#snippet content()}
		<div class="relative w-fit">
			<div class="relative mr-2 flex flex-shrink-0 flex-grow-0 items-center">
				{#if avatars.length <= 2}
					{#each avatars as avatar, i}
						<div
							class="inline-block"
							style="margin-left: {i === 0 ? '0' : '-0.7em'}; z-index: {10 - i};"
						>
							<Avatar char={avatar.data} />
						</div>
					{/each}
				{:else}
					{#each avatars.slice(0, 3) as avatar, i}
						<div
							class="ml-[-2.25em] inline-block first:ml-0"
							style="z-index: {10 - i};"
						>
							<Avatar char={avatar.data} />
						</div>
					{/each}
					{#if avatars.length > 3}
						<div class="preset-tonal-secondary relative z-1 mb-auto aspect-square rounded-full px-1 pt-[0.15em] text-xs select-none">
							+{avatars.length - 3}
						</div>
					{/if}
				{/if}
			</div>
		</div>
		<div class="flex min-w-0 flex-col">
			<div class="truncate text-left font-semibold">
				{chat.name || "Untitled Chat"}
			</div>
			<div class="text-muted-foreground line-clamp-2 text-left text-xs">
				{#if chat.chatCharacters?.length}
					{chat.chatCharacters
						.map((cc) => cc.character?.nickname || cc.character?.name)
						.filter(Boolean)
						.join(", ")}
				{/if}
				{chat.chatPersonas?.length ? "," : ""}
				{#if chat.chatPersonas?.length}
					{chat.chatPersonas
						.map((cp) => cp.persona?.name)
						.filter(Boolean)
						.join(", ")}
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && (onEdit || onDelete)}
			<div class="ml-auto flex flex-col gap-4">
				{#if onEdit}
					<button
						class="btn btn-sm text-primary-500 p-4"
						onclick={handleEditClick}
						title="Edit Chat"
					>
						<Icons.Edit size={16} />
					</button>
				{/if}
				{#if onDelete}
					<button
						class="btn btn-sm text-error-500 p-4"
						onclick={handleDeleteClick}
						title="Delete Chat"
					>
						<Icons.Trash2 size={16} />
					</button>
				{/if}
			</div>
		{/if}
	{/snippet}
</SidebarListItem>