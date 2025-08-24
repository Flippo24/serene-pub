<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount } from "svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"

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
	let selectedUserId: number | undefined = $state()
	let isCreating = $state(false)
	let isEditing = $state(false)
	let showDeleteModal = $state(false)
	let userToDelete: SelectUser | undefined = $state(undefined)

	// Form state
	let formUsername = $state("")
	let formDisplayName = $state("")
	let formIsAdmin = $state(false)

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
		formUsername = ""
		formDisplayName = ""
		formIsAdmin = false
		selectedUserId = undefined
		isCreating = false
		isEditing = false
	}

	function startCreate() {
		resetForm()
		isCreating = true
	}

	function startEdit(user: SelectUser) {
		formUsername = user.username
		formDisplayName = user.displayName || ""
		formIsAdmin = user.isAdmin
		selectedUserId = user.id
		isEditing = true
	}

	function cancelForm() {
		resetForm()
	}

	async function saveUser() {
		if (!formUsername.trim()) {
			toaster.error({
				title: "Validation Error",
				description: "Username is required"
			})
			return
		}

		if (isCreating) {
			socket.emit("users:create", {
				username: formUsername.trim(),
				displayName: formDisplayName.trim() || undefined,
				isAdmin: formIsAdmin
			})
		} else if (isEditing && selectedUserId) {
			socket.emit("users:update", {
				id: selectedUserId,
				username: formUsername.trim(),
				displayName: formDisplayName.trim() || undefined,
				isAdmin: formIsAdmin
			})
		}
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
			userList = userList.map(user => 
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
				userList = userList.filter(user => user.id !== userToDelete!.id)
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
	<!-- Header -->
	<div class="flex items-center justify-between p-4 pb-2">
		<h3 class="text-lg font-semibold">Users</h3>
		{#if isCurrentUserAdmin}
			<button
				class="btn btn-sm preset-filled-primary-500 flex items-center gap-1"
				onclick={startCreate}
				disabled={isCreating || isEditing}
			>
				<Icons.Plus size={16} />
				Add User
			</button>
		{/if}
	</div>

	<!-- Search -->
	<div class="px-4 pb-4">
		<div class="relative">
			<Icons.Search size={16} class="absolute left-3 top-1/2 transform -translate-y-1/2 text-surface-500" />
			<input
				type="text"
				bind:value={search}
				placeholder="Search users..."
				class="input w-full pl-10"
			/>
		</div>
	</div>

	<!-- Create/Edit Form -->
	{#if (isCreating || isEditing) && isCurrentUserAdmin}
		<div class="bg-surface-200-800 mx-4 mb-4 rounded-lg p-4">
			<h4 class="mb-3 text-sm font-medium">
				{isCreating ? "Create User" : "Edit User"}
			</h4>
			
			<div class="space-y-3">
				<div>
					<label for="username" class="block text-sm font-medium mb-1">Username</label>
					<input
						id="username"
						type="text"
						bind:value={formUsername}
						placeholder="Username"
						class="input w-full"
					/>
				</div>
				
				<div>
					<label for="displayName" class="block text-sm font-medium mb-1">Display Name</label>
					<input
						id="displayName"
						type="text"
						bind:value={formDisplayName}
						placeholder="Display Name (optional)"
						class="input w-full"
					/>
				</div>
				
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						bind:checked={formIsAdmin}
						class="checkbox"
					/>
					<span class="text-sm">Administrator</span>
				</label>
			</div>

			<div class="mt-4 flex gap-2">
				<button
					class="btn btn-sm preset-filled-primary-500"
					onclick={saveUser}
				>
					{isCreating ? "Create" : "Save"}
				</button>
				<button
					class="btn btn-sm preset-filled-surface-500"
					onclick={cancelForm}
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}

	<!-- User List -->
	<div class="flex-1 overflow-y-auto px-4">
		<div class="space-y-2">
			{#each filteredUsers as user}
				<div class="bg-surface-100-900 flex items-center justify-between rounded-lg p-3">
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<span class="font-medium">{user.displayName || user.username}</span>
							{#if user.displayName}
								<span class="text-surface-600-400 text-xs">@{user.username}</span>
							{/if}
							{#if user.isAdmin}
								<span class="bg-primary-500 rounded px-1.5 py-0.5 text-xs text-white">
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
								class="btn btn-sm btn-ghost p-1 text-error-500 hover:text-error-600 hover:bg-error-500/10"
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
				Are you sure you want to delete the user "{userToDelete?.displayName || userToDelete?.username}"?
				This action cannot be undone.
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
