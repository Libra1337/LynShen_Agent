import { describe, expect, it } from 'vitest';
import { breakdownTotal, fmtCtxTokens, fmtPct, parseBreakdown } from './contextUsage';

describe('parseBreakdown', () => {
	it('keeps the known parts with a token count', () => {
		expect(
			parseBreakdown({ system_prompt: 4100, skills: 2600, system_tools: 11800, mcp_tools: 1300, messages: 9200, other: 7 })
		).toEqual({ system_prompt: 4100, skills: 2600, system_tools: 11800, mcp_tools: 1300, messages: 9200 });
	});
	it('drops missing, negative and non-numeric parts', () => {
		expect(parseBreakdown({ messages: 10, skills: -1, mcp_tools: '5', system_prompt: Number.NaN })).toEqual({ messages: 10 });
	});
	it('is null without a usable breakdown', () => {
		expect(parseBreakdown(undefined)).toBeNull();
		expect(parseBreakdown(null)).toBeNull();
		expect(parseBreakdown([1, 2])).toBeNull();
		expect(parseBreakdown({ other: 3 })).toBeNull();
	});
});

describe('breakdownTotal', () => {
	it('sums the parts the engine sent', () => {
		expect(breakdownTotal({ system_prompt: 100, messages: 50 })).toBe(150);
	});
});

describe('fmtCtxTokens', () => {
	it('uses 万 in Chinese', () => {
		expect(fmtCtxTokens(29_000, 'zh')).toBe('2.9万');
		expect(fmtCtxTokens(1_000_000, 'zh')).toBe('100万');
		expect(fmtCtxTokens(258_000, 'zh')).toBe('25.8万');
		expect(fmtCtxTokens(9_500, 'zh')).toBe('9500');
	});
	it('uses k and M in English', () => {
		expect(fmtCtxTokens(29_000, 'en')).toBe('29k');
		expect(fmtCtxTokens(2_900, 'en')).toBe('2.9k');
		expect(fmtCtxTokens(258_000, 'en')).toBe('258k');
		expect(fmtCtxTokens(1_000_000, 'en')).toBe('1M');
		expect(fmtCtxTokens(999_900, 'en')).toBe('1M');
		expect(fmtCtxTokens(640, 'en')).toBe('640');
	});
});

describe('fmtPct', () => {
	it('keeps one decimal below 10%', () => {
		expect(fmtPct(2.94)).toBe('2.9%');
		expect(fmtPct(46.2)).toBe('46%');
		expect(fmtPct(0)).toBe('0%');
	});
});
