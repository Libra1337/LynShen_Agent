import { describe, expect, it } from 'vitest';
import { glassStyle } from './prefs.svelte';

describe('glass level', () => {
	it('is solid at 0', () => {
		const s = glassStyle(0, null, true);
		expect(s.on).toBe(false);
		expect(s.vars['--chrome-tint']).toBe('100%');
		expect(s.vars['--float-tint']).toBe('100%');
		expect(s.vars['--glass-filter']).toBe('none');
	});

	it('clears and blurs more as it rises', () => {
		const mid = glassStyle(50, null, true);
		const max = glassStyle(100, null, true);
		expect(mid.on).toBe(true);
		expect(max.vars['--float-tint']).toBe('60%');
		expect(max.vars['--glass-filter']).toBe('blur(50px) saturate(150%)');
		expect(max.vars['--chrome-tint']).toBe('100%');
	});

	it('stays solid where nothing can blur', () => {
		const s = glassStyle(100, null, false);
		expect(s.on).toBe(false);
		expect(s.vars['--float-tint']).toBe('100%');
	});

	it('lets a custom background through the chrome, more with glass', () => {
		expect(glassStyle(0, 'medium', true).vars['--chrome-tint']).toBe('80%');
		expect(glassStyle(0, 'faint', false).vars['--chrome-tint']).toBe('90%');
		expect(glassStyle(50, 'medium', true).vars['--chrome-tint']).toBe('65%');
		expect(glassStyle(100, 'medium', true).vars['--chrome-tint']).toBe('50%');
	});

	it('never thins the chrome below what keeps its text readable', () => {
		expect(glassStyle(100, 'medium', true, 74).vars['--chrome-tint']).toBe('74%');
		expect(glassStyle(0, 'faint', false, 74).vars['--chrome-tint']).toBe('90%');
		expect(glassStyle(100, null, true, 74).vars['--chrome-tint']).toBe('100%');
	});

	it('keeps levels in range', () => {
		expect(glassStyle(250, null, true).vars['--float-tint']).toBe('60%');
		expect(glassStyle(-5, null, true).on).toBe(false);
	});
});
