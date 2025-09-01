<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount } from "svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import UserForm from "../userForms/UserForm.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	const systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	const userCtx: { user: SelectUser } = $state(getContext("userCtx"))

	let userList: SelectUser[] = $state([])
	let search = $state("")
	let selectedUser: SelectUser | undefined = $state()
	let isCreating = $state(false)
	let isEditing = $state(false)
	let showDeleteModal = $state(false)
	let userToDelete: SelectUser | undefined = $state(undefined)

	// Filtered list
	let filteredUsers: SelectUser[] = $derived.by(() => {
		let list = [...userList]
		if (!search) return list

		const searchLower = search.toLowerCase()
		return list.filter((user) => {
			return (
				user.username.toLowerCase().includes(searchLower) ||
				(user.displayName?.toLowerCase().includes(searchLower) ?? false)
			)
		})
	})

	// Check if current user is admin
	let isCurrentUserAdmin = $derived(userCtx.user?.isAdmin ?? false)

	function resetForm() {
		selectedUser = undefined
		isCreating = false
		isEditing = false
	}

	function startCreate() {
		resetForm()
		isCreating = true
	}

	function startEdit(user: SelectUser) {
		selectedUser = user
		isEditing = true
	}

	function cancelForm() {
		resetForm()
	}

	function handleFormSave(user: SelectUser) {
		resetForm()
	}

	function confirmDelete(user: SelectUser) {
		userToDelete = user
		showDeleteModal = true
	}

	function deleteUser() {
		if (userToDelete) {
			socket.emit("users:delete", { id: userToDelete.id })
		}
		showDeleteModal = false
		userToDelete = undefined
	}

	function loadUsers() {
		socket.emit("users:list", { search: search || undefined })
	}

	// Load users on mount and when search changes
	$effect(() => {
		loadUsers()
	})

	onMount(() => {
		// Load initial user list
		loadUsers()

		// Socket listeners
		socket.on("users:list", (response) => {
			userList = response.users
		})

		socket.on("users:create", (response) => {
			userList = [...userList, response.user]
			resetForm()
			toaster.success({
				title: "User Created",
				description: `User "${response.user.username}" has been created successfully.`
			})
		})

		socket.on("users:update", (response) => {
			userList = userList.map((user) =>
				user.id === response.user.id ? response.user : user
			)
			resetForm()
			toaster.success({
				title: "User Updated",
				description: `User "${response.user.username}" has been updated successfully.`
			})
		})

		socket.on("users:delete", (response) => {
			if (userToDelete) {
				userList = userList.filter(
					(user) => user.id !== userToDelete!.id
				)
				toaster.success({
					title: "User Deleted",
					description: `User has been deleted successfully.`
				})
			}
		})
	})

	onDestroy(() => {
		socket.off("users:list")
		socket.off("users:create")
		socket.off("users:update")
		socket.off("users:delete")
	})
</script>

<div class="flex h-full flex-col">
	{#if (isCreating || isEditing) && isCurrentUserAdmin}
		<!-- Form View -->
		<UserForm
			user={selectedUser}
			onSave={handleFormSave}
			onCancel={cancelForm}
		/>
	{:else}
		<!-- List View -->
		<!-- Header -->
		<div class="flex p-4 pb-2">
			{#if isCurrentUserAdmin}
				<button
					class="btn btn-sm preset-filled-primary-500 flex items-center gap-1"
					onclick={startCreate}
					disabled={isCreating || isEditing}
				>
					<Icons.Plus size={16} />
				</button>
			{/if}
		</div>

		<!-- Search -->
		<div class="px-4 pb-4">
			<div class="relative">
				<Icons.Search
					size={16}
					class="text-surface-500 absolute top-1/2 left-3 -translate-y-1/2 transform"
				/>
				<input
					type="text"
					bind:value={search}
					placeholder="Search users..."
					class="input w-full pl-10"
				/>
			</div>
		</div>

		<!-- User List -->
		<div class="flex-1 overflow-y-auto px-4">
			<div class="space-y-2">
				{#each filteredUsers as user}
					<div
						class="bg-surface-100-900 flex items-center justify-between rounded-lg p-3"
					>
						<div class="flex-1">
							<div class="flex items-center gap-2">
								<span class="font-medium">
									{user.displayName || user.username}
								</span>
								{#if user.displayName}
									<span class="text-surface-600-400 text-xs">
										@{user.username}
									</span>
								{/if}
								{#if user.isAdmin}
									<span
										class="bg-primary-500 rounded px-1.5 py-0.5 text-xs text-white"
									>
										Admin
									</span>
								{/if}
							</div>
						</div>

						{#if isCurrentUserAdmin && user.id !== userCtx.user.id}
							<div class="flex gap-1">
								<button
									class="btn btn-sm btn-ghost p-1"
									onclick={() => startEdit(user)}
									disabled={isCreating || isEditing}
									title="Edit user"
								>
									<Icons.Edit size={14} />
								</button>
								<button
									class="btn btn-sm btn-ghost text-error-500 hover:text-error-600 hover:bg-error-500/10 p-1"
									onclick={() => confirmDelete(user)}
									disabled={isCreating || isEditing}
									title="Delete user"
								>
									<Icons.Trash2 size={14} />
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- Delete Confirmation Modal -->
<Modal
	open={showDeleteModal}
	onOpenChange={(open) => {
		if (!open) {
			showDeleteModal = false
			userToDelete = undefined
		}
	}}
>
	{#snippet content()}
		<div class="p-6">
			<h3 class="mb-4 text-lg font-semibold">Delete User</h3>
			<p class="text-surface-600-400 mb-6">
				Are you sure you want to delete the user "{userToDelete?.displayName ||
					userToDelete?.username}"? This action cannot be undone.
			</p>
			<div class="flex justify-end gap-2">
				<button
					class="btn btn-sm preset-filled-surface-500"
					onclick={() => {
						showDeleteModal = false
						userToDelete = undefined
					}}
				>
					Cancel
				</button>
				<button
					class="btn btn-sm preset-filled-error-500"
					onclick={deleteUser}
				>
					Delete
				</button>
			</div>
		</div>
	{/snippet}
</Modal>
