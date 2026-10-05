<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import type { MonoizeUser } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	let { onSuccess, autoStart = false }: { autoStart?: boolean; onSuccess: (user: MonoizeUser) => void } = $props();
	let busy = $state(false);
	let code = $state('');
	let error = $state('');
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let wake: (() => void) | undefined;
	function cancel() {
		generation++;
		clearTimeout(timer); wake?.(); wake = undefined;
		if (code) void invoke('monoize_oauth_cancel', { userCode: code }).catch(() => {});
		busy = false; code = '';
	}
	onDestroy(cancel);
	onMount(() => { if (autoStart) void start(); });
	async function start() {
		if (busy) return;
		busy = true; error = '';
		const current = ++generation;
		try {
			const attempt = await invoke<{ user_code: string; verification_uri_complete: string }>('monoize_oauth_start');
			if (current !== generation) {
				void invoke('monoize_oauth_cancel', { userCode: attempt.user_code }).catch(() => {});
				return;
			}
			code = attempt.user_code;
			await openUrl(attempt.verification_uri_complete);
			while (current === generation) {
				await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 5000); });
				if (current !== generation) return;
				const result = await invoke<{ pending?: boolean; user?: MonoizeUser }>('monoize_oauth_poll', { userCode: code });
				if (current !== generation) return;
				if (result.user) { code = ''; busy = false; onSuccess(result.user); return; }
			}
		} catch (cause) {
			if (current === generation) { error = String(cause); cancel(); }
		}
	}
</script>

<div class="browser-sign-in">
	<p>{t('settings.monoize.browserHint')}</p>
	{#if code}<p class="code">{code.slice(0, 6)}-{code.slice(6)}</p>{/if}
	{#if error}<p role="alert" class="error">{error}</p>{/if}
	<Button variant="primary" onclick={start} disabled={busy}>{t(busy ? 'settings.monoize.browserWaiting' : 'settings.monoize.browserLogin')}</Button>
	{#if busy}<Button variant="secondary" onclick={cancel}>{t('settings.monoize.browserCancel')}</Button>{/if}
</div>

<style>
	.browser-sign-in { display: flex; flex-direction: column; gap: 12px; }
	p { margin: 0; color: var(--dim); font-size: var(--fs-sm); line-height: 1.6; }
	.code { color: var(--text); font-family: var(--font-mono); font-size: var(--fs-lg); letter-spacing: .12em; }
	.error { overflow-wrap: anywhere; color: var(--error); }
</style>
