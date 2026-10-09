// The app's keyboard shortcuts in one table: the window key handler matches
// against it, and buttons, the command palette, the shortcut list and
// Settings → 快捷键 show the same keys (⌘ on macOS, Ctrl elsewhere).
//
// Each action has a default combo here. The user's changes are stored on
// this computer as overrides by action id (`lynshen-shortcuts`), so a new
// default in a later version still reaches every action the user did not
// change. Overrides are not synced between computers (cloudSync.svelte.ts):
// keyboards and platforms differ from one machine to the next.

import { SvelteMap } from 'svelte/reactivity';

export type ShortcutId =
	| 'palette'
	| 'newSession'
	| 'settings'
	| 'sidebar'
	| 'find'
	| 'quickOpen'
	| 'audit'
	| 'focusComposer'
	| 'stop'
	| 'model'
	| 'history'
	| 'prevSession'
	| 'nextSession'
	| 'sessionN'
	| 'terminal'
	| 'approvalMode'
	| 'captureRequirement'
	| 'shortcuts';

/** A key and the modifiers held with it. */
export interface Combo {
	/** `KeyboardEvent.key` (lower case for letters), a punctuation key, `Tab`,
	 *  `F1`–`F12`, or `1-9` for any digit from 1 to 9. */
	key: string;
	/** ⌘ on macOS, Ctrl elsewhere. */
	mod?: boolean;
	/** The Control key on every platform. */
	ctrl?: boolean;
	/** ⌥ on macOS, Alt elsewhere. */
	alt?: boolean;
	shift?: boolean;
}

export type ShortcutGroup = 'general' | 'session' | 'composer';
export const SHORTCUT_GROUPS: ShortcutGroup[] = ['general', 'session', 'composer'];

/** An action's default combo. */
export interface Shortcut extends Combo {
	group: ShortcutGroup;
	/** Cannot be left without a combo: the palette reaches every other action. */
	required?: boolean;
}

export const SHORTCUTS: Record<ShortcutId, Shortcut> = {
	palette: { key: 'k', mod: true, group: 'general', required: true },
	quickOpen: { key: 'p', mod: true, group: 'general' },
	sidebar: { key: 'b', mod: true, group: 'general' },
	settings: { key: ',', mod: true, group: 'general' },
	terminal: { key: '`', ctrl: true, group: 'general' },
	shortcuts: { key: '/', mod: true, group: 'general' },
	captureRequirement: { key: 'n', mod: true, shift: true, group: 'general' },
	newSession: { key: 'n', mod: true, group: 'session' },
	history: { key: 'h', mod: true, shift: true, group: 'session' },
	prevSession: { key: '[', mod: true, shift: true, group: 'session' },
	nextSession: { key: ']', mod: true, shift: true, group: 'session' },
	sessionN: { key: '1-9', mod: true, group: 'session' },
	find: { key: 'f', mod: true, group: 'session' },
	audit: { key: 'e', mod: true, group: 'session' },
	focusComposer: { key: 'l', mod: true, group: 'composer' },
	model: { key: 'm', mod: true, shift: true, group: 'composer' },
	approvalMode: { key: 'Tab', shift: true, group: 'composer' },
	stop: { key: '.', mod: true, group: 'composer' }
};

export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

export const isMac = () => typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);

// ---------- keys ----------

/** Punctuation read by its physical key: Shift turns `[` into `{` and `/` into `?`. */
const CODE_KEYS: Record<string, string> = {
	BracketLeft: '[',
	BracketRight: ']',
	Slash: '/',
	Backquote: '`',
	Period: '.',
	Comma: ',',
	Minus: '-',
	Equal: '=',
	Backslash: '\\',
	Semicolon: ';',
	Quote: "'"
};

/** Keys a combo can end with. */
const KEY_RE = /^(?:[a-z0-9]|[`\-=[\]\\;',./]|Tab|F(?:[1-9]|1[0-2])|1-9)$/;
/** Keys that type a character: they need ⌘ or ⌃ (Ctrl) to be a shortcut. */
const PRINTABLE_RE = /^(?:[a-z0-9]|[`\-=[\]\\;',./]|1-9)$/;

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'OS']);

/** The key behind `e`. Letters and digits come from the typed character (so
 *  the layout counts); when that is not a Latin letter or digit (⌥ on macOS,
 *  Shift on a digit, a Cyrillic layout) they come from the physical key. */
function keyOf(e: KeyboardEvent): string {
	const punct = CODE_KEYS[e.code];
	if (punct) return punct;
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	if (/^[a-z0-9]$/.test(key) || (e.key.length > 1 && e.key !== 'Dead' && e.key !== 'Unidentified')) return key;
	const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
	return m ? (m[1] ?? m[2]).toLowerCase() : key;
}

