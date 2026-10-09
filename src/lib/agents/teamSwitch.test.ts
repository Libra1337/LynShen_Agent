import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, readConfig, writeConfig } = vi.hoisted(() => ({ invoke: vi.fn(), readConfig: vi.fn(), writeConfig: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock('$lib/protocol', () => ({ readConfig, writeConfig }));

import { TeamSwitch, effectiveTeamV2, featuresUrls, remoteTeamV2, teamV2Patch } from './teamSwitch.svelte';
import { prefs } from '$lib/prefs.svelte';

const WWW = 'https://www.lynshen.org/v1/public/releases/desktop';
const API = 'https://api.lynshen.org/v1/public/releases/desktop';

describe('agent team v2 switch: the remote file', () => {
	it('sits next to each LynShen update feed, in their order, once each', () => {
		expect(featuresUrls([`${WWW}/latest.json`, `${WWW}/latest.json`, ` ${API}/latest.json `])).toEqual([`${WWW}/features.json`, `${API}/features.json`]);
		// A custom feed (desktop_update_url) comes first, like the update check.
		expect(featuresUrls(['https://cn.example.com/v1/public/releases/desktop/latest.json', `${WWW}/latest.json`])).toEqual([
			'https://cn.example.com/v1/public/releases/desktop/features.json',
			`${WWW}/features.json`
		]);
		// Anything that is not a latest.json has no features.json beside it.
		expect(featuresUrls(['https://github.com/x/y/releases/download/v1/update.json', ''])).toEqual([]);
	});

	it('says on or off with a boolean team_v2; anything else keeps the last known value', () => {
		expect(remoteTeamV2({ team_v2: false }, true)).toBe(false);
		expect(remoteTeamV2({ team_v2: true, other: 1 }, false)).toBe(true);
		// No file or no answer (null), no key, an odd value or shape.
		for (const features of [null, undefined, {}, { other: true }, { team_v2: 'no' }, [false], 'false'])
			for (const last of [true, false]) expect(remoteTeamV2(features, last)).toBe(last);
	});
});

describe('agent team v2 switch: the effective value', () => {
	it('is on only while LynShen and the user both have it on', () => {
		expect(effectiveTeamV2(true, true)).toBe(true);
		expect(effectiveTeamV2(true, false)).toBe(false);
		expect(effectiveTeamV2(false, true)).toBe(false);
		expect(effectiveTeamV2(false, false)).toBe(false);
	});

	it('patches config.json agents.team_v2 only when the file says otherwise', () => {
		const cfg = { model: 'gpt-5.5', agents: { max_live: 2 } };
		// No key is on (the engine's default).
		expect(teamV2Patch(cfg, true)).toBeNull();
		expect(teamV2Patch(cfg, false)).toEqual({ agents: { max_live: 2, team_v2: false } });
		expect(teamV2Patch({ ...cfg, agents: { max_live: 2, team_v2: false } }, false)).toBeNull();
		expect(teamV2Patch({ ...cfg, agents: { max_live: 2, team_v2: false } }, true)).toEqual({ agents: { max_live: 2, team_v2: true } });
		expect(teamV2Patch({ model: 'm', agents: 'odd' }, false)).toEqual({ agents: { team_v2: false } });
		// No config yet: the engine writes its defaults first.
		expect(teamV2Patch({}, false)).toBeNull();
		expect(teamV2Patch(null, false)).toBeNull();
	});
});

describe('TeamSwitch', () => {
	let store: Map<string, string>;
	let config: Record<string, unknown>;
	let features: unknown;

	beforeEach(() => {
		store = new Map();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
			removeItem: (key: string) => void store.delete(key)
		});
		config = { model: 'gpt-5.5', agents: { fanout: 'auto' } };
		features = { team_v2: true };
		invoke.mockReset();
		invoke.mockImplementation((cmd: string) => {
			if (cmd === 'update_feeds') return Promise.resolve([`${WWW}/latest.json`, `${API}/latest.json`]);
			if (cmd === 'feature_flags') return features instanceof Error ? Promise.reject(features) : Promise.resolve(features);
			return Promise.reject(new Error(`unexpected ${cmd}`));
		});
		readConfig.mockReset();
		readConfig.mockImplementation(() => Promise.resolve(structuredClone(config)));
		writeConfig.mockReset();
		writeConfig.mockImplementation((patch: Record<string, unknown>) => {
			config = { ...config, ...patch };
			return Promise.resolve();
		});
		prefs.setTeamV2(true);
	});

	it('starts on, reads features.json next to the feeds and writes nothing while all is on', async () => {
		const sw = new TeamSwitch();
		expect(sw.remote).toBe(true);
		expect(sw.on).toBe(true);
		await sw.refresh();
		expect(invoke).toHaveBeenCalledWith('feature_flags', { urls: [`${WWW}/features.json`, `${API}/features.json`] });
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it('follows the remote switch, writes on a change only and keeps the last value through failures', async () => {
		const sw = new TeamSwitch();
		features = { team_v2: false };
		await sw.refresh();
		expect(sw.remote).toBe(false);
		expect(sw.on).toBe(false);
		expect(writeConfig).toHaveBeenCalledTimes(1);
		expect(config.agents).toEqual({ fanout: 'auto', team_v2: false });
		// The same answer again: config.json says so already.
		await sw.refresh();
		expect(writeConfig).toHaveBeenCalledTimes(1);
		// No file, an unknown key, a network error: still off, no write.
		for (const next of [null, { other: true }, new Error('offline')]) {
			features = next;
			await sw.refresh();
			expect(sw.remote).toBe(false);
		}
		expect(writeConfig).toHaveBeenCalledTimes(1);
		// Kept for the next launch.
		expect(new TeamSwitch().remote).toBe(false);
		// Back on.
		features = { team_v2: true };
		await sw.refresh();
		expect(sw.on).toBe(true);
		expect(writeConfig).toHaveBeenCalledTimes(2);
		expect(config.agents).toEqual({ fanout: 'auto', team_v2: true });
		expect(new TeamSwitch().remote).toBe(true);
	});

	it("applies the user's own choice, and again once LynShen switches it back on", async () => {
		const sw = new TeamSwitch();
		await sw.setLocal(false);
		expect(prefs.teamV2).toBe(false);
		expect(sw.on).toBe(false);
		expect(config.agents).toEqual({ fanout: 'auto', team_v2: false });
		// LynShen off, then on again: the user's off stays.
		features = { team_v2: false };
		await sw.refresh();
		features = { team_v2: true };
		await sw.refresh();
		expect(sw.on).toBe(false);
		expect(writeConfig).toHaveBeenCalledTimes(1);
		// The user turns it on while LynShen has it off: still off.
		features = { team_v2: false };
		await sw.refresh();
		await sw.setLocal(true);
		expect(sw.on).toBe(false);
		expect(writeConfig).toHaveBeenCalledTimes(1);
		// LynShen on again: the user's on applies.
		features = { team_v2: true };
		await sw.refresh();
		expect(sw.on).toBe(true);
		expect(config.agents).toEqual({ fanout: 'auto', team_v2: true });
		expect(writeConfig).toHaveBeenCalledTimes(2);
	});

	it('fixes config.json when another writer put the old value back', async () => {
		const sw = new TeamSwitch();
		await sw.setLocal(false);
		config = { ...config, agents: { fanout: 'plan' } };
		await sw.apply();
		expect(config.agents).toEqual({ fanout: 'plan', team_v2: false });
		expect(writeConfig).toHaveBeenCalledTimes(2);
	});
});
