import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_LOOK, LOOKS, lookPreset } from '../src/element/looks.js'
import { presetModulators, isModulatorKey } from '../src/element/modulate.js'

// The keys each engine section's getJson() writes, read off its source: the
// engine needs WebGL to construct, and a key no section knows is a look that
// silently does nothing.
function engineKeys(file) {
	const source = readFileSync(new URL(`../src/engine-js/${file}`, import.meta.url), 'utf8')
	const start = source.indexOf('getJson() {')
	const body = source.slice(start, source.indexOf('\n\t}\n', start))
	return new Set([...body.matchAll(/^\t\t\t(\w+):/gm)].map((m) => m[1]))
}
const KEYS = {
	renderer: engineKeys('renderer.js'),
	cymatics: engineKeys('cymatics.js'),
	liquid: engineKeys('liquidsim.js'),
}

test('four or five looks, the default first', () => {
	assert.ok(LOOKS.length >= 4 && LOOKS.length <= 5)
	assert.equal(LOOKS[0].id, DEFAULT_LOOK)
	assert.equal(new Set(LOOKS.map((l) => l.id)).size, LOOKS.length)
	for (const look of LOOKS) assert.match(look.name, /^[A-Z]/)
})

test('every key in every look is one the engine has', () => {
	for (const { id } of LOOKS) {
		const preset = lookPreset(id)
		for (const section of ['renderer', 'cymatics', 'liquid']) {
			for (const key of Object.keys(preset[section])) {
				if (isModulatorKey(key)) continue
				assert.ok(KEYS[section].has(key), `${id}.${section}.${key}`)
			}
		}
	}
})

test('every look sets the render-path flags, so switching cannot leak one', () => {
	for (const { id } of LOOKS) {
		const { renderer, cymatics } = lookPreset(id)
		assert.equal(typeof renderer.liquid_mode, 'boolean', id)
		assert.equal(typeof renderer.emissive_mode, 'boolean', id)
		assert.equal(typeof cymatics.contour_mode, 'number', id)
		assert.equal(typeof cymatics.view_scale, 'number', id)
	}
})

test('no look loads a floor image: it would be a request to a path this page may not have', () => {
	for (const { id } of LOOKS) assert.equal('floor_image' in lookPreset(id).renderer, false, id)
})

// What the looks moved before they were presets (v0.1.54): DETAIL on every
// look, LINE_COLOR on water and lines. The colours were written as numbers
// then; as hex they are within one step of 255.
const BEFORE = {
	DETAIL: { section: 'cymatics', key: 'freq_detail_scale', band: 'band7', trigger: 0.3, speed: 0.02, min: 2, max: 5 },
	LINE_COLOR: { section: 'renderer', key: 'color_outer', band: 'band4', trigger: 0.75, speed: 0.8, min: [0, 0.502, 1], max: [1, 0.4, 0] },
}
const EXPECTED = { water: ['DETAIL', 'LINE_COLOR'], mercury: ['DETAIL'], lines: ['DETAIL', 'LINE_COLOR'], glow: ['DETAIL'] }

test('each look moves exactly as it did before it was a preset', () => {
	for (const { id } of LOOKS) {
		const specs = presetModulators(lookPreset(id))
		assert.equal(specs.length, EXPECTED[id].length, id)
		for (const name of EXPECTED[id]) {
			const want = BEFORE[name]
			const got = specs.find((s) => s.key === want.key)
			assert.ok(got, `${id} ${name}`)
			for (const field of ['section', 'band', 'trigger', 'speed']) assert.equal(got[field], want[field], `${id} ${name} ${field}`)
			for (const field of ['min', 'max']) {
				const a = [want[field]].flat()
				const b = [got[field]].flat()
				a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1 / 255, `${id} ${name} ${field}`))
			}
		}
	}
})

test('no look modulates view_scale, which zoom owns', () => {
	for (const { id } of LOOKS) assert.equal(presetModulators(lookPreset(id)).some((s) => s.key === 'view_scale'), false, id)
})

test('every look is a valid preset file', async () => {
	const { parsePresetFile, presetFile } = await import('../src/preset.js')
	for (const { id } of LOOKS) assert.doesNotThrow(() => parsePresetFile(presetFile(lookPreset(id))), id)
})

test('lookPreset copies, and falls back to the default', () => {
	const a = lookPreset(DEFAULT_LOOK)
	a.cymatics.poles[0][0] = 99
	assert.notEqual(lookPreset(DEFAULT_LOOK).cymatics.poles[0][0], 99)
	assert.equal(lookPreset('nope').id, DEFAULT_LOOK)
})
