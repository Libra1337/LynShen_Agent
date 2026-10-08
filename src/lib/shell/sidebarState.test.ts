import { describe, expect, it } from 'vitest';
import { readSidebarCollapsed, writeSidebarCollapsed } from './sidebarState';

function memory(init: Record<string, string> = {}) {
	const data = new Map(Object.entries(init));
	return {
		data,
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k)
	};
}

describe('sidebar collapsed state', () => {
	it('starts expanded', () => {
		expect(readSidebarCollapsed(memory())).toBe(false);
	});

	it('reads what was saved', () => {
		const s = memory();
		writeSidebarCollapsed(s, true);
		expect(readSidebarCollapsed(s)).toBe(true);
		writeSidebarCollapsed(s, false);
		expect(readSidebarCollapsed(s)).toBe(false);
	});

	it('turns a hidden navigator into the rail and drops the old key', () => {
		const s = memory({ 'lynshen-sidebar-visible': '0' });
		expect(readSidebarCollapsed(s)).toBe(true);
		expect(s.data.get('lynshen-sidebar-collapsed')).toBe('1');
		expect(s.data.has('lynshen-sidebar-visible')).toBe(false);
	});

	it('keeps a visible navigator expanded', () => {
		const s = memory({ 'lynshen-sidebar-visible': '1' });
		expect(readSidebarCollapsed(s)).toBe(false);
		expect(s.data.get('lynshen-sidebar-collapsed')).toBe('0');
	});

	it('prefers the new key over the old one', () => {
		const s = memory({ 'lynshen-sidebar-collapsed': '0', 'lynshen-sidebar-visible': '0' });
		expect(readSidebarCollapsed(s)).toBe(false);
	});
});
