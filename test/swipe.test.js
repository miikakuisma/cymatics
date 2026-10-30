import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SWIPE_MIN, isSwipeDown } from '../src/studio/swipe.js'

test('a drag of at least 60px down is a swipe', () => {
	assert.equal(SWIPE_MIN, 60)
	assert.equal(isSwipeDown(0, 60), true)
	assert.equal(isSwipeDown(20, 140), true)
})

test('a shorter drag, or one upward, is not', () => {
	assert.equal(isSwipeDown(0, 59), false)
	assert.equal(isSwipeDown(0, -120), false)
	assert.equal(isSwipeDown(0, 0), false)
})

test('a mostly sideways drag never is, however far it falls', () => {
	assert.equal(isSwipeDown(200, 80), false)
	assert.equal(isSwipeDown(-90, 70), false)
	assert.equal(isSwipeDown(80, 80), false)
})
