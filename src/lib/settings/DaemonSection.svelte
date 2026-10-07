<script lang="ts">
	// Settings → 远程访问: reaching this computer's lynshen daemon from a
	// phone — the relay switch, pairing and paired devices. Persists the
	// LAN address to the backend settings in localStorage.
	import type { Snippet } from 'svelte';
	import { loadBackendSettings, saveBackendSettings } from '$lib/backends/settings';
	import DevicePairing from './DevicePairing.svelte';
	import SettingsSection from './SettingsSection.svelte';

	let { children }: { children?: Snippet } = $props();

	let settings = $state(loadBackendSettings());

	function persist() {
		saveBackendSettings({ ...loadBackendSettings(), remoteAddress: settings.remoteAddress.trim() });
	}
</script>

{@render children?.()}
<SettingsSection id="remote">
	<DevicePairing bind:address={settings.remoteAddress} onAddressChange={persist} />
</SettingsSection>
