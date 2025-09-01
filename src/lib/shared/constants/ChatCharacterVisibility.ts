export class ChatCharacterVisibility {
	static VISIBLE = "visible" // Show full character information (default)
	static MINIMAL = "minimal" // Show only name/nickname when not responding
	static HIDDEN = "hidden" // Hide all character info when not responding

	static options = [
		{ value: ChatCharacterVisibility.VISIBLE, label: "Full Visibility" },
		{ value: ChatCharacterVisibility.MINIMAL, label: "Minimal Visibility" },
		{ value: ChatCharacterVisibility.HIDDEN, label: "Hidden" }
	]
}
