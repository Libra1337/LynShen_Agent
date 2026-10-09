import { afterEach, describe, expect, it } from 'vitest';
import {
	SHORTCUTS,
	SHORTCUT_IDS,
	binding,
	bindings,
	comboLabel,
	comboParts,
	comboProblem,
	findConflict,
	formatCombo,
	hasOverrides,
	initShortcuts,
	isDefaultBinding,
	matches,
	mergeBindings,
	parseCombo,
	parseOverrides,
	recordCombo,
	resetShortcuts,
	serializeOverrides,
	setShortcut,
	shortcutLabel,
	swapShortcut,
	withShortcut,
	type Combo,
	type ShortcutId
} from './shortcuts';

// Tests run in node: a plain event of the fields the matcher reads.
const key = (init: Partial<KeyboardEvent>) =>
	({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;
const combo = (s: string) => parseCombo(s) as Combo;

/** A localStorage stand-in. */
function memory(seed: Record<string, string> = {}) {
	const data = new Map(Object.entries(seed));
	return {
		data,
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k)
	};
}

afterEach(() => initShortcuts(undefined, true));

describe('shortcuts', () => {
	it('match ⌘ on macOS and Ctrl elsewhere', () => {
		expect(matches(key({ key: 'k', metaKey: true }), 'palette', true)).toBe(true);
		expect(matches(key({ key: 'k', ctrlKey: true }), 'palette', true)).toBe(false);
		expect(matches(key({ key: 'k', ctrlKey: true }), 'palette', false)).toBe(true);
		expect(matches(key({ key: 'k', metaKey: true, shiftKey: true }), 'palette', true)).toBe(false);
	});

	it('read shifted punctuation by its key, and digits as their number', () => {
		expect(matches(key({ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true }), 'prevSession', true)).toBe(true);
		expect(matches(key({ key: 'M', metaKey: true, shiftKey: true }), 'model', true)).toBe(true);
		expect(matches(key({ key: '3', metaKey: true }), 'sessionN', true)).toBe(3);
		expect(matches(key({ key: '0', metaKey: true }), 'sessionN', true)).toBe(0);
		expect(matches(key({ key: '`', code: 'Backquote', ctrlKey: true }), 'terminal', true)).toBe(true);
		expect(matches(key({ key: '`', code: 'Backquote', ctrlKey: true }), 'terminal', false)).toBe(true);
	});

	it('read the physical key when the character is not a Latin letter or digit', () => {
		// ⌥ on macOS, a Cyrillic layout, Shift on a digit.
		expect(recordCombo(key({ key: '˚', code: 'KeyK', metaKey: true, altKey: true }), 'palette', true)).toEqual(combo('Mod+Alt+K'));
		expect(matches(key({ key: 'л', code: 'KeyK', ctrlKey: true }), 'palette', false)).toBe(true);
		expect(recordCombo(key({ key: '#', code: 'Digit3', metaKey: true, shiftKey: true }), 'find', true)).toEqual(combo('Mod+Shift+3'));
	});

	it('label for the platform', () => {
		expect(shortcutLabel('model', true)).toBe('⇧⌘M');
		expect(shortcutLabel('model', false)).toBe('Ctrl+Shift+M');
		expect(shortcutLabel('terminal', true)).toBe('⌃`');
		expect(shortcutLabel('approvalMode', true)).toBe('⇧⇥');
		expect(shortcutLabel('sessionN', false)).toBe('Ctrl+1…9');
		expect(comboParts(combo('Mod+Ctrl+Alt+Shift+P'), true)).toEqual(['⌃', '⌥', '⇧', '⌘', 'P']);
		expect(comboLabel(combo('Alt+Shift+F5'), false)).toBe('Alt+Shift+F5');
		expect(comboLabel(null)).toBe('');
	});
});

describe('combo text', () => {
	it('round-trips', () => {
		for (const s of ['Mod+K', 'Mod+Shift+[', 'Ctrl+`', 'Shift+Tab', 'Mod+1-9', 'Mod+Ctrl+Alt+Shift+F12', 'Mod+\\', 'Mod+=']) {
			expect(formatCombo(combo(s))).toBe(s);
		}
		for (const id of SHORTCUT_IDS) {
			const { key, mod, ctrl, alt, shift } = SHORTCUTS[id];
			expect(parseCombo(formatCombo(SHORTCUTS[id]))).toEqual(JSON.parse(JSON.stringify({ key, mod, ctrl, alt, shift })));
		}
	});

	it('accept modifiers in any case and order, and reject anything else', () => {
		expect(parseCombo('shift+mod+k')).toEqual({ key: 'k', mod: true, shift: true });
		for (const bad of ['', 'Mod+', 'Mod+Enter', 'Mod+Space', 'Hyper+K', 'Mod+F13', 'Mod+KK', 42, null]) expect(parseCombo(bad)).toBeNull();
	});
});

describe('rules', () => {
	it('allow every default on both platforms, with no two alike', () => {
		for (const mac of [true, false]) {
			const all = mergeBindings(new Map(), mac);
			for (const id of SHORTCUT_IDS) {
				expect(comboProblem(id, SHORTCUTS[id], mac)).toBeNull();
				expect(all[id]).toBe(SHORTCUTS[id]);
				expect(findConflict(id, SHORTCUTS[id], all, mac)).toBeNull();
			}
		}
	});

	it('need ⌘ or ⌃ for keys that type', () => {
		expect(comboProblem('palette', combo('K'), true)).toBe('modifier');
		expect(comboProblem('palette', combo('Shift+K'), true)).toBe('modifier');
		expect(comboProblem('palette', combo('Alt+K'), true)).toBe('modifier');
		expect(comboProblem('palette', combo('Shift+Tab'), true)).toBe('modifier');
		expect(comboProblem('approvalMode', combo('Shift+Tab'), true)).toBeNull();
		expect(comboProblem('palette', combo('Ctrl+K'), true)).toBeNull();
		expect(comboProblem('palette', combo('F6'), true)).toBeNull();
	});

	it('keep text editing and system combos', () => {
		for (const s of ['Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Z', 'Mod+Shift+Z', 'Mod+Q', 'Mod+Shift+4']) {
			expect(comboProblem('find', combo(s), true)).toBe('reserved');
		}
		for (const s of ['Mod+C', 'Ctrl+V', 'Mod+Y', 'Mod+Shift+V', 'Alt+F4', 'Mod+Alt+Q']) {
			expect(comboProblem('find', combo(s), false)).toBe('reserved');
		}
		expect(comboProblem('find', combo('Mod+Y'), true)).toBeNull();
		expect(comboProblem('find', combo('Mod+Alt+Q'), true)).toBeNull();
	});

	it('take digits for sessionN only', () => {
		expect(recordCombo(key({ key: '4', ctrlKey: true }), 'sessionN', true)).toEqual(combo('Ctrl+1-9'));
		expect(comboProblem('sessionN', combo('Ctrl+1-9'), true)).toBeNull();
		expect(comboProblem('sessionN', combo('Mod+J'), true)).toBe('digits');
		expect(comboProblem('find', combo('Mod+1-9'), true)).toBe('key');
		expect(recordCombo(key({ key: 'Meta', metaKey: true }), 'find', true)).toBeNull();
		expect(comboProblem('find', recordCombo(key({ key: 'Enter', metaKey: true }), 'find', true) as Combo, true)).toBe('key');
	});

	it('find the action that already has a combo', () => {
		const all = mergeBindings(new Map(), true);
		expect(findConflict('find', combo('Mod+K'), all, true)).toBe('palette');
		expect(findConflict('palette', combo('Mod+K'), all, true)).toBeNull();
		expect(findConflict('find', combo('Mod+4'), all, true)).toBe('sessionN');
		// Off macOS ⌃` (terminal) and Mod+` are one key.
		expect(findConflict('find', combo('Mod+`'), mergeBindings(new Map(), false), false)).toBe('terminal');
		expect(findConflict('find', combo('Mod+`'), all, true)).toBeNull();
	});
});

describe('overrides', () => {
	it('merge over the defaults; a default a change took is left out', () => {
		const all = mergeBindings(new Map<ShortcutId, Combo | null>([['find', combo('Mod+K')], ['audit', null]]), true);
		expect(all.find).toEqual(combo('Mod+K'));
		expect(all.palette).toBeNull();
		expect(all.audit).toBeNull();
		expect(all.newSession).toBe(SHORTCUTS.newSession);
	});

	it('serialize only the changes and parse them back', () => {
		const ov = new Map<ShortcutId, Combo | null>([['palette', combo('Mod+Shift+P')], ['audit', null]]);
		const text = serializeOverrides(ov);
		expect(JSON.parse(text)).toEqual({ palette: 'Mod+Shift+P', audit: null });
		expect(parseOverrides(text, true)).toEqual(ov);
	});

	it('drop what does not fit', () => {
		const text = JSON.stringify({ nope: 'Mod+J', find: 'J', stop: 'Mod+C', model: 'Mod+Shift+M', palette: null, audit: 7, quickOpen: 'Mod+Shift+O' });
		expect(parseOverrides(text, true)).toEqual(new Map([['quickOpen', combo('Mod+Shift+O')]]));
		expect(parseOverrides('not json', true).size).toBe(0);
		expect(parseOverrides('[1]', true).size).toBe(0);
		expect(parseOverrides(null, true).size).toBe(0);
	});

	it('persist on this computer and load back', () => {
		const store = memory();
		initShortcuts(store, true);
		setShortcut('quickOpen', combo('Mod+Shift+O'), true);
		setShortcut('audit', null, true);
		expect(JSON.parse(store.data.get('lynshen-shortcuts') ?? '')).toEqual({ quickOpen: 'Mod+Shift+O', audit: null });
		initShortcuts(undefined, true);
		expect(shortcutLabel('quickOpen', true)).toBe('⌘P');
		initShortcuts(store, true);
		expect(shortcutLabel('quickOpen', true)).toBe('⇧⌘O');
		expect(binding('audit')).toBeNull();
		expect(withShortcut('Review', 'audit')).toBe('Review');
		expect(matches(key({ key: 'e', metaKey: true }), 'audit', true)).toBe(false);
		expect(matches(key({ key: 'o', metaKey: true, shiftKey: true }), 'quickOpen', true)).toBe(true);
	});

	it('store a default as no change, swap, and reset', () => {
		const store = memory();
		initShortcuts(store, true);
		setShortcut('find', combo('Mod+J'), true);
		expect(isDefaultBinding('find', true)).toBe(false);
		setShortcut('find', SHORTCUTS.find, true);
		expect(isDefaultBinding('find', true)).toBe(true);
		expect(store.data.has('lynshen-shortcuts')).toBe(false);

		swapShortcut('find', combo('Mod+K'), 'palette', true);
		expect(shortcutLabel('find', true)).toBe('⌘K');
		expect(shortcutLabel('palette', true)).toBe('⌘F');
		expect(findConflict('find', combo('Mod+K'), bindings(), true)).toBeNull();
		// Swapping back is the defaults again: nothing stored.
		swapShortcut('find', combo('Mod+F'), 'palette', true);
		expect(hasOverrides()).toBe(false);

		setShortcut('stop', combo('Mod+J'), true);
		resetShortcuts(true);
		expect(hasOverrides()).toBe(false);
		expect(store.data.has('lynshen-shortcuts')).toBe(false);
		expect(shortcutLabel('stop', true)).toBe('⌘.');
	});
});
