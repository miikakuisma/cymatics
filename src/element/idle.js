// What the plate does when no music reaches it: a slow, low swell, so a
// visualizer or a backdrop with nothing playing is alive but quiet rather
// than flat. A pure function of time, so it is the same on every screen.

export const IDLE_AFTER_MS = 1000
export const IDLE_EASE_MS = 1500
// A pushed frame older than this is not music any more. Without it a sender
// that stops mid-song would hold the plate at its last loud frame until the
// idle swell took over a second later.
export const STALE_MS = 250

const PERIOD_S = 6

export function idleSpectrum(seconds, out) {
	const breath = 0.5 + 0.5 * Math.sin((seconds * 2 * Math.PI) / PERIOD_S)
	const n = out.length
	for (let i = 0; i < n; i++) {
		const f = i / n
		// Broad enough to fill the two bass bands (20-250 Hz), which are what
		// draws the rings, and breathing across the looks' faraday_threshold
		// of 0.5, so the pattern forms and fades rather than standing still.
		const bass = Math.exp(-f * 30) * (0.65 + 0.2 * breath)
		const mids = Math.exp(-Math.pow((f - 0.08) * 25, 2)) * 0.15 * (1 - breath)
		out[i] = Math.min(0.9, bass + mids)
	}
	return out
}

export function idleWeight(msSinceSignal) {
	if (!(msSinceSignal > IDLE_AFTER_MS)) return 0
	return Math.min(1, (msSinceSignal - IDLE_AFTER_MS) / IDLE_EASE_MS)
}

export function blend(real, idle, weight, out) {
	for (let i = 0; i < out.length; i++) out[i] = real[i] * (1 - weight) + idle[i] * weight
	return out
}

export function freshSpectrum(real, msSincePush) {
	if (msSincePush > STALE_MS) real.fill(0)
	return real
}
