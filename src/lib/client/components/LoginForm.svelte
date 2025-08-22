<script lang="ts">
	import { z } from "zod"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket, refreshAuthAfterLogin } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()

	// Login form schema
	const loginSchema = z.object({
		username: z.string().min(1, "Username is required").max(50, "Username must be 50 characters or less"),
		passphrase: z.string().min(1, "Passphrase is required")
	})

	type LoginForm = z.infer<typeof loginSchema>

	// Form state
	let formData: LoginForm = $state({
		username: "",
		passphrase: ""
	})

	let errors: Partial<Record<keyof LoginForm, string>> = $state({})
	let isLoading = $state(false)
	let showPassphrase = $state(false)

	// Validation function
	function validateForm() {
		try {
			loginSchema.parse(formData)
			errors = {}
			return true
		} catch (error) {
			if (error instanceof z.ZodError) {
				errors = {}
				error.errors.forEach((err) => {
					if (err.path[0]) {
						errors[err.path[0] as keyof LoginForm] = err.message
					}
				})
			}
			return false
		}
	}

	// Handle form submission
	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault()
		
		if (!validateForm()) {
			return
		}

		isLoading = true
		
		try {
			const response = await fetch('/api/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					username: formData.username,
					passphrase: formData.passphrase
				})
			})

			const data = await response.json()

			if (!response.ok) {
				toaster.error({
					title: "Login Failed",
					description: data.error || "Invalid username or passphrase"
				})
				return
			}

			toaster.success({
				title: "Login Successful",
				description: "Welcome back!"
			})
			
			// Refresh authentication to load user context
			refreshAuthAfterLogin()

		} catch (error) {
			console.error('Login error:', error)
			toaster.error({
				title: "Login Error",
				description: "An unexpected error occurred. Please try again."
			})
		} finally {
			isLoading = false
		}
	}

	// Handle input changes with real-time validation
	function handleInputChange(field: keyof LoginForm, value: string) {
		formData[field] = value
		
		// Clear field-specific error when user starts typing
		if (errors[field]) {
			errors[field] = ""
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-surface-50 to-surface-200 dark:from-surface-900 dark:to-surface-950 px-4 py-12 sm:px-6 lg:px-8">
	<div class="w-full max-w-md">
		<!-- Login Container Card -->
		<div class="bg-surface-0 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-surface-800 p-8 space-y-8">
			<!-- Logo and Header -->
			<div class="text-center">
				<div class="flex justify-center mb-6">
					<img
						src="/logo.png"
						alt="Serene Pub"
						class="h-30"
					/>
				</div>
				<h2 class="text-3xl font-bold tracking-tight text-foreground">
					Welcome Back
				</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					Sign in to your Serene Pub account
				</p>
			</div>

			<form class="space-y-6" onsubmit={handleSubmit}>
				<div class="space-y-4">
					<!-- Username Field -->
					<div>
						<label for="username" class="block text-sm font-medium text-foreground mb-2">
							Username
						</label>
						<div class="relative">
							<input
								id="username"
								name="username"
								type="text"
								autocomplete="username"
								required
								class="input w-full pl-10 {errors.username ? 'border-error-500' : ''}"
								placeholder="Enter your username"
								bind:value={formData.username}
								oninput={(e) => handleInputChange('username', e.currentTarget.value)}
								disabled={isLoading}
							/>
							<Icons.User class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
						</div>
						{#if errors.username}
							<p class="mt-2 text-sm text-error-500" role="alert">
								{errors.username}
							</p>
						{/if}
					</div>

					<!-- Passphrase Field -->
					<div>
						<label for="passphrase" class="block text-sm font-medium text-foreground mb-2">
							Passphrase
						</label>
						<div class="relative">
							<input
								id="passphrase"
								name="passphrase"
								type={showPassphrase ? "text" : "password"}
								autocomplete="current-password"
								required
								class="input w-full pl-10 pr-12 {errors.passphrase ? 'border-error-500' : ''}"
								placeholder="Enter your passphrase"
								bind:value={formData.passphrase}
								oninput={(e) => handleInputChange('passphrase', e.currentTarget.value)}
								disabled={isLoading}
							/>
							<Icons.Key class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
							<button
								type="button"
								class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
								onclick={() => showPassphrase = !showPassphrase}
								aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
								disabled={isLoading}
							>
								{#if showPassphrase}
									<Icons.EyeOff class="h-5 w-5" aria-hidden="true" />
								{:else}
									<Icons.Eye class="h-5 w-5" aria-hidden="true" />
								{/if}
							</button>
						</div>
						{#if errors.passphrase}
							<p class="mt-2 text-sm text-error-500" role="alert">
								{errors.passphrase}
							</p>
						{/if}
					</div>
				</div>

				<div>
					<button
						type="submit"
						disabled={isLoading}
						class="btn preset-filled-primary-500 w-full flex justify-center items-center py-3 px-4 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg"
					>
						{#if isLoading}
							<Icons.Loader2 class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
							Signing in...
						{:else}
							<Icons.LogIn class="mr-2 h-4 w-4" aria-hidden="true" />
							Sign in
						{/if}
					</button>
				</div>
			</form>

			<div class="text-center">
				<p class="text-xs text-muted-foreground">
					Need help? Contact your administrator.
				</p>
			</div>
		</div>
	</div>
</div>
<style lang="postcss">
	@reference "tailwindcss";
</style>
