<script lang="ts">
	import PersonaSelectModal from "../modals/PersonaSelectModal.svelte"
	import CharacterSelectModal from "../modals/CharacterSe		socket.on("characters:list", (msg: Socke		socket.on("characters:list", (msg: Sockets.Characters.List.Response) => {
			charactersList = msg.characterList || []
		})

		socket.on("personas:list", (msg: Sockets.Personas.List.Response) => {
			personasList = msg.personaList || []
		})
		socket.emit("characters:list", {})
		socket.emit("personas:list", {})ters.List.Response) => {
			charactersList = msg.characterList || []
		})

		socket.on("personas:list", (msg: Sockets.Personas.List.Response) => {
			personasList = msg.personaList || []
		})al.svelte"
	import * as skio from "sveltekit-io"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { onMount, onDestroy, tick } from "svelte"

	interface Props {
		lorebookId: number // ID of the lorebook to edit
	}

	let { lorebookId }: Props = $props()

	const socket = skio.get()

	let showLinkPersonaBindingModal = $state(false)
	let showLinkCharacterBindingModal = $state(false)
	let showAddPersonaBindingModal = $state(false)
	let showAddCharacterBindingModal = $state(false)
	let lorebookBindingId: number | null = $state(null)
	let characterList: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let lorebookBindingList: Sockets.LorebookBindingList.Response["lorebookBindingList"] =
		$state([])
	let personaList: Sockets.Personas.List.Response["personaList"] = $state([])

	let availableBindingCharacters = $derived.by(() => {
		// Filter out the characters that are already bound to this lorebook
		return characterList.filter(
			(c) =>
				!lorebookBindingList.some(
					(b) => b.characterId === c.id && b.lorebookId === lorebookId
				)
		)
	})

	let availableBindingPersonas = $derived.by(() => {
		// Filter out the personas that are already bound to this lorebook
		return personaList.filter(
			(p) =>
				!lorebookBindingList.some(
					(b) => b.personaId === p.id && b.lorebookId === lorebookId
				)
		)
	})

	function unlinkBinding(id: number) {
		const req: Sockets.UpdateLorebookBinding.Call = {
			lorebookBinding: {
				id,
				personaId: null,
				characterId: null
			}
		}
		socket.emit("updateLorebookBinding", req)
	}

	function onClickLinkCharacterBinding(bindingId: number) {
		lorebookBindingId = bindingId
		showLinkCharacterBindingModal = true
	}

	function onClickLinkPersonaBinding(bindingId: number) {
		lorebookBindingId = bindingId
		showLinkPersonaBindingModal = true
	}

	function onClickAddCharacterBinding() {
		showAddCharacterBindingModal = true
	}

	function onClickAddPersonaBinding() {
		showAddPersonaBindingModal = true
	}

	function handleLinkPersonaBindingSelect(
		persona: Partial<SelectPersona> & { id: number }
	) {
		showLinkPersonaBindingModal = false
		const req: Sockets.UpdateLorebookBinding.Call = {
			lorebookBinding: {
				id: lorebookBindingId ?? 0,
				personaId: persona.id ?? null,
				characterId: null
			}
		}
		socket.emit("updateLorebookBinding", req)
	}

	function handleLinkCharacterBindingSelect(
		character: Partial<SelectCharacter> & { id: number }
	) {
		showLinkCharacterBindingModal = false
		const req: Sockets.UpdateLorebookBinding.Call = {
			lorebookBinding: {
				id: lorebookBindingId ?? 0,
				characterId: character.id ?? null,
				personaId: null
			}
		}
		socket.emit("updateLorebookBinding", req)
		lorebookBindingId = null
	}

	function handleAddPersonaBindingSelect(
		persona: Partial<SelectPersona> & { id: number }
	) {
		showAddPersonaBindingModal = false
		const req: Sockets.CreateLorebookBinding.Call = {
			lorebookBinding: {
				lorebookId: lorebookId ?? 0,
				personaId: persona.id ?? null,
				characterId: null
			}
		}
		socket.emit("createLorebookBinding", req)
	}

	function handleAddCharacterBindingSelect(
		character: Partial<SelectCharacter> & { id: number }
	) {
		showAddCharacterBindingModal = false
		const req: Sockets.CreateLorebookBinding.Call = {
			lorebookBinding: {
				lorebookId: lorebookId ?? 0,
				characterId: character.id ?? null,
				personaId: null
			}
		}
		socket.emit("createLorebookBinding", req)
		lorebookBindingId = null
	}

	function getBindingCharacter(binding: SelectLorebookBinding) {
		return binding.characterId
			? characterList.find((c) => c.id === binding.characterId)
			: binding.personaId
				? personaList.find((p) => p.id === binding.personaId)
				: null
	}

	onMount(() => {
		socket.on("characters:list", (msg: Sockets.Characters.List.Response) => {
			characterList = msg.characterList || []
		})

		socket.on("personas:list", (msg: Sockets.Personas.List.Response) => {
			personaList = msg.personaList || []
		})

		socket.on(
			"lorebookBindingList",
			async (msg: Sockets.LorebookBindingList.Response) => {
				lorebookBindingList = msg.lorebookBindingList || []
				await tick()
			}
		)

		socket.on(
			"createLorebookBinding",
			(msg: Sockets.CreateLorebookBinding.Response) => {
				toaster.success({
					title: "Binding Created",
					description: "Lorebook binding created successfully."
				})
			}
		)

		socket.on(
			"updateLorebookBinding",
			(msg: Sockets.UpdateLorebookBinding.Response) => {
				toaster.success({
					title: "Binding Updated",
					description: "Lorebook binding updated successfully."
				})
			}
		)

		socket.on("characters:list", (msg: Sockets.Characters.List.Response) => {
			characterList = msg.characterList || []
		})

		socket.on("personas:list", (msg: Sockets.Personas.List.Response) => {
			personaList = msg.personaList || []
		})
		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		const bindingReq: Sockets.LorebookBindingList.Call = {
			lorebookId
		}
		socket.emit("lorebookBindingList", bindingReq)
	})

	onDestroy(() => {
		socket.off("characters:list")
		socket.off("personas:list")
		socket.off("lorebookBindingList")
		socket.off("createLorebookBinding")
		socket.off("updateLorebookBinding")
		socket.off("deleteLorebookBinding")
	})
