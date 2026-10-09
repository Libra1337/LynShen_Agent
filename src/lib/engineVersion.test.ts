import { describe, expect, it } from 'vitest';
import { engine, engineAtLeast } from './engineVersion.svelte';

describe('engineAtLeast', () => {
	it('compares the daemon version numerically', () => {
		engine.version = '';
		expect(engineAtLeast('0.4.27')).toBe(false);
		engine.version = '0.4.25';
		expect(engineAtLeast('0.4.27')).toBe(false);
		engine.version = '0.4.27';
		expect(engineAtLeast('0.4.27')).toBe(true);
		engine.version = '0.4.100';
		expect(engineAtLeast('0.4.27')).toBe(true);
		engine.version = '0.5.0';
		expect(engineAtLeast('0.4.27')).toBe(true);
	});
});
