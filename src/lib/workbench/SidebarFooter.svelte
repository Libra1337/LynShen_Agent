<script lang="ts">
	import UserCircleIcon from 'phosphor-svelte/lib/UserCircleIcon';
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import ArrowCircleDownIcon from 'phosphor-svelte/lib/ArrowCircleDownIcon';
	import { t } from '$lib/i18n';
	import { withShortcut } from '$lib/shortcuts';
	import AccountCard from './AccountCard.svelte';

	// The bottom of the sidebar, as in Claude and ChatGPT: the account (hover
	// shows its card), the update notice and settings.
	let {
		loggedIn,
		updateAvailable = false,
		settingsOpen = false,
		onManageAccount,
		onSettings,
		onUpdate
	}: {
		/** Signed in to the LynShen account (not tied to any one chat). */
		loggedIn: boolean;
		updateAvailable?: boolean;
		/** The settings page is in front: the gear shows as selected. */
		settingsOpen?: boolean;
		/** Settings → Account: the card's sign-in / manage row. */
		onManageAccount: () => void;
		onSettings: () => void;
		/** Open settings at the update section. */
		onUpdate: () => void;
	} = $props();

	// Account card: hover opens it and leaving closes it after a short grace (so
	// the pointer can cross the gap); a click pins it until Esc or a click outside.
	let accountBtn = $state<HTMLButtonElement | null>(null);
	let card = $state<{ left: number; bottom: number } | null>(null);
	let pinned = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	function showCard() {
		clearTimeout(closeTimer);
		if (card || !accountBtn) return;
		const r = accountBtn.getBoundingClientRect();
		card = { left: r.left, bottom: window.innerHeight - r.top + 8 };
	}
	function hideCardSoon() {
		clearTimeout(closeTimer);
		if (!pinned) closeTimer = setTimeout(() => (card = null), 160);
	}
	function closeCard() {
		clearTimeout(closeTimer);
		card = null;
		pinned = false;
	}
	function toggleCard() {
		if (card && pinned) return closeCard();
		showCard();
		pinned = true;
	}
	function outsideDown(e: PointerEvent) {
		const el = e.target as Element;
		if (card && !accountBtn?.contains(el) && !el.closest?.('.acct-card')) closeCard();
	}
</script>

<div class="sb-foot">
	<button
		bind:this={accountBtn}
		class="foot-btn account"
		class:on={!!card}
		aria-label={t('shell.account.title')}
		aria-haspopup="dialog"
		aria-expanded={!!card}
		onmouseenter={showCard}
		onmouseleave={hideCardSoon}
		onclick={toggleCard}
	>
		<UserCircleIcon size={18} weight={card ? 'fill' : 'regular'} />
		<span>{t('shell.account.title')}</span>
	</button>
	{#if updateAvailable}
		<button class="foot-btn icon" title={t('shell.updateAvailable')} aria-label={t('shell.updateAvailable')} onclick={onUpdate}>
			<ArrowCircleDownIcon size={18} />
		</button>
	{/if}
	<button class="foot-btn icon" class:on={settingsOpen} title={withShortcut(t('shell.settings'), 'settings')} aria-label={t('shell.settings')} aria-pressed={settingsOpen} onclick={onSettings}>
		<GearIcon size={18} weight={settingsOpen ? 'fill' : 'regular'} />
	</button>
</div>

<svelte:window onpointerdown={outsideDown} onkeydown={(e) => e.key === 'Escape' && card && closeCard()} />

{#if card}
	<AccountCard
		{loggedIn}
		left={card.left}
		bottom={card.bottom}
		onEnter={() => clearTimeout(closeTimer)}
		onLeave={hideCardSoon}
		onManage={() => {
			closeCard();
			onManageAccount();
		}}
	/>
{/if}

<style>
	.sb-foot {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 10px 12px;
		border-top: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.foot-btn {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 36px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.foot-btn.account {
		flex: 1;
		min-width: 0;
		color: var(--text);
	}
	.foot-btn.account > :global(svg) {
		color: var(--dim);
	}
	.foot-btn.icon {
		justify-content: center;
		width: 36px;
		padding: 0;
	}
	.foot-btn:hover,
	.foot-btn.on {
		background: var(--surface2);
		color: var(--text);
	}
</style>
