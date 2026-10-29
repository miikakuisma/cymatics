import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	OCTAVE_EDGES_HZ, MODULATORS, createBandFollower, createModulators, gate, hexToRgb,
	isModulatorKey, mean, mix, octaveBands, presetModulators,
} from '../src/element/modulate.js'

const loud = () => new Float32Array(1024).fill(0.9)

test('eight octave bands from 40 Hz', () => {
	assert.deepEqual(OCTAVE_EDGES_HZ, [40, 80, 160, 320, 640, 1280, 2560, 5120, 10240])
})

test('octaveBands averages the bins inside each band', () => {
	const bins = new Float32Array(1024)
	for (let i = 14; i < 27; i++) bins[i] = 1 // 48 kHz: band 4 is bins 14..26
	const bands = octaveBands(bins, 48000)
	assert.equal(bands[3], 1)
	assert.equal(bands[0], 0)
})

test('gate rises at speed and falls at 15 % of it; mix lerps numbers and colours', () => {
	assert.equal(gate(0, 1, 0.8), 0.8)
	assert.ok(Math.abs(gate(1, 0, 0.8) - (1 - 0.12)) < 1e-9)
	assert.equal(mix(2, 4, 0.5), 3)
	assert.deepEqual(mix([0, 0, 0], [1, 0.5, 0], 0.5), [0.5, 0.25, 0])
	assert.equal(mean(loud()), Math.fround(0.9))
})

test('the follower smooths like the studio: fast up, slow down', () => {
	const f = createBandFollower()
	f.step(loud(), 48000, { now: 0 })
	assert.ok(Math.abs(f.bands[3] - 0.63) < 1e-6) // 0 * 0.3 + 0.9 * 0.7
	assert.ok(Math.abs(f.overall - 0.27) < 1e-6) // 0 * 0.7 + 0.9 * 0.3
	f.step(new Float32Array(1024), 48000, { now: 16 })
	assert.ok(Math.abs(f.bands[3] - 0.504) < 1e-6) // 0.63 * 0.8
})

test('value: bandN, overall, kick, legacy names, and overall for anything else', () => {
	const f = createBandFollower()
	f.step(loud(), 48000, { now: 0 })
	assert.equal(f.value('band4'), f.bands[3])
	assert.equal(f.value('overall'), f.overall)
	assert.equal(f.value('bass'), f.bands[1])
	assert.equal(f.value('mid'), f.bands[3])
	assert.equal(f.value('high'), f.bands[6])
	assert.equal(f.value('band12'), f.overall)
	assert.equal(f.value(undefined), f.overall)
	assert.equal(f.value('kick'), f.kick)
})

test('a bass jump over its running average fires the kick, which then decays', () => {
	const f = createBandFollower()
	const quiet = new Float32Array(1024).fill(0.1)
	for (let i = 0; i < 43; i++) f.step(quiet, 48000, { now: i * 16 })
	const hit = new Float32Array(1024).fill(0.1)
	hit.fill(0.9, 0, 6)
	f.step(hit, 48000, { now: 43 * 16 })
	assert.ok(f.kick >= 0.7)
	const after = f.kick
	f.step(quiet, 48000, { now: 44 * 16 })
	assert.ok(Math.abs(f.kick - after * 0.88) < 1e-9)
})

test('a beat kick replaces the flux kick and lifts every band', () => {
	const f = createBandFollower()
	f.step(new Float32Array(1024), 48000, { now: 0, beatKick: 1 })
	assert.equal(f.kick, 1)
	assert.ok(Math.abs(f.bands[0] - 0.5) < 1e-6)
})

test('hexToRgb', () => {
	assert.deepEqual(hexToRgb('#ff6600'), [1, 0.4, 0])
	assert.deepEqual(hexToRgb([0.1, 0.2, 0.3]), [0.1, 0.2, 0.3])
	assert.equal(hexToRgb('nope'), null)
})

test('every studio modulator is in the table', () => {
	assert.deepEqual(MODULATORS.map((m) => m.prefix).sort(), [
		'autoResponseSpeed', 'dynamicContourCount', 'dynamicFaradayThreshold', 'dynamicFreqDetail',
		'dynamicLightColor', 'dynamicLightDistance', 'dynamicLineColor', 'dynamicViewScale',
	])
})

test('presetModulators: only those switched on, saved values first', () => {
	const specs = presetModulators({
		renderer: { dynamicLineColor: true, dynamicLineColorBand: 'band4', dynamicLineColorMin: '#000000', dynamicLineColorMax: '#ffffff' },
		cymatics: { dynamicFreqDetail: false, dynamicContourCount: true, dynamicContourCountSpeed: 0.5 },
	})
	assert.deepEqual(specs.map((s) => s.name).sort(), ['dynamicContourCount', 'dynamicLineColor'])
	const line = specs.find((s) => s.name === 'dynamicLineColor')
	assert.equal(line.band, 'band4')
	assert.deepEqual(line.min, [0, 0, 0])
	assert.deepEqual(line.max, [1, 1, 1])
	assert.equal(line.slow, true)
	const contour = specs.find((s) => s.name === 'dynamicContourCount')
	assert.equal(contour.speed, 0.5)
	assert.equal(contour.round, true)
})

