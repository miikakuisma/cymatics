// What the page hosting the studio provides: where presets are kept, which
// sound sources it offers, and whether the standalone-only parts show. The
// standalone app (src/index.js) passes standaloneHost(); the desktop passes its
// own. Components read it with host().

const SOURCES = ['file', 'mic', 'radio', 'music']
const none = () => Promise.reject(Object.assign(new Error('No presets here.'), { code: 'unavailable' }))

export function normalizeHost(raw = {}) {
	const presets = raw.presets || {}
	const external = raw.sources?.external && typeof raw.sources.external.subscribe === 'function'
		? { label: String(raw.sources.external.label || 'External'), subscribe: raw.sources.external.subscribe }
		: null
	const list = (raw.sources?.list || ['file', 'mic', 'radio'])
		.filter((name) => SOURCES.includes(name) && (name !== 'music' || external))
	return {
		presets: {
			list: presets.list || (async () => []),
			read: presets.read || none,
			save: presets.save || none,
			rename: presets.rename || none,
			remove: presets.remove || none,
		},
		sources: { list, external },
		chrome: { standalone: raw.chrome?.standalone !== false },
		actions: (raw.actions || []).filter((a) => a && typeof a.run === 'function')
			.map((a) => ({ label: String(a.label), needsSaved: Boolean(a.needsSaved), run: a.run })),
	}
}

let current = normalizeHost()

export function setHost(raw) {
	current = normalizeHost(raw)
	return current
}

export function host() {
	return current
}
