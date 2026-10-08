import { describe, expect, it } from 'vitest';
import { bezier, EASE_BASE, EASE_ENTER, EASE_EXIT, motionMs } from './motion';

describe('motion easings', () => {
	it('start at 0 and end at 1', () => {
		for (const ease of [EASE_BASE, EASE_ENTER, EASE_EXIT]) {
			expect(ease(0)).toBe(0);
			expect(ease(1)).toBe(1);
		}
	});

	it('follow the curve: linear stays linear, enter leads, exit lags', () => {
		const linear = bezier(0, 0, 1, 1);
		expect(linear(0.3)).toBeCloseTo(0.3, 4);
		expect(EASE_ENTER(0.5)).toBeGreaterThan(0.5);
		expect(EASE_EXIT(0.5)).toBeLessThan(0.5);
	});

	it('never go backwards', () => {
		let last = 0;
		for (let i = 1; i <= 50; i++) {
			const v = EASE_BASE(i / 50);
			expect(v).toBeGreaterThanOrEqual(last);
			last = v;
		}
	});

	it('keep durations outside a browser', () => {
		expect(motionMs(240)).toBe(240);
	});
});
