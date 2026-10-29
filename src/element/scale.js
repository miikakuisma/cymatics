// The spectrum the engine eats: 1,024 bins of a 2048-point FFT, each 0..1.
//
// The bin count is not a choice. Cymatics.insertFreqSpectrum assumes
// sampleRate / 2048 Hz per bin when it folds bins into its four bands, so any
// other count lands every band in the wrong place.

export const FFT_SIZE = 2048
export const BINS = FFT_SIZE / 2

// What p-audio.js has always done: -100 dBFS is nothing, 0 dBFS is full.
const DB_FLOOR = -100

export function scaleDb(input, out) {
	for (let i = 0; i < input.length; i++) {
		const v = input[i]
		out[i] = v > DB_FLOOR ? Math.min(1, (v - DB_FLOOR) / -DB_FLOOR) : 0
	}
	return out
}

// The byte fallback. With the analyser's minDecibels/maxDecibels set to
// -100/0 (tap.js does), byte data is on the same scale as scaleDb's.
export function scaleBytes(input, out) {
	for (let i = 0; i < input.length; i++) out[i] = input[i] / 255
	return out
}

// Safari has been seen to fill getFloatFrequencyData with -Infinity while the
// byte data is live. Checked per frame, not once: silence at the moment of a
// one-off test would otherwise lock the float path off for good.
export function floatWorks(data) {
	return data[0] > -Infinity || data[10] > -Infinity
}

// Above the noise floor somewhere. A paused element's analyser keeps
// returning frames; this is what tells the element they are silence.
const SIGNAL = 0.05

export function hasSignal(bins) {
	for (let i = 0; i < bins.length; i++) if (bins[i] > SIGNAL) return true
	return false
}