/** The modifiers `c` holds on this platform: on Windows and Linux ⌘ (Mod) and
 *  Control are the same key. */
function modsOf(c: Combo, mac: boolean): string {
	const ctrl = mac ? !!c.ctrl : !!(c.ctrl || c.mod);
	return `${ctrl ? 'c' : ''}${c.alt ? 'a' : ''}${c.shift ? 's' : ''}${mac && c.mod ? 'm' : ''}`;
}

/** Whether `a` and `b` are the same combo on this platform. */
export function sameCombo(a: Combo, b: Combo, mac = isMac()): boolean {
	return a.key === b.key && modsOf(a, mac) === modsOf(b, mac);
}

/** Whether one key press can be both `a` and `b` (`1-9` covers each digit). */
export function overlaps(a: Combo, b: Combo, mac = isMac()): boolean {
	if (modsOf(a, mac) !== modsOf(b, mac)) return false;
	const digit = (x: string, y: string) => x === '1-9' && /^[1-9]$/.test(y);
	return a.key === b.key || digit(a.key, b.key) || digit(b.key, a.key);
}

/** Whether `e` is combo `c`. For a `1-9` combo it is the digit (1-9), else 0
 *  when only the modifiers match. */
export function matchCombo(e: KeyboardEvent, c: Combo, mac = isMac()): number | boolean {
	if (!!c.shift !== e.shiftKey || !!c.alt !== e.altKey) return false;
	// On macOS Control is a modifier of its own; elsewhere it is the mod key.
	const held = mac ? e.metaKey === !!c.mod && e.ctrlKey === !!c.ctrl : !e.metaKey && e.ctrlKey === !!(c.mod || c.ctrl);
	if (!held) return false;
	const key = keyOf(e);
	if (c.key === '1-9') return /^[1-9]$/.test(key) ? Number(key) : 0;
	return key === c.key;
}

// ---------- text ----------

