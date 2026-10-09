<script lang="ts">
	// The stop button of a subagent still at work (close_agent), and a
	// spinner in its place while the stop is on its way.
	import StopIcon from 'phosphor-svelte/lib/StopIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { t } from '$lib/i18n';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { canStop, type AgentRow } from '$lib/agentProgress';

	let { row, onStop, size = 'sm' }: { row: AgentRow; onStop: (row: AgentRow) => void; size?: 'xs' | 'sm' } = $props();
</script>

{#if row.stopping}
	<span class="stopping {size}" title={t('chat.team.stopping')} aria-label={t('chat.team.stopping')} role="img"><CircleNotchIcon size={12} class="spin" /></span>
{:else if canStop(row)}
	<IconButton
		{size}
		label={t('chat.team.stopAgent', { name: row.label })}
		title={t('chat.team.stopAgent', { name: row.label })}
		onclick={(e: MouseEvent) => {
			e.stopPropagation();
			onStop(row);
		}}
	>
		<StopIcon size={12} />
	</IconButton>
{/if}

<style>
	.stopping {
		display: inline-flex;
		flex: none;
		color: var(--dim);
	}
	.stopping.sm {
		padding: 5px;
	}
	.stopping.xs {
		padding: 2px;
	}
</style>
