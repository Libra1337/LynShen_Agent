// A turn a background subagent's result started by itself: the engine puts
// the result in the turn's user item, marked
// `<subagent_result path="/root/x" …>…</subagent_result>` (one block per
// agent). It is plain text in the transcript too, so the mark is what a
// reopened session keeps.

export interface SubagentResult {
	/** The agents whose results these are (paths), in order. */
	paths: string[];
	/** Any of them failed (`status` says failed / errored). */
	failed: boolean;
	/** Their results, one after the other. */
	body: string;
}

const BLOCK = /<subagent_result\b([^>]*)>([\s\S]*?)(?:<\/subagent_result>|$)/g;
const ATTR = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function parseSubagentResult(text: string): SubagentResult | null {
	if (!/^\s*<subagent_result\b/.test(text)) return null;
	const paths: string[] = [];
	const bodies: string[] = [];
	let failed = false;
	for (const m of text.matchAll(BLOCK)) {
		const attrs: Record<string, string> = {};
		for (const a of m[1]!.matchAll(ATTR)) attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
		if (attrs.path && !paths.includes(attrs.path)) paths.push(attrs.path);
		if (/^(failed|errored|error)$/i.test(attrs.status ?? '')) failed = true;
		const body = m[2]!.trim();
		if (body) bodies.push(body);
	}
	return paths.length ? { paths, failed, body: bodies.join('\n\n') } : null;
}
