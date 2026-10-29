import { BINS, FFT_SIZE, floatWorks, scaleBytes, scaleDb } from './scale.js'

// An analyser on `node` and the scaling the engine expects. `read` fills and
// returns one frame of BINS values in 0..1.
export function createSpectrumTap(node) {
	const context = node.context
	const analyser = context.createAnalyser()
	analyser.fftSize = FFT_SIZE
	analyser.smoothingTimeConstant = 0.3
	// So the byte fallback is on the same -100..0 dB scale as the float path.
	analyser.minDecibels = -100
	analyser.maxDecibels = 0
	node.connect(analyser)

	const floats = new Float32Array(BINS)
	const bytes = new Uint8Array(BINS)
	return {
		sampleRate: context.sampleRate,
		read(out = new Float32Array(BINS)) {
			analyser.getFloatFrequencyData(floats)
			if (floatWorks(floats)) return scaleDb(floats, out)
			analyser.getByteFrequencyData(bytes)
			return scaleBytes(bytes, out)
		},
		disconnect() {
			try { node.disconnect(analyser) } catch { /* already gone with its context */ }
		},
	}
}
