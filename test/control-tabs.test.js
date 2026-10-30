import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultPresets } from '../src/default-presets.js'
import { plateFundamentalHz } from '../src/engine-js/modes.js'
import { polygonModes } from '../src/engine-js/plate-modes.js'
import { controls } from '../src/controls.js'
import { TABS, toolId, isRelevant, irrelevantReason, toolsFor } from '../src/studio/control-tabs.js'

const byId = (id) => controls.find((c) => toolId(c) === id)
const ripples = { cymatics: { field_mode: 0 }, renderer: { liquid_mode: false, liquid_material: 0 } }
const plate = { cymatics: { field_mode: 2 }, renderer: { liquid_mode: false } }
const mercury = { cymatics: { field_mode: 0 }, renderer: { liquid_mode: true, liquid_material: 0 } }
const water = { cymatics: { field_mode: 0 }, renderer: { liquid_mode: true, liquid_material: 1 } }

test('every studio control has exactly one known tab and an icon', () => {
	for (const c of controls) {
		assert.ok(TABS.some((t) => t.id === c.tab), `${toolId(c)} has no known tab`)
		assert.ok(typeof c.icon === 'string' && c.icon.length > 0, `${toolId(c)} has no icon`)
	}
})

test('TABS are in order with labels', () => {
	assert.deepEqual(TABS.map((t) => t.id), ['shape', 'motion', 'surface', 'color', 'audio'])
	assert.deepEqual(TABS.map((t) => t.label), ['Shape', 'Motion', 'Surface', 'Color', 'Audio'])
})

test('the spec table: tab membership', () => {
	const expected = {
		shape: ['field_mode', 'formation', 'view_scale', 'freq_detail_scale', 'contour_count'],
		motion: ['freq_response_speed', 'freq_release', 'faraday_threshold', 'viscosity'],
		surface: ['liquid_mode', 'liquid_material', 'water_depth', 'ripple_depth', 'surface_polish', 'caustic_strength', 'floor_image'],
		color: ['color_inner', 'color_outer', 'emissive_strength', 'lights', 'light_distance'],
		audio: ['audio_amplify_mul', 'input_sensitivity'],
	}
	// membership only: the order within a tab is controls.js order, tested below
	for (const [t, ids] of Object.entries(expected)) {
		assert.deepEqual(controls.filter((c) => c.tab === t).map(toolId).sort(), [...ids].sort(), t)
	}
})

test('a plate hides Formation, Freq Detail and Contour Detail', () => {
	for (const id of ['formation', 'freq_detail_scale', 'contour_count']) assert.equal(isRelevant(byId(id), plate), false, id)
	assert.equal(isRelevant(byId('view_scale'), plate), true)
})

test('Liquid on hides Contour Detail; Liquid off hides every liquid-only control', () => {
	assert.equal(isRelevant(byId('contour_count'), ripples), true)
	assert.equal(isRelevant(byId('contour_count'), mercury), false)
	for (const id of ['liquid_material', 'viscosity', 'ripple_depth', 'surface_polish', 'water_depth', 'caustic_strength', 'floor_image', 'lights', 'light_distance']) {
		assert.equal(isRelevant(byId(id), ripples), false, id)
	}
	for (const id of ['liquid_mode', 'emissive_strength']) assert.equal(isRelevant(byId(id), ripples), true, id)
})

test('water-only controls show for water, not mercury', () => {
	for (const id of ['water_depth', 'caustic_strength', 'floor_image']) {
		assert.equal(isRelevant(byId(id), water), true, id)
		assert.equal(isRelevant(byId(id), mercury), false, id)
	}
	for (const id of ['ripple_depth', 'surface_polish', 'viscosity', 'lights']) {
		assert.equal(isRelevant(byId(id), water), true, id)
		assert.equal(isRelevant(byId(id), mercury), true, id)
	}
})

test('toolsFor keeps controls.js order and filters', () => {
	assert.deepEqual(toolsFor('shape', controls, plate).map(toolId), ['field_mode', 'view_scale'])
})

test('irrelevantReason names why, and agrees with isRelevant everywhere', () => {
	const squareWater = { cymatics: { field_mode: 1 }, renderer: { liquid_mode: true, liquid_material: 1 } }
	for (const state of [ripples, plate, mercury, water, squareWater, { cymatics: {}, renderer: {} }]) {
		for (const c of controls) {
			const reason = irrelevantReason(c, state)
			assert.equal(reason === null, isRelevant(c, state), toolId(c))
			if (reason !== null) assert.ok(typeof reason === 'string' && reason.length > 0)
		}
	}
	assert.equal(irrelevantReason(byId('formation'), plate), 'Not used by plate fields')
	assert.equal(irrelevantReason(byId('contour_count'), mercury), 'Not drawn while Liquid is on')
	assert.equal(irrelevantReason(byId('lights'), ripples), 'Turn on Liquid to use this')
	assert.equal(irrelevantReason(byId('caustic_strength'), mercury), 'Water only')
	assert.equal(irrelevantReason(byId('view_scale'), plate), null)
})

test('missing config keys read as engine defaults: field 0, liquid off, mercury', () => {
	assert.equal(isRelevant(byId('contour_count'), { cymatics: {}, renderer: {} }), true)
	assert.equal(isRelevant(byId('viscosity'), { cymatics: {}, renderer: {} }), false)
})

test('the polygon plates behave as plates in the Shape tab and the greying', () => {
	const hexagon = { cymatics: { field_mode: 5 }, renderer: { liquid_mode: false } }
	assert.deepEqual(toolsFor('shape', controls, hexagon).map(toolId), ['field_mode', 'view_scale'])
	for (const id of ['formation', 'freq_detail_scale', 'contour_count']) {
		assert.notEqual(irrelevantReason(byId(id), hexagon), null, id)
	}
})

test('the Field menu lists the plates, and the factory presets include the new ones', () => {
	const field = byId('field_mode')
	assert.deepEqual(field.options.map((o) => o.value), [0, 3, 1, 4, 5, 2])
	assert.deepEqual(field.options.map((o) => o.label), [
		'No plate', 'Triangle plate', 'Square plate', 'Pentagon plate', 'Hexagon plate', 'Round plate',
	])
	const names = defaultPresets.map((p) => p.name)
	const at = names.indexOf('Square Plate')
	assert.deepEqual(names.slice(at + 1, at + 4), ['Triangle Plate', 'Pentagon Plate', 'Hexagon Plate'])
	const fieldOf = (n) => defaultPresets.find((p) => p.name === n).preset.cymatics.field_mode
	assert.deepEqual(['Triangle Plate', 'Pentagon Plate', 'Hexagon Plate'].map(fieldOf), [3, 4, 5])
	assert.equal(new Set(defaultPresets.map((p) => p.objectId)).size, defaultPresets.length)
})

test('the new plate presets reach at least 7 kHz at their Distance', () => {
	const sidesOf = { 'Triangle Plate': 3, 'Pentagon Plate': 5, 'Hexagon Plate': 6 }
	for (const [name, sides] of Object.entries(sidesOf)) {
		const c = defaultPresets.find((p) => p.name === name).preset.cymatics
		const hz = plateFundamentalHz(c.view_scale) * polygonModes(sides).at(-1).ratio
		assert.ok(hz >= 7000, `${name} reaches only ${hz.toFixed(0)} Hz`)
	}
})
