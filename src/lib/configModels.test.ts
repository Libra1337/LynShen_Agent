import { describe, expect, it } from 'vitest';
import { configModelList } from './configModels';

describe('configModelList', () => {
	it('lists the engine models, else the gateway picks a new install has', () => {
		const picks = [{ name: 'deepseek-v4.1-flash' }, { name: 'claude-opus-5-5' }];
		expect(configModelList({ models: [{ name: 'a' }, { name: '' }, null], lynshen_models: picks })).toEqual([{ name: 'a' }]);
		expect(configModelList({ provider: 'monoize', models: [], lynshen_models: picks })).toEqual(picks);
		expect(configModelList({ provider: 'lynshen', lynshen_models: picks })).toEqual(picks);
		// Another provider runs on its own list only.
		expect(configModelList({ provider: 'openai', lynshen_models: picks })).toEqual([]);
		expect(configModelList({})).toEqual([]);
	});
});
