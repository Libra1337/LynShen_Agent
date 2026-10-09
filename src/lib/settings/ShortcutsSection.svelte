<script lang="ts">
	// Settings → 快捷键: every action in shortcuts.ts with its keys on this
	// computer. Click the keys, then press the new combination: Esc cancels,
	// Backspace or Delete leaves the action without one. A combination that
	// another action has is offered as a swap, never kept twice.
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';
	import {
		SHORTCUTS,
		SHORTCUT_GROUPS,
		SHORTCUT_IDS,
		binding,
		bindings,
		comboLabel,
		comboParts,
		comboProblem,
		findConflict,
		hasOverrides,
		heldCombo,
		isDefaultBinding,
		isMac,
		recordCombo,
		resetShortcuts,
		setShortcut,
		swapShortcut,
		type Combo,
		type ComboProblem,
		type ShortcutId
	} from '$lib/shortcuts';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	const mac = isMac();
	const name = (id: ShortcutId) => t(`shell.shortcuts.${id}`);
	const groups = SHORTCUT_GROUPS.map((group) => ({ group, ids: SHORTCUT_IDS.filter((id) => SHORTCUTS[id].group === group) }));

	/** The action whose keys are being recorded. */
	let recording = $state<ShortcutId | null>(null);
	/** The modifiers held so far while recording. */
	let held = $state<Combo | null>(null);
	/** Why the last key press could not be used. */
	let problem = $state<{ id: ShortcutId; kind: ComboProblem | 'required' } | null>(null);
	/** A combination another action has: swap them, or cancel. */
	let pending = $state<{ id: ShortcutId; combo: Combo; other: ShortcutId; canSwap: boolean } | null>(null);
	/** A press was just taken: its auto-repeat must not reach the app (holding
	 *  ⌘K would open the palette) until the key comes up. */
	let swallow = false;

	function start(id: ShortcutId, button: HTMLButtonElement) {
		// WebKit does not focus a clicked button; focus it so a click elsewhere ends the recording.
		button.focus();
		stop();
		recording = id;
		pending = null;
	}

	function stop() {
		recording = null;
		held = null;
		problem = null;
	}

	/** Give `id` combo `c` (null: none), or ask first when another action has it. */
	function assign(id: ShortcutId, c: Combo | null) {
		stop();
		const other = c ? findConflict(id, c, bindings(), mac) : null;
		if (c && other) {
			// The other action takes this one's combo, which it must be able to use.
			const mine = binding(id);
			const canSwap = mine ? !comboProblem(other, mine, mac) : !SHORTCUTS[other].required;
			pending = { id, combo: c, other, canSwap };
			return;
		}
		setShortcut(id, c, mac);
	}

	function swap() {
		if (!pending) return;
		swapShortcut(pending.id, pending.combo, pending.other, mac);
		pending = null;
	}

	function resetAll() {
		stop();
		pending = null;
		resetShortcuts(mac);
	}

	// Window capture phase: the press reaches nothing else while recording
	// (⌘K must not open the palette, Esc must not close the settings page).
	function onKeyDown(e: KeyboardEvent) {
		if (!recording) {
			if (swallow && e.repeat) {
				e.preventDefault();
				e.stopPropagation();
			} else swallow = false;
			if (pending && e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				pending = null;
			}
			return;
		}
		if (e.isComposing) return;
		e.preventDefault();
		e.stopPropagation();
		const id = recording;
		const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
		if (bare && e.key === 'Escape') return stop();
		if (bare && (e.key === 'Backspace' || e.key === 'Delete')) {
			if (SHORTCUTS[id].required) problem = { id, kind: 'required' };
			else assign(id, null);
			return;
		}
		// Off macOS the Windows key belongs to the system.
		if (!mac && e.metaKey) {
			problem = { id, kind: 'reserved' };
			held = null;
			return;
		}
		const c = recordCombo(e, id, mac);
		if (!c) {
			held = heldCombo(e, '', mac);
			return;
		}
		const kind = comboProblem(id, c, mac);
		if (kind) {
			problem = { id, kind };
			held = null;
			return;
		}
		swallow = true;
		assign(id, c);
	}

	function onKeyUp(e: KeyboardEvent) {
		swallow = false;
		if (recording) held = heldCombo(e, '', mac);
	}

	$effect(() => {
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('keyup', onKeyUp, true);
		window.addEventListener('blur', stop);
		return () => {
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('keyup', onKeyUp, true);
			window.removeEventListener('blur', stop);
		};
	});

	function problemText(kind: ComboProblem | 'required'): string {
		if (kind === 'modifier') return t('settings.shortcuts.modifier', { mods: t(mac ? 'settings.shortcuts.modsMac' : 'settings.shortcuts.modsOther') });
		return t(`settings.shortcuts.${kind}`);
	}
