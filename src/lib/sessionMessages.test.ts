import { describe, it, expect, beforeEach } from 'vitest';
import { ChatState } from './chat.svelte';
import { parseDelivery } from './delivery';
import {
	parseSessionMessage,
	readSessionMessageEvent,
	sendCardProps,
	sendCardView,
	summaryOf
} from './sessions/sessionMessage';
import { SessionInbox, queuedLabel, sessionInbox } from './sessions/inbox.svelte';
import { readSessionMessages, sessionsPatch, SESSION_MESSAGE_MODES } from './agents/teamConfig';
import { toolTarget, toolVerb } from './toolSummary';
import { searchRows } from './settings/nav';
import { catalog } from './i18n/messages';
import { setLocale, t } from './i18n';

// Frames as the daemon sends them for a message between two conversations
// (docs/design/cross-session-messages.md): A (s_abc) writes to B (s_def).
const A = 's_abc';
const B = 's_def';
const event = (session: string, status: string, extra: Record<string, unknown> = {}) => ({
	type: 'session_message',
	session,
	from: A,
	from_title: '项目 A：重构接口',
	to: B,
	to_title: '项目 B',
	summary: '接口 /v1/users 改成了分页，你那边的调用需要加 page 参数。',
	status,
	...extra
});
const body = '接口 /v1/users 改成了分页，你那边的调用需要加 page 参数。\n参考 docs/api.md。';
const wrapped = `<session_message from="${A}" title="项目 A：重构接口" hop="1">\n${body}\n</session_message>`;
const send = (callId = 'call_1') => [
	{ type: 'tool_start', session: A, call_id: callId, name: 'send_to_session' },
	{ type: 'tool_update', session: A, call_id: callId, name: 'send_to_session', output: JSON.stringify({ session: B, message: body, wait_reply: true }) }
];
const sender = () => {
	const c = new ChatState();
	c.handle({ type: 'startup', session: A, session_id: A, model: 'm', cwd: '/a' });
	return c;
};
const toolOf = (c: ChatState, callId: string) => {
	const m = c.messages.find((x) => x.kind === 'tool' && x.callId === callId);
	if (m?.kind !== 'tool') throw new Error('no tool card');
	return m;
};
const cardOf = (c: ChatState, callId: string) => {
	const m = toolOf(c, callId);
	return sendCardProps(sendCardView(m, c.sendOf(callId)), m.isError);
};

beforeEach(() => {
	setLocale('zh');
	sessionInbox.clear();
});

describe('cross-session messages: the event', () => {
	it('reads the frame, and refuses one that names no ends or no known state', () => {
		expect(readSessionMessageEvent(event(A, 'queued'))).toEqual({
			key: '',
			from: A,
			fromTitle: '项目 A：重构接口',
			to: B,
			toTitle: '项目 B',
			summary: '接口 /v1/users 改成了分页，你那边的调用需要加 page 参数。',
			status: 'queued'
		});
		expect(readSessionMessageEvent(event(A, 'lost'))).toBeNull();
		expect(readSessionMessageEvent(event(A, 'queued', { to: '' }))).toBeNull();
		expect(readSessionMessageEvent({ type: 'session_message', from: A, to: B, status: 'delivered' })).toMatchObject({ fromTitle: '', toTitle: '', summary: '' });
		// A summary is one line of at most 200 characters.
		expect(summaryOf(`\n  ${'长'.repeat(300)}\nsecond`)).toHaveLength(200);
	});

	it('keeps the sender’s messages, one entry per message, moving forward only', () => {
		const c = sender();
		c.handle(event(A, 'queued'));
		c.handle(event(A, 'queued')); // sent again on reconnect
		c.handle(event(A, 'delivered'));
		expect(c.sessionMessages).toHaveLength(1);
		expect(c.sessionMessages[0]).toMatchObject({ outgoing: true, status: 'delivered', toTitle: '项目 B' });
		c.handle(event(A, 'replied'));
		expect(c.sessionMessages[0]!.status).toBe('replied');
		// The same words sent again after the answer are a new message.
		c.handle(event(A, 'queued'));
		expect(c.sessionMessages.map((m) => m.status)).toEqual(['replied', 'queued']);
	});

	it('tells two messages with the same words apart by the daemon’s id', () => {
		const c = sender();
		c.handle(event(A, 'queued', { id: 'm1' }));
		c.handle(event(A, 'queued', { id: 'm2' }));
		c.handle(event(A, 'replied', { id: 'm1' }));
		expect(c.sessionMessages.map((m) => [m.key, m.status])).toEqual([
			['m1', 'replied'],
			['m2', 'queued']
		]);
	});

	it('tells the receiver’s end from the sender’s by the routing field', () => {
		const c = new ChatState();
		c.handle({ type: 'startup', session: B, session_id: B, model: 'm', cwd: '/b' });
		c.handle(event(B, 'queued'));
		expect(c.sessionMessages[0]).toMatchObject({ outgoing: false, from: A });
		expect(c.sendLinks).toEqual({});
	});
});

