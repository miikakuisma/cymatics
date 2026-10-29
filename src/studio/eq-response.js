// The EQ for a spectrum that never passed through it. A spectrum from the
// host (Music, on the desktop) arrives already analysed, so the studio's
// filters cannot shape it; their frequency response can. Each bin's 0..1 value
// is (dB + 100) / 100, so a gain of g dB moves it by g / 100.

export function binFrequencies(count, sampleRate) {
	const out = new Float32Array(count)
	const hz = sampleRate / (count * 2)
	for (let i = 0; i < count; i++) out[i] = i * hz
	return out
}

export function eqOffsets(filters, freqs, out = new Float32Array(freqs.length)) {
	out.fill(0)
	const mag = new Float32Array(freqs.length)
	const phase = new Float32Array(freqs.length)
	for (const filter of filters) {
		filter.getFrequencyResponse(freqs, mag, phase)
		// NaN where the filters cannot answer (above their Nyquist): no change.
		for (let i = 0; i < freqs.length; i++) {
			if (Number.isFinite(mag[i])) out[i] += (20 * Math.log10(Math.max(mag[i], 1e-6))) / 100
		}
	}
	return out
}

export function applyOffsets(bins, offsets, out) {
	for (let i = 0; i < bins.length; i++) {
		out[i] = bins[i] > 0 ? Math.min(1, Math.max(0, bins[i] + offsets[i])) : 0
	}
	return out
}
