<script lang="ts">
	// Usage page: this computer's coding-agent token usage over a chosen range
	// (the daemon's record, every engine) — totals, a daily bar chart (hover
	// for the day's numbers) and the split by channel, model, agent or project.
	import { onMount } from 'svelte';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import SettingsSection from '$lib/settings/SettingsSection.svelte';
	import { daemon, fetchLocalUsage, type UsageSummary, type UsageTokens } from '$lib/protocol';
	import { dayRange, EMPTY_TOKENS, fmtTokens, groupChannels, importLegacyUsage, totalTokens } from '$lib/usageStats';
	import { isBackendId } from '$lib/backends';
	import { t } from '$lib/i18n';

	type Dim = 'channel' | 'model' | 'engine' | 'project';

	let range = $state('30');
	let dim = $state<Dim>('channel');
	let hover = $state<number | null>(null);
	let summary = $state<UsageSummary | null>(null);
	let error = $state('');
	let expanded = $state<Record<string, boolean>>({ lynshen: true });
	let ready = $state(false);

	async function load(days: number) {
		error = '';
		try {
			const next = await fetchLocalUsage(days);
			if (Number(range) === days) summary = next;
		} catch (e) {
			summary = null;
			error = t('settings.overview.loadFailed', { msg: e instanceof Error ? e.message : String(e) });
		}
	}

	onMount(async () => {
		// Older versions counted usage here; the daemon keeps it now.
		await importLegacyUsage((op) => daemon.request(op)).catch(() => {});
		ready = true;
	});
	$effect(() => {
		if (ready) void load(Number(range));
	});

	const byDay = $derived(new Map((summary?.days ?? []).map((d) => [d.day, d])));
	const days = $derived(dayRange(Number(range)).map((key) => ({ key, u: byDay.get(key) ?? EMPTY_TOKENS })));
	const totals = $derived(summary?.totals ?? EMPTY_TOKENS);
	const active = $derived(days.filter((d) => totalTokens(d.u) > 0).length);
	const peak = $derived(Math.max(1, ...days.map((d) => totalTokens(d.u))));
	const hovered = $derived(hover === null ? null : days[hover]);

	const channels = $derived(groupChannels(summary?.by_channel ?? []));
	type Row = { key: string; label: string; usage: UsageTokens; icon: 'model' | 'engine' | 'none'; title?: string };
	const rows = $derived.by((): Row[] => {
		const s = summary;
		if (!s) return [];
		const list: Row[] =
			dim === 'model'
				? s.by_model.map((r) => ({ key: r.model, label: r.model || t('settings.overview.other'), usage: r, icon: 'model' }))
				: dim === 'engine'
					? s.by_engine.map((r) => ({ key: r.engine, label: engineName(r.engine), usage: r, icon: 'engine' }))
					: (s.by_project ?? []).map((r) => ({
							key: r.cwd,
							label: r.cwd ? (r.cwd.split(/[\\/]/).filter(Boolean).pop() ?? r.cwd) : t('settings.overview.unknownProject'),
							title: r.cwd,
							usage: r,
							icon: 'none'
						}));
		return list.sort((a, b) => totalTokens(b.usage) - totalTokens(a.usage));
	});
	const rowsTotal = $derived(totalTokens(totals) || 1);

	const ENGINE_NAMES: Record<string, string> = { lynshen: 'LynShen', claude: 'Claude Code', codex: 'Codex', acp: 'ACP' };
	const engineName = (key: string) => ENGINE_NAMES[key] ?? key;
	const KIND_KEYS: Record<string, string> = {
		lynshen: 'settings.overview.kindLynShen',
		third_party: 'settings.overview.kindThirdParty',
		local: 'settings.overview.kindLocal',
		legacy: 'settings.overview.kindLegacy'
	};
	const pct = (n: number) => `${Math.round((n / rowsTotal) * 1000) / 10}%`;
	const shortDate = (key: string) => {
		const [, m, d] = key.split('-');
		return t('settings.overview.date', { m: Number(m), d: Number(d) });
	};
	const RANGES = $derived([
		{ value: '7', label: t('settings.overview.range', { n: 7 }) },
		{ value: '30', label: t('settings.overview.range', { n: 30 }) },
		{ value: '90', label: t('settings.overview.range', { n: 90 }) }
	]);
	const DIMS = $derived([
		{ value: 'channel', label: t('settings.overview.dimProvider') },
		{ value: 'model', label: t('settings.overview.dimModel') },
		{ value: 'engine', label: t('settings.overview.dimAgent') },
		{ value: 'project', label: t('settings.overview.dimProject') }
	]);
</script>

