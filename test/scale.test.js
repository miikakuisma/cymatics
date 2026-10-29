import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BINS, FFT_SIZE, floatWorks, hasSignal, scaleBytes, scaleDb } from '../src/element/scale.js'

test('1,024 bins from a 2048-point FFT', () => {
	assert.equal(FFT_SIZE, 2048)
	assert.equal(BINS, 1024)
})

test('scaleDb maps -100..0 dBFS onto 0..1 and clamps', () => {
	const out = scaleDb(new Float32Array([-100, -50, 0, 12, -140, -Infinity, NaN]), new Float32Array(7))
	assert.deepEqual([...out], [0, 0.5, 1, 1, 0, 0, 0])
})

test('scaleBytes maps 0..255 onto 0..1', () => {
	const out = scaleBytes(new Uint8Array([0, 51, 255]), new Float32Array(3))
	assert.deepEqual([...out].map((v) => Math.round(v * 100) / 100), [0, 0.2, 1])
})

test('floatWorks is false only for a frame Safari left at -Infinity', () => {
	const dead = new Float32Array(16).fill(-Infinity)
	assert.equal(floatWorks(dead), false)
	const live = new Float32Array(16).fill(-Infinity)
	live[10] = -80
	assert.equal(floatWorks(live), true)
})

test('hasSignal ignores the noise floor', () => {
	assert.equal(hasSignal(new Float32Array(1024).fill(0.04)), false)
	const loud = new Float32Array(1024)
	loud[3] = 0.3
	assert.equal(hasSignal(loud), true)
})
