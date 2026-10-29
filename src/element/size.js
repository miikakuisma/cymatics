// The canvas is square and covers its box. The engine samples its square wave
// field across the whole canvas, so a 16:9 canvas would stretch the pattern;
// a square on the box's longer side, centred and cropped, is the cover the
// cymatics app has always done with a CSS transform.

export function coverSize(cssWidth, cssHeight, dpr, maxDpr) {
	const side = Math.max(1, Math.round(Math.max(cssWidth, cssHeight)))
	const ratio = Math.min(dpr || 1, maxDpr)
	return { side, pixels: Math.max(1, Math.round(side * ratio)) }
}

export function parseMaxDpr(value, fallback = 2) {
	if (value == null || value === '') return fallback
	const n = Number(value)
	return Number.isFinite(n) && n > 0 ? n : fallback
}
