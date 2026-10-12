// The web chat (app.lynshen.org) against a stubbed LynShen API, for the
// streaming benchmark (scripts/reasoning-perf.mjs --web) and the browser
// regressions: signed in, one model, every other request answered at once,
// and the reply's stream fed by the test, one SSE frame per delta, through
// the page's own request, stream parser and store.
import { chat } from '../../src/lib/web/chat.svelte';
import { models } from '../../src/lib/web/models.svelte';

const API = 'https://api.lynshen.org';
/** A Chat Completions model (protocol.ts): reasoning as `reasoning_content`. */
export const MODEL = 'deepseek-v4';

export type WebEvent = { type: 'reasoning_delta' | 'assistant_delta'; delta: string } | { type: 'status'; message: 'ready' };

export function stubWebChat() {
  localStorage.setItem('lynshen-web-auth', JSON.stringify({ access: 'test', refresh: 'test', expiresAt: Date.now() + 864e5 }));
  const enc = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
  let opened = () => {};
  const fetchPage = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(API)) return fetchPage(input, init);
    const path = url.slice(API.length);
    if (path.startsWith('/v1/oauth/chat/llm/')) {
      let c!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start: (it) => void (c = it) });
      stream = c;
      // As fetch does: stopped, the body fails.
      init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
      opened();
      const res = new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
      // The page reads this stream itself, each frame in the task that
      // delivered it: WebKit's Response passes its body on in tasks of its
      // own, out of the task the benchmark times.
      Object.defineProperty(res, 'body', { value: body });
      return res;
    }
    if (path === '/v1/public/site-info') return Response.json({ chat_models: [{ model: MODEL, group_id: 'test' }] });
    if (path === '/v1/models') return Response.json({ data: [{ id: MODEL, display_name: 'DeepSeek V4', context_window: 1_000_000 }] });
    return Response.json({});
  };
  const frame = (data: unknown) => stream?.enqueue(enc.encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`));
  return {
    /** Asks `text` and resolves once its reply streams. */
    async start(text: string) {
      await models.load();
      const streaming = new Promise<void>((r) => (opened = r));
      void chat.send(text, [], { model: MODEL, effort: '', search: false, research: false });
      await streaming;
    },
    /** One frame of the reply's stream; `ready` ends it. */
    deliver(ev: WebEvent) {
      if (ev.type === 'reasoning_delta') frame({ choices: [{ delta: { reasoning_content: ev.delta } }] });
      else if (ev.type === 'assistant_delta') frame({ choices: [{ delta: { content: ev.delta } }] });
      else {
        frame({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3400 } });
        frame('[DONE]');
        stream?.close();
        stream = null;
      }
    },
    /** The reply streaming now (the last message). */
    reply: () => chat.msgs.at(-1)
  };
}
