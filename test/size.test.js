import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverSize, parseMaxDpr } from '../src/element/size.js'

test('a square on the longer side, at the capped pixel ratio', () => {
	assert.deepEqual(coverSize(1600, 900, 2, 0.75), { side: 1600, pixels: 1200 })
	assert.deepEqual(coverSize(380, 400, 2, 2), { side: 400, pixels: 800 })
	assert.deepEqual(coverSize(380, 400, 1, 2), { side: 400, pixels: 400 })
})

test('never below one pixel', () => {
	assert.deepEqual(coverSize(0, 0, 1, 0.25), { side: 1, pixels: 1 })
})

test('parseMaxDpr takes a positive number or the fallback', () => {
	assert.equal(parseMaxDpr('0.75'), 0.75)
	assert.equal(parseMaxDpr(null), 2)
	assert.equal(parseMaxDpr(''), 2)
	assert.equal(parseMaxDpr('-1'), 2)
	assert.equal(parseMaxDpr('lots', 1), 1)
})
