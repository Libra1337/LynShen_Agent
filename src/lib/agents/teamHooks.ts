// The agent team's shell hooks in ~/.lynshen/hooks.json: `task_completed`
// and `agent_idle`, each a list of `{ "command": "...", "tools"?: [...] }`
// like the engine's other hook keys (`stop`, `pre_tool_use`, …). The page
// edits these two keys only; an entry it cannot read stays as it is.

export const TEAM_HOOKS = ['task_completed', 'agent_idle'] as const;
export type TeamHook = (typeof TEAM_HOOKS)[number];

export interface HookCommand {
	/** Its place in the key's list (what removing it takes out). */
	index: number;
	command: string;
	/** The tools it is limited to; null for all. */
	tools: string[] | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The commands of one hook key as the engine reads them (entries without a
 *  command are left out of the list, not out of the file). */
export function listHooks(hooks: Record<string, unknown>, key: TeamHook): HookCommand[] {
	const list = Array.isArray(hooks[key]) ? (hooks[key] as unknown[]) : [];
	const out: HookCommand[] = [];
	list.forEach((entry, index) => {
		if (!isObject(entry) || typeof entry.command !== 'string' || !entry.command.trim()) return;
		const tools = Array.isArray(entry.tools) ? entry.tools.filter((x): x is string => typeof x === 'string') : null;
		out.push({ index, command: entry.command.trim(), tools });
	});
	return out;
}

/** The key's list with `command` added; null when there is nothing to add
 *  or the key already has it. */
export function withHook(hooks: Record<string, unknown>, key: TeamHook, command: string): unknown[] | null {
	const cmd = command.trim();
	if (!cmd || listHooks(hooks, key).some((h) => h.command === cmd)) return null;
	const list = Array.isArray(hooks[key]) ? (hooks[key] as unknown[]) : [];
	return [...list, { command: cmd }];
}

/** The key's list without the entry at `index` (it must still hold `command`,
 *  else the file changed meanwhile and null says so). */
export function withoutHook(hooks: Record<string, unknown>, key: TeamHook, index: number, command: string): unknown[] | null {
	const list = Array.isArray(hooks[key]) ? (hooks[key] as unknown[]) : [];
	const entry = list[index];
	if (!isObject(entry) || typeof entry.command !== 'string' || entry.command.trim() !== command) return null;
	return list.filter((_, i) => i !== index);
}

/** Plain JSON: what a write keeps exactly as it is. */
function plainJson(v: unknown): boolean {
	if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
	if (typeof v === 'number') return Number.isFinite(v);
	if (Array.isArray(v)) return v.every(plainJson);
	return isObject(v) && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(plainJson);
}

/** A hook list ready to write: plain JSON whose entries name their command
 *  as a string. */
export function validHookList(list: unknown[]): boolean {
	return Array.isArray(list) && plainJson(list) && list.every((e) => !isObject(e) || !('command' in e) || typeof e.command === 'string');
}
