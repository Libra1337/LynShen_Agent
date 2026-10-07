import { describe, it, expect } from 'vitest';
import {
	chatPanel,
	chatSessionOf,
	chatSessionsIn,
	chatTab,
	openChatTab,
	openToolTab,
	reconcileLayout,
	CHAT_SEED_RATIO,
	TOOL_SIDE_RATIO
} from './canvas';
import {
	activateTab,
	leavesOf,
	openTab,
	serializeLayout,
	singleLeafLayout,
	splitLeaf,
	toggleMaximize,
	type LeafNode,
	type SplitNode,
	type TileTab
} from './tiles';

const panelTab = (id: string, panel = id): TileTab => ({ id, panel });

/** A persisted dock-only layout: [plan, git] | [term] — no chat tiles. */
function dockOnlyLayout() {
	const base = singleLeafLayout([panelTab('t1', 'plan'), panelTab('t2', 'git')], 't2');
	const first = leavesOf(base.root)[0];
	return splitLeaf(base, first.id, 'right', panelTab('t3', 'term')).layout;
}

describe('chat tab naming', () => {
	it('round-trips a session id through the panel kind', () => {
		expect(chatSessionOf(chatPanel('s1-abc'))).toBe('s1-abc');
	});

	it('returns null for tool panels, tui tabs and a bare prefix', () => {
		expect(chatSessionOf('git')).toBeNull();
		expect(chatSessionOf('tui:codex')).toBeNull();
		expect(chatSessionOf('chat:')).toBeNull();
	});

	it('uses the panel kind as the tab id (one tile per session)', () => {
		expect(chatTab('s9')).toEqual({ id: 'chat:s9', panel: 'chat:s9' });
	});
});

describe('openChatTab', () => {
	it('opens the chat tile in the requested leaf and activates it', () => {
		const layout = dockOnlyLayout();
		const target = leavesOf(layout.root)[1];
		const next = openChatTab(layout, target.id, 's1');
		const leaf = leavesOf(next.root)[1];
		expect(leaf.tabs.map((t) => t.panel)).toEqual(['term', 'chat:s1']);
		expect(leaf.active).toBe('chat:s1');
	});

	it('replaces the chat a leaf shows instead of adding a tab', () => {
		const one = openChatTab(singleLeafLayout([]), null, 's1');
		const leaf = leavesOf(one.root)[0];
		const two = openChatTab(one, leaf.id, 's2');
		expect(leavesOf(two.root)[0].tabs.map((t) => t.panel)).toEqual(['chat:s2']);
		expect(leavesOf(two.root)[0].active).toBe('chat:s2');
		// A tool beside the chat stays.
		const withTool = openTab(two, leaf.id, { id: 't1', panel: 'term' });
		const three = openChatTab(withTool, leaf.id, 's3');
		expect(leavesOf(three.root)[0].tabs.map((t) => t.panel).sort()).toEqual(['chat:s3', 'term']);
	});

	it('re-activates an existing tile instead of duplicating it', () => {
		const layout = openChatTab(dockOnlyLayout(), null, 's1');
		const other = leavesOf(layout.root)[1];
		const next = openChatTab(activateTab(layout, 't1'), other.id, 's1');
		expect(chatSessionsIn(next)).toEqual(['s1']);
	});
});

