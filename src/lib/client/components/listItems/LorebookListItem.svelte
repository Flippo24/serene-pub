<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		lorebook: any
		onclick?: (lorebook: any) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
		bindingsCount?: number
		worldEntriesCount?: number
		characterEntriesCount?: number
		historyEntriesCount?: number
	}

	let {
		lorebook,
		onclick,
		onEdit,
		onDelete,
		showControls = true,
		contentTitle = "Go to lorebook",
		classes = "",
		bindingsCount = 0,
		worldEntriesCount = 0,
		characterEntriesCount = 0,
		historyEntriesCount = 0
	}: Props = $props()

	function handleClick() {
		onclick?.(lorebook)
	}

	function handleEditClick(e: MouseEvent) {
		e.stopPropagation()
		onEdit?.(lorebook.id!)
	}

	function handleDeleteClick(e: MouseEvent) {
		e.stopPropagation()
		onDelete?.(lorebook.id!)
	}
</script>

<SidebarListItem
	itemType="Lorebook"
	id={lorebook.id}
	onclick={handleClick}
	{contentTitle}
	{classes}
>
	{#snippet content()}
		<div class="flex w-full items-center gap-2">
			<div class="relative flex min-w-0 flex-1 gap-2">
				<div class="relative min-w-0 flex-1">
					<div class="truncate text-left font-semibold">
						{lorebook.name}
					</div>
					{#if lorebook.description}
						<div
							class="text-muted-foreground line-clamp-2 text-left text-xs"
						>
							{lorebook.description}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/snippet}
	{#snippet extraContent()}
		<div class="flex gap-2 text-xs">
			{#if bindingsCount > 0}
				<div class="flex items-center gap-1" title="Bindings">
					<Icons.Link size={12} />
					{bindingsCount}
				</div>
			{/if}
			{#if worldEntriesCount > 0}
				<div class="flex items-center gap-1" title="World entries">
					<Icons.Globe size={12} />
					{worldEntriesCount}
				</div>
			{/if}
			{#if characterEntriesCount > 0}
				<div class="flex items-center gap-1" title="Character entries">
					<Icons.User size={12} />
					{characterEntriesCount}
				</div>
			{/if}
			{#if historyEntriesCount > 0}
				<div class="flex items-center gap-1" title="History entries">
					<Icons.Clock size={12} />
					{historyEntriesCount}
				</div>
			{/if}
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && (onEdit || onDelete)}
			<div class="flex flex-col gap-4">
				{#if onEdit}
					<button
						class="btn btn-sm text-primary-500 p-2"
						onclick={handleEditClick}
						title="Edit Lorebook"
					>
						<Icons.Edit size={16} />
					</button>
				{/if}
				{#if onDelete}
					<button
						class="btn btn-sm text-error-500 p-2"
						onclick={handleDeleteClick}
						title="Delete Lorebook"
					>
						<Icons.Trash2 size={16} />
					</button>
				{/if}
			</div>
		{/if}
	{/snippet}
</SidebarListItem>
