import { fetchMonoizeModels, readConfig, writeConfig, type MonoizeModel, type MonoizeRoute } from '$lib/protocol';
import { PROVIDER_CATALOG } from './catalog';

/** A gateway model as the picker and config.json hold it. */
export interface MonoizeModelEntry {
	/** The request id; never a display label. */
	name: string;
	/** What pickers show: the model id alone (the route is `groups`). */
	display_name: string;
	/** Gateway Groups that route this model for the signed-in key. */
	groups: string[];
	/** The Providers the key may pick for this model, in routing order. */
	routes: MonoizeRoute[];
	reasoning_efforts?: string[];
	context_window?: number;
	max_output_tokens?: number;
	[key: string]: unknown;
}

type CatalogModel = { name: string; reasoning_efforts?: string[]; context_window?: number; max_output_tokens?: number };

/** The bundled catalog's metadata for a gateway id. Gateway ids and catalog
 *  names can differ in case ("DeepSeek-V4.1-Flash" / "deepseek-v4.1-flash"). */
function catalogModel(id: string): CatalogModel | undefined {
	const template = PROVIDER_CATALOG.providers.find((p) => p.id === 'monoize');
	const models = (template?.models ?? []) as CatalogModel[];
	return models.find((m) => m.name === id) ?? models.find((m) => m.name.toLowerCase() === id.toLowerCase());
}

/** The window assumed for a gateway model nobody registered one for: an
 *  engine compacts only against a known window, and none would mean never. */
export const FALLBACK_CONTEXT_WINDOW = 128_000;

/**
 * Turns the gateway's model list into picker entries. Metadata comes from what
 * the user already configured for that id, else the bundled catalog, so every
 * model keeps its reasoning efforts (a model with none listed would offer only
 * "none" in the picker). The window is the gateway's registered one when it has
 * one (the engine compacts at a share of it), else the one already stored, else
 * the catalog's, else FALLBACK_CONTEXT_WINDOW.
 */
export function monoizeEntries(list: MonoizeModel[], known: { name: string }[] = []): MonoizeModelEntry[] {
	const stored = new Map(known.map((m) => [m.name, m]));
	return list
		.filter((m) => !m.routing_status || m.routing_status === 'ready')
		.map((m) => {
			const previous = stored.get(m.id) as Partial<MonoizeModelEntry> | undefined;
			const catalog = catalogModel(m.id);
			const efforts = previous?.reasoning_efforts?.length ? previous.reasoning_efforts : catalog?.reasoning_efforts;
			const window = m.context_window || previous?.context_window || catalog?.context_window || FALLBACK_CONTEXT_WINDOW;
			const output = m.max_output_tokens || previous?.max_output_tokens || catalog?.max_output_tokens;
			return {
				...catalog,
				...previous,
				name: m.id,
				display_name: m.id,
				groups: m.groups ?? [],
				routes: m.providers ?? [],
				context_window: window,
				...(output ? { max_output_tokens: output } : {}),
				...(efforts?.length ? { reasoning_efforts: efforts } : {})
			};
		});
}

/** Update labels from the current key's routes, retaining model configuration. */
export async function refreshMonoizeCatalog() {
	const template = PROVIDER_CATALOG.providers.find((p) => p.id === 'monoize');
	if (!template) return;
	const list = await fetchMonoizeModels();
	const custom = JSON.parse(localStorage.getItem('lynshen-custom-providers') || '[]');
	const existing = custom.find((p: { id: string }) => p.id === 'monoize');
	const models = monoizeEntries(list, existing?.models ?? []);
	const entry = { ...existing, id: 'monoize', name: template.name, base_url: template.base_url,
		format: template.protocol, builtin: false, source: 'catalog', models };
	localStorage.setItem('lynshen-custom-providers', JSON.stringify([...custom.filter((p: { id: string }) => p.id !== 'monoize'), entry]));
	// An engine on the gateway reads its windows (and compacts by them) from
	// config.json: keep them current there too, not only when Settings is open.
	const cfg = await readConfig().catch(() => null);
	if (cfg) {
		const patch = pickedMonoizeModels(models, cfg);
		if (Object.keys(patch).length) await writeConfig(patch);
	}
}

/** What config.json keeps of the gateway list: the models chosen to show
 *  (`lynshen_models`) that the key can still reach — one whose group was
 *  taken away is dropped — and, on the gateway, the engine's model list:
 *  those picks in their order, or every model when nothing was picked. */
export function pickedMonoizeModels(
	models: MonoizeModelEntry[],
	cfg: Record<string, unknown>
): Record<string, unknown> {
	const live = new Map(models.map((m) => [m.name, m]));
	const saved = Array.isArray(cfg.lynshen_models) ? (cfg.lynshen_models as { name?: unknown }[]) : [];
	const picked = saved.filter((m) => live.has(String(m.name)));
	const patch: Record<string, unknown> = {};
	if (picked.length !== saved.length) patch.lynshen_models = picked;
	// A Provider pinned for a model that no longer serves it would be refused
	// (provider_unavailable): the gateway picks again once the pin is gone.
	const pins = (cfg.monoize_providers ?? {}) as Record<string, string>;
	const keptPins = Object.fromEntries(
		Object.entries(pins).filter(([model, route]) => live.get(model)?.routes.some((r) => r.id === route))
	);
	if (Object.keys(keptPins).length !== Object.keys(pins).length) patch.monoize_providers = keptPins;
	if (cfg.provider === 'monoize') {
		const shown = picked.length ? picked.map((m) => live.get(String(m.name))!) : models;
		patch.models = shown;
		if (shown.length && !shown.some((m) => m.name === cfg.model)) patch.model = shown[0].name;
	}
	return patch;
}
