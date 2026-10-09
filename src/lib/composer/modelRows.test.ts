import { describe, expect, it } from 'vitest';
import { buildModelRows, splitRoute, stripGroupSuffix } from './modelRows';

const groups = { codex: 'Codex', claude: 'Claude', lynshen: 'LynShen', byok: 'BYOK', system: 'System' };

const base = {
	provider: 'lynshen',
	providersList: [],
	configured: ['lynshen'],
	groups
};

describe('buildModelRows', () => {
	it('packs engine rows with /model commands and active flag', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			models: [
				{ model: 'gpt-5.5', active: true, context_window: 200_000 },
				{ model: 'claude-x', active: false }
			]
		});
		expect(rows.map((r) => r.command)).toEqual(['/model gpt-5.5', '/model claude-x']);
		expect(rows[0]).toMatchObject({
			active: true,
			group: 'LynShen',
			detail: '200K'
		});
	});

	it('shows the gateway display name, keeping the id for the command and the icon', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			provider: 'deepseek',
			configured: ['lynshen', 'deepseek'],
			providersList: [{ id: 'lynshen', models: [{ name: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol' }, { name: 'glm-5' }] }],
			models: [{ model: 'deepseek-v4', label: 'DeepSeek V4', active: true }]
		});
		expect(rows.map((r) => [r.label, r.vendor, r.command])).toEqual([
			['GPT-6.1 Sol', 'gpt-6.1-sol', '@switch lynshen gpt-6.1-sol'],
			['glm-5', 'glm-5', '@switch lynshen glm-5'],
			['DeepSeek V4', 'deepseek-v4', '/model deepseek-v4']
		]);
	});

	it('marks LynShen models whose window nobody configured', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			provider: 'byo',
			configured: ['byo', 'lynshen'],
			unsetWindow: 'unset',
			models: [{ model: 'my-model', active: true }],
			providersList: [{ id: 'lynshen', models: [{ name: 'gpt-6-sol' }, { name: 'gpt-5.5', context_window: 272_000 }] }]
		});
		expect(rows.find((r) => r.id === 'lynshen::gpt-6-sol')?.detail).toBe('unset');
		expect(rows.find((r) => r.id === 'lynshen::gpt-5.5')?.detail).toBe('272K');
		// BYOK rows keep their provider label and show nothing for an unknown window.
		expect(rows.find((r) => r.id === 'byo::my-model')?.detail).toBe('byo');
	});

	it('appends other providers as @switch rows (lynshen only)', () => {
		const providersList = [
			{ id: 'lynshen', models: [{ name: 'gpt-5.5', context_window: 1000 }] },
			{ id: 'byo', models: [{ name: 'my-model' }] }
		];
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			provider: 'byo2',
			configured: ['byo2', 'byo', 'lynshen'],
			models: [{ model: 'active-model', active: true }],
			providersList
		});
		const byo = rows.find((r) => r.id === 'byo::my-model');
		expect(byo).toMatchObject({
			command: '@switch byo my-model',
			detail: 'byo'
		});
		expect(rows.find((r) => r.id === 'lynshen::gpt-5.5')?.command).toBe('@switch lynshen gpt-5.5');
	});

	it('lists every lynshen model the user chose to show', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			provider: 'byo',
			configured: ['lynshen'],
			models: [],
			providersList: [
				{
					id: 'lynshen',
					models: [{ name: 'gpt-5.5' }, { name: 'claude-sonnet' }, { name: 'gemini-3-pro' }]
				}
			]
		});
		expect(rows.map((r) => r.label)).toEqual(['gpt-5.5', 'claude-sonnet', 'gemini-3-pro']);
	});

	it('lists only providers with credentials', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			provider: 'deepseek',
			// deepseek is the running provider (possibly env-keyed): its engine
			// rows stay even though it has no stored key.
			configured: ['openrouter'],
			models: [{ model: 'deepseek-chat', active: true }],
			providersList: [
				{ id: 'lynshen', models: [{ name: 'gpt-5.5' }] },
				{ id: 'openrouter', models: [{ name: 'or-model' }] },
				{ id: 'anthropic', models: [{ name: 'claude-opus' }] },
				{ id: 'deepseek', models: [{ name: 'deepseek-chat' }] }
			]
		});
		expect(rows.map((r) => r.id)).toEqual(['deepseek::deepseek-chat', 'openrouter::or-model']);
	});

	it('drops lynshen catalog rows when not logged in', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			provider: 'byo',
			configured: ['byo'],
			models: [{ model: 'm', active: true }],
			providersList: [{ id: 'lynshen', models: [{ name: 'gpt-5.5' }] }]
		});
		expect(rows.every((r) => !r.command.startsWith('@switch lynshen'))).toBe(true);
	});

	it('sorts rows into the fixed group order', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			provider: 'custom',
			configured: ['custom', 'lynshen'],
			models: [{ model: 'byok-model', active: true }],
			providersList: [{ id: 'lynshen', models: [{ name: 'gpt-5.5' }] }]
		});
		// LynShen comes first; every other provider is a heading of its own.
		expect(rows.map((r) => r.group)).toEqual(['LynShen', 'custom']);
	});

	// Claude Code / Codex: one list of this machine's catalog and the gateway's.
	const claude = {
		...base,
		backendId: 'claude',
		provider: 'anthropic',
		localLabel: 'Local',
		models: [
			{ model: 'opus', label: 'Opus 5.5', vendor: 'claude-opus-5-5', active: true },
			{ model: 'claude-fable-5[1m]', label: 'Fable 5 (1M)', vendor: 'claude-fable-5[1m]', active: false }
		],
		providersList: [{ id: 'lynshen', models: [{ name: 'claude-opus-5-5', context_window: 200_000 }, { name: 'claude-fable-5-1' }] }]
	};

	it('lists a model both sides run once, and says where each runs', () => {
		const rows = buildModelRows({ ...claude, toolMode: 'system' });
		expect(rows.map((r) => [r.label, r.detail, r.active])).toEqual([
			['Opus 5.5', '200K · Local · LynShen', true],
			['Fable 5 (1M)', 'Local', false],
			['Fable 5.1', 'LynShen', false]
		]);
		expect(rows.every((r) => r.group === undefined)).toBe(true);
	});

	it('picks on the current side, and switches sides for a model only the other has', () => {
		const local = buildModelRows({ ...claude, toolMode: 'system' });
		expect(local.map((r) => r.command)).toEqual(['/model opus', '/model claude-fable-5[1m]', '@tool lynshen claude-fable-5-1']);
		const gateway = buildModelRows({
			...claude,
			toolMode: 'lynshen',
			models: [{ model: 'claude-opus-5-5', active: true, listed: false }, ...claude.models.map((m) => ({ ...m, active: false }))]
		});
		expect(gateway.map((r) => r.command)).toEqual([
			'/model claude-opus-5-5',
			'@tool system claude-fable-5[1m]',
			'/model claude-fable-5-1'
		]);
		expect(gateway[0].active).toBe(true);
	});

	it('a model the engine only marks as running is the gateway\'s while on it', () => {
		const rows = buildModelRows({
			...claude,
			toolMode: 'lynshen',
			models: [{ model: 'glm-5.3', active: true, listed: false }, ...claude.models.map((m) => ({ ...m, active: false }))],
			providersList: [{ id: 'lynshen', models: [{ name: 'glm-5.3' }] }]
		});
		expect(rows.find((r) => r.active)).toMatchObject({ command: '/model glm-5.3', detail: 'LynShen' });
	});

	it('lists only this machine when not logged in to LynShen', () => {
		const rows = buildModelRows({ ...claude, configured: [], toolMode: 'system' });
		expect(rows.map((r) => r.command)).toEqual(['/model opus', '/model claude-fable-5[1m]']);
	});
});

