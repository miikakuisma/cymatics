import { createModulators, isModulatorKey, presetModulators } from './modulate.js'

// Engine defaults first, then the preset: a key the preset leaves out goes
// back to the engine's value rather than keeping a previous one's. Modulator
// settings are not engine keys; they become the modulators.
export function applyPreset(engine, defaults, preset) {
	let lights = []
	let viewScale
	for (const section of ['renderer', 'cymatics', 'liquid']) {
		const own = Object.fromEntries(Object.entries(preset[section] || {}).filter(([key]) => !isModulatorKey(key)))
		const merged = { ...defaults[section], ...own }
		engine.command(`set ${section} ${JSON.stringify(merged)}`)
		if (section === 'renderer') lights = merged.lights || []
		if (section === 'cymatics') viewScale = merged.view_scale
	}
	const mods = createModulators(presetModulators(preset), { lights: () => lights })
	return { mods, lights, viewScale }
}
