<script lang="ts">
	// Settings → 工作组: whether the main agent starts subagents
	// (`agents.fanout`), how many run at once and how deep, the token budget
	// of a turn, how long unmerged worktrees stay — config.json `agents.*`,
	// written ~500 ms after a change — and the roles a subagent can take,
	// read from the role files (built-in, the user's, the project's).
	import { onDestroy, onMount } from 'svelte';
	import { homeDir, join } from '@tauri-apps/api/path';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { listDir, readConfig, readText, writeConfig, type FsEntry } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import { toast } from '$lib/ui/toast.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import { FANOUTS, TEAM_DEFAULTS, readTeamConfig, teamPatch, type Fanout } from '$lib/agents/teamConfig';
	import { listRoles, parseRole, type RoleInfo, type RoleSource } from '$lib/agents/roles';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	/** The active project, whose `.lynshen/roles` is listed ('' for none). */
	let { project = '' }: { project?: string } = $props();

	type NumberField = number | string | undefined;
	let form = $state<{ fanout: Fanout; max_live: NumberField; max_depth: NumberField; turn_token_budget: NumberField; keep_worktrees_days: NumberField }>({
		...TEAM_DEFAULTS
	});
	const fanoutOpts = $derived(FANOUTS.map((v) => ({ value: v, label: t(`settings.team.fanoutOpt.${v}`) })));

	// config.json's `agents` as last read or written: keys this page does not
	// show are written back as they are.
	let agents: unknown = {};
	let loaded = $state(false);
	let written = '';
	let pending: Record<string, unknown> | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	onMount(async () => {
		const cfg = ((await readConfig().catch(() => null)) ?? {}) as Record<string, unknown>;
		agents = cfg.agents;
		form = { ...readTeamConfig(cfg) };
		written = JSON.stringify(teamPatch(agents, form));
		loaded = true;
	});

	function flush() {
		clearTimeout(timer);
		if (!pending) return;
		const next = pending;
		pending = null;
		agents = next;
		written = JSON.stringify(next);
		writeConfig({ agents: next }).catch((e) => toast.error(t('settings.page.saveFailed', { msg: String(e) })));
	}
	$effect(() => {
		if (!loaded) return;
		const next = teamPatch(agents, { ...form });
		if (JSON.stringify(next) === written) return;
		pending = next;
		clearTimeout(timer);
		timer = setTimeout(flush, 500);
	});
	onDestroy(flush);

	// ---------- roles ----------
	let roles = $state<RoleInfo[]>(listRoles([], []));
	let reading = $state(false);

	async function readRoles(dir: string, source: Exclude<RoleSource, 'builtin'>): Promise<RoleInfo[]> {
		const entries = await listDir(dir, dir).catch(() => [] as FsEntry[]);
		const files = entries.filter((e) => !e.is_dir && /\.md$/i.test(e.name));
		return Promise.all(
			files.map(async (f) => {
				// A file the app cannot read still lists, by its name.
				const text = await readText(f.path).catch(() => '');
				return { ...parseRole(text, f.name), source, path: f.path, shadowedBy: null };
			})
		);
	}
	async function loadRoles(dir: string) {
		reading = true;
		try {
			const home = await homeDir().catch(() => '');
			const [user, own] = await Promise.all([
				home ? readRoles(await join(home, '.lynshen', 'roles'), 'user') : Promise.resolve([]),
				dir ? readRoles(await join(dir, '.lynshen', 'roles'), 'project') : Promise.resolve([])
			]);
			roles = listRoles(user, own);
		} finally {
			reading = false;
		}
	}
	$effect(() => {
		void loadRoles(project);
	});
	const describe = (r: RoleInfo) =>
		r.source === 'builtin' ? t(`settings.team.builtin.${r.name}`) : r.description || t('settings.team.noDescription');
</script>

<SettingsSection>
	<SettingsRow id="team-fanout" title={t('settings.team.fanout')} description={t(`settings.team.fanoutHint.${form.fanout}`)}>
		<Segmented bind:value={form.fanout} options={fanoutOpts} />
	</SettingsRow>
</SettingsSection>

<SettingsSection title={t('settings.team.limits')}>
	<SettingsRow id="team-max-live" title={t('settings.team.maxLive')} description={t('settings.team.maxLiveHint')}>
		<div class="w-num"><TextField bind:value={form.max_live} type="number" align="right" /></div>
	</SettingsRow>
	<SettingsRow id="team-max-depth" title={t('settings.team.maxDepth')} description={t('settings.team.maxDepthHint')}>
		<div class="w-num"><TextField bind:value={form.max_depth} type="number" align="right" /></div>
	</SettingsRow>
	<SettingsRow id="team-budget" title={t('settings.team.budget')} description={t('settings.team.budgetHint')}>
		<div class="w-wide"><TextField bind:value={form.turn_token_budget} type="number" align="right" mono /></div>
		<span class="unit">{t('settings.team.tokensUnit')}</span>
	</SettingsRow>
	<SettingsRow id="team-keep-worktrees" title={t('settings.team.keepDays')} description={t('settings.team.keepDaysHint')}>
		<div class="w-num"><TextField bind:value={form.keep_worktrees_days} type="number" align="right" /></div>
		<span class="unit">{t('settings.team.days')}</span>
	</SettingsRow>
</SettingsSection>

<SettingsSection id="team-roles" title={t('settings.team.roles')}>
	{#snippet action()}
		<button class="iconbtn" title={t('settings.team.refreshRoles')} aria-label={t('settings.team.refreshRoles')} disabled={reading} onclick={() => loadRoles(project)}>
			{#if reading}<CircleNotchIcon size={14} class="spin" />{:else}<ArrowsClockwiseIcon size={14} />{/if}
		</button>
	{/snippet}
	{#each roles as r (`${r.source}:${r.path || r.name}`)}
		<div class="role" class:shadowed={!!r.shadowedBy} title={r.path || undefined}>
			<div class="rhead">
				<span class="rname">{r.name}</span>
				<span class="rsrc">{t(`settings.team.source.${r.source}`)}</span>
				{#if r.model}<span class="rmeta">{r.model}</span>{/if}
			</div>
			<p class="rdesc">{describe(r)}</p>
			{#if r.shadowedBy}<p class="rnote">{t(`settings.team.shadowed.${r.shadowedBy}`)}</p>{/if}
		</div>
	{/each}
	<p class="hint">{t('settings.team.rolesHint')}</p>
</SettingsSection>

<style>
	.w-num {
		width: 96px;
	}
	.w-wide {
		width: 140px;
	}
	.unit {
		min-width: 1.5em;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.iconbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.iconbtn:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.iconbtn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.role {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px 0;
	}
	.rhead {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}
	.rname {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		font-weight: 500;
		color: var(--text);
	}
	.rsrc {
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.rmeta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.rdesc,
	.rnote,
	.hint {
		margin: 0;
		max-width: 64ch;
		font-size: var(--fs-xs);
		line-height: 1.45;
		color: var(--dim);
	}
	.rnote {
		color: var(--warn);
	}
	.role.shadowed .rname {
		color: var(--dim);
		text-decoration: line-through;
	}
	.hint {
		padding: 12px 0;
	}
</style>
