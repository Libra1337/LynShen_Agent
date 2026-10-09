// The agent team's settings in config.json (`agents.*`): whether the main
// agent starts subagents, how many and how deep, the token budget of a
// turn, and how long unmerged worktrees stay.

export type Fanout = 'off' | 'plan' | 'auto';
export const FANOUTS: Fanout[] = ['off', 'plan', 'auto'];

export interface TeamConfig {
	fanout: Fanout;
	max_live: number;
	max_depth: number;
	/** Tokens all subagents of a turn may use; 0: no limit. */
	turn_token_budget: number;
	keep_worktrees_days: number;
}

export const TEAM_DEFAULTS: TeamConfig = {
	fanout: 'auto',
	max_live: 4,
	max_depth: 2,
	turn_token_budget: 0,
	keep_worktrees_days: 7
};

/** The smallest value each number takes. */
const MIN: Record<Exclude<keyof TeamConfig, 'fanout'>, number> = {
	max_live: 1,
	max_depth: 1,
	turn_token_budget: 0,
	keep_worktrees_days: 1
};

/** A number field as typed: a whole number at or above its minimum, else null. */
export function teamNumber(key: Exclude<keyof TeamConfig, 'fanout'>, v: unknown): number | null {
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
	if (!Number.isFinite(n)) return null;
	const whole = Math.floor(n);
	return whole >= MIN[key] ? whole : null;
}

/** The settings config.json holds (`agents`), the defaults where it has none. */
export function readTeamConfig(cfg: Record<string, unknown>): TeamConfig {
	const a = cfg.agents && typeof cfg.agents === 'object' && !Array.isArray(cfg.agents) ? (cfg.agents as Record<string, unknown>) : {};
	const num = (k: Exclude<keyof TeamConfig, 'fanout'>) => teamNumber(k, a[k]) ?? TEAM_DEFAULTS[k];
	return {
		fanout: FANOUTS.includes(a.fanout as Fanout) ? (a.fanout as Fanout) : TEAM_DEFAULTS.fanout,
		max_live: num('max_live'),
		max_depth: num('max_depth'),
		turn_token_budget: num('turn_token_budget'),
		keep_worktrees_days: num('keep_worktrees_days')
	};
}

/** The `agents` object to write: what config.json has (keys this page does
 *  not show stay), with the valid fields of the form over it. */
export function teamPatch(agents: unknown, form: Record<keyof TeamConfig, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = agents && typeof agents === 'object' && !Array.isArray(agents) ? { ...(agents as Record<string, unknown>) } : {};
	if (FANOUTS.includes(form.fanout as Fanout)) out.fanout = form.fanout;
	for (const k of ['max_live', 'max_depth', 'turn_token_budget', 'keep_worktrees_days'] as const) {
		const n = teamNumber(k, form[k]);
		if (n !== null) out[k] = n;
	}
	return out;
}
