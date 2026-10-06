<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';
	let { provider, onSuccess }: { provider: string; onSuccess: () => void } = $props();
	let busy = $state(false);
	let error = $state('');
	let url = $state('');
	let attempt = '';
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let wake: (() => void) | undefined;
	function cancel() {
		generation++;
		clearTimeout(timer); wake?.(); wake = undefined;
		if (attempt) void invoke('provider_oauth_cancel', { id: attempt }).catch(() => {});
		attempt = ''; busy = false; url = '';
	}
	onDestroy(cancel);
	async function start() {
		if (busy) return;
		busy = true; error = ''; url = '';
		const current = ++generation;
		try {
			const id = await invoke<string>('provider_oauth_start', { provider });
			if (current !== generation) { void invoke('provider_oauth_cancel', { id }); return; }
			attempt = id;
			while (current === generation) {
				const state = await invoke<{ status: string; url?: string; message?: string }>('provider_oauth_poll', { id });
				if (current !== generation) return;
				if (state.status === 'complete') { attempt = ''; busy = false; onSuccess(); return; }
				if (state.status === 'error') throw new Error(state.message);
				if (state.url) {
					const parsed = new URL(state.url);
					if (parsed.protocol === 'https:' && ['auth.openai.com', 'claude.ai'].includes(parsed.hostname)) url = state.url;
				}
				await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 1000); });
			}
		} catch (cause) {
			if (current === generation) { error = String(cause); cancel(); }
		}
	}
</script>

<div class="oauth">
	<p>{t('settings.account.oauthHint')}</p>
	<Button variant="primary" disabled={busy} onclick={start}>{t(busy ? 'settings.account.authorizing' : 'settings.account.oauthLogin', { provider: provider === 'anthropic' ? 'Claude' : 'ChatGPT / Codex' })}</Button>
	{#if url}<Button variant="secondary" onclick={() => openUrl(url).catch(e => { error = String(e); })}>{t('settings.account.reopenBrowser')}</Button>{/if}
	{#if busy}<Button variant="secondary" onclick={cancel}>{t('settings.monoize.browserCancel')}</Button>{/if}
	{#if error}<p role="alert" class="error">{error}</p>{/if}
</div>

<style>
	.oauth { display: flex; flex-direction: column; gap: 10px; }
	p { margin: 0; font-size: var(--fs-sm); color: var(--dim); line-height: 1.6; }
	.error { color: var(--error); overflow-wrap: anywhere; }
</style>
