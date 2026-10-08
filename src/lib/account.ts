// What the sidebar's account row and its card show about the LynShen Console
// (Monoize gateway) account.

/** The letter in the avatar circle: the name's first letter, upper case. */
export function avatarInitial(name: string | null | undefined): string {
	const first = [...(name ?? '').trim()][0];
	return first ? first.toUpperCase() : '';
}

/** The role badge's message key, or null for an ordinary user (no badge). */
export function roleBadgeKey(role: string | null | undefined): string | null {
	if (role === 'super_admin') return 'shell.account.roles.superAdmin';
	if (role === 'admin') return 'shell.account.roles.admin';
	return null;
}

/** A count for a live-usage tile: "1,234", or "—" without data. */
export function liveCount(n: number | null | undefined): string {
	return n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
}

/** A cache hit rate as a percentage with at most one decimal ("42.5%",
 *  "100%"), or "—" when there is no basis (never "0%" for no input). */
export function cacheHitText(rate: number | null | undefined): string {
	if (rate == null || !Number.isFinite(rate)) return '—';
	const percent = Math.round(rate * 1000) / 10;
	return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
}
