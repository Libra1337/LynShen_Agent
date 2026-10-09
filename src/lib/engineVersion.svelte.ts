// The running daemon's version, from its hello. Features a newer engine adds
// show only once the daemon runs it: after an app update the daemon keeps the
// previous engine until no session is running (daemonVersion.ts).

export const engine = $state({ version: '' });

/** The daemon runs `min` or later; unknown (not yet greeted) counts as no. */
export function engineAtLeast(min: string): boolean {
	const have = engine.version.split('.').map((part) => Number.parseInt(part, 10) || 0);
	const want = min.split('.').map((part) => Number.parseInt(part, 10) || 0);
	if (!engine.version) return false;
	for (let i = 0; i < Math.max(have.length, want.length); i++) {
		const diff = (have[i] ?? 0) - (want[i] ?? 0);
		if (diff) return diff > 0;
	}
	return true;
}

/** The first engine that takes a queued message back and says so. */
export const UNQUEUE_SINCE = '0.4.27';
