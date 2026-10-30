import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BESSEL_X_MAX } from '../src/engine-js/modes.js'
import {
	MAX_CORNERS, MAX_CORNER_ORDERS, MAX_TERMS, bakeMargin, checkBakeBounds, createLru,
} from '../src/engine-js/plate-bake.js'
import {
	CORNER_X_MAX, cornerOrders, plateCoeffTexture, plateCornerTexture, plateStoredModes,
} from '../src/engine-js/plate-modes.js'

test('the cache evicts the least recently used entry and returns it', () => {
	const lru = createLru(2)
	assert.equal(lru.put('a', 'A'), undefined)
	assert.equal(lru.put('b', 'B'), undefined)
	assert.equal(lru.get('a'), 'A') // a is now the most recent
	assert.equal(lru.put('c', 'C'), 'B')
	assert.equal(lru.get('b'), undefined)
	assert.equal(lru.get('a'), 'A')
	assert.equal(lru.get('c'), 'C')
	assert.deepEqual([...lru.keys()].sort(), ['a', 'c'])
})

test('a get refreshes an entry; a put of a present key replaces it without evicting', () => {
	const lru = createLru(2)
	lru.put('a', 1)
	lru.put('b', 2)
	assert.equal(lru.put('a', 3), undefined)
	assert.equal(lru.get('a'), 3)
	assert.equal(lru.put('c', 4), 2) // b, not a, is the oldest
	assert.equal(lru.get('missing'), undefined)
})

test('keys of different shapes never collide', () => {
	const lru = createLru(8)
	lru.put('3:7', 'triangle')
	lru.put('5:7', 'hexagon')
	assert.equal(lru.get('3:7'), 'triangle')
	assert.equal(lru.get('5:7'), 'hexagon')
	assert.equal([...lru.keys()].length, 2)
})

test('the shipped plates fit the bake shader: loop bounds and table x-ranges', () => {
	for (const sides of [3, 5, 6]) {
		assert.doesNotThrow(() => checkBakeBounds(sides), `sides ${sides}`)
		assert.ok(plateCoeffTexture(sides).width <= MAX_TERMS)
		assert.ok(plateCornerTexture(sides).width <= MAX_CORNERS)
		assert.ok(cornerOrders(sides).length <= MAX_CORNER_ORDERS)
		// Every point a bake evaluates is within `reach` of the centre and
		// 2·reach of vertex 0.
		const reach = 1 + bakeMargin(512) / Math.cos(Math.PI / sides)
		for (const m of plateStoredModes(sides)) {
			assert.ok(m.k * reach <= BESSEL_X_MAX, `sides ${sides}: k ${m.k} over the Bessel table`)
			if (m.cornerM.length) assert.ok(2 * m.k * reach <= CORNER_X_MAX, `sides ${sides}: k ${m.k} over the corner table`)
		}
	}
})

test('the JS loop bounds are the shader\'s', () => {
	const src = readFileSync(new URL('../src/engine-js/shaders/plate_bake.fsh', import.meta.url), 'utf8')
	assert.equal(Number(src.match(/const int MAX_TERMS = (\d+);/)[1]), MAX_TERMS)
	assert.equal(Number(src.match(/const int MAX_CORNERS = (\d+);/)[1]), MAX_CORNERS)
	assert.match(src, /uniform vec4 cornerMu;/) // MAX_CORNER_ORDERS = 4
	assert.equal(MAX_CORNER_ORDERS, 4)
})
