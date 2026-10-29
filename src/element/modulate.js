// Band-driven parameter modulation, shared by the studio, <cymatics-view>,
// Music and the desktop, so a preset moves the same way everywhere. A port of
// the gates in src/components/p-audio.js, with state per instance instead of
// window globals.

export const OCTAVE_EDGES_HZ = [40, 80, 160, 320, 640, 1280, 2560, 5120, 10240]
const BAND_COUNT = OCTAVE_EDGES_HZ.length - 1

export function octaveBands(bins, sampleRate, out = new Float32Array(BAND_COUNT)) {
	const n = bins.length
	const binHz = sampleRate / (n * 2)
	const edge = (hz) => Math.min(n, Math.max(1, Math.round(hz / binHz)))
	for (let b = 0; b < BAND_COUNT; b++) {
		const lo = edge(OCTAVE_EDGES_HZ[b])
		const hi = edge(OCTAVE_EDGES_HZ[b + 1])
		let sum = 0
		for (let i = lo; i < hi; i++) sum += bins[i]
		out[b] = hi > lo ? sum / (hi - lo) : 0
	}
	return out
}

export function mean(bins) {
	let sum = 0
	for (let i = 0; i < bins.length; i++) sum += bins[i]
	return bins.length ? sum / bins.length : 0
}

// Rise at `speed`, fall at 15 % of it: p-audio.js's updateGate.
export function gate(prev, over, speed = 0.8) {
	const attack = Math.max(0.01, speed)
	const release = Math.max(0.005, speed * 0.15)
	const a = over > prev ? attack : release
	return prev * (1 - a) + over * a
}

export function mix(min, max, t) {
	if (Array.isArray(min)) return min.map((v, i) => v + (max[i] - v) * t)
	return min + (max - min) * t
}

export function hexToRgb(value) {
	if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) return value.slice()
	if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null
	return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
}

const KICK_HISTORY = 43 // ~0.72 s at 60 fps, for the running average
const KICK_COOLDOWN_MS = 120
const KICK_THRESHOLD_MUL = 1.8
const KICK_DECAY = 0.88
const LEGACY = { bass: 'band2', mid: 'band4', high: 'band7' }

// The studio's band follower: octave bands and the overall level, smoothed
// peak-detector style, and a kick impulse from the bass bins' flux. `beatKick`,
// when a number, is the kick instead: the standalone studio's beat grid for a
// decoded file, which also lifts every band on the beat.
export function createBandFollower() {
	const raw = new Float32Array(BAND_COUNT)
	const bands = new Float32Array(BAND_COUNT)
	const history = new Float32Array(KICK_HISTORY)
	let index = 0
	let full = false
	let lastKick = -Infinity
	const follower = {
		bands,
		overall: 0,
		kick: 0,
		step(bins, sampleRate, { now = performance.now(), beatKick = null } = {}) {
			octaveBands(bins, sampleRate, raw)
			const level = mean(bins)
			if (typeof beatKick === 'number') {
				follower.kick = beatKick
			} else {
				let energy = 0
				for (let i = 0; i < 6; i++) energy += bins[i]
				energy /= 6
				history[index] = energy
				index = (index + 1) % KICK_HISTORY
				if (index === 0) full = true
				const n = full ? KICK_HISTORY : Math.max(index, 1)
				let average = 0
				for (let i = 0; i < n; i++) average += history[i]
				average /= n
				if (energy > average * KICK_THRESHOLD_MUL && energy > 0.05 && now - lastKick > KICK_COOLDOWN_MS) {
					const overshoot = (energy - average * KICK_THRESHOLD_MUL) / (average * KICK_THRESHOLD_MUL + 0.001)
					follower.kick = Math.min(1, 0.7 + overshoot * 0.3)
					lastKick = now
				} else {
					follower.kick *= KICK_DECAY
					if (follower.kick < 0.01) follower.kick = 0
				}
			}
			for (let b = 0; b < BAND_COUNT; b++) {
				const v = raw[b]
				bands[b] = v > bands[b] ? bands[b] * 0.3 + v * 0.7 : bands[b] * 0.8 + v * 0.2
			}
			follower.overall = follower.overall * 0.7 + level * 0.3
			if (typeof beatKick === 'number' && follower.kick > 0.1) {
				const boost = follower.kick * 0.5
				for (let b = 0; b < BAND_COUNT; b++) bands[b] = Math.min(1, bands[b] + boost)
				follower.overall = Math.min(1, follower.overall + boost)
			}
			return follower
		},
		value(band) {
			if (band === 'kick') return follower.kick
			const name = LEGACY[band] || band
			const m = /^band(\d+)$/.exec(name || '')
			const i = m ? Number(m[1]) - 1 : -1
			return i >= 0 && i < BAND_COUNT ? bands[i] : follower.overall
		},
	}
	return follower
}

