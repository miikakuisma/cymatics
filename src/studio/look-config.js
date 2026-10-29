// What the studio loads goes over the engine's own defaults, as
// <cymatics-view> lays them: loadConfig merges over whatever is on the plate,
// so a look or a sparse preset would otherwise keep the last one's keys.
const SECTIONS = ['renderer', 'cymatics', 'liquid']
let recorded = null

// Called once at mount, before the first preset loads.
export function setEngineDefaults(defaults) {
	recorded = structuredClone(defaults)
}

export function overDefaults(preset, defaults = recorded) {
	const out = structuredClone(preset)
	for (const name of SECTIONS) {
		out[name] = { ...structuredClone(defaults?.[name] || {}), ...(preset[name] || {}) }
	}
	return out
}