describe('gateway model rows', () => {
	const labels = {
		...groups,
		routeGroup: (group: string) => `分组 ${group}`,
		routeChannel: (channel: string) => `渠道 ${channel}`
	};

	it('shows the model name alone and its group and channel on the second line', () => {
		const rows = buildModelRows({
			...base,
			groups: labels,
			backendId: 'lynshen',
			provider: 'monoize',
			configured: ['monoize'],
			providersList: [
				{
					id: 'monoize',
					models: [{ name: 'DeepSeek-V4.1-Flash', display_name: 'DeepSeek-V4.1-Flash（代理）', groups: ['代理', 'default'] }]
				}
			],
			models: [{ model: 'DeepSeek-V4.1-Flash', label: 'DeepSeek-V4.1-Flash（代理）', active: true, context_window: 1_000_000 }]
		});
		expect(rows[0].label).toBe('DeepSeek-V4.1-Flash');
		expect(rows[0].detail).toBe('分组 代理, default · 渠道 LynShen · 1M');
		expect(rows[0].command).toBe('/model DeepSeek-V4.1-Flash');
	});

	it('lists the provider catalog before the engine has reported its models', () => {
		// A draft after a provider switch: no engine list yet, which used to
		// leave the reopened menu with nothing to pick.
		const rows = buildModelRows({
			...base,
			groups: labels,
			backendId: 'lynshen',
			provider: 'monoize',
			configured: ['monoize'],
			current: 'claude-opus-5',
			providersList: [
				{
					id: 'monoize',
					models: [
						{ name: 'DeepSeek-V4.1-Flash', groups: ['代理'] },
						{ name: 'claude-opus-5', groups: ['代理'], context_window: 1_000_000 }
					]
				}
			],
			models: []
		});
		expect(rows.map((r) => r.label)).toEqual(['DeepSeek-V4.1-Flash', 'claude-opus-5']);
		expect(rows.find((r) => r.active)?.id).toBe('monoize::claude-opus-5');
		expect(rows[1].command).toBe('/model claude-opus-5');
	});

	it('lists a model once per Provider, the account class and Provider below it', () => {
		const accountLabels = { ...labels, accountClass: (c: string) => ({ private: '私有' })[c] ?? c };
		const input = {
			...base,
			groups: accountLabels,
			backendId: 'lynshen' as const,
			provider: 'monoize',
			configured: ['monoize'],
			providersList: [
				{
					id: 'monoize',
					models: [
						{
							name: 'deepseek-v4.1-flash',
							groups: ['代理'],
							routes: [
								{ id: 'p-agent', name: '代理', group: '代理', account_class: 'private' },
								{ id: 'p-lab', name: '新科研', group: '代理', account_class: 'private' }
							]
						},
						{ name: 'glm-5.3', routes: [{ id: 'p-one', name: '国模模型组', account_class: 'private' }] }
					]
				}
			],
			models: [
				{ model: 'deepseek-v4.1-flash', active: true },
				{ model: 'glm-5.3', active: false }
			]
		};
		const rows = buildModelRows(input);
		// One row per model; the route line is the chosen Provider's.
		expect(rows.map((r) => [r.label, r.detail])).toEqual([
			['deepseek-v4.1-flash', '私有 · 代理'],
			['glm-5.3', '私有 · 国模模型组']
		]);
		// Nothing chosen yet: the first Provider (the one the gateway tries first) is checked.
		expect(rows[0].route).toBe('p-agent');
		expect(rows[0].choices?.map((c) => [c.label, c.active])).toEqual([
			['代理', true],
			['新科研', false]
		]);
		expect(splitRoute(rows[0].choices![1].command)).toEqual({ command: '/model deepseek-v4.1-flash', route: 'p-lab' });
		// One Provider: a single row, no route to pin, no route page.
		expect(rows[1].route).toBeUndefined();
		expect(rows[1].choices).toBeUndefined();
		expect(rows[1].command).toBe('/model glm-5.3');

		const chosen = buildModelRows({ ...input, routes: { 'deepseek-v4.1-flash': 'p-lab' } });
		expect(chosen[0].route).toBe('p-lab');
		expect(chosen[0].detail).toBe('私有 · 新科研');
		expect(chosen[0].choices?.filter((c) => c.active).map((c) => c.id)).toEqual(['p-lab']);
	});

	it('keeps a pick without a route and an effort after the model', () => {
		expect(splitRoute('/model m high @route=p-1')).toEqual({ command: '/model m high', route: 'p-1' });
		expect(splitRoute('@switch monoize m @route=p-2')).toEqual({ command: '@switch monoize m', route: 'p-2' });
		expect(splitRoute('/model m')).toEqual({ command: '/model m' });
	});

	it('strips a group suffix older configs stored in the label', () => {
		expect(stripGroupSuffix('claude-opus-4-6（海外）')).toBe('claude-opus-4-6');
		expect(stripGroupSuffix('gpt-5.5 (default) / gpt-5.5 (test)')).toBe('gpt-5.5');
		expect(stripGroupSuffix('Claude Opus 4.8')).toBe('Claude Opus 4.8');
	});

	it('heads each provider by its name and hides the old login beside the gateway', () => {
		const rows = buildModelRows({
			...base,
			backendId: 'lynshen',
			provider: 'monoize',
			configured: ['monoize', 'lynshen', 'deepseek'],
			models: [{ model: 'glm-5.3', active: true }],
			providersList: [
				{ id: 'lynshen', models: [{ name: 'gpt-5.5' }] },
				{ id: 'monoize', name: 'LynShen Console', models: [{ name: 'glm-5.3' }] },
				{ id: 'deepseek', name: 'DeepSeek', models: [{ name: 'deepseek-chat' }] }
			]
		});
		expect(rows.map((r) => [r.group, r.id])).toEqual([
			['LynShen', 'monoize::glm-5.3'],
			['DeepSeek', 'deepseek::deepseek-chat']
		]);
	});
});

