// A preset as a file: the studio's preset ({ poleMode, renderer, cymatics,
// liquid }) wrapped so a stray JSON file is never taken for one. The desktop
// keeps yours as /.cymatics/<name>.cymatics.json; the file name is the name.

export const PRESET_FORMAT = 'cymatics'
export const PRESET_VERSION = 1
export const MAX_PRESET_BYTES = 2 * 1024 * 1024
const SECTIONS = ['renderer', 'cymatics', 'liquid']
// The keys every render path reads as numbers. A word here would reach a
// uniform as NaN and blank the plate, so it is refused rather than ignored.
const NUMBERS = {
	renderer: ['emissive_strength', 'final_mul', 'final_gamma'],
	cymatics: ['view_scale', 'faraday_threshold', 'freq_response_speed', 'freq_release', 'freq_detail_scale',
		'contour_mode', 'contour_count', 'audio_amplify_mul', 'wave_distance_scale'],
	liquid: [],
}
const LEGACY = ['reflectionImage', 'refractionImage']

const refuse = (sentence) => { throw new Error(sentence) }
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function checkNumbers(section, name) {
	for (const key of NUMBERS[name]) {
		if (key in section && !Number.isFinite(section[key])) refuse(`That preset's ${key} is not a number.`)
	}
	for (const [key, value] of Object.entries(section)) {
		if (typeof value === 'number' && !Number.isFinite(value)) refuse(`That preset's ${key} is not a number.`)
	}
	if ('poles' in section) {
		const ok = Array.isArray(section.poles) && section.poles.every((p) => Array.isArray(p) && p.every(Number.isFinite))
		if (!ok) refuse("That preset's poles are not a number.")
	}
}

export function cleanPreset(preset) {
	const out = {}
	if (typeof preset.poleMode === 'string') out.poleMode = preset.poleMode
	for (const name of SECTIONS) {
		out[name] = { ...preset[name] }
		for (const key of LEGACY) delete out[name][key]
	}
	// The floor picture travels inside the preset as a data URL. Anything else
	// would be fetched by every page wearing it: a remote address works as a
	// tracking pixel in a shared file. Old presets name '/empty.png', a black
	// picture: '' is the same empty floor without the fetch.
	if ('floor_image' in out.renderer) {
		const image = out.renderer.floor_image
		out.renderer.floor_image = typeof image === 'string' && image.startsWith('data:image/') ? image : ''
	}
	return out
}

export function parsePresetFile(text) {
	if (typeof text !== 'string') refuse('That file is not a Cymatics preset.')
	if (new TextEncoder().encode(text).length > MAX_PRESET_BYTES) refuse('That preset is larger than 2 MB.')
	let data
	try { data = JSON.parse(text) } catch { refuse('That file is not a Cymatics preset.') }
	if (!plain(data) || data.format !== PRESET_FORMAT) refuse('That file is not a Cymatics preset.')
	if (Number.isInteger(data.version) && data.version > PRESET_VERSION) refuse('That preset was saved by a newer Cymatics.')
	if (data.version !== PRESET_VERSION) refuse('That file is not a Cymatics preset.')
	const preset = data.preset
	if (!plain(preset) || !SECTIONS.every((name) => plain(preset[name]))) refuse('That preset is missing its settings.')
	for (const name of SECTIONS) checkNumbers(preset[name], name)
	return { preset: cleanPreset(preset) }
}

export function presetFile(preset) {
	return `${JSON.stringify({ format: PRESET_FORMAT, version: PRESET_VERSION, preset: cleanPreset(preset) }, null, 2)}\n`
}