</script>

{#snippet caps(c: Combo)}
	{#each comboParts(c, mac) as part, i (i)}<kbd>{part}</kbd>{/each}
{/snippet}

<SettingsSection>
	<SettingsRow id="shortcuts-reset" title={t('settings.shortcuts.customize')} description={t('settings.shortcuts.hint')}>
		<Button size="sm" disabled={!hasOverrides()} onclick={resetAll}>{t('settings.shortcuts.resetAll')}</Button>
	</SettingsRow>
</SettingsSection>

{#each groups as g (g.group)}
	<SettingsSection title={t(`shell.shortcuts.${g.group}`)}>
		{#each g.ids as id (id)}
			{@const c = binding(id)}
			{@const ask = pending?.id === id ? pending : null}
			<SettingsRow id="shortcut-{id}" title={name(id)}>
				{#snippet detail()}
					{#if problem?.id === id}
						<p class="msg err" role="status">{problemText(problem.kind)}</p>
					{:else if ask}
						{@const mine = binding(id)}
						<div class="msg warn" role="status">
							<p>{t('settings.shortcuts.conflict', { name: name(ask.other), keys: comboLabel(ask.combo, mac) })}</p>
							<p>
								{#if !ask.canSwap}
									{t('settings.shortcuts.noSwap', { name: name(ask.other) })}
								{:else if mine}
									{t('settings.shortcuts.swapTo', { name: name(ask.other), keys: comboLabel(mine, mac) })}
								{:else}
									{t('settings.shortcuts.swapToNone', { name: name(ask.other) })}
								{/if}
							</p>
						</div>
					{/if}
				{/snippet}
				{#if ask}
					<span class="keys pend">{@render caps(ask.combo)}</span>
					{#if ask.canSwap}<Button size="sm" onclick={swap}>{t('settings.shortcuts.swap')}</Button>{/if}
					<Button size="sm" variant="ghost" onclick={() => (pending = null)}>{t('common.cancel')}</Button>
				{:else}
					<button
						class="keys rec"
						class:on={recording === id}
						aria-label={t('settings.shortcuts.record', { name: name(id), keys: comboLabel(c, mac) || t('settings.shortcuts.none') })}
						onclick={(e) => (recording === id ? stop() : start(id, e.currentTarget))}
						onblur={() => recording === id && stop()}
					>
						{#if recording === id}
							{#if held}{@render caps(held)}{/if}
							<span class="wait">{t('settings.shortcuts.recording')}</span>
						{:else if c}
							{@render caps(c)}
						{:else}
							<span class="wait">{t('settings.shortcuts.none')}</span>
						{/if}
					</button>
					<span class="reset">
						{#if !isDefaultBinding(id, mac) && recording !== id}
							{@const label = t('settings.shortcuts.reset', { keys: comboLabel(SHORTCUTS[id], mac) })}
							<IconButton size="sm" {label} title={label} onclick={() => assign(id, SHORTCUTS[id])}><ArrowCounterClockwiseIcon size={14} /></IconButton>
						{/if}
					</span>
				{/if}
			</SettingsRow>
		{/each}
	</SettingsSection>
{/each}

<style>
	.keys {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		min-height: 32px;
	}
	.rec {
		min-width: 132px;
		padding: 4px 8px;
		border: 1px solid transparent;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font-family: var(--font-sans);
		font-size: var(--fs-xs);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.rec:hover {
		background: var(--surface2);
	}
	.rec.on {
		background: var(--surface2);
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.wait {
		white-space: nowrap;
	}
	kbd {
		display: inline-block;
		min-width: 24px;
		padding: 2px 7px;
		border: 1px solid var(--border);
		border-bottom-width: 2px;
		border-radius: var(--r-xs);
		background: var(--surface);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		text-align: center;
	}
	/* Holds the reset button's place so the keys line up down the column. */
	.reset {
		display: inline-flex;
		width: 24px;
	}
	.msg {
		margin: 2px 0 0;
		max-width: 52ch;
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	.msg p {
		margin: 0;
	}
	.err {
		color: var(--err);
	}
	.warn {
		color: var(--warn);
	}
</style>
