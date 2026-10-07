import { describe, expect, it } from 'vitest';
import { FALLBACK_CONTEXT_WINDOW, monoizeEntries } from './monoize';

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

	it('takes the window the gateway registers, and never leaves one unknown', () => {
		const [registered, stored, catalogOnly, nothing] = monoizeEntries(
			[
				{ id: 'glm-5.3', context_window: 128_000, max_output_tokens: 32_000 },
				{ id: 'gpt-5.5', context_window: null },
				{ id: 'DeepSeek-V4.1-Flash', context_window: null },
				{ id: 'brand-new-model' }
			],
			[
				{ name: 'glm-5.3', context_window: 1_310_720 } as { name: string },
				{ name: 'gpt-5.5', context_window: 400_000 } as { name: string }
			]
		);
		// The gateway's registered window wins over a larger stale one.
		expect(registered).toMatchObject({ context_window: 128_000, max_output_tokens: 32_000 });
		expect(stored.context_window).toBe(400_000);
		expect(catalogOnly.context_window).toBe(1_000_000);
		expect(nothing.context_window).toBe(FALLBACK_CONTEXT_WINDOW);
	});
});
