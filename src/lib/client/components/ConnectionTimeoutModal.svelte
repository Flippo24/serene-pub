<!-- Connection timeout and reconnection UI component -->
<script lang="ts">
	import { onDestroy, onMount } from "svelte"
	import { connectionTimeout, type ConnectionTimeoutService } from "$lib/client/services/connectionTimeout"
	import { toaster } from "$lib/client/utils/toaster"
	import { refreshAuthAfterLogin } from "$lib/client/sockets/loadSockets.client"
	import * as Icons from "@lucide/svelte"

	interface Props {
		isVisible?: boolean
		onReconnect?: () => Promise<void>
	}

	let { isVisible = false, onReconnect }: Props = $props()

	let showModal = $state(false)
	let reconnectCountdown = $state(0)
	let canReconnect = $state(false)
	let isReconnecting = $state(false)
	let updateInterval: number | null = null

	// Initialize connection timeout service
	onMount(() => {
		connectionTimeout.startTimeout(
			// On timeout callback
			() => {
				showModal = true
				toaster.warning({
					title: "Connection Timed Out",
					description: "Your session has expired due to inactivity. You can reconnect in 30 seconds."
				})
			},
			// On reconnect available callback
			() => {
				canReconnect = true
				toaster.info({
					title: "Reconnection Available",
					description: "You can now reconnect to the application."
				})
			}
		)

		// Update countdown every second
		updateInterval = setInterval(() => {
			reconnectCountdown = connectionTimeout.getReconnectCountdown()
		}, 1000) as unknown as number

		return () => {
			if (updateInterval) {
				clearInterval(updateInterval)
			}
		}
	})

	onDestroy(() => {
		if (updateInterval) {
			clearInterval(updateInterval)
		}
		connectionTimeout.stopTimeout()
	})

	// Handle reconnection attempt
	async function handleReconnect() {
		if (!canReconnect || isReconnecting) return

		try {
			isReconnecting = true
			
			if (onReconnect) {
				await onReconnect()
			} else {
				// Default reconnection behavior - refresh auth and reload
				await refreshAuthAfterLogin()
			}
			
			// Reset timeout state
			connectionTimeout.reset()
			connectionTimeout.startTimeout()
			
			showModal = false
			canReconnect = false
			reconnectCountdown = 0
			
			toaster.success({
				title: "Reconnected",
				description: "Successfully reconnected to the application."
			})
			
		} catch (error) {
			console.error("Reconnection failed:", error)
			toaster.error({
				title: "Reconnection Failed",
				description: "Failed to reconnect. Please refresh the page manually."
			})
		} finally {
			isReconnecting = false
		}
	}

	// Close modal and refresh page
	function handleRefreshPage() {
		window.location.reload()
	}

	// Update activity when user interacts with the page
	function updateActivity() {
		connectionTimeout.updateActivity()
	}

	// Listen for user activity
	onMount(() => {
		const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click']
		
		const activityHandler = () => updateActivity()
		
		events.forEach(event => {
			document.addEventListener(event, activityHandler, true)
		})

		return () => {
			events.forEach(event => {
				document.removeEventListener(event, activityHandler, true)
			})
		}
	})
</script>

<!-- Connection Timeout Modal -->
{#if showModal || isVisible}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
		<div class="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
			<div class="text-center">
				<!-- Icon -->
				<div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/20">
					<Icons.WifiOff class="h-8 w-8 text-orange-600 dark:text-orange-400" />
				</div>

				<!-- Title -->
				<h3 class="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
					Connection Timed Out
				</h3>

				<!-- Description -->
				<p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
					Your session has expired due to inactivity. You can reconnect to continue using the application.
				</p>

				<!-- Countdown or Ready State -->
				<div class="mt-4">
					{#if canReconnect}
						<p class="text-sm font-medium text-green-600 dark:text-green-400">
							Ready to reconnect
						</p>
					{:else if reconnectCountdown > 0}
						<p class="text-sm text-gray-500 dark:text-gray-400">
							Reconnect available in {reconnectCountdown} seconds
						</p>
					{/if}
				</div>

				<!-- Actions -->
				<div class="mt-6 flex flex-col gap-3 sm:flex-row">
					<!-- Reconnect Button -->
					<button
						onclick={handleReconnect}
						disabled={!canReconnect || isReconnecting}
						class="flex-1 rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-gray-800"
					>
						{#if isReconnecting}
							<Icons.Loader2 class="mr-2 h-4 w-4 animate-spin" />
							Reconnecting...
						{:else}
							<Icons.RotateCcw class="mr-2 h-4 w-4" />
							Reconnect
						{/if}
					</button>

					<!-- Refresh Page Button -->
					<button
						onclick={handleRefreshPage}
						class="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 dark:focus:ring-offset-gray-800"
					>
						<Icons.RefreshCw class="mr-2 h-4 w-4" />
						Refresh Page
					</button>
				</div>

				<!-- Additional Info -->
				<p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
					Sessions expire after 1 hour of inactivity
				</p>
			</div>
		</div>
	</div>
{/if}