</script>

<div>
	<div class="bindings-tab">
		<div class="mb-4 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500 w-full"
				onclick={() => onClickAddCharacterBinding()}
			>
				<Icons.Plus size={16} /> Add Character
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500 w-full"
				onclick={() => onClickAddPersonaBinding()}
			>
				<Icons.Plus size={16} /> Add Persona
			</button>
		</div>
		<div class="bindings-list">
			{#key lorebookBindingList.length}
				{#each lorebookBindingList as binding, i}
					{@render bindingCard(binding)}
				{/each}
			{/key}
		</div>
	</div>
</div>

{#snippet bindingCard(binding: SelectLorebookBinding)}
	{#if binding}
		<!-- Show character card -->
		{@const char = getBindingCharacter(binding)}
		<div
			class="binding-card group hover:preset-filled-surface-200-800"
			class:preset-outlined-surface-300-700={!!char}
			class:preset-outlined-warning-300-700={!char}
		>
			<div class="binding-top-row">
				{#if char}
					<div class="binding-avatar">
						<Avatar {char} />
					</div>
					<div class="binding-info">
						<div class="binding-name select-none">
							{"nickname" in char && char.nickname
								? char.nickname
								: char.name}
						</div>
						<div
							class="binding-desc group-hover:text-surface-800-200 line-clamp-2 select-none"
						>
							{"creatorNotes" in char
								? char.creatorNotes
								: char.description}
						</div>
					</div>
				{/if}

				<div class="binding-actions">
					<button
						onclick={() => onClickLinkCharacterBinding(binding.id)}
						class:hidden={binding.personaId || binding.characterId}
						class="btn btn-sm preset-filled-primary-500"
					>
						<Icons.Link size={16} />
						Link Character
					</button>
					<button
						onclick={() => onClickLinkPersonaBinding(binding.id)}
						class:hidden={binding.personaId || binding.characterId}
						class="btn btn-sm preset-filled-primary-500"
					>
						<Icons.Link size={16} />
						Link Persona
					</button>
				</div>
			</div>
			<div>
				<span>
					{binding.characterId ? "Character" : "Persona"} handlebar:
					<span class="text-tertiary-700-300">
						{binding.binding}
					</span>
				</span>
			</div>
			{#if !!char}
				<div
					class="bg-surface-500/75 align absolute top-0 right-0 bottom-0 left-0 flex h-full w-full justify-center opacity-0 hover:opacity-100"
				>
					<button
						onclick={() => unlinkBinding(binding.id)}
						class:disabled={!binding.characterId &&
							!binding.personaId}
						class="btn preset-filled-warning-500 my-auto h-fit"
						title="Unlink Binding"
					>
						<Icons.Link size={16} class="inline" /> Unlink
					</button>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

<!-- Link to existing bindings -->

<PersonaSelectModal
	open={showLinkPersonaBindingModal}
	onSelect={handleLinkPersonaBindingSelect}
	onOpenChange={() => (showLinkPersonaBindingModal = false)}
	personas={availableBindingPersonas}
/>
<CharacterSelectModal
	open={showLinkCharacterBindingModal}
	onSelect={handleLinkCharacterBindingSelect}
	onOpenChange={() => (showLinkCharacterBindingModal = false)}
	characters={availableBindingCharacters}
/>

<!-- Modals for adding new bindings -->

<PersonaSelectModal
	open={showAddPersonaBindingModal}
	onSelect={handleAddPersonaBindingSelect}
	onOpenChange={() => (showAddPersonaBindingModal = false)}
	personas={availableBindingPersonas}
/>

<CharacterSelectModal
	open={showAddCharacterBindingModal}
	onSelect={handleAddCharacterBindingSelect}
	onOpenChange={() => (showAddCharacterBindingModal = false)}
	characters={availableBindingCharacters}
/>

<style lang="postcss">
	@reference "tailwindcss";

	.bindings-list {
		@apply relative mb-2 flex w-full flex-wrap gap-3;
	}

	.binding-card {
		@apply relative flex w-full flex-col gap-2 rounded-lg p-3 transition-all;
	}

	.binding-top-row {
		@apply flex w-full gap-3 overflow-hidden rounded;
	}

	.binding-name {
		@apply truncate font-semibold;
	}

	.binding-desc {
		@apply: text-surface-500 line-clamp-2 w-full text-left text-xs select-none;
	}
</style>
