import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presetKey, createThumbQueue } from '../src/studio/thumbnails.js'

function fakes({ failMake = false, failOn = null } = {}) {
	const f = { store: new Map(), makes: 0, disposes: 0, renders: 0, pauses: 0, active: 0, maxActive: 0 }
	f.cache = {
		get: async (k) => f.store.get(k) ?? null,
		put: async (k, u) => { f.store.set(k, u) },
	}
	f.makeRenderer = () => {
		f.makes++
		if (failMake) throw new Error('no webgl2')
		return {
			render: async (p) => {
				f.renders++
				f.active++
				f.maxActive = Math.max(f.maxActive, f.active)
				await Promise.resolve()
				f.active--
				if (failOn && p.id === failOn) throw new Error('bad preset')
				return 'url-' + p.id
			},
			dispose: () => { f.disposes++ },
		}
	}
	f.pause = async () => { f.pauses++ }
	f.queue = createThumbQueue({ cache: f.cache, makeRenderer: f.makeRenderer, pause: f.pause })
	return f
}

test('presetKey ignores key order and changes with any value', () => {
	assert.equal(presetKey({ a: 1, b: { c: 2, d: 3 } }), presetKey({ b: { d: 3, c: 2 }, a: 1 }))
	assert.notEqual(presetKey({ a: 1, b: { c: 2, d: 3 } }), presetKey({ a: 1, b: { c: 2, d: 4 } }))
	assert.match(presetKey({ a: 1 }), /^[0-9a-f]+$/)
})

test('a cached thumbnail is returned without rendering', async () => {
	const f = fakes()
	const p = { id: 'x' }
	f.store.set(presetKey(p), 'cached')
	assert.equal(await f.queue.thumbnailFor(p), 'cached')
	assert.equal(f.renders, 0)
	assert.equal(f.makes, 0)
})

test('the same preset asked twice at once renders once', async () => {
	const f = fakes()
	const p = { id: 'x', n: { a: 1 } }
	const [a, b] = await Promise.all([f.queue.thumbnailFor(p), f.queue.thumbnailFor(structuredClone(p))])
	assert.equal(a, 'url-x')
	assert.equal(b, 'url-x')
	assert.equal(f.renders, 1)
})

test('renders one at a time, pausing between, and caches each result', async () => {
	const f = fakes()
	const ps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
	const urls = await Promise.all(ps.map((p) => f.queue.thumbnailFor(p)))
	assert.deepEqual(urls, ['url-a', 'url-b', 'url-c'])
	assert.equal(f.maxActive, 1)
	assert.equal(f.pauses, 2)
	assert.equal(f.store.get(presetKey(ps[1])), 'url-b')
})

test('the renderer is created lazily and disposed when the queue drains', async () => {
	const f = fakes()
	assert.equal(f.makes, 0)
	await Promise.all([{ id: 'a' }, { id: 'b' }, { id: 'c' }].map((p) => f.queue.thumbnailFor(p)))
	assert.equal(f.makes, 1)
	assert.equal(f.disposes, 1)
	await f.queue.thumbnailFor({ id: 'd' })
	assert.equal(f.makes, 2)
	assert.equal(f.disposes, 2)
})

test('a renderer that cannot be made answers null now and later, without retrying', async () => {
	const f = fakes({ failMake: true })
	assert.equal(await f.queue.thumbnailFor({ id: 'a' }), null)
	assert.equal(await f.queue.thumbnailFor({ id: 'b' }), null)
	assert.equal(f.makes, 1)
	f.store.set(presetKey({ id: 'c' }), 'cached')
	assert.equal(await f.queue.thumbnailFor({ id: 'c' }), 'cached')
})

test('one preset that fails to render answers null; the next still renders', async () => {
	const f = fakes({ failOn: 'bad' })
	const [a, b] = await Promise.all([f.queue.thumbnailFor({ id: 'bad' }), f.queue.thumbnailFor({ id: 'ok' })])
	assert.equal(a, null)
	assert.equal(b, 'url-ok')
	assert.equal(f.store.has(presetKey({ id: 'bad' })), false)
})

test('cache failures are a miss and are ignored', async () => {
	const f = fakes()
	const q = createThumbQueue({
		cache: { get: async () => { throw new Error('idb') }, put: async () => { throw new Error('idb') } },
		makeRenderer: f.makeRenderer,
		pause: f.pause,
	})
	assert.equal(await q.thumbnailFor({ id: 'a' }), 'url-a')
})