describe('openToolTab', () => {
	it('opens a tool beside a lone chat instead of covering it', () => {
		const layout = singleLeafLayout([chatTab('s1')]);
		const chatLeaf = leavesOf(layout.root)[0];
		const next = openToolTab(layout, chatLeaf.id, panelTab('t1', 'git'));
		const root = next.root as SplitNode;
		expect(root.dir).toBe('row');
		expect(root.ratio).toBeCloseTo(1 - TOOL_SIDE_RATIO);
		expect((root.a as LeafNode).tabs.map((t) => t.panel)).toEqual(['chat:s1']);
		expect((root.b as LeafNode).tabs.map((t) => t.panel)).toEqual(['git']);
		expect((root.b as LeafNode).active).toBe('t1');
	});

	it('stacks later tools in the existing tool leaf', () => {
		const layout = singleLeafLayout([chatTab('s1')]);
		const chatLeaf = leavesOf(layout.root)[0];
		const once = openToolTab(layout, chatLeaf.id, panelTab('t1', 'git'));
		const twice = openToolTab(once, chatLeaf.id, panelTab('t2', 'term'));
		const leaves = leavesOf(twice.root);
		expect(leaves).toHaveLength(2);
		expect(leaves[1].tabs.map((t) => t.panel)).toEqual(['git', 'term']);
		expect(leaves[1].active).toBe('t2');
	});

	it('adds the tab to a focused leaf that already shows a tool', () => {
		const layout = dockOnlyLayout();
		const target = leavesOf(layout.root)[1];
		const next = openToolTab(layout, target.id, panelTab('t9', 'files'));
		expect(leavesOf(next.root)[1].tabs.map((t) => t.panel)).toEqual(['term', 'files']);
	});

	it('stacks the tool on the chat when splitting is not allowed', () => {
		const layout = singleLeafLayout([chatTab('s1')]);
		const next = openToolTab(layout, null, panelTab('t1', 'git'), false);
		const leaves = leavesOf(next.root);
		expect(leaves).toHaveLength(1);
		expect(leaves[0].tabs.map((t) => t.panel)).toEqual(['chat:s1', 'git']);
	});

	it('treats a native TUI tab as a conversation', () => {
		const layout = singleLeafLayout([panelTab('tui', 'tui:codex')]);
		const next = openToolTab(layout, null, panelTab('t1', 'git'));
		expect(leavesOf(next.root)).toHaveLength(2);
	});

	it('creates a root leaf on an empty canvas', () => {
		const next = openToolTab(singleLeafLayout([]), null, panelTab('t1', 'git'));
		expect(leavesOf(next.root).map((l) => l.tabs.map((t) => t.panel))).toEqual([['git']]);
	});
});

describe('reconcileLayout', () => {
	it('migrates a dock-only layout into the canvas by grafting one chat leaf on the left', () => {
		const saved = serializeLayout(dockOnlyLayout());
		const next = reconcileLayout(saved, ['s1'], 's1');
		const root = next.root as SplitNode;
		expect(root.kind).toBe('split');
		expect(root.dir).toBe('row');
		expect(root.ratio).toBe(CHAT_SEED_RATIO);
		expect((root.a as LeafNode).tabs.map((t) => t.panel)).toEqual(['chat:s1']);
		// The old panel arrangement survives untouched on the other side.
		const panels = leavesOf(root.b).flatMap((l) => l.tabs.map((t) => t.panel));
		expect(panels).toEqual(['plan', 'git', 'term']);
	});

	it('drops chat tiles for dead sessions and keeps live ones', () => {
		const layout = openChatTab(openChatTab(dockOnlyLayout(), null, 'dead'), null, 'live');
		const next = reconcileLayout(serializeLayout(layout), ['live'], 'live');
		expect(chatSessionsIn(next)).toEqual(['live']);
	});

	it('keeps a persisted 2-chat split intact when both session ids are live', () => {
		// Restore with persisted tab ids re-spawns sessions under the same ids,
		// so a workspace switch (or restart) must not collapse the split.
		const base = singleLeafLayout([chatTab('live-a')]);
		const split = splitLeaf(base, leavesOf(base.root)[0].id, 'right', chatTab('live-b')).layout;
		const next = reconcileLayout(serializeLayout(split), ['live-a', 'live-b'], 'live-a');
		expect(next).toEqual(split);
		expect(chatSessionsIn(next)).toEqual(['live-a', 'live-b']);
	});

	it('re-seeds one chat leaf when every persisted chat session is dead', () => {
		const layout = openChatTab(dockOnlyLayout(), null, 'old-run');
		const next = reconcileLayout(serializeLayout(layout), ['fresh'], 'fresh');
		expect(chatSessionsIn(next)).toEqual(['fresh']);
	});

	it('falls back to a single chat leaf for garbage or absent layouts', () => {
		for (const raw of [null, 'junk', { version: 99 }]) {
			const next = reconcileLayout(raw, ['s1'], 's1');
			expect(next.root?.kind).toBe('leaf');
			expect((next.root as LeafNode).tabs.map((t) => t.panel)).toEqual(['chat:s1']);
		}
	});

	it('yields an empty canvas when there is no session to seed', () => {
		expect(reconcileLayout(null, [], null).root).toBeNull();
	});

	it('keeps a valid layout (chat tile alive) byte-identical, maximize included', () => {
		const base = openChatTab(dockOnlyLayout(), null, 's1');
		const maxed = toggleMaximize(base, leavesOf(base.root)[0].id);
		const next = reconcileLayout(JSON.parse(JSON.stringify(serializeLayout(maxed))), ['s1'], 's1');
		expect(next).toEqual(maxed);
	});
});
