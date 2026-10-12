// Streaming benchmark: a long reasoning block streamed into a real ChatPane
// (production build, tests/browser/perf.html), each delta delivered the way
// the page delivers a daemon frame: in a task of its own, through
// ChatState.handle, then the pane follows the end. Not run in CI.
//
//   node scripts/reasoning-perf.mjs [--deltas 20000] [--windows 10] [--per-frame 4] [--words 1]
//                                   [--open] [--answer] [--lines] [--webkit] [--web] [--port 1439]
//
// Prints, per window of deltas: the time each delta's task took (the view's
// update in its microtasks included), the time per frame (average and 95th
// percentile), and in Chromium the main thread's task, script, layout and
// style time per frame and the JS heap (not collected); at the end, the heap after
// a forced GC. A cost per frame that grows from window to window grows with
// the text's length.
//
// --per-frame: deltas per animation frame. --words: words per delta (about
//   4 characters each; more reaches a long text sooner).
// --open: the reader unfolds the reasoning as it starts streaming.
// --answer: stream the deltas as the reply instead of reasoning.
// --lines: no blank lines, only single line breaks (reasoning some models
//   write that way): no Markdown block ever finishes.
// --web: the web chat (app.lynshen.org, tests/browser/webperf.html) instead:
//   its conversation view against a stubbed API, each delta one SSE frame of
//   the reply's stream, read by the page's own stream parser and store. Its
//   reasoning is open while the model thinks (--open does nothing).
// --webkit: Playwright's WebKit (the engine of the macOS app's web view)
//   instead of Chromium. It has no CDP: memory is the WebContent process's
//   footprint (macOS `footprint`), which WebKit's allocator does not give
//   back when freed, so it shows the peak. Only the WebContent processes
//   started by this run count (not another run's at the same time).
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { build, preview } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, def) => {
	const i = args.indexOf(`--${name}`);
	return i < 0 ? def : Number(args[i + 1]);
};
const DELTAS = opt('deltas', 20000);
const PER_FRAME = opt('per-frame', 4);
const WINDOWS = opt('windows', 10);
const WORDS = opt('words', 1);
const LINES = args.includes('--lines');
const OPEN = args.includes('--open');
const ANSWER = args.includes('--answer');
const WEBKIT = args.includes('--webkit');
const WEB = args.includes('--web');
const PORT = opt('port', 1439);
const PAGE = WEB ? 'tests/browser/webperf.html' : 'tests/browser/perf.html';