describe('cross-session messages: the receiver’s turn', () => {
	it('renders the marked turn as one line that opens the source, not as a bubble', () => {
		expect(parseSessionMessage(wrapped)).toEqual([{ from: A, title: '项目 A：重构接口', hop: 1, body }]);
		expect(parseDelivery(wrapped)).toEqual({
			kind: 'message',
			label: '来自对话「项目 A：重构接口」：',
			body,
			source: { session: A, title: '项目 A：重构接口' }
		});
		setLocale('en');
		expect(parseDelivery(wrapped)).toMatchObject({ label: 'From “项目 A：重构接口”:' });
	});

	it('reads the mark however its attributes are quoted', () => {
		expect(parseSessionMessage(`<session_message from='${A}' title='Fix &quot;users&quot; API' hop='2'>x</session_message>`)).toEqual([
			{ from: A, title: 'Fix "users" API', hop: 2, body: 'x' }
		]);
		expect(parseSessionMessage(`  <session_message hop=3 from=${A}>no title, no end`)).toEqual([{ from: A, title: '', hop: 3, body: 'no title, no end' }]);
		// An unnamed source reads as a new conversation.
		expect(parseDelivery(`<session_message from=${A}>hi</session_message>`)).toMatchObject({ label: '来自对话「新对话」：', source: { session: A } });
		// Two messages delivered in one turn.
		const two = `${wrapped}\n<session_message from="s_ghi" title="项目 C">也看一下</session_message>`;
		expect(parseDelivery(two)).toMatchObject({ label: '来自「项目 A：重构接口」等 2 个对话：', body: `${body}\n\n也看一下` });
	});

	it('leaves what the user wrote a bubble', () => {
		expect(parseSessionMessage(`看看这个 ${wrapped}`)).toBeNull();
		expect(parseSessionMessage('<session_message title="x">no sender</session_message>')).toBeNull();
		expect(parseDelivery('修复登录跳转')).toBeNull();
	});

	it('still counts as a user turn, and the turn list names it by its line', () => {
		const c = new ChatState();
		c.handle({
			type: 'transcript',
			items: [
				{ role: 'user', content: 'Fix the login' },
				{ role: 'assistant', content: 'Done.' },
				{ role: 'user', content: wrapped },
				{ role: 'assistant', content: 'Added the page parameter.' }
			]
		});
		const users = c.messages.filter((m) => m.kind === 'user');
		// Rewind ordinals count it (MessageList's userOrdinal); the rail's
		// marks do not (they skip deliveries).
		expect(c.userTurns).toBe(2);
		expect(users.filter((m) => m.kind === 'user' && !parseDelivery(m.text))).toHaveLength(1);
		c.turnEdits = { 1: { 'src/api.ts': { added: 4, removed: 1 } } };
		expect(c.turnTimeline[0]!.text).toBe('来自对话「项目 A：重构接口」：');
	});
});

