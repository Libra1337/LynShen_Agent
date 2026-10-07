import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdaterState } from './updater.svelte';

const { invoke, relaunch, flush } = vi.hoisted(() => ({ invoke: vi.fn(), relaunch: vi.fn(), flush: vi.fn() }));
vi.mock('$lib/workbench/workspaceStore.svelte', () => ({ workspaces: { flush } }));

vi.mock('@tauri-apps/api/core', () => ({
	invoke,
	Channel: class {
		onmessage: (message: unknown) => void = () => {};
	}
}));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('0.4.0') }));

/** `update_check` finds 0.3.2 on `source`; `install` answers `update_install`. */
function commands(install: () => Promise<void> = () => Promise.resolve(), source = 'github') {
	invoke.mockImplementation((cmd: string) => {
		if (cmd === 'update_check') return Promise.resolve({ version: '0.3.2', notes: null, source });
		if (cmd === 'update_install') return install();
		return Promise.reject(new Error(`unexpected ${cmd}`));
	});
}
const calls = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd).length;

describe('UpdaterState', () => {
	beforeEach(() => {
		invoke.mockReset();
		relaunch.mockReset();
		flush.mockReset();
	});

	it('automatically downloads and installs a silent startup update', async () => {
		commands(undefined, 'lynshen');
		const state = new UpdaterState();

		await state.check(true, true);

		expect(calls('update_install')).toBe(1);
		expect(state.phase).toBe('ready');
		expect(state.version).toBe('0.3.2');
		expect(state.source).toBe('lynshen');
	});

	it('asks on launch, and downloads only once the user chooses to update now', async () => {
		commands();
		const state = new UpdaterState();

		await state.checkOnLaunch();

		expect(state.asking).toBe(true);
		expect(state.phase).toBe('available');
		expect(calls('update_install')).toBe(0);

		await state.updateNow();

		expect(state.asking).toBe(false);
		expect(state.phase).toBe('ready');
		expect(calls('update_install')).toBe(1);
	});

	it('leaves a version put off for later alone until the next launch', async () => {
		commands();
		const state = new UpdaterState();

		await state.checkOnLaunch();
		state.dismiss();
		expect(state.asking).toBe(false);

		// The periodic background check does not download the declined version.
		state.phase = 'idle';
		await state.check(true, true);
		expect(calls('update_install')).toBe(0);

		// A newer one than the version put off is offered again.
		state.phase = 'idle';
		state.dismissed = '0.3.1';
		await state.check(true, true);
		expect(calls('update_install')).toBe(1);
	});

	it('keeps manual checks download-free until the user starts the download', async () => {
		commands();
		const state = new UpdaterState();

		await state.check();

		expect(calls('update_install')).toBe(0);
		expect(state.phase).toBe('available');
	});

	it('does not start a second check while an update is downloading', async () => {
		let resolveDownload!: () => void;
		commands(() => new Promise<void>((resolve) => (resolveDownload = resolve)));
		const state = new UpdaterState();

		const first = state.check(true, true);
		await vi.waitFor(() => expect(state.phase).toBe('downloading'));
		await state.check(true, true);
		expect(calls('update_check')).toBe(1);
		resolveDownload();
		await first;
	});

	it('surfaces an automatic install failure without pretending it is ready', async () => {
		commands(() => Promise.reject(new Error('signature mismatch')));
		const state = new UpdaterState();

		await state.check(true, true);

		expect(state.phase).toBe('error');
		expect(state.error).toContain('signature mismatch');
	});

	it('resets progress when a failed download starts again on a fallback source', async () => {
		invoke.mockImplementation(async (cmd, args) => {
			if (cmd === 'update_check') return { version: '0.5.0', source: 'lynshen' };
			if (cmd === 'update_policy') return '';
			if (cmd === 'update_install') {
				const channel = args.onEvent;
				channel.onmessage({ event: 'Started', data: { contentLength: 100 } });
				channel.onmessage({ event: 'Progress', data: { chunkLength: 80 } });
				channel.onmessage({ event: 'Started', data: { contentLength: 100 } });
				channel.onmessage({ event: 'Progress', data: { chunkLength: 10 } });
				expect(state.progress).toBe(10);
			}
		});
		const state = new UpdaterState();
		await state.check(true, true);
		expect(calls('update_apply')).toBe(0);
	});

	it('flushes workspace state before running the installer that may exit Windows', async () => {
		invoke.mockResolvedValue(undefined);
		const state = new UpdaterState();
		state.phase = 'ready';
		await state.restart();
		expect(invoke).toHaveBeenCalledWith('update_apply');
		expect(flush.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
		expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(relaunch.mock.invocationCallOrder[0]);
	});

	it('keeps the process open when applying the update fails', async () => {
		invoke.mockRejectedValue(new Error('installer failed'));
		const state = new UpdaterState();
		await state.restart();
		expect(relaunch).not.toHaveBeenCalled();
		expect(state.phase).toBe('error');
		expect(state.error).toContain('installer failed');
	});
	it('does not install when saving the workspace fails', async () => {
		flush.mockRejectedValue(new Error('disk full'));
		const state = new UpdaterState();
		state.phase = 'ready';
		await state.restart();
		expect(flush).toHaveBeenCalledWith(true);
		expect(invoke).not.toHaveBeenCalled();
		expect(relaunch).not.toHaveBeenCalled();
		expect(state.error).toContain('disk full');
	});
});

describe('a required version', () => {
	it('downloads the update even on a manual check, and is cleared once current', async () => {
		const { UpdaterState } = await import('./updater.svelte');
		let min = '0.5.0';
		invoke.mockImplementation((cmd: string) => {
			if (cmd === 'update_policy') return Promise.resolve(min);
			if (cmd === 'update_check') return Promise.resolve({ version: '0.5.0', notes: 'fixes', source: 'lynshen' });
			if (cmd === 'update_install') return Promise.resolve();
			return Promise.reject(new Error(`unexpected ${cmd}`));
		});
		const state = new UpdaterState();
		await state.check();
		expect(state.required).toBe('0.5.0');
		expect(state.phase).toBe('ready');
		expect(state.notes).toBe('fixes');
		min = '';
		await state.check();
		expect(state.required).toBe('');
	});
});

describe('olderThan', () => {
	it('compares versions numerically, a pre-release before its release', async () => {
		const { olderThan } = await import('./updater.svelte');
		expect(olderThan('0.4.0', '0.4.10')).toBe(true);
		expect(olderThan('0.4.10', '0.4.2')).toBe(false);
		expect(olderThan('0.4.0', '0.4.0')).toBe(false);
		expect(olderThan('0.5.0-beta.1', '0.5.0')).toBe(true);
		expect(olderThan('v1.0.0', '0.9.9')).toBe(false);
		expect(olderThan('garbage', '0.4.0')).toBe(false);
	});
});
