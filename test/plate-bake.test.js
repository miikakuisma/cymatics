import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLru } from '../src/engine-js/plate-bake.js'

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
