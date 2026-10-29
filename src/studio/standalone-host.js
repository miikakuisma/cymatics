// The standalone app's host: presets in this browser's IndexedDB (storage.js,
// as before), every source, and the standalone chrome.
import { listScenes, loadScene, saveScene, updateScene, renameScene, deleteScene } from '../storage.js'

const call = (fn, args) => new Promise((resolve, reject) => fn({ ...args, onSuccess: resolve, onError: reject }))

const indexedDbStore = {
	list: () => call(listScenes, {}),
	get: (id) => call(loadScene, { id }),
	add: (row) => call(saveScene, { name: row.name, preset: row.preset }),
	put: (row) => call(updateScene, { id: row.id, updatedData: { name: row.name, preset: row.preset } }),
	remove: (id) => call(deleteScene, { id }),
	rename: (id, name) => call(renameScene, { id, newName: name }),
}

export function standaloneHost({ store = indexedDbStore, newId } = {}) {
	return {
		presets: {
			async list() {
				return (await store.list()).map((row) => ({ id: row.id, name: row.name || 'Untitled' }))
			},
			async read(id) {
				return (await store.get(id)).preset
			},
			// Names need not be unique here, so a new one never meets 'exists'.
			async save({ id, name, preset }) {
				if (id) {
					await store.put({ id, name, preset })
					return { id, name }
				}
				const row = await store.add({ id: newId?.(), name, preset })
				return { id: row.id, name }
			},
			async rename(id, name) {
				if (store.rename) await store.rename(id, name)
				else await store.put({ ...(await store.get(id)), name })
				return { id, name }
			},
			async remove(id) {
				await store.remove(id)
			},
		},
		sources: { list: ['file', 'mic', 'radio'], external: null },
		chrome: { standalone: true },
		actions: [],
	}
}
