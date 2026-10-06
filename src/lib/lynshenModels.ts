// The LynShen models the user chose to show, as config.json keeps them
// (`lynshen_models`, read by the engines). The gateway's metadata for them
// (display names, windows, per-group windows) can change after the pick, so
// the saved entries are refreshed from /v1/models at startup.

import { fetchLynShenModels, readConfig, writeConfig, type LynShenModel } from './protocol';
import { DEFAULT_MODELS } from './defaultModels';

/** One saved entry. Explicit unknowns (0 / ["none"]), as the engine's own
 *  login writes them: a missing field would read back as a default. */
export function savedModel(m: LynShenModel): Record<string, unknown> {
	return {
		name: m.id,
		context_window: m.context_window ?? 0,
		max_context_window: m.max_context_window ?? m.context_window ?? 0,
		max_output_tokens: m.max_output_tokens ?? 0,
		reasoning_efforts: m.reasoning_efforts ?? ['none'],
		...(m.display_name ? { display_name: m.display_name } : {}),
		...(m.group_context_windows ? { group_context_windows: m.group_context_windows } : {})
	};
}

/** Refreshes saved metadata, or initializes recommendations after the first
 * account login. Existing user selections and their order are preserved. */
export async function refreshLynShenModels(): Promise<boolean> {
	const [live, cfg] = await Promise.all([fetchLynShenModels(), readConfig()]);
	const saved = Array.isArray(cfg.lynshen_models) ? (cfg.lynshen_models as Record<string, unknown>[]) : [];
	if (!live.length) return false;
	const byId = new Map(live.map((m) => [m.id, m]));
	const recommended = DEFAULT_MODELS.flatMap((id) => {
		const model = byId.get(id);
		return model ? [savedModel(model)] : [];
	});
	const next = saved.length ? saved.map((entry) => {
		const model = byId.get(String(entry.name));
		return model ? savedModel(model) : entry;
	}) : recommended.length ? recommended : live.slice(0, 6).map(savedModel);
	const patch: Record<string, unknown> = {};
	if (JSON.stringify(next) !== JSON.stringify(saved)) patch.lynshen_models = next;
	if (cfg.provider === 'lynshen') {
		if (JSON.stringify(cfg.models) !== JSON.stringify(next)) patch.models = next;
		if (!next.some((model) => model.name === cfg.model)) {
			patch.model = next[0].name;
			const efforts = next[0].reasoning_efforts as string[];
			if (!efforts.includes(String(cfg.reasoning_effort))) {
				patch.reasoning_effort = efforts.includes('medium') ? 'medium' : efforts[0];
			}
		}
	}
	if (!Object.keys(patch).length) return false;
	await writeConfig(patch);
	return true;
}
