<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import ContextConfigUnsavedChangesModal from "../modals/ContextConfigUnsavedChangesModal.svelte"
	import PromptConfigUnsavedChangesModal from "../modals/PromptConfigUnsavedChangesModal.svelte"
	import NewNameModal from "../modals/NewNameModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { z } from "zod"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	let userCtx: { user: SelectUser } = getContext("userCtx")
	let userSettingsCtx: UserSettingsCtx = getContext("userSettingsCtx")
	let promptsList: Sockets.PromptConfigs.List.Response["promptConfigsList"] =
		$state([])
	let selectedPromptId: number | undefined = $state(
		userSettingsCtx.settings?.activePromptConfigId || undefined
	)
	let promptConfig: Sockets.PromptConfigs.Get.Response["promptConfig"] = $state(
		{} as Sockets.PromptConfigs.Get.Response["promptConfig"]
	)
	let originalData: Sockets.PromptConfigs.Get.Response["promptConfig"] = $state(
		{} as Sockets.PromptConfigs.Get.Response["promptConfig"]
	)
	let unsavedChanges = $derived(
		JSON.stringify(promptConfig) !== JSON.stringify(originalData)
	)
	let showNewNameModal = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	// Zod validation schema
	const promptConfigSchema = z.object({
		name: z.string().min(1, "Name is required").trim()
	})

	type ValidationErrors = Record<string, string>
	let validationErrors: ValidationErrors = $state({})

	function validateForm(): boolean {
		const result = promptConfigSchema.safeParse({
			name: promptConfig.name
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

	function handleSave() {
		if (!validateForm()) return
		socket.emit("promptConfigs:update", {
			promptConfig: { ...promptConfig, id: promptConfig.id }
		})
	}

	function handleDelete() {
		if (!promptConfig.isImmutable) {
			socket.emit("promptConfigs:delete", { id: promptConfig.id })
			selectedPromptId = undefined
		}
	}

	function handleReset() {
		promptConfig = { ...originalData }
	}

	function handleNew() {
		showNewNameModal = true
	}

	function handleNewNameConfirm(name: string) {
		if (!name.trim()) return
		const newPromptConfig = {
			...promptConfig,
			name: name.trim(),
			isImmutable: false
		}
		delete newPromptConfig.id
		socket.emit("promptConfigs:create", { promptConfig: newPromptConfig })
		showNewNameModal = false
	}

	function handleNewNameCancel() {
		showNewNameModal = false
	}

	async function handleOnClose() {
		if (unsavedChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			return true
		}
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}
	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}
	function handleUnsavedChangesModalOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	$effect(() => {
		if (
			!!selectedPromptId &&
			selectedPromptId !== userSettingsCtx.settings?.activePromptConfigId
		) {
			socket.emit("promptConfigs:setUserActive", {
				id: selectedPromptId
			})
		}
	})

	$effect(() => {
		if (selectedPromptId) {
			socket.emit("promptConfigs:get", { id: selectedPromptId })
		}
	})

	onMount(() => {
		socket.on(
			"promptConfigs:list",
			(msg: Sockets.PromptConfigs.List.Response) => {
				promptsList = msg.promptConfigsList
				if (!selectedPromptId && promptsList.length > 0) {
					selectedPromptId =
						userSettingsCtx.settings?.activePromptConfigId ?? promptsList[0].id
				}
			}
		)

		socket.on("promptConfigs:get", (msg: Sockets.PromptConfigs.Get.Response) => {
			promptConfig = { ...msg.promptConfig }
			originalData = { ...msg.promptConfig }
		})

		socket.on(
			"promptConfigs:create",
			(msg: Sockets.PromptConfigs.Create.Response) => {
				selectedPromptId = msg.promptConfig.id
			}
		)
		socket.on(
			"promptConfigs:update",
			(msg: Sockets.PromptConfigs.Update.Response) => {
				if (msg.promptConfig.id === promptConfig.id) {
					promptConfig = { ...msg.promptConfig }
					originalData = { ...msg.promptConfig }
					toaster.success({ title: "Prompt Config Updated" })
				}
			}
		)
		socket.emit("promptConfigs:list", {})
		if (selectedPromptId) {
			socket.emit("promptConfigs:get", { id: selectedPromptId })
		}
		onclose = handleOnClose
	})

	onDestroy(() => {
		socket.off("promptConfigs:list")
		socket.off("promptConfigs:get")
		socket.off("promptConfigs:create")
		socket.off("promptConfigs:update")
	})
</script>

<div class="text-foreground h-full p-4">
	<div class="mt-2 mb-2 flex gap-2 sm:mt-0">
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			onclick={handleNew}
		>
			<Icons.Plus size={16} />
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-secondary-500"
			onclick={handleReset}
			disabled={!unsavedChanges}
		>
			<Icons.RefreshCcw size={16} />
		</button>
		<button
			type="button"
			class="btn btn-sm preset-filled-error-500"
			onclick={handleDelete}
			disabled={!promptConfig || promptConfig.isImmutable}
		>
			<Icons.X size={16} />
		</button>
	</div>
	<div class="mb-6 flex items-center gap-2">
		<select class="select w-full" bind:value={selectedPromptId}>
			{#each promptsList.filter((c) => c.isImmutable) as c}
				<option value={c.id}>{c.name}{c.isImmutable ? "*" : ""}</option>
			{/each}
			{#each promptsList.filter((c) => !c.isImmutable) as c}
				<option value={c.id}>{c.name}{c.isImmutable ? "*" : ""}</option>
			{/each}
		</select>
	</div>
	{#if promptConfig}
		<div class="mt-4 mb-4 flex w-full justify-end gap-2">
			<button
				class="btn btn-sm preset-filled-success-500 w-full"
				onclick={handleSave}
				disabled={promptConfig.isImmutable || !unsavedChanges}
			>
				<Icons.Save size={16} />
				Save
			</button>
		</div>
		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-1">
				<label class="font-semibold" for="promptName">Name*</label>
				<input
					id="promptName"
					type="text"
					bind:value={promptConfig.name}
					class="input w-full {validationErrors.name
						? 'border-red-500'
						: ''}"
					disabled={promptConfig.isImmutable}
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
			<div class="flex flex-col gap-1">
				<label class="font-semibold" for="systemPrompt">
					System Instructions
				</label>
				<textarea
					id="systemPrompt"
					rows="15"
					bind:value={promptConfig.systemPrompt}
					class="input w-full"
				></textarea>
			</div>
		</div>
	{/if}
</div>

<PromptConfigUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>
<NewNameModal
	open={showNewNameModal}
	onOpenChange={(e) => (showNewNameModal = e.open)}
	onConfirm={handleNewNameConfirm}
	onCancel={handleNewNameCancel}
	title="New Prompt Config"
	description="Your current settings will be copied."
/>
