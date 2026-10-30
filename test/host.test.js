import { test } from 'node:test'
import assert from 'node:assert/strict'
import { host, normalizeHost, setHost } from '../src/studio/host.js'
import { standaloneHost } from '../src/studio/standalone-host.js'

test('a host with nothing gets safe defaults', () => {
	const h = normalizeHost({})
	assert.deepEqual(h.sources.list, ['file', 'mic', 'radio', 'tone'])
	assert.equal(h.sources.external, null)
	assert.equal(h.chrome.standalone, true)
	assert.deepEqual(h.actions, [])
	assert.equal(typeof h.presets.list, 'function')
})

test('an external source is offered only with a subscribe function', () => {
	const subscribe = () => () => {}
	assert.equal(normalizeHost({ sources: { list: ['music'], external: { label: 'Music' } } }).sources.external, null)
	assert.equal(normalizeHost({ sources: { list: ['music'], external: { label: 'Music', subscribe } } }).sources.external.label, 'Music')
})

test('unknown source names are dropped; music needs an external source', () => {
	assert.deepEqual(normalizeHost({ sources: { list: ['mic', 'tv', 'music'] } }).sources.list, ['mic'])
})

test('setHost then host() returns the normalized host', () => {
	setHost({ chrome: { standalone: false } })
	assert.equal(host().chrome.standalone, false)
	assert.deepEqual(host().actions, [])
})

test('actions without a run function are dropped', () => {
	const run = () => {}
	assert.deepEqual(normalizeHost({ actions: [{ label: 'A', run }, { label: 'B' }] }).actions.map((a) => a.label), ['A'])
})


test('the standalone host lists, saves and renames through its store, and keeps legacy scenes', async () => {
	const rows = new Map([['old-1', { id: 'old-1', name: 'From before', preset: { renderer: {}, cymatics: {}, liquid: {} } }]])
	const store = {
		list: async () => [...rows.values()],
		get: async (id) => rows.get(id),
		add: async (row) => { rows.set(row.id, row); return row },
		put: async (row) => { rows.set(row.id, row); return row },
		remove: async (id) => { rows.delete(id) },
	}
	const h = standaloneHost({ store, newId: () => 'new-1' })
	assert.deepEqual(await h.presets.list(), [{ id: 'old-1', name: 'From before' }])
	const saved = await h.presets.save({ id: null, name: 'Mine', preset: { renderer: {}, cymatics: {}, liquid: {} } })
	assert.deepEqual(saved, { id: 'new-1', name: 'Mine' })
	await h.presets.save({ id: 'new-1', name: 'Mine', preset: { renderer: { a: 1 }, cymatics: {}, liquid: {} }, replace: true })
	assert.equal((await h.presets.read('new-1')).renderer.a, 1)
	assert.deepEqual(await h.presets.rename('old-1', 'Renamed'), { id: 'old-1', name: 'Renamed' })
	await h.presets.remove('new-1')
	assert.deepEqual((await h.presets.list()).map((p) => p.name), ['Renamed'])
})
