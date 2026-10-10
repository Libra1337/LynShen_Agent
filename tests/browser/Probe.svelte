<script lang="ts">
  // A tab's content that counts its mounts and scrolls.
  import { onMount } from 'svelte';
  let { id }: { id: string } = $props();
  onMount(() => {
    const w = window as unknown as { __mounts: Record<string, number> };
    w.__mounts[id] = (w.__mounts[id] ?? 0) + 1;
  });
</script>
<div data-probe={id} style="height:100%;overflow:auto">{#each Array(200) as _, i (i)}<div>{id} {i}</div>{/each}</div>
