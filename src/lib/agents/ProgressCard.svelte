<script lang="ts">
	// Top right of the conversation while a turn has a todo list or runs
	// subagents: a one-line summary (steps done, subagents running, the
	// team's tokens against its budget), the steps with their state and owner,
	// and the subagents with their latest action, as the engines report them. Folds to a pill (the user's
	// choice is kept per session) and folds by itself a few seconds after the
	// turn is over; the pill stays until the next turn.
	import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import { t } from '$lib/i18n';
	import { cardMode, pillParts, planShown, planSummary, shortPath, teamSummary, type AgentRow } from '$lib/agentProgress';
	import { roleLabel, teamNote } from './teamText';
	import type { ChatState } from '$lib/chat.svelte';
	import { sheet } from '$lib/ui/motion';
	import StateIcon from './StateIcon.svelte';
	import Elapsed from './Elapsed.svelte';

	let {
		chat,
		sessionId,
		rows,
		onOpen
	}: {
		chat: ChatState;
		/** Keys the folded state. */
		sessionId: string;
		rows: AgentRow[];
		/** Shows a subagent's own conversation (absent: rows are not links). */
		onOpen?: (row: AgentRow) => void;
	} = $props();

	const LINGER = 4000;
	const key = $derived(`lynshen-progress-folded:${sessionId}`);
	let folded = $state(false);
	$effect(() => {
		try {
			folded = localStorage.getItem(key) === '1';
		} catch {
			folded = false;
		}
	});
	function setFolded(v: boolean) {
		folded = v;
		try {
			if (v) localStorage.setItem(key, '1');
			else localStorage.removeItem(key);
		} catch {
			/* no storage */
		}
	}
	// Opened from the pill after it folded by itself: open until the next turn.
	let peek = $state(false);
	$effect(() => {
		void chat.turnStartedAt;
		peek = false;
	});

	// The clock that folds the card a few seconds after the turn ends.
	let now = $state(Date.now());
	$effect(() => {
		const end = chat.turnEndedAt;
		now = Date.now();
		if (!end) return;
		const left = end + LINGER - now;
		if (left <= 0) return;
		const timer = setTimeout(() => (now = Date.now()), left + 30);
		return () => clearTimeout(timer);
	});

	const plan = $derived(planSummary(chat.plan, chat.team));
	const planFresh = $derived(chat.turnStartedAt > 0 && chat.planAt >= chat.turnStartedAt);
	const showPlan = $derived(planShown(plan, chat.busy, planFresh));
	const mode = $derived(
		cardMode({
			plan,
			rows,
			busy: chat.busy,
			fold: folded ? 'folded' : peek ? 'open' : 'auto',
			endedAt: chat.turnEndedAt,
			now,
			planFresh
		})
	);
	const pill = $derived(pillParts(plan, rows, showPlan));
	const summary = $derived(teamSummary(plan, rows, chat.teamBudget, showPlan));
	const summaryParts = $derived.by(() => {
		const parts: { text: string; budget?: 'ok' | 'warn' | 'over' }[] = [];
		if (summary.steps) parts.push({ text: t('chat.progress.stepsDone', summary.steps) });
		if (summary.running) parts.push({ text: t('chat.progress.runningAgentsN', { n: summary.running }) });
		else if (summary.agents) parts.push({ text: t('chat.progress.agentsN', { n: summary.agents }) });
		if (summary.budget)
			parts.push({ text: t('chat.progress.budget', { used: summary.budget.used, limit: summary.budget.limit }), budget: summary.budget.level });
		return parts;
	});
	const ownerRow = (agent: string) => (agent ? rows.find((r) => r.id === agent) : undefined);

	function unfold() {
		if (folded) setFolded(false);
		peek = true;
	}
	function fold() {
		peek = false;
		setFolded(true);
	}
	const agentTitle = (r: AgentRow) => [r.label, r.role ? roleLabel(r.role) : '', r.model, activityOf(r)].filter(Boolean).join(' · ');
	/** The team's word for its state wins over its latest action. */
	const activityOf = (r: AgentRow) => teamNote(r) || r.activity;
</script>

