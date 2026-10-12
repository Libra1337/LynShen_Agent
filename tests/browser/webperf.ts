// The web chat's conversation view against a stubbed API, for streaming
// benchmarks (scripts/reasoning-perf.mjs --web). The script feeds the reply.
import { mount } from 'svelte';
import '../../src/lib/app.css';
import { setLocale } from '../../src/lib/i18n';
import { stubWebChat, type WebEvent } from './webChat';

setLocale('zh');
const web = stubWebChat();
const { default: ChatView } = await import('../../src/lib/web/ChatView.svelte');
mount(ChatView, { target: document.getElementById('app')!, props: {} });
Object.assign(window, {
  __perf: {
    ready: () => true,
    start: (text: string) => web.start(text),
    deliver: (ev: WebEvent) => web.deliver(ev),
    length: () => {
      const m = web.reply();
      return m ? m.reasoning.length + m.content.length : 0;
    }
  }
});