describe('the ChatGPT sign-in', () => {
	it('is not listed beside the LynShen gateway', () => {
		const rows = buildModelRows({
			models: [{ model: 'glm-5.3', active: true }],
			backendId: 'lynshen',
			provider: 'monoize',
			providersList: [
				{ id: 'monoize', name: 'Monoize', models: [{ name: 'glm-5.3' }] },
				{ id: 'openai-codex', models: [{ name: 'gpt-5.5' }] },
				{ id: 'deepseek', name: 'DeepSeek', models: [{ name: 'deepseek-v4-pro' }] }
			],
			configured: ['monoize', 'openai-codex', 'deepseek'],
			groups: { lynshen: 'LynShen', byok: 'BYOK' }
		});
		expect(rows.map((r) => r.group)).toEqual(['LynShen', 'DeepSeek']);
	});
});

describe('a gateway model whose input window is smaller than its context', () => {
	it('names both, so the window does not read as the model\u2019s size', () => {
		const labels = { ...groups, ofTotal: (total: string) => `（共 ${total}）` };
		const rows = buildModelRows({
			models: [
				{ model: 'glm-5.3', active: true, context_window: 128_000 },
				{ model: 'kimi-k3', active: false, context_window: 262_144 }
			],
			backendId: 'lynshen',
			provider: 'monoize',
			providersList: [
				{
					id: 'monoize',
					name: 'Monoize',
					models: [
						{ name: 'glm-5.3', context_window: 128_000, context_total: 1_048_576 },
						{ name: 'kimi-k3', context_window: 262_144, context_total: 262_144 }
					]
				}
			],
			configured: ['monoize'],
			groups: labels
		});
		expect(rows[0]!.detail).toContain('128K（共 1M）');
		// A total equal to the window adds nothing.
		expect(rows[1]!.detail).toContain('262K');
		expect(rows[1]!.detail).not.toContain('共');
	});
});