{#if mode === 'pill'}
	<button class="pill" in:sheet={{ y: -6 }} onclick={unfold} aria-label={t('chat.progress.unfold')} title={t('chat.progress.unfold')}>
		{#if pill.running || chat.busy}<CircleNotchIcon size={13} class="spin" />{:else}<ListChecksIcon size={13} />{/if}
		{#if pill.steps}<span class="num">{pill.steps}</span>{/if}
		{#if pill.steps && pill.agents}<span class="dot">·</span>{/if}
		{#if pill.agents}<span>{pill.running ? t('chat.progress.runningN', { n: pill.running }) : t('chat.progress.agentsN', { n: pill.agents })}</span>{/if}
	</button>
{:else if mode === 'card'}
	<section class="card" in:sheet={{ y: -8 }} aria-label={t('chat.progress.label')}>
		<header>
			<span class="title">{t('chat.progress.label')}</span>
			<span class="grow"></span>
			<button class="fold" onclick={fold} aria-label={t('chat.progress.fold')} title={t('chat.progress.fold')}><CaretUpIcon size={14} /></button>
		</header>
		{#if summaryParts.length}
			<!-- One line; a narrow card wraps it between parts, never inside one. -->
			<p class="summary">
				{#each summaryParts as p, i (i)}
					<span class="part" class:num={!!p.budget} class:warn={p.budget === 'warn'} class:over={p.budget === 'over'} title={p.budget ? t('chat.progress.budgetTitle') : undefined}
						>{p.text}{#if i < summaryParts.length - 1}<span class="dot">·</span>{/if}</span
					>
				{/each}
			</p>
		{/if}
		<div class="body">
			{#if showPlan}
				<div class="sec">{t('chat.progress.todo')}</div>
				<ol class="steps">
					{#each plan.steps as s, i (i)}
						{@const owner = ownerRow(s.agent)}
						<li class="step {s.state}" class:current={i === plan.current} aria-current={i === plan.current ? 'step' : undefined}>
							<StateIcon state={s.state} size={14} label={t(`chat.progress.step.${s.state}`)} />
							<span class="stext" title={s.files.length ? s.files.join('\n') : undefined}>{s.text}</span>
							{#if s.agent}
								<button
									class="owner"
									disabled={!onOpen || !owner}
									onclick={() => owner && onOpen?.(owner)}
									title={t('chat.progress.owner', { name: shortPath(s.agent) })}
									aria-label={t('chat.progress.owner', { name: shortPath(s.agent) })}
								>
									{#if owner}<StateIcon state={owner.state} size={11} />{/if}
									<span>{owner?.label ?? shortPath(s.agent)}</span>
								</button>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
			{#if rows.length}
				<div class="sec">{t('chat.progress.agents')}<span class="num">{rows.length}</span></div>
				<ul class="agents">
					{#each rows as r (r.id)}
						<li>
							<button
								class="agent"
								disabled={!onOpen}
								onclick={() => onOpen?.(r)}
								title={agentTitle(r)}
								aria-label={t('chat.progress.open', { name: r.label })}
							>
								<StateIcon state={r.state} size={14} label={t(`dock.agents.state.${r.state}`)} />
								<span class="acol">
									<span class="aline">
										<span class="aname">{r.label}</span>
										{#if r.role}<span class="arole" title={t('chat.team.roleTitle', { role: r.role })}>{roleLabel(r.role)}</span>{/if}
										{#if r.model}<span class="amodel">{r.model.replace(/^claude-/, '')}</span>{/if}
										{#if r.progress}<span class="amodel num">{r.progress.done}/{r.progress.total}</span>{/if}
										<span class="grow"></span>
										<Elapsed row={r} />
									</span>
									<span class="act" class:err={r.state === 'failed'} class:warn={!!teamNote(r)}>{activityOf(r) || t('chat.progress.noActivity')}</span>
								</span>
								{#if onOpen}<span class="go"><CaretRightIcon size={12} /></span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
{/if}

<style>
	.card,
	.pill {
		position: absolute;
		top: 10px;
		right: 14px;
		z-index: 6;
		background: var(--panel);
		box-shadow: var(--shadow-float);
	}
	.card {
		display: flex;
		flex-direction: column;
		width: min(360px, calc(100% - 28px));
		max-height: min(60%, 520px);
		border-radius: var(--r-lg);
		overflow: hidden;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r-full);
		color: var(--dim);
		font-size: var(--fs-xs);
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease-out),
			box-shadow var(--t-med) var(--ease-out);
	}
	.pill:hover {
		color: var(--text);
		box-shadow: var(--shadow-float-strong);
	}
	.dot {
		color: var(--dim2);
	}
	.num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 8px 6px 14px;
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		row-gap: 2px;
		margin: 0;
		padding: 0 14px 6px;
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.part {
		white-space: nowrap;
	}
	.part .dot {
		margin: 0 5px;
		color: var(--dim2);
	}
	.part.warn {
		color: var(--warn);
	}
	.part.over {
		color: var(--err);
	}
	.grow {
		flex: 1;
	}
	.fold {
		display: inline-flex;
		padding: 4px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.fold:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.body {
		overflow-y: auto;
		padding: 0 6px 8px;
	}
	.sec {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 6px 8px 4px;
		font-size: var(--fs-2xs);
		font-weight: 500;
		color: var(--dim2);
	}
	.sec .num {
		font-weight: 400;
	}
	.steps,
	.agents {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.step {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 4px 8px;
		border-radius: var(--r-md);
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	.step :global(.si) {
		margin-top: 1px;
	}
	.step.current {
		background: var(--surface2);
		color: var(--text);
		font-weight: 500;
	}
	.step.done .stext {
		color: var(--dim);
	}
	.step.skipped .stext {
		text-decoration: line-through;
		color: var(--dim2);
	}
	.stext {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.owner {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 4px;
		max-width: 110px;
		margin: 1px -4px 0 0;
		padding: 0 4px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		font-weight: 400;
		line-height: 1.5;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.owner span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.owner:disabled {
		cursor: default;
	}
	.owner:hover:not(:disabled) {
		background: color-mix(in oklab, var(--text) 8%, transparent);
		color: var(--text);
	}
	.agent {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.agent:disabled {
		cursor: default;
	}
	.agent:hover:not(:disabled) {
		background: var(--surface2);
	}
	.agent :global(.si) {
		margin-top: 2px;
	}
	.acol {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: 1;
		min-width: 0;
	}
	.aline {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}
	.aname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		font-weight: 500;
	}
	.amodel {
		flex: none;
		max-width: 110px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.act {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.act.err {
		color: var(--err);
	}
	.act.warn {
		color: var(--warn);
	}
	.arole {
		flex: none;
		padding: 0 5px;
		border-radius: var(--r-xs);
		background: var(--surface2);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.go {
		display: inline-flex;
		margin-top: 3px;
		color: var(--dim2);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.agent:hover .go,
	.agent:focus-visible .go {
		opacity: 1;
	}
</style>
