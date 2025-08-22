<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { z } from "zod"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	// Passphrase validation schema
	const passphraseSchema = z.string()
		.min(6, "Passphrase must be at least 6 characters long")
		.regex(/[a-z]/, "Passphrase must contain at least one lowercase letter")
		.regex(/[A-Z]/, "Passphrase must contain at least one uppercase letter")
		.regex(/[^a-zA-Z0-9]/, "Passphrase must contain at least one special character")

	const socket = useTypedSocket()

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	// URL validation schema
	const urlSchema = z.string().url().refine((url) => {
		try {
			const parsed = new URL(url)
			return parsed.port !== "" || parsed.hostname === "localhost"
		} catch {
			return false
		}
	}, "URL must include a port (e.g., http://localhost:11434)")

	// State for ollama manager base URL
	let ollamaBaseUrlField = $state("")
	let ollamaBaseUrlError = $state("")
	let isSavingBaseUrl = $state(false)

	// State for enable accounts confirmation modal
	let showEnableAccountsModal = $state(false)
	let hasPassphrase = $state(false)
	let passphrase = $state("")
	let confirmPassphrase = $state("")
	let passphraseError = $state("")
	let isSettingPassphrase = $state(false)

	// Initialize base URL field when system settings are available
	$effect(() => {
		if (systemSettingsCtx.settings?.ollamaManagerBaseUrl) {
			ollamaBaseUrlField = systemSettingsCtx.settings.ollamaManagerBaseUrl
		}
	})

	async function onOllamaManagerEnabledClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({ title: "Access denied", description: "Admin privileges required" })
			return
		}
		
		socket?.emit("systemSettings:updateOllamaManagerEnabled", {
			enabled: event.checked
		})
	}

	async function handleSaveOllamaBaseUrl() {
		if (!userCtx.user?.isAdmin) {
			toaster.error({ title: "Access denied", description: "Admin privileges required" })
			return
		}

		const trimmedUrl = ollamaBaseUrlField.trim()
		
		// Validate URL
		const result = urlSchema.safeParse(trimmedUrl)
		if (!result.success) {
			ollamaBaseUrlError = result.error.errors[0]?.message || "Invalid URL format"
			return
		}

		ollamaBaseUrlError = ""
		isSavingBaseUrl = true

		try {
			socket?.emit("systemSettings:updateOllamaManagerBaseUrl", {
				baseUrl: trimmedUrl
			})
		} catch (error) {
			ollamaBaseUrlError = "Failed to save URL"
			isSavingBaseUrl = false
		}
	}

	function handleEnableAccountsClick(event: { checked: boolean }) {
		if (!userCtx.user?.isAdmin) {
			toaster.error({ title: "Access denied", description: "Admin privileges required" })
			return
		}

		if (event.checked) {
			// Check if user has a passphrase first
			socket?.emit("users:current:hasPassphrase", {})
		} else {
			// Allow disabling without confirmation (though it shouldn't be possible once enabled)
			socket?.emit("systemSettings:updateAccountsEnabled", {
				enabled: event.checked
			})
		}
	}

	function showEnableAccountsModalWithPassphraseCheck() {
		showEnableAccountsModal = true
		if (!hasPassphrase) {
			// Reset passphrase fields
			passphrase = ""
			confirmPassphrase = ""
			passphraseError = ""
		}
	}

	function validatePassphrase() {
		passphraseError = ""
		
		if (!passphrase) {
			passphraseError = "Passphrase is required"
			return false
		}

		if (passphrase !== confirmPassphrase) {
			passphraseError = "Passphrases do not match"
			return false
		}

		try {
			passphraseSchema.parse(passphrase)
			return true
		} catch (error) {
			if (error instanceof z.ZodError) {
				passphraseError = error.errors.map(e => e.message).join(", ")
			}
			return false
		}
	}

	function handleSetPassphrase() {
		if (!userCtx.user?.isAdmin) {
			toaster.error({ title: "Access denied", description: "Admin privileges required" })
			return
		}

		if (!validatePassphrase()) {
			return
		}

		isSettingPassphrase = true
		socket?.emit("users:current:setPassphrase", {
			passphrase: passphrase
		})
	}

	function confirmEnableAccounts() {
		if (!userCtx.user?.isAdmin) {
			toaster.error({ title: "Access denied", description: "Admin privileges required" })
			return
		}

		if (!hasPassphrase && !validatePassphrase()) {
			return
		}

		if (!hasPassphrase) {
			// Set passphrase first
			handleSetPassphrase()
		} else {
			// User already has a passphrase, proceed with enabling accounts
			socket?.emit("systemSettings:updateAccountsEnabled", {
				enabled: true
			})
			showEnableAccountsModal = false
		}
	}

	function cancelEnableAccounts() {
		showEnableAccountsModal = false
		passphrase = ""
		confirmPassphrase = ""
		passphraseError = ""
		// The switch will remain in its previous state
	}

	// Listen for socket responses
	$effect(() => {
		if (!socket) return

		const handleOllamaManagerEnabled = (message: any) => {
			if (message.success) {
				toaster.success({
					title: `Ollama Manager ${message.enabled ? 'enabled' : 'disabled'} successfully`
				})
			} else {
				toaster.error({ title: "Failed to update Ollama Manager setting" })
			}
		}

		const handleOllamaManagerBaseUrl = (message: any) => {
			isSavingBaseUrl = false
			if (message.success) {
				toaster.success({
					title: "Ollama URL updated successfully"
				})
			} else {
				ollamaBaseUrlError = "Failed to update URL"
				toaster.error({ title: "Failed to update Ollama URL" })
			}
		}

		const handleAccountsEnabled = (message: any) => {
			if (message.success) {
				toaster.success({
					title: "User accounts enabled successfully",
					description: "Authentication is now required for all users"
				})
			} else {
				toaster.error({ title: "Failed to enable user accounts" })
			}
		}

		const handleAccountsEnabledError = (message: any) => {
			toaster.error({ 
				title: "Cannot enable user accounts", 
				description: message.error || "An error occurred"
			})
		}

		const handleGenericError = (message: any) => {
			// Handle specific error events based on the event type
			if (message.error?.includes("passphrase")) {
				toaster.error({
					title: "Cannot enable user accounts",
					description: message.error
				})
			}
		}

		const handleHasPassphrase = (message: any) => {
			hasPassphrase = message.hasPassphrase
			if (hasPassphrase) {
				showEnableAccountsModalWithPassphraseCheck()
			} else {
				showEnableAccountsModalWithPassphraseCheck()
			}
		}

		const handleSetPassphrase = (message: any) => {
			isSettingPassphrase = false
			if (message.success) {
				hasPassphrase = true
				passphrase = ""
				confirmPassphrase = ""
				passphraseError = ""
				toaster.success({
					title: "Passphrase set successfully"
				})
				// Now enable accounts
				socket?.emit("systemSettings:updateAccountsEnabled", {
					enabled: true
				})
				showEnableAccountsModal = false
			} else {
				passphraseError = message.message || "Failed to set passphrase"
				toaster.error({ title: "Failed to set passphrase", description: message.message })
			}
		}

		// Register event listeners
		socket.on("systemSettings:updateOllamaManagerEnabled", handleOllamaManagerEnabled)
		socket.on("systemSettings:updateOllamaManagerBaseUrl", handleOllamaManagerBaseUrl)
		socket.on("systemSettings:updateAccountsEnabled", handleAccountsEnabled)
		socket.on("**:error", handleGenericError)
		socket.on("users:current:hasPassphrase", handleHasPassphrase)
		socket.on("users:current:setPassphrase", handleSetPassphrase)

		// Cleanup function to remove listeners
		return () => {
			socket.off("systemSettings:updateOllamaManagerEnabled", handleOllamaManagerEnabled)
			socket.off("systemSettings:updateOllamaManagerBaseUrl", handleOllamaManagerBaseUrl)
			socket.off("systemSettings:updateAccountsEnabled", handleAccountsEnabled)
			socket.off("**:error", handleGenericError)
			socket.off("users:current:hasPassphrase", handleHasPassphrase)
			socket.off("users:current:setPassphrase", handleSetPassphrase)
		}
	})
