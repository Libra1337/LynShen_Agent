import { describe, expect, it } from 'vitest';
import { setLocale } from '$lib/i18n';
import { fmtResetAt, planQuota, remainingPct } from './quota';

describe('planQuota', () => {
	it('is null without windows (no subscription: no quota section)', () => {
		expect(planQuota(null)).toBeNull();
		expect(planQuota({ plan: 'max', windows: [] })).toBeNull();
	});
	it('maps engine plan windows to labelled quota windows', () => {
		setLocale('zh');
		const q = planQuota({
			plan: 'max',
			windows: [
				{ key: 'five_hour', used: 60, resetsAt: 1000, minutes: 300 },
				{ key: 'seven_day', used: 69, resetsAt: null, minutes: null }
			]
		});
		expect(q).toEqual({
			plan: 'Max',
			windows: [
				{ label: '5 小时', usedPct: 60, resetsAt: 1000 },
				{ label: '每周', usedPct: 69, resetsAt: null }
			]
		});
	});
});

describe('remainingPct', () => {
	it('is the share left, clamped', () => {
		expect(remainingPct({ label: '', usedPct: 60, resetsAt: null })).toBe(40);
		expect(remainingPct({ label: '', usedPct: 130, resetsAt: null })).toBe(0);
	});
});

describe('fmtResetAt', () => {
	const now = new Date(2026, 9, 7, 18, 0).getTime();
	it('shows the time of day within a day', () => {
		expect(fmtResetAt(new Date(2026, 9, 7, 21, 20).getTime(), 'zh', now)).toBe('21:20');
	});
	it('shows the date further out', () => {
		const at = new Date(2026, 9, 11, 9, 0).getTime();
		expect(fmtResetAt(at, 'zh', now)).toBe('10月11日');
		expect(fmtResetAt(at, 'en', now)).toBe('Oct 11');
	});
});
