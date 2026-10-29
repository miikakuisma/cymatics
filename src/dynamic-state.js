// The studio's modulator settings live on window (__dynamicLineColor and the
// rest), where the control panel reads and writes them. This moves them in
// and out of a preset's shape, using the shared table in element/modulate.js
// so the two never drift.
import { MODULATORS } from './element/modulate.js'

const SUFFIXES = ['', 'Min', 'Max', 'Band', 'Trigger', 'Speed']
const KEYS = MODULATORS.flatMap((m) => SUFFIXES.map((suffix) => ({ from: m.from, key: m.prefix + suffix })))
	.concat([{ from: 'cymatics', key: 'autoResponseSpeedValue' }, { from: 'cymatics', key: 'kickBeatDiv' }])

export function dynamicState(store = window) {
	const state = { renderer: {}, cymatics: {} }
	for (const { from, key } of KEYS) state[from][key] = store[`__${key}`]
	return state
}

export function applyDynamicState(preset, store = window) {
	for (const { from, key } of KEYS) {
		const value = preset?.[from]?.[key]
		if (value === undefined) delete store[`__${key}`]
		else store[`__${key}`] = value
	}
}
