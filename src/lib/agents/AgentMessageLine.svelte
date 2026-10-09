<script lang="ts">
	// A message between agents of the team, as one quiet line in the
	// conversation: who sent it to whom, and what it says in one line.
	import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDotsIcon';
	import { agentName } from './teamText';

	let { from, to, summary }: { from: string; to: string; summary: string } = $props();

	const line = $derived(summary.split('\n').find((l) => l.trim())?.trim() ?? '');
</script>

<div class="amsg" title={`${from || 'parent'} → ${to || 'parent'}\n${summary}`}>
	<span class="ico" aria-hidden="true"><ChatCircleDotsIcon size={13} /></span>
	<span class="who">{agentName(from)}</span>
	<span class="arrow" aria-hidden="true">→</span>
	<span class="who to">{agentName(to)}</span>
	<span class="text">{line}</span>
</div>

<style>
	.amsg {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		min-height: 22px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.ico {
		display: inline-flex;
		flex: none;
		color: var(--dim2);
	}
	.who {
		flex: none;
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.to::after {
		content: ':';
	}
	.arrow {
		flex: none;
		color: var(--dim2);
	}
	.text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
