<script lang="ts">
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { fetchMonoizeBalance, monoizeSession, type MonoizeUser } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import { shownBalanceText } from '$lib/money';
	import { prefs } from '$lib/prefs.svelte';

	// The rail's account card: who is signed in to the LynShen Console
	// (Monoize gateway), balance from /user/balance via the client key.
	// Floats beside the account button (fixed, so the sidebar can't clip it);
	// the rail owns open / close.
	let {
		loggedIn,
		left,
		bottom,
		onEnter,
		onLeave,
		onManage
	}: {
		loggedIn: boolean;
		left: number;
		bottom: number;
		onEnter: () => void;
		onLeave: () => void;
		/** Open Settings → Account (sign in / manage). */
		onManage: () => void;
	} = $props();

	let user = $state<MonoizeUser | null>(null);
	let raw = $state<{ total_balance: string; currency: string } | null>(null);
	const balance = $derived(raw ? shownBalanceText(raw.total_balance, raw.currency, prefs.balanceCurrency) : null);
	let error = $state<string | null>(null);
	let loading = $state(false);

	// Refetch on every open: balance moves with each call.
	$effect(() => {
		if (!loggedIn) return;
		loading = true;
		Promise.all([monoizeSession(), fetchMonoizeBalance().catch(() => null)])
			.then(([s, b]) => {
				user = s.logged_in && s.session ? s.session.user : null;
				raw = b?.balance_infos?.[0] ?? null;
				error = null;
			})
			.catch((e) => (error = e instanceof Error ? e.message : String(e)))
			.finally(() => (loading = false));
	});
</script>

<div
	class="pop acct-card"
	role="dialog"
	aria-label={t('shell.account.title')}
	tabindex="-1"
	style:left="{left}px"
	style:bottom="{bottom}px"
	onmouseenter={onEnter}
	onmouseleave={onLeave}
>
	{#if !loggedIn}
		<div class="sec">
			<div class="name">{t('shell.notLoggedIn')}</div>
			<div class="sub">{t('shell.account.signInHint')}</div>
		</div>
		<button class="pop-row manage" onclick={onManage}>{t('shell.account.signIn')}<CaretRightIcon size={14} /></button>
	{:else}
		<div class="sec">
			<div class="name">{user?.username ?? 'LynShen'}</div>
			<div class="sub">LynShen Console</div>
		</div>
		<div class="sec rows">
			<div class="kv">
				<span>{t('settings.usage.balance')}</span>
				<span class="num">{balance ?? (error ? '—' : t('common.loading'))}</span>
			</div>
		</div>
		<button class="pop-row manage" onclick={onManage}>{t('shell.account.manage')}<CaretRightIcon size={14} /></button>
	{/if}
</div>

<style>
	.acct-card {
		position: fixed;
		z-index: 90;
		width: 280px;
		gap: 0;
		padding: 6px;
		user-select: text;
		transform-origin: bottom left;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.sec {
		padding: 10px 12px;
	}
	.sec + .sec {
		border-top: 1px solid var(--border);
	}
	.name {
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		margin-top: 2px;
		font-size: var(--fs-xs);
		color: var(--dim2);
		overflow-wrap: anywhere;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.kv {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.kv span:last-child {
		color: var(--text);
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.manage {
		justify-content: space-between;
		margin-top: 2px;
		min-height: 34px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.manage:hover {
		color: var(--text);
	}
</style>
