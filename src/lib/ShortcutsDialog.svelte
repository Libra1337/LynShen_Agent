<script lang="ts">
	// Every keyboard shortcut (⌘/), grouped as in shortcuts.ts, with the keys
	// in use on this computer; Settings → 快捷键 changes them.
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { SHORTCUTS, SHORTCUT_GROUPS, SHORTCUT_IDS, shortcutLabel } from '$lib/shortcuts';
	import { t } from '$lib/i18n';

	let { onClose, onCustomize }: { onClose: () => void; /** Open Settings → 快捷键. */ onCustomize: () => void } = $props();

	const groups = SHORTCUT_GROUPS.map((group) => ({
		group,
		ids: SHORTCUT_IDS.filter((id) => SHORTCUTS[id].group === group)
	}));
</script>

<Modal label={t('shell.shortcuts.title')} width={460} {onClose}>
	<h2>{t('shell.shortcuts.title')}</h2>
	{#each groups as g (g.group)}
		<section>
			<h3>{t(`shell.shortcuts.${g.group}`)}</h3>
			{#each g.ids as id (id)}
				{@const keys = shortcutLabel(id)}
				<div class="row">
					<span>{t(`shell.shortcuts.${id}`)}</span>
					{#if keys}<kbd>{keys}</kbd>{:else}<span class="none" aria-label={t('shell.shortcuts.none')}>—</span>{/if}
				</div>
			{/each}
		</section>
	{/each}
	{#snippet footer()}
		<Button size="sm" onclick={onCustomize}>{t('shell.shortcuts.customize')}</Button>
	{/snippet}
</Modal>

<style>
	h2 {
		margin: 0 0 12px;
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	section + section {
		margin-top: 14px;
	}
	h3 {
		margin: 0 0 4px;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 5px 0;
		font-size: var(--fs-sm);
	}
	kbd {
		padding: 1px 6px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--dim);
		font-family: inherit;
		font-size: var(--fs-xs);
	}
	.none {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
</style>
