// The models the native engine offers, read from config.json before any
// engine has reported its own list (a draft, the home page).

/** config.json's `models`, or, before the engine first wrote them (a new
 *  install signed in to the gateway), the gateway models picked to show
 *  (`lynshen_models`): the engine runs on those whenever the provider is
 *  the gateway. Entries without a name are skipped. */
export function configModelList(cfg: Record<string, unknown>): Record<string, unknown>[] {
	const named = (key: string) =>
		(Array.isArray(cfg[key]) ? (cfg[key] as unknown[]) : []).filter(
			(m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).name === 'string' && (m as Record<string, unknown>).name !== ''
		);
	const models = named('models');
	if (models.length) return models;
	return cfg.provider === 'lynshen' || cfg.provider === 'monoize' ? named('lynshen_models') : [];
}
