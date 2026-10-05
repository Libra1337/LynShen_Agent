import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchLynShenModels = vi.fn();
const readConfig = vi.fn();
const writeConfig = vi.fn((_patch: Record<string, unknown>) => Promise.resolve());
vi.mock('./protocol', () => ({
	fetchLynShenModels: () => fetchLynShenModels(),
	readConfig: () => readConfig(),
	writeConfig: (patch: Record<string, unknown>) => writeConfig(patch)
}));

import { refreshLynShenModels, savedModel } from './lynshenModels';

beforeEach(() => vi.clearAllMocks());

describe('refreshLynShenModels', () => {
	it('brings the picked models up to the gateway, keeping the pick and its order', async () => {
		const old = savedModel({ id: 'b' });
		readConfig.mockResolvedValue({ provider: 'lynshen', lynshen_models: [old, { name: 'gone', context_window: 1 }] });
		fetchLynShenModels.mockResolvedValue([
			{ id: 'a', context_window: 100 },
			{ id: 'b', context_window: 200, display_name: 'Bee', group_context_windows: { g: { context_window: 300, max_context_window: 300 } } }
		]);
		expect(await refreshLynShenModels()).toBe(true);
		const patch = writeConfig.mock.calls[0][0] as { lynshen_models: Record<string, unknown>[]; models: unknown };
		expect(patch.lynshen_models.map((m) => [m.name, m.display_name, m.context_window])).toEqual([
			['b', 'Bee', 200],
			['gone', undefined, 1]
		]);
		expect(patch.models).toBe(patch.lynshen_models);
	});

	it('writes nothing when the gateway says the same', async () => {
		readConfig.mockResolvedValue({ provider: 'deepseek', lynshen_models: [savedModel({ id: 'b', context_window: 200 })] });
		fetchLynShenModels.mockResolvedValue([{ id: 'b', context_window: 200 }]);
		expect(await refreshLynShenModels()).toBe(false);
		expect(writeConfig).not.toHaveBeenCalled();
	});
});