describe('cross-session messages: the sender’s tool card', () => {
	it('shows where the message is, then the reply the output carries', () => {
		const c = sender();
		for (const f of send()) c.handle(f);
		// Before any event: the conversation's id, no state yet.
		expect(cardOf(c, 'call_1')).toMatchObject({ heading: `发给「${B}」`, badge: undefined });
		expect(cardOf(c, 'call_1').sections).toEqual([{ label: '消息', text: body }]);
		c.handle(event(A, 'queued'));
		expect(cardOf(c, 'call_1')).toMatchObject({ heading: '发给「项目 B」', badge: { label: '排队中' } });
		c.handle(event(A, 'delivered'));
		expect(cardOf(c, 'call_1').badge).toEqual({ label: '已送达' });
		c.handle({
			type: 'tool_output',
			session: A,
			call_id: 'call_1',
			name: 'send_to_session',
			output: JSON.stringify({ status: 'replied', to: B, to_title: '项目 B', reply: '改好了，测试通过。' }),
			is_error: false
		});
		const card = cardOf(c, 'call_1');
		expect(card.badge).toEqual({ label: '已回复', tone: 'ok' });
		expect(card.sections).toEqual([
			{ label: '消息', text: body },
			{ label: '回复', text: '改好了，测试通过。' }
		]);
		setLocale('en');
		expect(cardOf(c, 'call_1')).toMatchObject({ heading: 'To “项目 B”', badge: { label: 'Replied', tone: 'ok' } });
	});

	it('moves a card that returned at once forward with later events', () => {
		const c = sender();
		c.handle({ type: 'tool_start', session: A, call_id: 'c2', name: 'send_to_session' });
		c.handle({ type: 'tool_output', session: A, call_id: 'c2', name: 'send_to_session', output: JSON.stringify({ status: 'queued', to: B }), is_error: false });
		c.handle(event(A, 'queued'));
		expect(cardOf(c, 'c2')).toMatchObject({ heading: '发给「项目 B」', badge: { label: '排队中' }, sections: [] });
		c.handle(event(A, 'delivered'));
		expect(cardOf(c, 'c2').badge).toEqual({ label: '已送达' });
	});

	it('links each event to the call that names its conversation', () => {
		const c = sender();
		c.handle({ type: 'tool_start', session: A, call_id: 'to_b', name: 'send_to_session' });
		c.handle({ type: 'tool_update', session: A, call_id: 'to_b', name: 'send_to_session', output: JSON.stringify({ session: B, message: 'hi B' }) });
		c.handle({ type: 'tool_start', session: A, call_id: 'to_c', name: 'send_to_session' });
		c.handle({ type: 'tool_update', session: A, call_id: 'to_c', name: 'send_to_session', output: JSON.stringify({ session: 's_ghi', message: 'hi C' }) });
		c.handle(event(A, 'delivered', { summary: 'hi B' }));
		c.handle(event(A, 'queued', { to: 's_ghi', to_title: '项目 C', summary: 'hi C' }));
		expect(c.sendOf('to_b')).toMatchObject({ to: B, status: 'delivered' });
		expect(c.sendOf('to_c')).toMatchObject({ to: 's_ghi', status: 'queued' });
	});

	it('reads a reopened conversation’s card from its output alone', () => {
		const c = new ChatState();
		c.handle({
			type: 'transcript',
			items: [{ role: 'tool', name: 'send_to_session', output: JSON.stringify({ status: 'delivered', to: B, to_title: 'New session' }) }]
		});
		const m = c.messages[0]!;
		expect(m.kind === 'tool' && sendCardProps(sendCardView(m), false)).toMatchObject({ heading: '发给「新对话」', badge: { label: '已送达' } });
	});

	it('shows a failed send as an error, without a state', () => {
		const card = sendCardProps(sendCardView({ output: '{"error":"approval mode is stricter"}' }, undefined), true);
		expect(card.badge).toBeUndefined();
		expect(card.heading).toBe('发给另一个对话');
		// Text that is not JSON shows as it is.
		expect(sendCardView({ output: 'Delivered to 项目 B.' }).text).toBe('Delivered to 项目 B.');
	});

	it('names the other session tools in the interface language', () => {
		expect(toolVerb('send_to_session')).toBe('发给对话');
		expect(toolVerb('list_sessions')).toBe('列出对话');
		expect(toolVerb('read_session')).toBe('读取对话');
		expect(toolTarget('list_sessions', { sessions: [{}, {}, {}] })).toBe('3 个');
		expect(toolTarget('read_session', { session: B, title: '项目 B', turns: [] })).toBe('项目 B');
		setLocale('en');
		expect(toolVerb('list_sessions')).toBe('Listed conversations');
		expect(toolVerb('bash')).toBe('Ran');
	});
});

