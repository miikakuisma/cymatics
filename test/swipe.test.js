import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SWIPE_MIN, isSwipeDown, onSwipeDown } from '../src/studio/swipe.js'

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

// onSwipeDown hears releases on the window; here the window and the root are
// small listener tables, and events are plain objects.
function target() {
	const fns = new Map()
	return {
		addEventListener: (type, fn) => {
			if (!fns.has(type)) fns.set(type, new Set())
			fns.get(type).add(fn)
		},
		removeEventListener: (type, fn) => fns.get(type)?.delete(fn),
		dispatch: (type, e) => [...(fns.get(type) ?? [])].forEach((fn) => fn({ type, ...e })),
	}
}

function harness() {
	const win = target()
	globalThis.addEventListener = win.addEventListener
	globalThis.removeEventListener = win.removeEventListener
	const root = target()
	const handle = { closest: (sel) => (sel === '.handle' ? handle : null) }
	const at = (pointerId, clientY) => ({ pointerId, clientX: 0, clientY, isPrimary: true, target: handle })
	return {
		root,
		down: (pointerId, clientY) => root.dispatch('pointerdown', at(pointerId, clientY)),
		up: (pointerId, clientY) => win.dispatch('pointerup', at(pointerId, clientY)),
	}
}

test('a swipe down on the handle calls back once', () => {
	const h = harness()
	let calls = 0
	onSwipeDown(h.root, '.handle', () => calls++)
	h.down(1, 0)
	h.up(1, 120)
	h.up(1, 240)
	assert.equal(calls, 1)
})

test('a new press drops a swipe whose release was lost', () => {
	const h = harness()
	let calls = 0
	onSwipeDown(h.root, '.handle', () => calls++)
	h.down(1, 0)
	// Released outside the window: no pointerup. Then a tap elsewhere.
	h.down(2, 300)
	h.up(2, 300)
	// A late event for the first pointer must not close anything.
	h.up(1, 200)
	assert.equal(calls, 0)
})