test('presetModulators: a modulator with no sub-keys gets the studio defaults', () => {
	const [detail] = presetModulators({ cymatics: { dynamicFreqDetail: true } })
	assert.deepEqual(
		{ band: detail.band, trigger: detail.trigger, speed: detail.speed, min: detail.min, max: detail.max },
		{ band: 'band7', trigger: 0.3, speed: 0.8, min: 1, max: 3 },
	)
	const [color] = presetModulators({ renderer: { dynamicLineColor: true, dynamicLineColorMin: 'garbage' } })
	assert.deepEqual(color.min, hexToRgb('#003366'))
})

test('presetModulators: nothing for a preset without sections', () => {
	assert.deepEqual(presetModulators({}), [])
	assert.deepEqual(presetModulators(null), [])
})

test('isModulatorKey knows the saved keys and nothing else', () => {
	for (const key of ['dynamicLineColor', 'dynamicLineColorMax', 'autoResponseSpeedValue', 'kickBeatDiv']) {
		assert.equal(isModulatorKey(key), true, key)
	}
	for (const key of ['view_scale', 'color_outer', 'lights', 'dynamic']) assert.equal(isModulatorKey(key), false, key)
})

test('fast modulators apply on every frame they move past epsilon; slow ones every fourth frame', () => {
	const mods = createModulators(presetModulators({
		cymatics: { dynamicFreqDetail: true, dynamicFreqDetailBand: 'overall', dynamicFreqDetailSpeed: 1, dynamicFreqDetailMin: 2, dynamicFreqDetailMax: 5,
			dynamicViewScale: true, dynamicViewScaleBand: 'overall', dynamicViewScaleSpeed: 1 },
	}))
	const f = createBandFollower()
	const applied = []
	for (let i = 0; i < 8; i++) {
		f.step(loud(), 48000, { now: i * 16 })
		mods.step(f, (section, key, value) => applied.push([key, value]))
	}
	// Frame 1: the smoothed overall (0.27) is under the trigger, so min (2).
	// Frame 2: over it (0.459), the gate opens at speed 1, so max (5). Then
	// nothing: the value stays within epsilon.
	const detail = applied.filter(([key]) => key === 'freq_detail_scale')
	assert.deepEqual(detail, [['freq_detail_scale', 2], ['freq_detail_scale', 5]])
	assert.equal(applied.filter(([key]) => key === 'view_scale').length, 2) // frames 4 and 8
})

test('light modulators write the first light of the base lights, once per fourth frame', () => {
	const base = [{ pos: [0, 0, 30], color: [0.5, 0.5, 0.5] }, { pos: [1, 1, 1], color: [0, 0, 0] }]
	const mods = createModulators(presetModulators({
		renderer: { dynamicLightDistance: true, dynamicLightDistanceSpeed: 1, dynamicLightColor: true, dynamicLightColorSpeed: 1 },
	}), { lights: () => base })
	const f = createBandFollower()
	const applied = []
	for (let i = 0; i < 4; i++) {
		f.step(loud(), 48000, { now: i * 16 })
		mods.step(f, (section, key, value) => applied.push([section, key, value]))
	}
	assert.equal(applied.length, 1)
	const [section, key, lights] = applied[0]
	assert.equal(section, 'renderer')
	assert.equal(key, 'lights')
	// The smoothed overall passes the trigger on frame 2, so by frame 4 both
	// gates are open: the maxima, 49 and #ffffff.
	assert.equal(lights[0].pos[2], 49)
	assert.deepEqual(lights[0].color, [1, 1, 1])
	assert.deepEqual(lights[1], base[1])
	assert.deepEqual(base[0], { pos: [0, 0, 30], color: [0.5, 0.5, 0.5] }) // the base is never written
})

test('update keeps the gates of modulators that stay', () => {
	const on = presetModulators({ cymatics: { dynamicContourCount: true, dynamicContourCountBand: 'overall', dynamicContourCountSpeed: 0.5 } })
	const mods = createModulators(on)
	const f = createBandFollower()
	const seen = []
	f.step(loud(), 48000, { now: 0 })
	mods.step(f, (s, k, v) => seen.push(v))
	mods.update(presetModulators({ cymatics: { dynamicContourCount: true, dynamicContourCountBand: 'overall', dynamicContourCountSpeed: 0.5 } }))
	f.step(loud(), 48000, { now: 16 })
	mods.step(f, (s, k, v) => seen.push(v))
	assert.ok(seen[seen.length - 1] > seen[0])
})

test('no modulators, no work', () => {
	let called = false
	createModulators([]).step(createBandFollower(), () => { called = true })
	assert.equal(called, false)
})
