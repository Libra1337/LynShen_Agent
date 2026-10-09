import { describe, expect, it } from 'vitest';
import { contrast, leastVeil, over, parseColor, SECONDARY_CONTRAST, TEXT_CONTRAST, type RGB } from './readability';

const dark = { bg: [26, 26, 26] as RGB, text: [236, 236, 236] as RGB, dim: [163, 163, 163] as RGB };
const light = { bg: [255, 255, 255] as RGB, text: [31, 31, 31] as RGB, dim: [92, 92, 92] as RGB };
const inks = (t: typeof dark) => [
	{ color: t.text, min: TEXT_CONTRAST },
	{ color: t.dim, min: SECONDARY_CONTRAST }
];

describe('readability over a background image', () => {
	it('reads colours as the theme writes them', () => {
		expect(parseColor('#1a1a1a')).toEqual([26, 26, 26]);
		expect(parseColor(' #fff')).toEqual([255, 255, 255]);
		expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
		expect(parseColor('oklch(0.5 0.1 20)')).toBeNull();
	});

	it('needs no veil where the image already is the theme', () => {
		expect(leastVeil(Array(50).fill(dark.bg), dark.bg, inks(dark))).toBe(0);
	});

	it('veils a busy illustration more than a calm photo', () => {
		// A calm, dark photo and a bright, busy drawing (white with pink and
		// black lines), in the dark theme.
		const calm: RGB[] = Array.from({ length: 100 }, (_, i) => [30 + (i % 20), 40, 60]);
		const busy: RGB[] = Array.from({ length: 100 }, (_, i) =>
			i % 3 === 0 ? [255, 255, 255] : i % 3 === 1 ? [240, 120, 160] : [20, 20, 20]
		);
		const calmVeil = leastVeil(calm, dark.bg, inks(dark));
		const busyVeil = leastVeil(busy, dark.bg, inks(dark));
		expect(calmVeil).toBeLessThan(40);
		expect(busyVeil).toBeGreaterThan(70);
		// And the veil it asks for really holds the contrast on the brightest part.
		const veiled = over(dark.bg, busyVeil / 100, [255, 255, 255]);
		expect(contrast(dark.text, veiled)).toBeGreaterThanOrEqual(TEXT_CONTRAST - 0.05);
		expect(contrast(dark.dim, veiled)).toBeGreaterThanOrEqual(SECONDARY_CONTRAST - 0.05);
	});

	it('looks at the dark parts in the light theme', () => {
		const night: RGB[] = Array.from({ length: 60 }, () => [15, 15, 30]);
		const day: RGB[] = Array.from({ length: 60 }, () => [235, 240, 250]);
		expect(leastVeil(night, light.bg, inks(light))).toBeGreaterThan(leastVeil(day, light.bg, inks(light)));
	});

	it('leaves the few worst spots out', () => {
		const mostlyCalm: RGB[] = [...Array(97).fill([30, 30, 30]), ...Array(3).fill([255, 255, 255])];
		expect(leastVeil(mostlyCalm, dark.bg, inks(dark))).toBeLessThan(10);
	});
});
