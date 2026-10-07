<script lang="ts">
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { t } from '$lib/i18n';
	import { defaultEffort, effortLabel } from './effort';
	import EffortSlider from './EffortSlider.svelte';

	// The thinking-effort popover opened from the effort label in the
	// composer footer: the same slider as in the model menu, on its own.
	let {
		efforts,
		effort,
		disabled = false,
		accent = '',
		onEffort,
		onClose
	}: {
		efforts: string[];
		effort: string;
		disabled?: boolean;
		/** The model's colour (modelColor); '' keeps the neutral fill. */
		accent?: string;
		onEffort: (effort: string) => void;
		onClose: () => void;
	} = $props();

	let shown = $state('');
	const def = $derived(defaultEffort(efforts));
</script>

<button class="eff-backdrop" aria-label={t('common.close')} tabindex="-1" onclick={onClose}></button>
<div class="pop eff" role="dialog" aria-label={t('chat.effortTitle')}>
	<div class="ehead">
		<span class="elabel">{t('chat.effortTitle')}</span>
		<span class="evalue">{effortLabel(shown)}</span>
		<span class="grow"></span>
		<IconButton
			size="sm"
			label={t('chat.effortReset')}
			title={t('chat.effortReset')}
			disabled={disabled || !def || shown === def}
			onclick={() => onEffort(def)}
		>
			<ArrowCounterClockwiseIcon size={14} />
		</IconButton>
	</div>
	<EffortSlider {efforts} {effort} {disabled} {onEffort} {accent} bind:current={shown} />
</div>

<style>
	.eff-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		border: none;
		background: none;
		cursor: default;
	}
	.eff {
		position: absolute;
		right: 0;
		bottom: calc(100% + 8px);
		z-index: 21;
		width: min(320px, calc(100vw - 32px));
		padding: 10px 14px 12px;
		transform-origin: bottom right;
		animation: pop-in var(--t-med) var(--ease-spring);
	}
	.ehead {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}
	.elabel {
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
	.evalue {
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.grow {
		flex: 1;
	}
</style>
