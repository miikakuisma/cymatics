import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overDefaults, setEngineDefaults } from '../src/studio/look-config.js'

const DEFAULTS = {
	renderer: { roughness: 0.3, metalness: 0.9, emissive_mode: false, trail_amount: 0 },
	cymatics: { view_scale: 0.2, mandala_mode: 0 },
	liquid: { speed_mul: 1 },
}

// What the studio loads goes over the engine's own defaults, as the element
// lays them: a key the preset leaves out is the engine's, never whatever the
// plate wore before.
test('keys a preset leaves out are the engine defaults; its own keys win', () => {
	const out = overDefaults({ poleMode: 'star8', renderer: { emissive_mode: true }, cymatics: { view_scale: 0.1, dynamicFreqDetail: true }, liquid: {} }, DEFAULTS)
	assert.deepEqual(out.renderer, { roughness: 0.3, metalness: 0.9, emissive_mode: true, trail_amount: 0 })
	assert.deepEqual(out.cymatics, { view_scale: 0.1, mandala_mode: 0, dynamicFreqDetail: true })
	assert.equal(out.poleMode, 'star8')
})

test('a missing section is all defaults, and the defaults are never written', () => {
	const out = overDefaults({ renderer: { roughness: 0 } }, DEFAULTS)
	assert.deepEqual(out.liquid, { speed_mul: 1 })
	out.liquid.speed_mul = 9
	assert.equal(DEFAULTS.liquid.speed_mul, 1)
})

test('the defaults recorded at mount are used when none are passed', () => {
	setEngineDefaults(DEFAULTS)
	assert.equal(overDefaults({ renderer: {}, cymatics: {}, liquid: {} }).renderer.metalness, 0.9)
})
