import { tick } from 'svelte';

type Transitioning = Document & {
	startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> };
};

/** Runs `update` as a crossfade of the canvas (app.css, `canvas` view
 *  transition): the view it leaves fades out while the new one fades in,
 *  instead of vanishing and leaving a frame of bare background. A plain
 *  update where the webview has no view transitions (WebKit before Safari
 *  18) or the user asked for reduced motion. */
export function crossfade(update: () => void) {
	const doc = typeof document === 'undefined' ? null : (document as Transitioning);
	if (!doc?.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		update();
		return;
	}
	const root = doc.documentElement;
	// The panes' own entrance would fade the new view in twice.
	root.classList.add('vt-running');
	const transition = doc.startViewTransition(async () => {
		update();
		await tick();
	});
	transition.finished.finally(() => root.classList.remove('vt-running'));
}
