import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDLE_AFTER_MS, IDLE_EASE_MS, STALE_MS, blend, freshSpectrum, idleSpectrum, idleWeight } from '../src/element/idle.js'

test('the swell stays below a loud song, and is never too faint to draw', () => {
	// Measured in element-test.html: the rings come from the two bass bands
	// (20-250 Hz, bins 1-10), which a loud song drives to about 0.9 and 0.7,
	// and the looks' faraday_threshold of 0.5 hides anything quieter. A swell
	// that left them at 0.2 drew Lines black and Water as a single dot.
	for (const t of [0, 1.3, 4.5, 7, 60, 3600]) {
		const out = idleSpectrum(t, new Float32Array(1024))
		for (const v of out) assert.ok(v >= 0 && v <= 0.9, `${v} at ${t}s`)
		assert.ok(out[2] >= 0.6, `the lowest band can draw at ${t}s: ${out[2]}`)
		assert.ok(out[10] >= 0.45, `the second band can draw at ${t}s: ${out[10]}`)
	}
})

test('the swell is the same for the same time and continuous between nearby times', () => {
	const a = idleSpectrum(12.5, new Float32Array(1024))
	const b = idleSpectrum(12.5, new Float32Array(1024))
	assert.deepEqual([...a], [...b])
	const c = idleSpectrum(12.5 + 1 / 60, new Float32Array(1024))
	for (let i = 0; i < 1024; i++) assert.ok(Math.abs(a[i] - c[i]) < 0.01)
})

test('idleWeight: none while fresh, then eased in, then whole', () => {
	assert.equal(idleWeight(0), 0)
	assert.equal(idleWeight(IDLE_AFTER_MS), 0)
	assert.equal(idleWeight(IDLE_AFTER_MS + IDLE_EASE_MS / 2), 0.5)
	assert.equal(idleWeight(IDLE_AFTER_MS + IDLE_EASE_MS), 1)
	assert.equal(idleWeight(Infinity), 1)
})

test('blend mixes by weight', () => {
	const out = blend(new Float32Array([1, 0]), new Float32Array([0, 1]), 0.25, new Float32Array(2))
	assert.deepEqual([...out], [0.75, 0.25])
})

test('freshSpectrum zeroes a frame nobody has pushed for a while', () => {
	const real = new Float32Array([0.9, 0.8])
	assert.deepEqual([...freshSpectrum(real, STALE_MS - 1)], [0.9, 0.8].map(Math.fround))
	assert.deepEqual([...freshSpectrum(real, STALE_MS + 1)], [0, 0])
})
