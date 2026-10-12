import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat, streamDeltas, streamSource } from './chat.svelte';

const opts = { model: 'deepseek-v4', effort: '', search: false, research: false };

/** The LynShen API stubbed: signed in, every request answered, and the
 *  reply's stream (Chat Completions SSE) fed by the test. */
function stubApi() {
	vi.stubGlobal('localStorage', {
		getItem: () => JSON.stringify({ access: 'a', refresh: 'r', expiresAt: Date.now() + 864e5 }),
		setItem: () => {},
		removeItem: () => {}
	});
	const enc = new TextEncoder();
	let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
	let opened = () => {};
	const streaming = new Promise<void>((r) => (opened = r));
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (!url.includes('/chat/llm/')) return Response.json({});
		opened();
		const body = new ReadableStream<Uint8Array>({ start: (c) => void (stream = c) });
		// As fetch does: stopped, the body fails.
		init?.signal?.addEventListener('abort', () => stream!.error(new DOMException('aborted', 'AbortError')));
		return new Response(body);
	});
	const frame = (data: string) => stream!.enqueue(enc.encode(`data: ${data}\n\n`));
	return {
		streaming,
		reasoning: (t: string) => frame(JSON.stringify({ choices: [{ delta: { reasoning_content: t } }] })),
		content: (t: string) => frame(JSON.stringify({ choices: [{ delta: { content: t } }] })),
		end: () => {
			frame('[DONE]');
			stream!.close();
		}
	};
}

afterEach(() => {
	chat.fresh();
	vi.unstubAllGlobals();
});

describe('the web chat streaming a reply', () => {
	it('keeps the deltas of the reply streaming now for the view, and only while it streams', async () => {
		const api = stubApi();
		const sent = chat.send('想一想', [], opts);
		await api.streaming;
		const m = chat.msgs.at(-1)!;
		let reasoning = '';
		for (let i = 0; i < 5000; i++) {
			const delta = i % 40 === 39 ? '\n\n' : `想${i} `;
			reasoning += delta;
			api.reasoning(delta);
		}
		await vi.waitFor(() => expect(m.reasoning.length).toBe(reasoning.length));
		expect(m.reasoning).toBe(reasoning);
		const deltas = streamDeltas(m)!;
		expect(deltas.reasoning.length).toBe(reasoning.length);
		expect(deltas.reasoning.slice(reasoning.length - 240)).toBe(reasoning.slice(-240));
		const source = streamSource(m, 'reasoning');
		expect(source.length).toBe(reasoning.length);
		expect(source.read(1000, 1100)).toBe(reasoning.slice(1000, 1100));
		api.content('The ');
		api.content('answer');
		await vi.waitFor(() => expect(m.content).toBe('The answer'));
		expect(deltas.content.slice(0)).toBe('The answer');
		api.end();
		await sent;
		expect(m.status).toBe('complete');
		// It stopped: its text is read whole from now on.
		expect(streamDeltas(m)).toBeUndefined();
		expect(streamSource(m, 'content').read(4, 10)).toBe('answer');
		expect(m.reasoning).toBe(reasoning);
	});

	it('stops keeping the deltas of a reply cut short', async () => {
		const api = stubApi();
		const sent = chat.send('想一想', [], opts);
		await api.streaming;
		const m = chat.msgs.at(-1)!;
		api.reasoning('先看');
		await vi.waitFor(() => expect(m.reasoning).toBe('先看'));
		expect(streamDeltas(m)?.reasoning.slice(0)).toBe('先看');
		chat.stop();
		await sent;
		expect(m.status).toBe('incomplete');
		expect(streamDeltas(m)).toBeUndefined();
		expect(streamSource(m, 'reasoning').read(0, 2)).toBe('先看');
	});
});
