import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyOffsets, binFrequencies, eqOffsets } from '../src/studio/eq-response.js'

// A filter that answers getFrequencyResponse with a fixed gain in dB.
const flat = (db) => ({ getFrequencyResponse(freqs, mag) { mag.fill(10 ** (db / 20)) } })

test('bin frequencies at 48 kHz are 23.4375 Hz apart', () => {
	const f = binFrequencies(1024, 48000)
	assert.equal(f[0], 0)
	assert.equal(f[1], 23.4375)
})

test('offsets are the filters\' summed gain, in hundredths of a dB', () => {
	const offsets = eqOffsets([flat(6), flat(-2)], binFrequencies(4, 48000))
	for (const v of offsets) assert.ok(Math.abs(v - 0.04) < 1e-6)
})

test('a flat EQ changes nothing', () => {
	const offsets = eqOffsets([flat(0)], binFrequencies(4, 48000))
	assert.deepEqual([...offsets], [0, 0, 0, 0])
})

test('offsets lift or cut a bin, clamped to 0..1, and silence stays silent', () => {
	const out = applyOffsets(new Float32Array([0, 0.5, 0.99, 0.02]), new Float32Array([0.1, 0.1, 0.1, -0.1]), new Float32Array(4))
	assert.deepEqual([...out].map((v) => Math.round(v * 100) / 100), [0, 0.6, 1, 0])
})

// Web Audio answers NaN for a frequency above the filters' Nyquist: a Music
// feed at 96 kHz against filters made at 48 kHz. That must change nothing,
// not turn half of every frame into NaN.
test('a frequency the filters cannot answer changes nothing', () => {
	const nan = { getFrequencyResponse(freqs, mag) { mag.fill(NaN) } }
	assert.deepEqual([...eqOffsets([nan, flat(6)], binFrequencies(4, 96000))].map((v) => Math.round(v * 100) / 100), [0.06, 0.06, 0.06, 0.06])
})
