import { test } from 'node:test'
import assert from 'node:assert/strict'
import { controls } from '../src/controls.js'
import { TABS, toolId, isRelevant, toolsFor } from '../src/studio/control-tabs.js'

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

test('missing config keys read as engine defaults: field 0, liquid off, mercury', () => {
	assert.equal(isRelevant(byId('contour_count'), { cymatics: {}, renderer: {} }), true)
	assert.equal(isRelevant(byId('viscosity'), { cymatics: {}, renderer: {} }), false)
})
