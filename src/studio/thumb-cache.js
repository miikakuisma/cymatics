// Rendered thumbnails, kept across visits in their own IndexedDB database
// (never ScenesDB), with a Map in front for this session. Every IndexedDB
// failure is a miss or a no-op: a thumbnail can always be rendered again.
const DB_NAME = 'CymaticsThumbs'
const STORE = 'thumbs'

let opening = null

function openDb() {
	if (!opening) {
		opening = new Promise((resolve) => {
			try {
				const request = indexedDB.open(DB_NAME, 1)
				request.onupgradeneeded = () => {
					const db = request.result
					if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
				}
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => resolve(null)
				request.onblocked = () => resolve(null)
			} catch {
				resolve(null)
			}
		})
	}
	return opening
}

function settle(request, value) {
	return new Promise((resolve) => {
		request.onsuccess = () => resolve(value(request))
		request.onerror = () => resolve(null)
	})
}

const memory = new Map()

export const thumbCache = {
	async get(key) {
		if (memory.has(key)) return memory.get(key)
		const db = await openDb()
		if (!db) return null
		try {
			const row = await settle(db.transaction(STORE).objectStore(STORE).get(key), (r) => r.result)
			const url = row?.url ?? null
			if (url) memory.set(key, url)
			return url
		} catch {
			return null
		}
	},
	async put(key, url) {
		memory.set(key, url)
		const db = await openDb()
		if (!db) return
		try {
			await settle(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, url }), () => null)
		} catch { /* kept in memory for this session */ }
	},
}
