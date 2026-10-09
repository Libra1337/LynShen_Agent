// Agent team v2 is a Beta that can be switched off at any time: by the user
// on this machine (Settings → 工作组, prefs.teamV2) and by LynShen for
// everyone (`features.json` next to the update feed, `{"team_v2": true}`).
// The engine gets both together as config.json `agents.team_v2` and works as
// the v1 team while it is false.
import { invoke } from '@tauri-apps/api/core';
import { readConfig, writeConfig } from '$lib/protocol';
import { prefs } from '$lib/prefs.svelte';

/** localStorage: the remote switches as last read. */
const KEY = 'lynshen-features';

/** `features.json` next to each update feed's `latest.json` (the way
 *  app_update.rs puts `/policy` there), in the feeds' order, once each. */
export function featuresUrls(feeds: string[]): string[] {
	const out: string[] = [];
	for (const feed of feeds) {
		const url = feed.trim().replace(/\/latest\.json$/, '/features.json');
		if (url.endsWith('/features.json') && !out.includes(url)) out.push(url);
	}
	return out;
}

/** LynShen's switch in `features` (features.json): its boolean `team_v2`;
 *  `last` when there is none (no file, offline, an unknown shape). */
export function remoteTeamV2(features: unknown, last: boolean): boolean {
	if (features && typeof features === 'object' && !Array.isArray(features)) {
		const v = (features as Record<string, unknown>).team_v2;
		if (typeof v === 'boolean') return v;
	}
	return last;
}

/** What the engine gets: on only while LynShen and the user both have it on. */
export const effectiveTeamV2 = (remote: boolean, local: boolean) => remote && local;

/** The config.json patch that sets `agents.team_v2` to `on` (the other
 *  `agents` keys as they are); null when config.json already says so (no
 *  key is on, the engine's default) or has nothing yet (the engine writes
 *  its defaults first, and a file of `agents` alone would replace them). */
export function teamV2Patch(cfg: Record<string, unknown> | null, on: boolean): Record<string, unknown> | null {
	if (!cfg || typeof cfg !== 'object' || !Object.keys(cfg).length) return null;
	const agents = cfg.agents && typeof cfg.agents === 'object' && !Array.isArray(cfg.agents) ? (cfg.agents as Record<string, unknown>) : {};
	const current = typeof agents.team_v2 === 'boolean' ? agents.team_v2 : true;
	return current === on ? null : { agents: { ...agents, team_v2: on } };
}

function loadRemote(): boolean {
	try {
		return remoteTeamV2(JSON.parse(localStorage.getItem(KEY) || '{}'), true);
	} catch {
		return true;
	}
}

export class TeamSwitch {
	/** LynShen's switch as last read; on until features.json says otherwise. */
	remote = $state(loadRemote());
	#writes: Promise<void> = Promise.resolve();

	/** What the engine runs with (config.json `agents.team_v2`). */
	get on() {
		return effectiveTeamV2(this.remote, prefs.teamV2);
	}

	/** Reads features.json (on launch and every 10 minutes, with the update
	 *  check), then brings config.json in line. */
	async refresh() {
		try {
			const feeds = await invoke<string[]>('update_feeds');
			const features = await invoke<unknown>('feature_flags', { urls: featuresUrls(feeds) });
			this.#setRemote(remoteTeamV2(features, this.remote));
		} catch {
			// Not in the app, or no answer: the last known value stays.
		}
		await this.apply();
	}

	/** The user's own switch. */
	setLocal(on: boolean) {
		prefs.setTeamV2(on);
		return this.apply();
	}

	/** Writes the effective value to config.json when it differs from what
	 *  the file says, one write at a time. */
	apply(): Promise<void> {
		this.#writes = this.#writes
			.then(async () => {
				const patch = teamV2Patch(await readConfig(), this.on);
				if (patch) await writeConfig(patch);
			})
			.catch(() => {});
		return this.#writes;
	}

	#setRemote(on: boolean) {
		this.remote = on;
		try {
			localStorage.setItem(KEY, JSON.stringify({ team_v2: on }));
		} catch {
			/* no storage: kept for this run */
		}
	}
}

export const teamSwitch = new TeamSwitch();
