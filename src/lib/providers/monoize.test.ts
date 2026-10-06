import { describe, expect, it } from 'vitest';
import { monoizeEntries } from './monoize';

describe('monoizeEntries', () => {
	it('keeps every model its reasoning efforts, matching the catalog regardless of case', () => {
		const [deepseek, unknown] = monoizeEntries([
			{ id: 'DeepSeek-V4.1-Flash', groups: ['代理'] },
			{ id: 'brand-new-model', groups: ['default'] }
		]);
		expect(deepseek).toMatchObject({
			name: 'DeepSeek-V4.1-Flash',
			display_name: 'DeepSeek-V4.1-Flash',
			groups: ['代理'],
			reasoning_efforts: ['low', 'high', 'max']
		});
		expect(unknown.name).toBe('brand-new-model');
		expect(unknown.reasoning_efforts).toBeUndefined();
	});

	it('prefers what the user configured and drops unroutable models', () => {
		const entries = monoizeEntries(
			[
				{ id: 'gpt-5.5', groups: ['default'] },
				{ id: 'offline', routing_status: 'no_channel' }
			],
			[{ name: 'gpt-5.5', reasoning_efforts: ['low', 'high'], context_window: 400_000 } as { name: string }]
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ reasoning_efforts: ['low', 'high'], context_window: 400_000 });
	});
});