/** `Mod+Shift+K`: how a combo is stored. */
export function formatCombo(c: Combo): string {
	const mods = [c.mod && 'Mod', c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift'].filter(Boolean) as string[];
	return [...mods, /^[a-z]$/.test(c.key) ? c.key.toUpperCase() : c.key].join('+');
}

/** A stored combo back (modifier names in any case and order), or null when
 *  the text is not one. */
export function parseCombo(text: unknown): Combo | null {
	if (typeof text !== 'string') return null;
	const parts = text.split('+');
	const last = parts.pop() ?? '';
	const key = last.length === 1 ? last.toLowerCase() : last;
	if (!KEY_RE.test(key)) return null;
	const c: Combo = { key };
	for (const p of parts) {
		const m = p.toLowerCase();
		if (m === 'mod') c.mod = true;
		else if (m === 'ctrl') c.ctrl = true;
		else if (m === 'alt') c.alt = true;
		else if (m === 'shift') c.shift = true;
		else return null;
	}
	return c;
}

const keyCap = (key: string, mac: boolean) =>
	key === '1-9' ? '1…9' : key === 'Tab' && mac ? '⇥' : key.length === 1 ? key.toUpperCase() : key;

/** The key caps of `c` in the order the system writes them: ⌃ ⌥ ⇧ ⌘ K on
 *  macOS, Ctrl Alt Shift K elsewhere. A combo without a key gives only its
 *  modifiers (the ones held while recording). */
export function comboParts(c: Combo, mac = isMac()): string[] {
	const key = keyCap(c.key, mac);
	const parts = mac
		? [c.ctrl && '⌃', c.alt && '⌥', c.shift && '⇧', c.mod && '⌘', key]
		: [(c.ctrl || c.mod) && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', key];
	return parts.filter(Boolean) as string[];
}

/** How `c` reads on this platform: ⌘⇧M → ⇧⌘M, Ctrl+Shift+M; '' for none. */
export function comboLabel(c: Combo | null, mac = isMac()): string {
	if (!c) return '';
	const parts = comboParts(c, mac);
	return mac ? parts.join('') : parts.join('+');
}

// ---------- rules ----------

/** Why a combo cannot be an action's: a key that cannot be one, a typing key
 *  without ⌘/⌃ (Ctrl), a combo the system or text editing uses, or (for
 *  sessionN) a key that is not a digit. */
export type ComboProblem = 'key' | 'modifier' | 'reserved' | 'digits';

/** Combos the system or text fields use (copy, paste, undo, quit, hide,
 *  screenshots …). */
const RESERVED_MAC = [
	'Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Z', 'Mod+Shift+Z',
	'Mod+Q', 'Mod+W', 'Mod+H', 'Mod+Alt+H', 'Mod+M',
	'Mod+Tab', 'Mod+Shift+Tab', 'Mod+`', 'Mod+Shift+`',
	'Mod+Shift+3', 'Mod+Shift+4', 'Mod+Shift+5', 'Mod+Ctrl+Q', 'Mod+Ctrl+F'
].map((s) => parseCombo(s) as Combo);
const RESERVED_OTHER = [
	'Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Z', 'Mod+Y', 'Mod+Shift+Z',
	'Mod+Shift+C', 'Mod+Shift+V', 'Alt+F4'
].map((s) => parseCombo(s) as Combo);

/** Why `c` cannot be `id`'s combo on this platform, or null when it can. An
 *  action's own default is always allowed (⇧⇥ switches the approval mode). */
export function comboProblem(id: ShortcutId, c: Combo, mac = isMac()): ComboProblem | null {
	if (!KEY_RE.test(c.key)) return 'key';
	if (id === 'sessionN' && c.key !== '1-9') return 'digits';
	if (id !== 'sessionN' && c.key === '1-9') return 'key';
	if (sameCombo(c, SHORTCUTS[id], mac)) return null;
	if (!c.mod && !c.ctrl && (PRINTABLE_RE.test(c.key) || c.key === 'Tab')) return 'modifier';
	// Ctrl+Alt is AltGr on Windows and Linux, which types characters.
	if (!mac && c.alt && PRINTABLE_RE.test(c.key)) return 'reserved';
	if ((mac ? RESERVED_MAC : RESERVED_OTHER).some((r) => sameCombo(r, c, mac))) return 'reserved';
	return null;
}

/** What a key press records for `id`: null while only modifiers are down.
 *  For sessionN any digit from 1 to 9 records 1…9. */
export function recordCombo(e: KeyboardEvent, id: ShortcutId, mac = isMac()): Combo | null {
	if (MODIFIER_KEYS.has(e.key)) return null;
	const key = keyOf(e);
	return heldCombo(e, id === 'sessionN' && /^[1-9]$/.test(key) ? '1-9' : key, mac);
}

/** The modifiers of `e` as a combo with `key` (empty: modifiers only). */
export function heldCombo(e: KeyboardEvent, key = '', mac = isMac()): Combo {
	const c: Combo = { key };
	if (mac ? e.metaKey : e.ctrlKey) c.mod = true;
	if (mac && e.ctrlKey) c.ctrl = true;
	if (e.altKey) c.alt = true;
	if (e.shiftKey) c.shift = true;
	return c;
}

// ---------- defaults + overrides ----------

/** The combo of each action; null for none. */
export type Bindings = Record<ShortcutId, Combo | null>;
/** The user's changes: a combo, or null for none. */
export type Overrides = ReadonlyMap<ShortcutId, Combo | null>;

/** Each action's combo: its override, else its default. A default that a
 *  changed action now uses is left out (one key press never runs two
 *  actions), and so is an override that an earlier one already took. */
export function mergeBindings(overrides: Overrides, mac = isMac()): Bindings {
	const out = {} as Bindings;
	const taken: Combo[] = [];
	const take = (id: ShortcutId, c: Combo | null) => {
		out[id] = c && !taken.some((t) => overlaps(t, c, mac)) ? c : null;
		if (out[id]) taken.push(out[id]);
	};
	for (const id of SHORTCUT_IDS) if (overrides.has(id)) take(id, overrides.get(id) ?? null);
	for (const id of SHORTCUT_IDS) if (!overrides.has(id)) take(id, SHORTCUTS[id]);
	return out;
}

/** The other action that already has `c`, if any. */
export function findConflict(id: ShortcutId, c: Combo, bindings: Bindings, mac = isMac()): ShortcutId | null {
	return SHORTCUT_IDS.find((o) => o !== id && bindings[o] && overlaps(bindings[o], c, mac)) ?? null;
}

/** The overrides as stored: `{"palette":"Mod+Shift+P","audit":null}`. */
export function serializeOverrides(overrides: Overrides): string {
	const out: Record<string, string | null> = {};
	for (const id of SHORTCUT_IDS) {
		if (!overrides.has(id)) continue;
		const c = overrides.get(id);
		out[id] = c ? formatCombo(c) : null;
	}
	return JSON.stringify(out);
}

/** Stored overrides back. Unknown actions, combos this platform does not
 *  allow, a default stored as a change and a missing combo for a required
 *  action are dropped. */
export function parseOverrides(text: string | null | undefined, mac = isMac()): Map<ShortcutId, Combo | null> {
	const out = new Map<ShortcutId, Combo | null>();
	let raw: unknown;
	try {
		raw = JSON.parse(text || '{}');
	} catch {
		return out;
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	const rec = raw as Record<string, unknown>;
	for (const id of SHORTCUT_IDS) {
		if (!Object.prototype.hasOwnProperty.call(rec, id)) continue;
		if (rec[id] === null) {
			if (!SHORTCUTS[id].required) out.set(id, null);
			continue;
		}
		const c = parseCombo(rec[id]);
		if (c && !comboProblem(id, c, mac) && !sameCombo(c, SHORTCUTS[id], mac)) out.set(id, c);
	}
	return out;
}

// ---------- this computer's bindings ----------

const STORAGE_KEY = 'lynshen-shortcuts';
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The user's changes (reactive: Settings → 快捷键 reads them). */
const overrides = new SvelteMap<ShortcutId, Combo | null>();
/** Defaults merged with the overrides (reactive: labels follow a change). */
const effective = new SvelteMap<ShortcutId, Combo | null>(Object.entries(mergeBindings(new Map())) as [ShortcutId, Combo | null][]);
let storage: KeyValueStore | undefined;

function localStore(): KeyValueStore | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

function commit(next: Map<ShortcutId, Combo | null>, mac: boolean) {
	for (const id of SHORTCUT_IDS) {
		if (next.has(id)) overrides.set(id, next.get(id) ?? null);
		else overrides.delete(id);
	}
	const merged = mergeBindings(next, mac);
	for (const id of SHORTCUT_IDS) effective.set(id, merged[id]);
	try {
		if (next.size) storage?.setItem(STORAGE_KEY, serializeOverrides(next));
		else storage?.removeItem(STORAGE_KEY);
	} catch {
		/* private mode / no storage — in-memory only */
	}
}

/** Read this computer's overrides; once at startup (tests pass their own store). */
export function initShortcuts(from: KeyValueStore | undefined = localStore(), mac = isMac()) {
	storage = from;
	let text: string | null = null;
	try {
		text = from?.getItem(STORAGE_KEY) ?? null;
	} catch {
		/* unreadable — the defaults */
	}
	commit(parseOverrides(text, mac), mac);
}

/** Action `id`'s combo now; null when it has none. */
export function binding(id: ShortcutId): Combo | null {
	return effective.get(id) ?? null;
}

/** Every action's combo now. */
export function bindings(): Bindings {
	return Object.fromEntries(SHORTCUT_IDS.map((id) => [id, binding(id)])) as Bindings;
}

/** Whether `id` has its default combo. */
export function isDefaultBinding(id: ShortcutId, mac = isMac()): boolean {
	const c = binding(id);
	return !!c && sameCombo(c, SHORTCUTS[id], mac);
}

/** Whether any action was changed. */
export function hasOverrides(): boolean {
	return overrides.size > 0;
}

function put(next: Map<ShortcutId, Combo | null>, id: ShortcutId, c: Combo | null, mac: boolean) {
	if (c && sameCombo(c, SHORTCUTS[id], mac)) next.delete(id);
	else next.set(id, c && parseCombo(formatCombo(c)));
}

/** Give `id` combo `c` (null: none). The caller has checked comboProblem and
 *  findConflict; a default is stored as no change. */
export function setShortcut(id: ShortcutId, c: Combo | null, mac = isMac()) {
	const next = new Map(overrides);
	put(next, id, c, mac);
	commit(next, mac);
}

/** Give `id` combo `c`, and `other` (which had `c`) `id`'s combo until now. */
export function swapShortcut(id: ShortcutId, c: Combo, other: ShortcutId, mac = isMac()) {
	const next = new Map(overrides);
	put(next, other, binding(id), mac);
	put(next, id, c, mac);
	commit(next, mac);
}

/** Every action back to its default. */
export function resetShortcuts(mac = isMac()) {
	commit(new Map(), mac);
}

// ---------- callers ----------

/** Whether `e` is shortcut `id`. For `sessionN` it is the digit (1-9), else
 *  0 when it is not. Always false for an action without a combo. */
export function matches(e: KeyboardEvent, id: ShortcutId, mac = isMac()): number | boolean {
	const c = binding(id);
	return c ? matchCombo(e, c, mac) : false;
}

/** How shortcut `id` reads on this platform: ⇧⌘M, Ctrl+Shift+M; '' for none. */
export function shortcutLabel(id: ShortcutId, mac = isMac()): string {
	return comboLabel(binding(id), mac);
}

/** A tooltip: the action, then its shortcut when it has one. */
export function withShortcut(label: string, id: ShortcutId): string {
	const keys = shortcutLabel(id);
	return keys ? `${label} · ${keys}` : label;
}
