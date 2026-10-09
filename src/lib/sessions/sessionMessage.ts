// Messages between conversations (docs/design/cross-session-messages.md):
// the turn a message starts in the conversation it went to, the daemon's
// `session_message` event both conversations get, and what the sender's
// `send_to_session` card shows.

import { markAttrs } from '$lib/agents/subagentResult';
import { t } from '$lib/i18n';

/** Where a message is: waiting for the other conversation to be free, in
 *  it as a user turn, or answered. */
export type SessionMessageStatus = 'queued' | 'delivered' | 'replied';
const STATUS_RANK: Record<SessionMessageStatus, number> = { queued: 0, delivered: 1, replied: 2 };

/** The later of two states (a message only moves forward). */
export function laterStatus(a: SessionMessageStatus | null, b: SessionMessageStatus | null): SessionMessageStatus | null {
	if (!a) return b;
	if (!b) return a;
	return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

/** A state as the daemon or a tool output words it, else null. */
export function readStatus(v: unknown): SessionMessageStatus | null {
	if (typeof v !== 'string') return null;
	const s = v.trim().toLowerCase();
	if (s === 'queued' || s === 'pending' || s === 'waiting') return 'queued';
	if (s === 'delivered' || s === 'sent') return 'delivered';
	if (s === 'replied' || s === 'answered') return 'replied';
	return null;
}

// ---------- the turn a message starts ----------

/** One `<session_message from="s_abc" title="…" hop="1">…</session_message>`
 *  block of a user turn. */
export interface SessionMessageBlock {
	/** The conversation (session id) it came from. */
	from: string;
	/** That conversation's title when it was sent ('' when unnamed). */
	title: string;
	/** How many conversations it has passed through (1: sent by a person's
	 *  conversation directly). */
	hop: number;
	body: string;
}

const BLOCK = /<session_message\b([^>]*)>([\s\S]*?)(?:<\/session_message>|$)/g;

/** XML entities a sender may have escaped in an attribute. */
function unescapeAttr(v: string): string {
	return v
		.replace(/&quot;/g, '"')
		.replace(/&apos;|&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

/** The messages a user turn carries when another conversation wrote it
 *  (one block each, the turn opening with the first); null for a turn the
 *  user wrote. The mark is plain text in every engine's transcript, so a
 *  reopened conversation reads the same. */
export function parseSessionMessage(text: string): SessionMessageBlock[] | null {
	if (!/^\s*<session_message\b/.test(text)) return null;
	const out: SessionMessageBlock[] = [];
	for (const m of text.matchAll(BLOCK)) {
		const attrs = markAttrs(m[1]!);
		const from = unescapeAttr(attrs.from ?? '').trim();
		if (!from) continue;
		const hop = Number.parseInt(attrs.hop ?? '', 10);
		out.push({ from, title: unescapeAttr(attrs.title ?? '').trim(), hop: Number.isFinite(hop) && hop > 0 ? hop : 1, body: m[2]!.trim() });
	}
	return out.length ? out : null;
}

/** A message's first line, as the event's `summary` words it (≤200 chars). */
export function summaryOf(body: string): string {
	const line = body.split('\n').find((l) => l.trim())?.trim() ?? '';
	return line.length > 200 ? line.slice(0, 200) : line;
}

// ---------- the event ----------

/** A `session_message` event: the daemon sends it to the clients of both
 *  conversations as the message moves on. */
export interface SessionMessageEvent {
	from: string;
	fromTitle: string;
	to: string;
	toTitle: string;
	summary: string;
	status: SessionMessageStatus;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The event as the daemon sends it, or null when it names no sender, no
 *  receiver or no state this client knows. */
export function readSessionMessageEvent(ev: Record<string, unknown>): SessionMessageEvent | null {
	const from = str(ev.from).trim();
	const to = str(ev.to).trim();
	const status = readStatus(ev.status);
	if (!from || !to || !status) return null;
	return {
		from,
		fromTitle: str(ev.from_title).trim(),
		to,
		toTitle: str(ev.to_title).trim(),
		summary: summaryOf(str(ev.summary)),
		status
	};
}

/** A message this conversation sent or got, as its events report it. */
export interface SessionMessageView extends SessionMessageEvent {
	/** Unique within the conversation. */
	id: number;
	/** This conversation sent it. */
	outgoing: boolean;
	/** When this client first heard of it (ms). */
	at: number;
}

/** The entry of `list` an event updates: the latest one for the same sender,
 *  receiver and first line that the event does not move backwards (a message
 *  sent again with the same words after the first was answered is a new
 *  one); undefined for a new message. */
export function matchMessage(list: SessionMessageView[], ev: SessionMessageEvent): SessionMessageView | undefined {
	const same = list.findLast((m) => m.from === ev.from && m.to === ev.to && m.summary === ev.summary);
	return same && STATUS_RANK[ev.status] >= STATUS_RANK[same.status] ? same : undefined;
}

// ---------- the sender's tool card ----------

/** The host tools a conversation finds and messages others with. */
export const SESSION_TOOLS = new Set(['list_sessions', 'read_session', 'send_to_session']);

/** What a `send_to_session` card shows. */
export interface SendCardView {
	/** The conversation it went to: its title, else its id; '' while unknown. */
	to: string;
	status: SessionMessageStatus | null;
	/** What was sent, when the call shows it. */
	message: string;
	/** The other conversation's reply, when the output carries one. */
	reply: string;
	/** An output that is not JSON (shown as it is). */
	text: string;
}

function parseObject(text: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(text);
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** A text field, or the text of an object (`{text}` / `{content}`). */
function textOf(v: unknown): string {
	if (typeof v === 'string') return v.trim();
	if (v && typeof v === 'object' && !Array.isArray(v)) {
		const o = v as Record<string, unknown>;
		return str(o.text).trim() || str(o.content).trim();
	}
	return '';
}

/** The card of one `send_to_session` call: its output (and arguments, when
 *  the engine showed them) read together with the latest event of the
 *  message it sent. A state only moves forward: the output says queued, a
 *  later event says delivered. */
export function sendCardView(call: { output: string; args?: string }, event?: SessionMessageView): SendCardView {
	const out = parseObject(call.output);
	const args = parseObject(call.args ?? '') ?? {};
	const o = out ?? {};
	const reply = textOf(o.reply) || textOf(o.response) || textOf(o.answer) || textOf(o.last_reply);
	const toTitle = str(o.to_title).trim() || str(o.title).trim() || str(o.session_title).trim();
	const toId = str(o.to).trim() || str(o.session).trim() || str(args.session).trim() || str(args.to).trim();
	const own = laterStatus(readStatus(o.status) ?? readStatus(o.state), reply ? 'replied' : null);
	return {
		to: event?.toTitle || toTitle || event?.to || toId,
		status: laterStatus(own, event?.status ?? null),
		message: textOf(o.message) || textOf(args.message),
		reply,
		text: out || !call.output.trim().length ? '' : call.output.trim()
	};
}

/** The conversation a `send_to_session` call names (its output's or its
 *  arguments' session id), '' when it names none yet. */
export function sendTarget(call: { output: string; args?: string }): string {
	const o = parseObject(call.output) ?? {};
	const a = parseObject(call.args ?? '') ?? {};
	return str(o.to).trim() || str(o.session).trim() || str(a.session).trim() || str(a.to).trim();
}

/** A conversation's title as the interface shows it: an unnamed one (no
 *  title, or the placeholder chat.svelte.ts stores as UNTITLED) reads as a
 *  new conversation. */
export const conversationTitle = (title: string) => (title && title !== 'New session' ? title : t('shell.newChat'));

/** The card a `send_to_session` call renders as (ToolCard's heading, badge
 *  and sections): 「发给「项目 B」」, where the message is, then what was
 *  sent and the reply. A failed call shows no state. */
export function sendCardProps(view: SendCardView, isError: boolean) {
	const sections: { label: string; text: string }[] = [];
	if (view.message) sections.push({ label: t('chat.sessionTools.message'), text: view.message });
	if (view.reply) sections.push({ label: t('chat.sessionTools.reply'), text: view.reply });
	if (view.text) sections.push({ label: '', text: view.text });
	return {
		heading: view.to ? t('chat.sessionTools.sendTo', { title: conversationTitle(view.to) }) : t('chat.sessionTools.sendToUnknown'),
		badge:
			view.status && !isError
				? { label: t(`chat.sessionTools.status.${view.status}`), ...(view.status === 'replied' ? { tone: 'ok' as const } : {}) }
				: undefined,
		sections
	};
}
