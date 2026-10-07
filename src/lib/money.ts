/** A balance to two decimals, cut rather than rounded so it never reads higher
 *  than it is. Amounts spent are shown as the server sends them. */
export function fmtBalance(v?: string | null): string {
	const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec((v ?? '').trim() || '0');
	if (!m) return v ?? '';
	const frac = (m[3] ?? '').padEnd(2, '0').slice(0, 2);
	const int = m[2] || '0';
	const sign = m[1] && /[1-9]/.test(int + frac) ? '-' : '';
	return `${sign}${int}.${frac}`;
}

/** The gateway's fixed rate (Monoize SB-FX-1), as the website converts with it. */
export const CNY_PER_USD = 6.72;

/**
 * A balance in the currency the user chose to see. Only a USD amount converts
 * (the gateway keeps balances in USD); any other currency stays as reported.
 */
export function shownBalance(
	amount: string | null | undefined,
	currency: string | null | undefined,
	wanted: 'CNY' | 'USD'
): { amount: string; currency: string } {
	const from = (currency ?? '').toUpperCase();
	if (from === 'USD' && wanted === 'CNY') {
		const usd = Number(amount);
		if (Number.isFinite(usd)) return { amount: fmtBalance((usd * CNY_PER_USD).toFixed(6)), currency: 'CNY' };
	}
	return { amount: fmtBalance(amount), currency: currency ?? '' };
}

/** `shownBalance` as one string: "5695.38 CNY". */
export function shownBalanceText(
	amount: string | null | undefined,
	currency: string | null | undefined,
	wanted: 'CNY' | 'USD'
): string {
	const b = shownBalance(amount, currency, wanted);
	return `${b.amount} ${b.currency}`.trim();
}
