<script lang="ts">
	// Settings → 工作组: the agent team v2 Beta switch (agents/teamSwitch),
	// whether the main agent starts subagents (`agents.fanout`), how many run
	// at once and how deep, the token budget of a turn, how long unmerged
	// worktrees stay, what happens when a subagent finishes — config.json
	// `agents.*`, written ~500 ms after a change — the roles a subagent can
	// take, read from the role files (built-in, the user's, the project's),
	// and the team's shell hooks in ~/.lynshen/hooks.json (`task_completed`,
	// `agent_idle`). With v2 off, its settings (what happens when work
	// finishes, the hooks) are not shown.
	import { onDestroy, onMount } from 'svelte';
	import { homeDir, join } from '@tauri-apps/api/path';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { listDir, readConfig, readHooks, readText, writeConfig, writeHooks, type FsEntry } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import { toast } from '$lib/ui/toast.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { FANOUTS, TEAM_DEFAULTS, readTeamConfig, teamPatch, type Fanout } from '$lib/agents/teamConfig';
	import { listRoles, parseRole, type RoleInfo, type RoleSource } from '$lib/agents/roles';
	import { listHooks, TEAM_HOOKS, validHookList, withHook, withoutHook, type TeamHook } from '$lib/agents/teamHooks';
	import { teamSwitch } from '$lib/agents/teamSwitch.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	/** The active project, whose `.lynshen/roles` is listed ('' for none). */
	let { project = '' }: { project?: string } = $props();

	type NumberField = number | string | undefined;
	let form = $state<{
		fanout: Fanout;
		max_live: NumberField;
		max_depth: NumberField;
		turn_token_budget: NumberField;
		keep_worktrees_days: NumberField;
		wake_on_result: boolean;
		review_on_complete: boolean;
	}>({
		...TEAM_DEFAULTS
	});
	const fanoutOpts = $derived(FANOUTS.map((v) => ({ value: v, label: t(`settings.team.fanoutOpt.${v}`) })));

	// config.json's `agents` as last read or written; a write reads the file
	// again, so keys this page does not show (`team_v2`, which the Beta switch
	// writes) stay as the file has them then.
	let agents: unknown = {};
	let loaded = $state(false);
	let written = '';
	let pending: typeof form | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	onMount(async () => {
		const cfg = ((await readConfig().catch(() => null)) ?? {}) as Record<string, unknown>;
		agents = cfg.agents;
		form = { ...readTeamConfig(cfg) };
		written = JSON.stringify(teamPatch(agents, form));
		loaded = true;
		// config.json may have come after the launch (a first run).
		void teamSwitch.apply();
	});

	async function flush() {
		clearTimeout(timer);
		if (!pending) return;
		const changed = pending;
		pending = null;
		try {
			const fresh = ((await readConfig().catch(() => null)) ?? {}) as Record<string, unknown>;
			const next = teamPatch(fresh.agents ?? agents, changed);
			agents = next;
			written = JSON.stringify(next);
			await writeConfig({ agents: next });
			// A switch written in between is not lost.
			void teamSwitch.apply();
		} catch (e) {
			toast.error(t('settings.page.saveFailed', { msg: String(e) }));
		}
	}
	$effect(() => {
		if (!loaded) return;
		const changed = { ...form };
		if (JSON.stringify(teamPatch(agents, changed)) === written) return;
		pending = changed;
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

	// ---------- hooks ----------
	// hooks.json as last read; the page changes its two team keys only, each
	// time on a fresh read of the file (a file that does not parse is left
	// alone, and the page says so).
	let hooks = $state<Record<string, unknown>>({});
	let hooksError = $state('');
	let hooksBusy = $state(false);
	let drafts = $state<Record<TeamHook, string>>({ task_completed: '', agent_idle: '' });

	async function loadHooks() {
		hooksBusy = true;
		try {
			hooks = await readHooks();
			hooksError = '';
		} catch (e) {
			hooksError = String(e);
		} finally {
			hooksBusy = false;
		}
	}
	onMount(loadHooks);

	/** Reads the file again, applies `change` to its `key`, checks the list
	 *  and writes that key only. */
	async function changeHook(key: TeamHook, change: (fresh: Record<string, unknown>) => unknown[] | null): Promise<boolean> {
		hooksBusy = true;
		try {
			const fresh = await readHooks();
			const next = change(fresh);
			if (!next || !validHookList(next)) {
				hooks = fresh;
				return false;
			}
			await writeHooks({ [key]: next });
			hooks = { ...fresh, [key]: next };
			hooksError = '';
			return true;
		} catch (e) {
			toast.error(t('settings.team.hooksSaveFailed', { msg: String(e) }));
			return false;
		} finally {
			hooksBusy = false;
		}
	}
	async function addHook(key: TeamHook) {
		const command = drafts[key].trim();
		if (!command) return;
		if (await changeHook(key, (fresh) => withHook(fresh, key, command))) drafts[key] = '';
	}
	function removeHook(key: TeamHook, index: number, command: string) {
		void changeHook(key, (fresh) => withoutHook(fresh, key, index, command));
	}
</script>

<SettingsSection>
	<SettingsRow
		id="team-v2"
		title={t('settings.team.v2Title')}
		tag={t('settings.team.beta')}
		description={teamSwitch.remote ? t('settings.team.v2Hint') : t('settings.team.v2RemoteOff')}
	>
		<Switch checked={teamSwitch.on} disabled={!teamSwitch.remote} label={t('settings.team.v2')} onChange={(on) => teamSwitch.setLocal(on)} />
	</SettingsRow>
	<SettingsRow id="team-fanout" title={t('settings.team.fanout')} description={t(`settings.team.fanoutHint.${form.fanout}`)}>
		<Segmented bind:value={form.fanout} options={fanoutOpts} />
	</SettingsRow>
</SettingsSection>

{#if teamSwitch.on}
	<SettingsSection title={t('settings.team.flow')}>
		<SettingsRow id="team-wake" title={t('settings.team.wakeOnResult')} description={t('settings.team.wakeOnResultHint')}>
			<Switch bind:checked={form.wake_on_result} label={t('settings.team.wakeOnResult')} />
		</SettingsRow>
		<SettingsRow id="team-review" title={t('settings.team.reviewOnComplete')} description={t('settings.team.reviewOnCompleteHint')}>
			<Switch bind:checked={form.review_on_complete} label={t('settings.team.reviewOnComplete')} />
		</SettingsRow>
	</SettingsSection>
{/if}

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

{#if teamSwitch.on}
	<SettingsSection id="team-hooks" title={t('settings.team.hooks')}>
		{#snippet action()}
			<button class="iconbtn" title={t('settings.team.refreshHooks')} aria-label={t('settings.team.refreshHooks')} disabled={hooksBusy} onclick={loadHooks}>
				{#if hooksBusy}<CircleNotchIcon size={14} class="spin" />{:else}<ArrowsClockwiseIcon size={14} />{/if}
			</button>
		{/snippet}
		{#if hooksError}
			<div class="notice"><Notice tone="error">{t('settings.team.hooksUnreadable', { msg: hooksError })}</Notice></div>
		{/if}
		{#each TEAM_HOOKS as key (key)}
			<SettingsRow id={`team-hook-${key}`} title={t(`settings.team.hook.${key}`)} description={t(`settings.team.hookHint.${key}`)} stacked>
				<ul class="cmds">
					{#each listHooks(hooks, key) as h (h.index)}
						<li class="cmd">
							<code>{h.command}</code>
							{#if h.tools}<span class="ctools">{t('settings.team.onlyTools', { tools: h.tools.join(', ') })}</span>{/if}
							<span class="cact">
								<IconButton size="sm" label={t('settings.team.removeCommand')} title={t('settings.team.removeCommand')} disabled={hooksBusy || !!hooksError} onclick={() => removeHook(key, h.index, h.command)}>
									<XIcon size={13} />
								</IconButton>
							</span>
						</li>
					{:else}
						<li class="none">{t('settings.team.noCommands')}</li>
					{/each}
				</ul>
				<form
					class="add"
					onsubmit={(e) => {
						e.preventDefault();
						void addHook(key);
					}}
				>
					<TextField bind:value={drafts[key]} placeholder={t('settings.team.commandPlaceholder')} mono disabled={!!hooksError} />
					<Button size="sm" type="submit" disabled={hooksBusy || !!hooksError || !drafts[key].trim()}>{t('settings.team.addCommand')}</Button>
				</form>
			</SettingsRow>
		{/each}
		<p class="hint">{t('settings.team.hooksHint')}</p>
	</SettingsSection>
{/if}

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
	.notice {
		padding-top: 12px;
	}
	.cmds {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.cmd {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		min-height: 32px;
		padding: 2px 0;
	}
	.cmd code {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--text);
	}
	.ctools {
		flex: none;
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.cact {
		display: inline-flex;
		margin-left: auto;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.cmd:hover .cact,
	.cmd:focus-within .cact {
		opacity: 1;
	}
	.none {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.add {
		display: flex;
		align-items: center;
		gap: 8px;
	}
</style>
