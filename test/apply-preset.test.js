import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPreset } from '../src/element/apply-preset.js'

const fake = () => ({ sent: [], command(s) { this.sent.push(s) } })
const DEFAULT_LIGHTS = [{ pos: [1, 1, -5], color: [1, 0, 0] }]
const defaults = () => ({
	renderer: { metalness: 0.5, lights: DEFAULT_LIGHTS },
	cymatics: { view_scale: 0.2, contour_count: 12 },
	liquid: { speed_mul: 1 },
})

test('each section is the defaults with the preset over them, modulator keys removed', () => {
	const engine = fake()
	applyPreset(engine, defaults(), { cymatics: { view_scale: 0.1, dynamicFreqDetail: true } })
	assert.equal(engine.sent.length, 3)
	assert.match(engine.sent[0], /^set renderer /)
	assert.equal(engine.sent[1], 'set cymatics ' + JSON.stringify({ view_scale: 0.1, contour_count: 12 }))
	assert.match(engine.sent[2], /^set liquid /)
})

test('returns the merged lights and view_scale', () => {
	const lights = [{ pos: [0, 0, -10], color: [1, 1, 1] }]
	const result = applyPreset(fake(), defaults(), { renderer: { lights }, cymatics: { view_scale: 0.1 } })
	assert.deepEqual(result.lights, lights)
	assert.equal(result.viewScale, 0.1)
})

test('a preset with no lights key gets the default lights; lights: [] stays empty', () => {
	assert.deepEqual(applyPreset(fake(), defaults(), {}).lights, DEFAULT_LIGHTS)
	assert.deepEqual(applyPreset(fake(), defaults(), { renderer: { lights: [] } }).lights, [])
})

test('a missing section is all defaults', () => {
	const engine = fake()
	const d = defaults()
	const result = applyPreset(engine, d, {})
	assert.equal(engine.sent[2], 'set liquid ' + JSON.stringify(d.liquid))
	assert.equal(result.viewScale, 0.2)
	assert.ok(result.mods)
})
