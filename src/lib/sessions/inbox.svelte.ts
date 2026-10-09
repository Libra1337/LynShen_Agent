// Messages waiting for a conversation (`session_message` with status
// `queued`), by the conversation they wait for: the sidebar marks it until
// they are delivered. Fed by the events of both ends, so a conversation not
// open here is marked too while the one that wrote to it is.

import { t } from '$lib/i18n';
import { conversationTitle, summaryOf, type SessionMessageEvent } from './sessionMessage';

export interface QueuedMessage {
	from: string;
	fromTitle: string;
	summary: string;
}

export class SessionInbox {
	/** Receiver session id → the messages queued for it, oldest first. */
	queued = $state<Record<string, QueuedMessage[]>>({});

	/** An event of either end: a queued message is added (once), a delivered
	 *  or answered one goes. */
	note(ev: SessionMessageEvent) {
		const list = this.queued[ev.to] ?? [];
		const i = list.findIndex((m) => m.from === ev.from && m.summary === ev.summary);
		if (ev.status === 'queued') {
			if (i < 0) this.queued[ev.to] = [...list, { from: ev.from, fromTitle: ev.fromTitle, summary: ev.summary }];
			return;
		}
		if (i >= 0) this.#drop(ev.to, i);
	}

	/** The receiver started a turn with a message from `from` (its delivered
	 *  event may not have reached this client): that one goes, else the
	 *  oldest from the same sender. */
	arrived(to: string, from: string, body: string) {
		const list = this.queued[to];
		if (!list) return;
		const summary = summaryOf(body);
		let i = list.findIndex((m) => m.from === from && m.summary === summary);
		if (i < 0) i = list.findIndex((m) => m.from === from);
		if (i >= 0) this.#drop(to, i);
	}

	/** The messages waiting for a conversation (none for '' ). */
	queuedFor(session: string): QueuedMessage[] {
		return (session && this.queued[session]) || [];
	}

	clear() {
		this.queued = {};
	}

	#drop(to: string, i: number) {
		const rest = (this.queued[to] ?? []).filter((_, k) => k !== i);
		if (rest.length) this.queued[to] = rest;
		else delete this.queued[to];
	}
}

/** What the sidebar's mark says of the messages waiting for a conversation
 *  ('' for none). */
export function queuedLabel(list: QueuedMessage[]): string {
	if (!list.length) return '';
	if (list.length > 1) return t('chat.sessionTools.queuedN', { n: list.length });
	return t('chat.sessionTools.queuedFrom', { title: conversationTitle(list[0]!.fromTitle) });
}

/** The app's one inbox (ChatState feeds it, the sidebar reads it). */
export const sessionInbox = new SessionInbox();