</script>

{#if !!systemSettingsCtx.settings && userCtx.user?.isAdmin}
	<div class="flex flex-col gap-6">
		<!-- Ollama Manager Settings -->
		<div class="space-y-4">
			<h3 class="text-lg font-semibold">Ollama Manager</h3>
			
			<div class="flex gap-2 items-center">
				<Switch
					name="ollama-manager"
					checked={systemSettingsCtx.settings?.ollamaManagerEnabled}
					onCheckedChange={onOllamaManagerEnabledClick}
				></Switch>
				<label for="ollama-manager" class="font-semibold">
					Enable Ollama Manager
				</label>
			</div>

			{#if systemSettingsCtx.settings?.ollamaManagerEnabled}
				<div class="ml-6 space-y-3">
					<div>
						<label
							class="text-foreground mb-1 block text-sm font-medium"
							for="ollamaBaseUrl"
						>
							Ollama Server URL
						</label>
						<input
							id="ollamaBaseUrl"
							type="text"
							bind:value={ollamaBaseUrlField}
							placeholder="http://localhost:11434"
							class="input w-full {ollamaBaseUrlError ? 'border-error-500' : ''}"
						/>
						{#if ollamaBaseUrlError}
							<p class="text-error-500 text-sm mt-1">{ollamaBaseUrlError}</p>
						{/if}
					</div>

					<button
						class="btn preset-filled-primary-500"
						onclick={handleSaveOllamaBaseUrl}
						disabled={isSavingBaseUrl}
					>
						{#if isSavingBaseUrl}
							<Icons.Loader2 class="h-4 w-4 animate-spin" />
							Saving...
						{:else}
							<Icons.Save class="h-4 w-4" />
							Save URL
						{/if}
					</button>
				</div>
			{/if}
		</div>

		<!-- Account Settings -->
		<div class="space-y-4">
			<h3 class="text-lg font-semibold">Account Management</h3>
			
			<div class="flex gap-2 items-center">
				<Switch
					name="enable-accounts"
					checked={systemSettingsCtx.settings?.isAccountsEnabled}
					onCheckedChange={handleEnableAccountsClick}
					disabled={systemSettingsCtx.settings?.isAccountsEnabled}
				></Switch>
				<label for="enable-accounts" class="font-semibold">
					Enable User Accounts
				</label>
			</div>
			
			{#if systemSettingsCtx.settings?.isAccountsEnabled}
				<p class="text-muted-foreground text-sm ml-6">
					User accounts are enabled. This setting cannot be reversed.
				</p>
			{:else}
				<p class="text-muted-foreground text-sm ml-6">
					Enable user authentication and multi-user support. This is a permanent change.
				</p>
			{/if}
		</div>
	</div>
{:else if !userCtx.user?.isAdmin}
	<div class="text-muted-foreground">
		Error: You do not have permission to view or modify system settings.
	</div>
{:else}
	<div class="text-muted-foreground">
		Error: No system settings available.
	</div>
{/if}

<!-- Enable Accounts Confirmation Modal -->
<Modal
	open={showEnableAccountsModal}
	onOpenChange={(e) => showEnableAccountsModal = e.open}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-lg"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex justify-between items-center">
			<h2 class="text-xl font-bold">Enable User Accounts</h2>
			<button
				class="btn-ghost"
				onclick={cancelEnableAccounts}
			>
				<Icons.X class="h-5 w-5" />
			</button>
		</header>
		<article class="space-y-4">
			<div class="text-warning-500 flex items-center gap-2">
				<Icons.AlertTriangle class="h-5 w-5" />
				<span class="font-semibold">Warning: Permanent Change</span>
			</div>
			<p>
				Enabling user accounts will activate authentication and multi-user support. 
				This change is <strong>permanent and cannot be reversed</strong>.
			</p>
			<p class="text-muted-foreground text-sm">
				After enabling accounts, you will need to create accounts for all new users.
			</p>

			{#if !hasPassphrase}
				<div class="bg-warning-500/10 border border-warning-500/20 rounded-lg p-4 space-y-3">
					<div class="flex items-center gap-2 text-warning-500">
						<Icons.Key class="h-4 w-4" />
						<span class="font-semibold">Passphrase Required</span>
					</div>
					<p class="text-sm">
						You need to set a passphrase for your account to continue.
					</p>
					
					<div class="space-y-3">
						<p class="text-sm">
							<label class="text-sm font-medium block mb-1" for="username">
								Username
							</label>
							<input
								id="username"
								value={userCtx.user!.username}
								class="input w-full"
								disabled
							/>
						</p>
						<div>
							<label class="text-sm font-medium block mb-1" for="passphrase">
								Passphrase
							</label>
							<input
								id="passphrase"
								type="password"
								bind:value={passphrase}
								placeholder="Enter your passphrase"
								class="input w-full {passphraseError ? 'border-error-500' : ''}"
							/>
						</div>
						<div>
							<label class="text-sm font-medium block mb-1" for="confirmPassphrase">
								Confirm Passphrase
							</label>
							<input
								id="confirmPassphrase"
								type="password"
								bind:value={confirmPassphrase}
								placeholder="Confirm your passphrase"
								class="input w-full {passphraseError ? 'border-error-500' : ''}"
							/>
						</div>
						{#if passphraseError}
							<p class="text-error-500 text-sm">{passphraseError}</p>
						{/if}
						<div class="text-xs text-muted-foreground">
							<p>Requirements:</p>
							<ul class="list-disc list-inside ml-2 space-y-1">
								<li>At least 6 characters long</li>
								<li>At least one lowercase letter</li>
								<li>At least one uppercase letter</li>
								<li>At least one special character</li>
							</ul>
						</div>
					</div>
				</div>
			{/if}
		</article>
		<footer class="flex justify-end gap-2">
			<button
				class="btn preset-tonal-surface"
				onclick={cancelEnableAccounts}
			>
				Cancel
			</button>
			<button
				class="btn preset-filled-warning-500"
				onclick={confirmEnableAccounts}
				disabled={isSettingPassphrase}
			>
				{#if isSettingPassphrase}
					<Icons.Loader2 class="h-4 w-4 animate-spin" />
					Setting up...
				{:else}
					<Icons.Shield class="h-4 w-4" />
					{hasPassphrase ? 'Enable Accounts' : 'Set Passphrase & Enable'}
				{/if}
			</button>
		</footer>
	{/snippet}
</Modal>
