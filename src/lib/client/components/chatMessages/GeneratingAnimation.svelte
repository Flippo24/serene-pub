<script lang="ts">
	interface Props {
		text?: string
	}

	let { text = "Generating" }: Props = $props()
</script>

<div class="flex items-center gap-2">
	<div class="animate-pulse text-sm text-surface-600-400">{text}...</div>
	<div class="h-2 w-2 animate-bounce rounded-full bg-primary-500"></div>
</div>