{#snippet cells(u: UsageTokens)}
	<span class="share">
		<span class="track"><span class="fill" style:width={pct(totalTokens(u))}></span></span>
		<span class="p">{pct(totalTokens(u))}</span>
	</span>
	<span class="n">{fmtTokens(u.input_tokens)}</span>
	<span class="n cache">{fmtTokens(u.cached_input_tokens)}</span>
	<span class="n">{fmtTokens(u.output_tokens)}</span>
	<span class="n strong">{fmtTokens(totalTokens(u))}</span>
{/snippet}

<div class="bar">
	<Segmented value={range} options={RANGES} onChange={(v) => ((range = v), (hover = null))} />
</div>

{#if error}<div class="err"><Notice>{error}</Notice></div>{/if}

<SettingsSection id="usage-daily">
	<div class="stats">
		<div class="stat">
			<span class="label">{t('settings.overview.total')}</span>
			<span class="num">{fmtTokens(totalTokens(totals))}</span>
			<span class="sub">{t('settings.overview.perActiveDay', { n: fmtTokens(active ? Math.round(totalTokens(totals) / active) : 0) })}</span>
		</div>
		<div class="stat">
			<span class="label">{t('settings.overview.input')}</span>
			<span class="num">{fmtTokens(totals.input_tokens)}</span>
			<span class="sub">{t('settings.overview.cachedOf', { n: fmtTokens(totals.cached_input_tokens) })}</span>
		</div>
		<div class="stat">
			<span class="label">{t('settings.overview.output')}</span>
			<span class="num">{fmtTokens(totals.output_tokens)}</span>
			<span class="sub">{t('settings.overview.turns', { n: totals.turns })}</span>
		</div>
		<div class="stat">
			<span class="label">{t('settings.overview.activeDays')}</span>
			<span class="num">{active}<span class="of">/{days.length}</span></span>
		</div>
	</div>
	<div class="chart" role="img" aria-label={t('settings.overview.chartLabel')} onpointerleave={() => (hover = null)}>
		<div class="tipline">
			{#if hovered}
				<span class="tdate">{shortDate(hovered.key)}</span>
				<span>{t('settings.overview.input')} {fmtTokens(hovered.u.input_tokens)}</span>
				<span class="tcache">{t('settings.overview.cache')} {fmtTokens(hovered.u.cached_input_tokens)}</span>
				<span>{t('settings.overview.output')} {fmtTokens(hovered.u.output_tokens)}</span>
				<span class="ttotal">{fmtTokens(totalTokens(hovered.u))}</span>
			{:else}
				<span class="dim">{t('settings.overview.peak', { n: fmtTokens(peak === 1 ? 0 : peak) })}</span>
			{/if}
		</div>
		<div class="bars" style:--gap="{days.length > 45 ? 2 : 4}px">
			{#each days as x, i (x.key)}
				{@const v = totalTokens(x.u)}
				<div class="col" class:on={hover === i} role="presentation" onpointerenter={() => (hover = i)}>
					<!-- The cached part of the day's input, shaded at the bar's foot. -->
					<div class="b" class:zero={v === 0} style:height="{v ? Math.max(3, (v / peak) * 100) : 0}%">
						{#if v}<div class="bc" style:height="{Math.min(100, (x.u.cached_input_tokens / v) * 100)}%"></div>{/if}
					</div>
				</div>
			{/each}
		</div>
		<div class="legend">
			<span><i class="sw"></i>{t('settings.overview.uncached')}</span>
			<span><i class="sw cache"></i>{t('settings.overview.cache')}</span>
		</div>
		<div class="axis">
			<span>{shortDate(days[0].key)}</span>
			<span>{shortDate(days[Math.floor(days.length / 2)].key)}</span>
			<span>{t('settings.overview.today')}</span>
		</div>
	</div>
</SettingsSection>

<SettingsSection id="usage-detail" title={t('settings.overview.breakdownTitle')}>
	{#snippet action()}
		<Segmented value={dim} options={DIMS} onChange={(v) => (dim = v as Dim)} />
	{/snippet}
	{#if dim === 'channel' ? channels.length : rows.length}
		<div class="table">
			<div class="tr th">
				<span class="name">{t('settings.overview.colName')}</span>
				<span class="share">{t('settings.overview.colShare')}</span>
				<span class="n">{t('settings.overview.input')}</span>
				<span class="n">{t('settings.overview.cache')}</span>
				<span class="n">{t('settings.overview.output')}</span>
				<span class="n">{t('settings.overview.total')}</span>
			</div>
			{#if dim === 'channel'}
				{#each channels as g (g.kind)}
					<button class="tr group" aria-expanded={!!expanded[g.kind]} onclick={() => (expanded[g.kind] = !expanded[g.kind])}>
						<span class="name">
							<span class="ico caret" class:open={expanded[g.kind]}><CaretRightIcon size={12} /></span>
							<span class="nm">{t(KIND_KEYS[g.kind])}</span>
						</span>
						{@render cells(g.usage)}
					</button>
					{#if expanded[g.kind]}
						{#each g.rows as r (r.key)}
							<div class="tr sub">
								<span class="name">
									<span class="ico">{#if g.kind !== 'lynshen'}<Vendor provider={r.key} size={16} />{/if}</span>
									<span class="nm">{g.kind === 'lynshen' ? r.key || t('settings.overview.defaultGroup') : r.key}</span>
								</span>
								{@render cells(r.usage)}
							</div>
						{/each}
					{/if}
				{/each}
			{:else}
				{#each rows as r (r.key)}
					<div class="tr">
						<span class="name" title={r.title}>
							<span class="ico">
								{#if r.icon === 'model'}<Vendor model={r.key} size={16} />
								{:else if r.icon === 'engine' && isBackendId(r.key)}<BackendIcon backend={r.key as never} size={16} />{/if}
							</span>
							<span class="nm">{r.label}</span>
						</span>
						{@render cells(r.usage)}
					</div>
				{/each}
			{/if}
		</div>
	{:else}
		<p class="empty">{t('settings.overview.noData')}</p>
	{/if}
</SettingsSection>

<style>
	/* The range picker sits on the page title's line, at the right. */
	.bar {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: -32px;
	}
	.err {
		margin: 12px 0 0;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 16px;
		padding: 4px 0 18px;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.label {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.num {
		color: var(--text);
		font-size: var(--fs-xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.of {
		color: var(--dim2);
		font-size: var(--fs-sm);
		font-weight: 400;
	}
	.sub {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.chart {
		padding: 14px 0 12px;
	}
	.tipline {
		display: flex;
		gap: 14px;
		height: 20px;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.tdate,
	.ttotal {
		color: var(--text);
		font-weight: 500;
	}
	.ttotal {
		margin-left: auto;
	}
	.dim {
		color: var(--dim2);
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: var(--gap);
		height: 140px;
		margin-top: 8px;
	}
	.col {
		display: flex;
		flex: 1;
		align-items: flex-end;
		height: 100%;
		border-radius: var(--r-xs);
	}
	.col.on {
		background: var(--surface2);
	}
	.b {
		display: flex;
		align-items: flex-end;
		width: 100%;
		overflow: hidden;
		border-radius: var(--r-xs);
		background: var(--text);
		opacity: 0.78;
		transition:
			height var(--t-med) var(--ease-out),
			opacity var(--t-fast) var(--ease-out);
	}
	.col.on .b {
		opacity: 1;
	}
	/* The cached share of the day: the accent at the bar's foot. */
	.bc {
		width: 100%;
		background: var(--accent);
	}
	.legend {
		display: flex;
		gap: 14px;
		margin-top: 8px;
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.sw {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--text);
		opacity: 0.78;
	}
	.sw.cache {
		background: var(--accent);
		opacity: 1;
	}
	.tcache {
		color: var(--accent);
	}
	.n.cache {
		color: var(--dim);
	}
	.b.zero {
		height: 2px !important;
		background: var(--hairline);
		opacity: 1;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin-top: 8px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.table {
		display: flex;
		flex-direction: column;
	}
	.tr {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1.2fr) 64px 64px 64px 72px;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 0 4px;
		font-size: var(--fs-sm);
	}
	.tr + .tr {
		border-top: 1px solid var(--hairline);
	}
	button.tr {
		width: 100%;
		border: 0;
		border-top: 1px solid var(--hairline);
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	button.tr:hover {
		background: var(--surface2);
	}
	.tr.sub {
		min-height: 40px;
	}
	.tr.sub .name {
		padding-left: 26px;
	}
	.th {
		min-height: 38px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.name {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.ico {
		display: inline-flex;
		width: 16px;
		flex-shrink: 0;
		justify-content: center;
		color: var(--dim);
	}
	.caret {
		transition: transform var(--t-fast) var(--ease-out);
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.th .name {
		padding-left: 26px;
	}
	.nm {
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.group .nm {
		font-weight: 500;
	}
	.share {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.track {
		flex: 1;
		height: 6px;
		overflow: hidden;
		border-radius: var(--r-full);
		background: var(--surface2);
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: var(--r-full);
		background: var(--text);
		opacity: 0.7;
	}
	.p {
		width: 44px;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.n {
		color: var(--dim);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.n.strong {
		color: var(--text);
		font-weight: 500;
	}
	.empty {
		margin: 0;
		padding: 18px 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
</style>
