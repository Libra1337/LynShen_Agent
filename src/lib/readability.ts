// Text over a custom background. The canvas and the chrome lay a veil of the
// theme's colour over the image; a fixed veil reads well on a calm photo and
// not on a busy, high-contrast illustration. The least veil that keeps the
// text readable over (nearly) every part of the image is worked out from the
// image itself, and the user's strength can only make it stronger.

export type RGB = [number, number, number];

/** `#rrggbb`, `#rgb` or `rgb(r, g, b)`; null for anything else. */
export function parseColor(css: string): RGB | null {
	const text = css.trim();
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)?.[1];
	if (hex) {
		const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
		return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
	}
	const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
	return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

const linear = (c: number) => {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export const luminance = ([r, g, b]: RGB) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** WCAG contrast ratio, 1–21. */
export function contrast(a: RGB, b: RGB): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** What `veil` (0–1) of `color` over `under` paints: the browser blends a
 *  translucent fill in sRGB. */
export const over = (color: RGB, veil: number, under: RGB): RGB =>
	[0, 1, 2].map((i) => color[i] * veil + under[i] * (1 - veil)) as RGB;

/** A text colour and the contrast it must keep. */
export interface Ink {
	color: RGB;
	min: number;
}

/** WCAG AA: body text at 4.5, the rest is held a step above it. */
export const TEXT_CONTRAST = 7;
export const SECONDARY_CONTRAST = 4.5;

/** The least veil of `bg` (0–1) over `under` that keeps every ink readable. */
function veilFor(bg: RGB, under: RGB, inks: Ink[]): number {
	const ok = (veil: number) => inks.every((ink) => contrast(ink.color, over(bg, veil, under)) >= ink.min);
	if (ok(0)) return 0;
	if (!ok(1)) return 1;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 14; i++) {
		const mid = (lo + hi) / 2;
		if (ok(mid)) hi = mid;
		else lo = mid;
	}
	return hi;
}

/** The least veil, in whole percent, that keeps `inks` readable over all
 *  but the `spare` share of the image's `samples` that need the most. */
export function leastVeil(samples: RGB[], bg: RGB, inks: Ink[], spare = 0.05): number {
	if (!samples.length) return 0;
	const needs = samples.map((sample) => veilFor(bg, sample, inks)).sort((a, b) => a - b);
	const at = Math.min(needs.length - 1, Math.floor(needs.length * (1 - spare)));
	return Math.ceil(needs[at] * 100);
}

/** The image at `src` as a small grid of colours (a blur of sorts: each
 *  sample averages a patch). Browser only. */
export async function sampleImage(src: string, columns = 48): Promise<RGB[]> {
	const image = new Image();
	image.decoding = 'async';
	image.src = src;
	await image.decode();
	const rows = Math.max(1, Math.round((columns * image.naturalHeight) / Math.max(1, image.naturalWidth)));
	const canvas = document.createElement('canvas');
	canvas.width = columns;
	canvas.height = rows;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return [];
	context.imageSmoothingQuality = 'high';
	context.drawImage(image, 0, 0, columns, rows);
	const data = context.getImageData(0, 0, columns, rows).data;
	const samples: RGB[] = [];
	for (let i = 0; i < data.length; i += 4) samples.push([data[i], data[i + 1], data[i + 2]]);
	return samples;
}

/** The image at `src`, so small that the browser's scaling blurs it when it
 *  covers the window: a calm plate to read on, made once. Browser only. */
export async function softImage(src: string, width = 160): Promise<string> {
	const image = new Image();
	image.decoding = 'async';
	image.src = src;
	await image.decode();
	const height = Math.max(1, Math.round((width * image.naturalHeight) / Math.max(1, image.naturalWidth)));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) return '';
	context.imageSmoothingQuality = 'high';
	context.drawImage(image, 0, 0, width, height);
	return canvas.toDataURL('image/jpeg', 0.85);
}

