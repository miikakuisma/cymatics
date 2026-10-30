// Which tab each studio control lives in is `tab` in controls.js. This file
// holds the rest: the tab list, and which controls matter in the current state.

export const TABS = [
	{ id: 'shape', label: 'Shape' },
	{ id: 'motion', label: 'Motion' },
	{ id: 'surface', label: 'Surface' },
	{ id: 'color', label: 'Color' },
	{ id: 'audio', label: 'Audio' },
]

export const toolId = (control) => control.name || control.label.toLowerCase()

const PLATE_HIDES = new Set(['formation', 'freq_detail_scale', 'contour_count'])
const LIQUID_ONLY = new Set(['liquid_material', 'viscosity', 'ripple_depth', 'surface_polish', 'water_depth', 'caustic_strength', 'floor_image', 'lights', 'light_distance'])
const WATER_ONLY = new Set(['water_depth', 'caustic_strength', 'floor_image'])

// Why a control does nothing in the current state, or null when it does
// something. The phone leaves such controls out; the desktop greys them, with
// this as their title. Missing keys read as the engine's defaults: no plate,
// liquid off, mercury.
export function irrelevantReason(control, { cymatics = {}, renderer = {} }) {
	const id = toolId(control)
	const plate = (cymatics.field_mode ?? 0) !== 0
	const liquid = renderer.liquid_mode ?? false
	const water = (renderer.liquid_material ?? 0) === 1
	if (plate && PLATE_HIDES.has(id)) return 'Not used by plate fields'
	if (liquid && id === 'contour_count') return 'Not drawn while Liquid is on'
	if (!liquid && LIQUID_ONLY.has(id)) return 'Turn on Liquid to use this'
	if (!water && WATER_ONLY.has(id)) return 'Water only'
	return null
}

export const isRelevant = (control, state) => irrelevantReason(control, state) === null

export const toolsFor = (tabId, controls, state) =>
	controls.filter((c) => c.tab === tabId && isRelevant(c, state))
