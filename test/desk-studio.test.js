import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeskStudio, deskStudio, initDeskStudio } from '../src/studio/desk-studio.js'

test('toggle opens and closes, showing each change once', () => {
	const shown = []
	const studio = createDeskStudio({ show: (on) => shown.push(on) })
	assert.equal(studio.open, false)
	studio.toggle()
	assert.equal(studio.open, true)
	studio.toggle()
	assert.equal(studio.open, false)
	assert.deepEqual(shown, [true, false])
})

test('setting the state it is already in does nothing', () => {
	const shown = []
	const seen = []
	const studio = createDeskStudio({ show: (on) => shown.push(on) })
	studio.onChange((on) => seen.push(on))
	studio.close()
	studio.set(true)
	studio.set(true)
	studio.set(1)
	assert.deepEqual(shown, [true])
	assert.deepEqual(seen, [true])
})

test('onChange returns an unsubscribe', () => {
	const seen = []
	const studio = createDeskStudio({ show: () => {} })
	const off = studio.onChange((on) => seen.push(on))
	studio.toggle()
	off()
	studio.toggle()
	assert.deepEqual(seen, [true])
})

test('the facade is inert before init and keeps subscribers across it', () => {
	const seen = []
	deskStudio().onChange((on) => seen.push(on))
	deskStudio().toggle()
	const shown = []
	const facade = initDeskStudio((on) => shown.push(on))
	assert.equal(facade, deskStudio())
	assert.equal(deskStudio().open, false, 'init starts closed')
	deskStudio().toggle()
	assert.equal(deskStudio().open, true)
	assert.deepEqual(shown, [true])
	assert.deepEqual(seen, [true, true])
})
