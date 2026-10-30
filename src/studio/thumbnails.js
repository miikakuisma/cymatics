// Thumbnails for the picker: a stable key per preset, and a queue that renders
// them one at a time. The renderer and cache are injected so this stays pure.

export const THUMB_VERSION = 2

function stableStringify(v) {
	if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
	if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
	const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort()
	return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
}

// 32-bit FNV-1a over UTF-16 code units, as hex.
function fnv1a(text) {
	let h = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(16).padStart(8, '0')
}

export function presetKey(preset) {
	return fnv1a(THUMB_VERSION + stableStringify(preset))
}

export function createThumbQueue({ cache, makeRenderer, pause }) {
	const inflight = new Map()
	const pending = []
	let renderer = null
	let unsupported = false
	let running = false

	async function cached(key) {
		try { return (await cache.get(key)) ?? null } catch { return null }
	}

	async function drain() {
		running = true
		let first = true
		while (pending.length) {
			const job = pending.shift()
			if (!first) await pause()
			first = false
			job.resolve(await renderOne(job))
		}
		if (renderer) {
			try { renderer.dispose() } catch { /* nothing to recover */ }
			renderer = null
		}
		running = false
	}

	async function renderOne({ key, preset }) {
		if (unsupported) return null
		if (!renderer) {
			try {
				renderer = makeRenderer()
			} catch {
				unsupported = true
				return null
			}
		}
		try {
			const url = await renderer.render(preset)
			try { await cache.put(key, url) } catch { /* the thumbnail is still good */ }
			return url
		} catch {
			return null
		}
	}

	function thumbnailFor(preset) {
		const key = presetKey(preset)
		const open = inflight.get(key)
		if (open) return open
		const promise = (async () => {
			const hit = await cached(key)
			if (hit) return hit
			if (unsupported) return null
			return new Promise((resolve) => {
				pending.push({ key, preset, resolve })
				if (!running) drain()
			})
		})().finally(() => inflight.delete(key))
		inflight.set(key, promise)
		return promise
	}

	return { thumbnailFor }
}