// Every modulator the studio saves: where its keys live in a preset, what it
// moves, and the defaults p-audio.js used when a key is missing. `slow` ones
// are written every fourth frame (the engine call is the cost); the others
// whenever they move past `epsilon`.
export const MODULATORS = [
	{ prefix: 'dynamicFreqDetail', from: 'cymatics', section: 'cymatics', key: 'freq_detail_scale', band: 'band7', trigger: 0.3, min: 1, max: 3, epsilon: 0.05 },
	{ prefix: 'autoResponseSpeed', from: 'cymatics', section: 'cymatics', key: 'freq_response_speed', band: 'overall', trigger: 0.3, min: 0.15, max: 0.85, epsilon: 0.01 },
	{ prefix: 'dynamicFaradayThreshold', from: 'cymatics', section: 'cymatics', key: 'faraday_threshold', band: 'overall', trigger: 0.2, min: 0, max: 0.95, epsilon: 0.01 },
	{ prefix: 'dynamicContourCount', from: 'cymatics', section: 'cymatics', key: 'contour_count', band: 'band4', trigger: 0.3, min: 2, max: 32, round: true },
	{ prefix: 'dynamicViewScale', from: 'cymatics', section: 'cymatics', key: 'view_scale', band: 'band2', trigger: 0.3, min: 0.05, max: 0.45, slow: true },
	{ prefix: 'dynamicLineColor', from: 'renderer', section: 'renderer', key: 'color_outer', band: 'overall', trigger: 0.3, min: '#003366', max: '#ff6600', color: true, slow: true },
	{ prefix: 'dynamicLightDistance', from: 'renderer', section: 'renderer', key: 'lights', light: 'distance', band: 'overall', trigger: 0.3, min: 10, max: 49, slow: true },
	{ prefix: 'dynamicLightColor', from: 'renderer', section: 'renderer', key: 'lights', light: 'color', band: 'overall', trigger: 0.3, min: '#ff6600', max: '#ffffff', color: true, slow: true },
]
const SUFFIXES = ['', 'Min', 'Max', 'Band', 'Trigger', 'Speed', 'Value']
const OTHER_KEYS = new Set(['kickBeatDiv'])

export function isModulatorKey(key) {
	if (OTHER_KEYS.has(key)) return true
	return MODULATORS.some((m) => key.startsWith(m.prefix) && SUFFIXES.includes(key.slice(m.prefix.length)))
}

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback)

export function presetModulators(preset) {
	if (!preset || typeof preset !== 'object') return []
	const specs = []
	for (const m of MODULATORS) {
		const saved = preset[m.from]
		if (!saved || !saved[m.prefix]) continue
		const at = (suffix) => saved[m.prefix + suffix]
		const range = (suffix, fallback) => (m.color ? hexToRgb(at(suffix)) ?? hexToRgb(fallback) : finite(at(suffix), fallback))
		specs.push({
			name: m.prefix,
			section: m.section,
			key: m.key,
			band: typeof at('Band') === 'string' ? at('Band') : m.band,
			trigger: finite(at('Trigger'), m.trigger),
			speed: finite(at('Speed'), 0.8),
			min: range('Min', m.min),
			max: range('Max', m.max),
			epsilon: m.epsilon ?? 0,
			round: Boolean(m.round),
			slow: Boolean(m.slow),
			light: m.light ?? null,
		})
	}
	return specs
}

export function createModulators(initial, { lights = () => [] } = {}) {
	let specs = initial
	const gates = new Map()
	const last = new Map()
	let frame = 0
	return {
		update(next) {
			specs = next
			for (const name of [...gates.keys()]) {
				if (!next.some((spec) => spec.name === name)) { gates.delete(name); last.delete(name) }
			}
		},
		step(follower, apply) {
			if (!specs.length) return
			frame += 1
			for (const spec of specs) {
				const level = follower.value(spec.band)
				const g = gate(gates.get(spec.name) ?? 0, level > spec.trigger ? 1 : 0, spec.speed)
				gates.set(spec.name, g)
				if (spec.slow) continue
				let value = mix(spec.min, spec.max, g)
				if (spec.round) value = Math.round(value)
				const prev = last.get(spec.name)
				if (prev !== undefined && (spec.round ? value === prev : Math.abs(value - prev) <= spec.epsilon)) continue
				last.set(spec.name, value)
				apply(spec.section, spec.key, value)
			}
			if (frame % 4 !== 0) return
			const lightSpecs = []
			for (const spec of specs) {
				if (!spec.slow) continue
				if (spec.light) { lightSpecs.push(spec); continue }
				apply(spec.section, spec.key, mix(spec.min, spec.max, gates.get(spec.name)))
			}
			if (!lightSpecs.length) return
			const list = structuredClone(lights() || [])
			const light = list[0]
			if (!light) return
			for (const spec of lightSpecs) {
				const value = mix(spec.min, spec.max, gates.get(spec.name))
				if (spec.light === 'distance') light.pos[2] = value
				else light.color = value
			}
			apply('renderer', 'lights', list)
		},
	}
}
