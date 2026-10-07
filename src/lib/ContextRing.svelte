<script lang="ts">
	// A small progress ring at the right end of the composer's footer: it marks
	// how full the context is; the numbers are in its hover card.
	let { pct, size = 14 }: { pct: number; size?: number } = $props();

	const R = 6;
	const C = 2 * Math.PI * R;
	const dash = $derived((Math.max(0, Math.min(100, pct)) / 100) * C);
	const stroke = $derived(pct >= 90 ? 'var(--err)' : pct >= 75 ? 'var(--warn)' : 'var(--dim)');
</script>

<svg class="ring" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
	<circle cx="8" cy="8" r={R} fill="none" stroke="var(--border-strong)" stroke-width="2" />
	<circle
		cx="8"
		cy="8"
		r={R}
		fill="none"
		stroke={stroke}
		stroke-width="2"
		stroke-linecap="round"
		stroke-dasharray="{dash} {C}"
		transform="rotate(-90 8 8)"
	/>
</svg>

<style>
	.ring {
		flex-shrink: 0;
	}
	.ring circle {
		transition: stroke-dasharray var(--t-slow) var(--ease-out), stroke var(--t-med) var(--ease-out);
	}
</style>
