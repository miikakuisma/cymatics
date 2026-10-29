import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PRESET_BYTES, PRESET_FORMAT, PRESET_VERSION, parsePresetFile, presetFile } from '../src/preset.js'

const PRESET = {
	poleMode: 'star8',
	renderer: { emissive_mode: true, color_outer: [0.2, 0.4, 0.8], dynamicLineColor: true },
	cymatics: { view_scale: 0.1, poles: [[1, 0, 0]], dynamicFreqDetail: true },
	liquid: { speed_mul: 1.1 },
}
const file = (over = {}) => JSON.stringify({ format: PRESET_FORMAT, version: PRESET_VERSION, preset: PRESET, ...over })

test('a file round-trips', () => {
	assert.deepEqual(parsePresetFile(presetFile(PRESET)).preset, PRESET)
})

test('presetFile writes the wrapper', () => {
	const data = JSON.parse(presetFile(PRESET))
	assert.equal(data.format, 'cymatics')
	assert.equal(data.version, 1)
})

test('unknown keys are ignored, at the top and in the preset', () => {
	const { preset } = parsePresetFile(file({ extra: 1, preset: { ...PRESET, thumbnail: 'x' } }))
	assert.equal('thumbnail' in preset, false)
	assert.deepEqual(preset.renderer, PRESET.renderer)
})

test('legacy map paths are dropped', () => {
	const { preset } = parsePresetFile(file({ preset: { ...PRESET, cymatics: { ...PRESET.cymatics, reflectionImage: 'dot.png', refractionImage: 'empty.png' } } }))
	assert.equal('reflectionImage' in preset.cymatics, false)
	assert.equal('refractionImage' in preset.cymatics, false)
})

for (const [label, text, message] of [
	['not JSON', '{nope', /not a Cymatics preset/],
	['another JSON file', JSON.stringify({ name: 'package' }), /not a Cymatics preset/],
	['a newer version', file({ version: 2 }), /newer Cymatics/],
	['an unreadable version', file({ version: 'one' }), /not a Cymatics preset/],
	['no sections', file({ preset: { poleMode: 'x' } }), /missing its settings/],
	['a section that is not an object', file({ preset: { ...PRESET, liquid: [1] } }), /missing its settings/],
	['an infinite number', file().replace('0.1', '1e999'), /not a number/],
	['a word where a number belongs', file({ preset: { ...PRESET, cymatics: { ...PRESET.cymatics, view_scale: 'big' } } }), /not a number/],
	['a broken pole', file({ preset: { ...PRESET, cymatics: { ...PRESET.cymatics, poles: [[1, 'x', 0]] } } }), /not a number/],
]) {
	test(`refuses ${label}`, () => {
		assert.throws(() => parsePresetFile(text), message)
	})
}

test('refuses a file over 2 MB', () => {
	const big = file({ preset: { ...PRESET, renderer: { ...PRESET.renderer, floor_image: 'x'.repeat(MAX_PRESET_BYTES) } } })
	assert.throws(() => parsePresetFile(big), /larger than 2 MB/)
})

test('a floor image inside the limit is kept', () => {
	const image = `data:image/jpeg;base64,${'A'.repeat(1000)}`
	const { preset } = parsePresetFile(file({ preset: { ...PRESET, renderer: { ...PRESET.renderer, floor_image: image } } }))
	assert.equal(preset.renderer.floor_image, image)
})

// A floor picture travels inside the preset. Anything else in that key would
// make every page wearing the preset fetch it: from a shared file, a tracking
// pixel; from an old preset, a path that is no longer there.
test('a floor image is kept only as an embedded picture', () => {
	for (const bad of ['https://example.com/pixel.png', '/empty.png', 'javascript:alert(1)', 42, null]) {
		const { preset } = parsePresetFile(file({ preset: { ...PRESET, renderer: { ...PRESET.renderer, floor_image: bad } } }))
		assert.equal(preset.renderer.floor_image, '', String(bad))
	}
	const none = parsePresetFile(file()).preset
	assert.equal('floor_image' in none.renderer, false)
})
