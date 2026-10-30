import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	BESSEL_ROWS, BESSEL_WIDTH, BESSEL_X_MAX, ROUND_MAX_S, SQUARE_MAX_ORDER,
	besselJ, besselZeros, besselTable, modeBinRanges, pickModes, plateFundamentalHz, roundModes, squareModes,
} from '../src/engine-js/modes.js'

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`)

test('Bessel values and zeros match the published ones', () => {
	near(besselJ(0, 0), 1, 1e-12, 'J0(0)')
	near(besselJ(1, 1), 0.4400505857, 1e-9, 'J1(1)')
	near(besselZeros(0, 1)[0], 2.404825557695773, 1e-9, 'first zero of J0')
	near(besselZeros(1, 2)[1], 7.015586669815619, 1e-9, 'second zero of J1')
	// Where the power series loses precision.
	near(besselZeros(8, 6)[5], 29.545659670998546, 1e-9, 'sixth zero of J8 (checked against an 80-digit series)')
})

test('the round plate fits inside its Bessel table', () => {
	const modes = roundModes()
	assert.equal(modes.length, BESSEL_ROWS * ROUND_MAX_S)
	assert.ok(Math.max(...modes.map((m) => m.b)) < BESSEL_X_MAX)
	assert.equal(modes[0].a, 0)
	near(modes[0].ratio, 1, 1e-12, 'lowest mode is the reference')
	const table = besselTable()
	assert.equal(table.length, BESSEL_ROWS * BESSEL_WIDTH)
	for (let n = 0; n < BESSEL_ROWS; n++) {
		const row = table.subarray(n * BESSEL_WIDTH, (n + 1) * BESSEL_WIDTH)
		near(Math.max(...row.map(Math.abs)), 1, 1e-6, `row ${n} peak`)
	}
})

test('square modes are sorted by m² + n², split into ± pairs, and skip the flat plate', () => {
	const modes = squareModes(12)
	// 13·14/2 − 1 index pairs, all but the 12 with m = n split in two.
	assert.equal(modes.length, 2 * ((13 * 14) / 2 - 1) - 12)
	assert.equal(squareModes().at(-1).ratio, 2 * SQUARE_MAX_ORDER ** 2)
	assert.deepEqual(modes[0], { a: 0, b: 1, mix: -1, ratio: 1 })
	assert.equal(modes[1].mix, 1)
	assert.ok(modes[1].ratio > 1 && modes[1].ratio < Math.pow(2, 1 / 12))
	for (let i = 1; i < modes.length; i++) assert.ok(modes[i].ratio >= modes[i - 1].ratio)
})

test('each mode listens near its own frequency', () => {
	const modes = [{ ratio: 1 }, { ratio: 25 }, { ratio: 10000 }]
	const r = modeBinRanges(modes, 40, 44100, 1024)
	const binHz = 44100 / 2048
	// 40 Hz sits between bins 1 and 2; the range must include the nearest.
	assert.ok(r[0] <= 2 && r[1] >= 2)
	// 1 kHz: bins within a semitone of 1000 Hz.
	assert.ok(r[2] * binHz < 1000 && r[3] * binHz > 1000)
	// 400 kHz is past Nyquist: empty.
	assert.ok(r[4] > r[5])
})

test('pickModes keeps the strongest few and sharpens the rest', () => {
	const env = new Float32Array([0.2, 0.9, 0.6, 0.95, 0.55, 0.7])
	const out = new Float32Array(8)
	const n = pickModes(env, 0.5, 4, out)
	assert.equal(n, 4)
	assert.deepEqual([out[0], out[2], out[4], out[6]], [3, 1, 5, 2])
	near(out[1], 0.45, 1e-6, 'strongest keeps its level')
	near(out[3], 0.4 * (0.4 / 0.45) ** 2, 1e-6, 'second is sharpened')
	assert.equal(pickModes(env, 0.96, 4, out), 0)
})

test('Distance is the plate size: farther out, every mode rings lower', () => {
	near(plateFundamentalHz(0.1), 40, 1e-9, 'factory Distance keeps 40 Hz')
	assert.ok(plateFundamentalHz(0.5) < plateFundamentalHz(0.1))
	assert.ok(plateFundamentalHz(0.01) > plateFundamentalHz(0.1))
	// A whistle (~1.5 kHz) at the farthest Distance reaches far past the old
	// 12-line ceiling and still fits the list.
	const ratio = 1500 / plateFundamentalHz(0.5)
	assert.ok(ratio > 2 * 12 ** 2 && ratio < 2 * SQUARE_MAX_ORDER ** 2, `ratio ${ratio}`)
})
