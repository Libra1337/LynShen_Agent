import { describe, expect, it } from 'vitest';
import { tuiBackendOf, tuiPanelKind, tuiTabTitle } from './tuiTab';

describe('tui tab kinds', () => {
	it('round-trips every backend through the panel kind', () => {
		for (const b of ['lynshen', 'codex', 'claude'] as const) {
			expect(tuiBackendOf(tuiPanelKind(b))).toBe(b);
		}
	});

	it('kind strings are stable (persisted in layouts)', () => {
		expect(tuiPanelKind('lynshen')).toBe('tui:lynshen');
	});

	it('non-tui and malformed kinds map to null', () => {
		for (const k of ['term', 'browser', 'tui', 'tui:', 'tui:bash', 'tui:lynshen:x', 'TUI:lynshen']) {
			expect(tuiBackendOf(k)).toBeNull();
		}
	});

	it('titles read as "TUI · <cli>"', () => {
		expect(tuiTabTitle('lynshen')).toBe('TUI · lynshen');
		expect(tuiTabTitle('claude')).toBe('TUI · claude');
	});
});