const outDir = mkdtempSync(resolve(tmpdir(), 'lynshen-perf-'));
const shared = {
	configFile: false,
	logLevel: 'warn',
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: { alias: { $lib: resolve('src/lib'), '$app/navigation': resolve('tests/browser/navigation.ts') } }
};
await build({ ...shared, build: { outDir, emptyOutDir: true, rollupOptions: { input: resolve(PAGE) } } });
const server = await preview({ ...shared, build: { outDir }, preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
/** The WebKit WebContent processes running now. */
const webContent = () => {
	try {
		return execFileSync('pgrep', ['-f', 'ms-playwright/webkit.*WebContent'], { encoding: 'utf8' }).trim().split('\n');
	} catch {
		return []; // none
	}
};
const others = new Set(webContent());
const browser = WEBKIT
	? await webkit.launch()
	: await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
/** This run's WebContent processes' footprint, MB (WebKit only). */
const footprintMB = () => {
	let total = 0;
	for (const pid of webContent().filter((p) => !others.has(p))) {
		const out = execFileSync('footprint', ['-p', pid], { encoding: 'utf8' });
		const m = out.match(/Footprint:\s+([\d.]+)\s+(KB|MB|GB)/);
		if (m) total += Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1);
	}
	return +total.toFixed(1);
};
try {
	const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const cdp = WEBKIT ? null : await page.context().newCDPSession(page);
	await cdp?.send('Performance.enable');
	page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
	await page.goto(`http://127.0.0.1:${PORT}/${PAGE}`);
	await page.waitForFunction(() => window.__perf?.ready(), null, { timeout: 15000 });
	const metrics = async () =>
		cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])) : {};
	const gcHeap = async () => {
		if (!cdp) return NaN;
		await cdp.send('HeapProfiler.collectGarbage');
		return (await cdp.send('Runtime.getHeapUsage')).usedSize;
	};

	if (WEB) await page.evaluate(() => window.__perf.start('请仔细想一想再回答'));
	await page.evaluate(
		({ open, answer, wordsPer, web, lines }) => {
			const P = window.__perf;
			if (!web) {
				P.deliver({ type: 'user_message', content: '请仔细想一想再回答' });
				P.deliver({ type: 'connecting' });
				P.deliver({ type: 'status', message: 'streaming' });
				P.deliver({ type: 'thinking_start' });
			}
			// Reasoning as models write it: paragraphs of mixed Chinese and
			// English, some Markdown, a few chars per delta.
			const words = ['我们', '需要', '考虑', '这个', '函数', 'the cache', '边界', '情况', 'returns', '**注意**', '`buf.len()`', '然后', 'maybe', '检查', '一下', '。'];
			let seed = 7;
			const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
			const word = () => {
				const r = rnd();
				if (r < 0.02) return lines ? '\n' : '\n\n';
				if (r < 0.025) return '\n- ';
				return words[Math.floor(rnd() * words.length)] + (rnd() < 0.3 ? ' ' : '');
			};
			window.__nextDelta = () => Array.from({ length: wordsPer }, word).join('');
			window.__type = answer ? 'assistant_delta' : 'reasoning_delta';
			P.deliver({ type: window.__type, delta: '好的，' });
			if (open && !web) window.__perf.chat().messages.at(-1).collapsed = false;
		},
		{ open: OPEN, answer: ANSWER, wordsPer: WORDS, web: WEB, lines: LINES }
	);

	// Feeds `n` deltas, `per` per animation frame, each in a task of its own
	// (a WebSocket message or a network chunk each); resolves with the frame
	// intervals, the time the deliveries' tasks took and the time it all took.
	// A frame's deltas run back to back, then a last task marks where they
	// ended: the view updates in each delta's microtasks, after `deliver`
	// returns. A page slower than the stream falls behind (WebKit runs frames
	// between queued tasks): the window ends once the deltas queued are all
	// delivered.
	const feed = (n) =>
		page.evaluate(
			({ n, per }) =>
				new Promise((done) => {
					const ch = new MessageChannel();
					let left = n;
					let busy = 0;
					let from = 0;
					let finished = false;
					const frames = [];
					const started = performance.now();
					let last = started;
					ch.port1.onmessage = (e) => {
						if (e.data === 'end') return void (busy += performance.now() - from);
						if (e.data === 'done') {
							finished = true;
							return done({ frames, busy, wall: performance.now() - started });
						}
						if (e.data === 'first') from = performance.now();
						window.__perf.deliver({ type: window.__type, delta: window.__nextDelta() });
					};
					const frame = (now) => {
						if (finished) return;
						frames.push(now - last);
						last = now;
						if (left > 0) {
							for (let i = 0; i < per && left > 0; i++, left--) ch.port2.postMessage(i ? 'next' : 'first');
							ch.port2.postMessage('end');
							if (left <= 0) ch.port2.postMessage('done');
						}
						requestAnimationFrame(frame);
					};
					requestAnimationFrame(frame);
				}),
			{ n, per: PER_FRAME }
		);

	const per = Math.floor(DELTAS / WINDOWS);
	const rows = [];
	let peak = 0;
	let before = await metrics();
	const t0 = Date.now();
	for (let w = 0; w < WINDOWS; w++) {
		const { frames, busy, wall } = await feed(per);
		const after = await metrics();
		const d = (k) => (after[k] - before[k]) * 1000;
		const n = frames.length;
		const sorted = [...frames].sort((a, b) => a - b);
		const chars = await page.evaluate(() => window.__perf.length());
		const row = { upTo: (w + 1) * per, chars, 'task ms/delta': +(busy / per).toFixed(3) };
		if (cdp) {
			peak = Math.max(peak, after.JSHeapUsedSize);
			Object.assign(row, {
				'task ms/frame': +(d('TaskDuration') / n).toFixed(2),
				'script ms/frame': +(d('ScriptDuration') / n).toFixed(2),
				'layout ms/frame': +(d('LayoutDuration') / n).toFixed(2),
				'style ms/frame': +(d('RecalcStyleDuration') / n).toFixed(2),
				'heap MB': +(after.JSHeapUsedSize / 1e6).toFixed(1)
			});
		} else {
			const mb = footprintMB();
			peak = Math.max(peak, mb);
			row['footprint MB'] = mb;
		}
		Object.assign(row, {
			'ms/frame': +(wall / n).toFixed(1),
			'frame p95': +sorted[Math.floor(n * 0.95)].toFixed(1)
		});
		rows.push(row);
		process.stderr.write(`${JSON.stringify(row)}\n`);
		before = after;
	}
	const seconds = (Date.now() - t0) / 1000;
	const heapAfterGc = await gcHeap();
	await page.evaluate(() => window.__perf.deliver({ type: 'status', message: 'ready' }));
	await page.waitForTimeout(300);
	const finalHeap = await gcHeap();
	console.table(rows);
	console.log(
		JSON.stringify({
			page: WEB ? 'web chat' : 'desktop',
			engine: WEBKIT ? 'webkit' : 'chromium',
			mode: `${ANSWER ? 'answer' : 'reasoning'}${WEB ? '' : OPEN ? ' open' : ' folded'}${LINES ? ' lines' : ''}`,
			deltas: DELTAS,
			perFrame: PER_FRAME,
			wordsPerDelta: WORDS,
			seconds,
			...(cdp
				? { peakHeapMB: +(peak / 1e6).toFixed(1), heapAfterGcMB: +(heapAfterGc / 1e6).toFixed(1), heapAfterTurnMB: +(finalHeap / 1e6).toFixed(1) }
				: { peakFootprintMB: peak, footprintAfterTurnMB: footprintMB() }),
			errors
		})
	);
} finally {
	await browser.close();
	await new Promise((r) => server.httpServer.close(r));
	rmSync(outDir, { recursive: true, force: true });
}
