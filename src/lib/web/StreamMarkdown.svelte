<script lang="ts">
	// A reasoning or answer still streaming, at the cost of what each delta
	// adds: its finished blocks as Markdown, each rendered once (ReplyStream),
	// and the block being written after them as plain text, in blocks written
	// once (streamPlain), both read from the reply's deltas. Rendering the
	// whole text as Markdown on every delta parsed, sanitized and laid out all
	// of it again: the frame time and the memory grew with its length. Once
	// finished, the text renders whole as Markdown (MessageItem).
	import Markdown from '$lib/Markdown.svelte';
	import { ReplyStream } from '$lib/streamBlocks';
	import { streamPlain, type PlainSource } from '$lib/streamPlain';

	let { source }: { source: PlainSource } = $props();

	const stream = new ReplyStream();
	const parts = $derived(stream.parts(source.length, source.read));
	// Each changes only when a block finishes: the blocks are not walked again
	// on every delta.
	const blocks = $derived(parts.blocks);
	const split = $derived(parts.split);
	const tail = $derived.by((): PlainSource => {
		const { length, read } = source;
		const from = split;
		return { length: length - from, read: (a, b) => read(from + a, from + b) };
	});
</script>

<div class="stream">
	<!-- The finished blocks in a box of their own, which changes only when a
	     block finishes: a frame that grows the tail lays the box out as it
	     was, not each block in it again (as siblings of the tail they were,
	     a frame cost every block). -->
	{#if blocks.length}
		<div class="done">{#each blocks as block (block.key)}<Markdown text={block.text} />{/each}</div>
	{/if}
	<!-- Written again from its start when the split moves (a block
	     finished, or a code fence closed). There while it is empty too,
	     holding the cursor until the next block starts: a cursor rule that
	     reached into the last finished block restyled the whole box each
	     time a block finished. -->
	{#key split}<div class="tail" use:streamPlain={tail}></div>{/key}
</div>

<style>
	.tail {
		white-space: pre-wrap;
		line-height: 1.65;
		word-break: break-word;
	}
	/* The blocks read as the one Markdown they become: a paragraph's space
	   between them, as each block drops its own last margin (Markdown). */
	.done > :global(.md + .md),
	.done + .tail {
		margin-top: 10px;
	}
</style>