describe('cross-session messages: the sidebar marker', () => {
	it('marks the receiver while a message waits, from either end’s events', () => {
		const sending = sender();
		sending.handle(event(A, 'queued'));
		const receiving = new ChatState();
		receiving.handle({ type: 'startup', session: B, session_id: B, model: 'm', cwd: '/b' });
		receiving.handle(event(B, 'queued'));
		expect(sessionInbox.queuedFor(B)).toHaveLength(1);
		expect(sessionInbox.queuedFor(A)).toEqual([]);
		expect(queuedLabel(sessionInbox.queuedFor(B))).toBe('「项目 A：重构接口」发来的消息在排队');
		sending.handle(event(A, 'delivered'));
		expect(sessionInbox.queuedFor(B)).toEqual([]);
		expect(queuedLabel(sessionInbox.queuedFor(B))).toBe('');
	});

	it('clears when the receiver starts the turn, should the delivered event not come', () => {
		const sending = sender();
		sending.handle(event(A, 'queued'));
		const receiving = new ChatState();
		receiving.handle({ type: 'startup', session: B, session_id: B, model: 'm', cwd: '/b' });
		receiving.handle({ type: 'user_message', session: B, content: wrapped });
		expect(sessionInbox.queuedFor(B)).toEqual([]);
		// The turn renders as the line, not as a bubble.
		const turn = receiving.messages.at(-1)!;
		expect(turn.kind === 'user' && parseDelivery(turn.text)?.kind).toBe('message');
	});

	it('counts several waiting messages', () => {
		const inbox = new SessionInbox();
		const ev = readSessionMessageEvent(event(A, 'queued'))!;
		inbox.note(ev);
		inbox.note({ ...ev, from: 's_ghi', fromTitle: '项目 C', summary: 'also' });
		expect(queuedLabel(inbox.queuedFor(B))).toBe('2 条消息在排队');
		inbox.note({ ...ev, status: 'replied' });
		expect(inbox.queuedFor(B).map((m) => m.from)).toEqual(['s_ghi']);
		inbox.arrived(B, 's_ghi', 'something else');
		expect(inbox.queuedFor(B)).toEqual([]);
		expect(inbox.queuedFor('')).toEqual([]);
	});
});

describe('cross-session messages: the setting', () => {
	it('reads sessions.messages, on by default', () => {
		expect(readSessionMessages({})).toBe('on');
		expect(readSessionMessages({ sessions: { messages: 'ask' } })).toBe('ask');
		expect(readSessionMessages({ sessions: { messages: 'sometimes' } })).toBe('on');
		expect(readSessionMessages({ sessions: 'off' })).toBe('on');
	});

	it('writes it keeping the other keys of sessions', () => {
		expect(sessionsPatch({ messages: 'on', keep_days: 30 }, 'off')).toEqual({ messages: 'off', keep_days: 30 });
		expect(sessionsPatch(undefined, 'ask')).toEqual({ messages: 'ask' });
		expect(sessionsPatch(['x'], 'on')).toEqual({ messages: 'on' });
	});

	it('has a label and one line for each choice in both languages, and is found by search', () => {
		for (const locale of ['zh', 'en'] as const) {
			const team = catalog[locale].settings.team as Record<string, unknown>;
			expect(typeof team.messages).toBe('string');
			for (const mode of SESSION_MESSAGE_MODES) {
				expect((team.messagesOpt as Record<string, string>)[mode]).toBeTruthy();
				expect((team.messagesHint as Record<string, string>)[mode]).toBeTruthy();
			}
		}
		expect(t('settings.team.messagesOpt.ask')).toBe('每次询问');
		expect(searchRows('跨对话', t).map((r) => r.id)).toContain('team-messages');
		setLocale('en');
		expect(searchRows('between conversations', t).map((r) => r.id)).toContain('team-messages');
	});
});
