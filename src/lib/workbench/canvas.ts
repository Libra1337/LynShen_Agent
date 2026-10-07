// Unified canvas tabs: everything right of the navigator is ONE mosaic whose
// tabs are chat sessions (`chat:<sessionId>`), tool panels (plan / git / term
// / …), native TUI tabs (`tui:<backend>`) and the audit pane. Pure data —
// layout transforms come from tiles.ts, this module only adds the chat-tab
// naming plus the reconcile/migration step run when a workspace loads.

import {
	activateTab,
	closeTab,
	deserializeLayout,
	emptyLayout,
	findLeaf,
	leafOfTab,
	leavesOf,
	openTab,
	singleLeafLayout,
	splitLeaf,
	wrapRoot,
	type TileLayout,
	type TileTab
} from './tiles';
import { TUI_PANEL_PREFIX } from './tuiTab';

export const CHAT_PREFIX = 'chat:';

/** A chat tile's share of the canvas when grafted beside an old dock layout. */
export const CHAT_SEED_RATIO = 0.58;

/** A tool panel's share of the canvas when it opens beside a chat. */
export const TOOL_SIDE_RATIO = 0.42;

/** Narrowest chat leaf a tool panel may split: below it, the panel stacks. */
export const TOOL_SPLIT_MIN_CHAT = 560;

/** Panel kind (and tab id) of a session's chat tile — one tile per session,
 *  so the id can be derived from the session id. */
export function chatPanel(sessionId: string): string {
	return `${CHAT_PREFIX}${sessionId}`;
}

/** The session id a `chat:*` panel kind renders, or null for any other kind. */
export function chatSessionOf(panel: string): string | null {
	return panel.startsWith(CHAT_PREFIX) && panel.length > CHAT_PREFIX.length
		? panel.slice(CHAT_PREFIX.length)
		: null;
}

export function chatTab(sessionId: string): TileTab {
	return { id: chatPanel(sessionId), panel: chatPanel(sessionId) };
}

/** Session ids of every chat tile in the layout (DFS / visual order). */
export function chatSessionsIn(layout: TileLayout): string[] {
	return leavesOf(layout.root)
		.flatMap((l) => l.tabs)
		.map((t) => chatSessionOf(t.panel))
		.filter((s): s is string => s !== null);
}

/** Whether a panel kind is a conversation (chat tile or native TUI). */
const isConversation = (panel: string) => chatSessionOf(panel) !== null || panel.startsWith(TUI_PANEL_PREFIX);

/**
 * Open a tool panel (git, terminal, files, …) from the focused leaf `leafId`.
 * A tool does not cover a conversation: when the leaf shows a chat, the panel
 * joins the first leaf that holds no conversation, or splits the leaf to its
 * right. A leaf that already shows a tool takes the panel as another tab, and
 * so does a chat leaf when `split` is false (the canvas is too narrow).
 */
export function openToolTab(
	layout: TileLayout,
	leafId: string | null,
	tab: TileTab,
	split = true
): TileLayout {
	const leaves = leavesOf(layout.root);
	const focused = (leafId && findLeaf(layout.root, leafId)) || leaves[0];
	if (!focused) return openTab(layout, null, tab);
	const front = focused.tabs.find((t) => t.id === focused.active);
	if (!front || !isConversation(front.panel)) return openTab(layout, focused.id, tab);
	const tools = leaves.find((l) => l.tabs.every((t) => !isConversation(t.panel)));
	if (tools) return openTab(layout, tools.id, tab);
	if (!split) return openTab(layout, focused.id, tab);
	return splitLeaf(layout, focused.id, 'right', tab, TOOL_SIDE_RATIO).layout;
}

/**
 * Open (or re-activate) the chat tile for `sessionId`, landing in `leafId`.
 * A leaf shows one conversation at a time (switching is the sidebar's, as in
 * ChatGPT or Claude, not a row of tabs): opening one in a leaf that already
 * shows a chat replaces that chat in place. Tool tabs beside it stay.
 */
export function openChatTab(
	layout: TileLayout,
	leafId: string | null,
	sessionId: string
): TileLayout {
	const tab = chatTab(sessionId);
	if (leafOfTab(layout.root, tab.id)) return activateTab(layout, tab.id);
	const target = (leafId && findLeaf(layout.root, leafId)) || leavesOf(layout.root)[0];
	const shown = target?.tabs.find((t) => chatSessionOf(t.panel) !== null);
	if (!target || !shown) return openTab(layout, leafId, tab);
	// Add the new chat, then drop the one it replaces (both in this leaf).
	return closeTab(openTab(layout, target.id, tab), shown.id);
}

/**
 * Build the canvas from a persisted layout blob when a workspace loads:
 * - chat tiles whose session is not live are dropped — desktop session ids
 *   are stable across restore when the saved tabs carry `id` (see
 *   SavedProject.tabs), so only truly missing sessions (and legacy files
 *   saved without ids) lose their tile;
 * - a layout left without any chat tile gets one seeded for `seedSessionId` —
 *   an old dock-only layout keeps its panel arrangement and gains a chat leaf
 *   on the left (the pre-canvas shape, chat | panels);
 * - garbage / absent input falls back to a single chat leaf (or an empty
 *   canvas when there is no session to seed).
 */
export function reconcileLayout(
	raw: unknown,
	liveSessionIds: string[],
	seedSessionId: string | null
): TileLayout {
	let layout = deserializeLayout(raw) ?? emptyLayout();
	const live = new Set(liveSessionIds);
	for (const leaf of leavesOf(layout.root)) {
		for (const tab of leaf.tabs) {
			const sid = chatSessionOf(tab.panel);
			if (sid && !live.has(sid)) layout = closeTab(layout, tab.id);
		}
	}
	if (!seedSessionId || chatSessionsIn(layout).length) return layout;
	if (!layout.root) return singleLeafLayout([chatTab(seedSessionId)]);
	return wrapRoot(layout, 'left', chatTab(seedSessionId), CHAT_SEED_RATIO);
}
