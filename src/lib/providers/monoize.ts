import { fetchMonoizeModels, monoizeModelEntries } from '$lib/protocol';
import { PROVIDER_CATALOG } from './catalog';

/** Update labels from the current key's routes, retaining model configuration. */
export async function refreshMonoizeCatalog() {
	const template = PROVIDER_CATALOG.providers.find(p => p.id === 'monoize');
	if (!template) return;
	const list = await fetchMonoizeModels();
	const custom = JSON.parse(localStorage.getItem('lynshen-custom-providers') || '[]');
	const existing = custom.find((p: { id: string }) => p.id === 'monoize');
	const models = list.filter(m => !m.routing_status || m.routing_status === 'ready').map(m => ({
		...existing?.models?.find((known: { name: string }) => known.name === m.id),
		name: m.id,
		display_name: monoizeModelEntries({ model_id: m.id, groups: m.groups }).join(' / ')
	}));
	const entry = { ...existing, id: 'monoize', name: template.name, base_url: template.base_url,
		format: template.protocol, builtin: false, source: 'catalog', models };
	localStorage.setItem('lynshen-custom-providers', JSON.stringify([...custom.filter((p: { id: string }) => p.id !== 'monoize'), entry]));
}
