import { fetchMonoizeModels, type MonoizeModel, type MonoizeRoute } from '$lib/protocol';
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

/**
 * Turns the gateway's model list into picker entries. Metadata comes from what
 * the user already configured for that id, else the bundled catalog, so every
 * model keeps its reasoning efforts (a model with none listed would offer only
 * "none" in the picker).
 */
export function monoizeEntries(list: MonoizeModel[], known: { name: string }[] = []): MonoizeModelEntry[] {
	const stored = new Map(known.map((m) => [m.name, m]));
	return list
		.filter((m) => !m.routing_status || m.routing_status === 'ready')
		.map((m) => {
			const previous = stored.get(m.id) as Partial<MonoizeModelEntry> | undefined;
			const catalog = catalogModel(m.id);
			const efforts = previous?.reasoning_efforts?.length ? previous.reasoning_efforts : catalog?.reasoning_efforts;
			return {
				...catalog,
				...previous,
				name: m.id,
				display_name: m.id,
				groups: m.groups ?? [],
				routes: m.providers ?? [],
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
}
