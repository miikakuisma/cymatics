import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEditSession } from '../src/studio/edit-session.js'
import { createPhoneStudio, initPhoneStudio, phoneStudio } from '../src/studio/phone-studio.js'

function rig() {
	const log = { captured: 0, restored: [], shown: [], changed: [] }
	const snapshot = () => ({ n: ++log.captured })
	const session = createEditSession({ capture: snapshot, restore: (s) => log.restored.push(s) })
	const studio = createPhoneStudio({ session, show: (p) => log.shown.push(p) })
	studio.onChange((p) => log.changed.push(p))
	return { log, studio, session }
}

test('Adjust then Cancel restores the snapshot taken at Adjust and returns to the picker', () => {
	const { log, studio, session } = rig()
	studio.open('picker')
	studio.open('editor')
	assert.equal(session.active, true)
	studio.cancel()
	assert.deepEqual(log.restored, [{ n: 1 }])
	assert.equal(studio.phase, 'picker')
	assert.equal(session.active, false)
})

test('Done keeps changes: restore never called; phase picker', () => {
	const { log, studio } = rig()
	studio.open('editor')
	studio.done()
	assert.equal(log.restored.length, 0)
	assert.equal(studio.phase, 'picker')
})

test('closing from the editor keeps changes and closes', () => {
	const { log, studio, session } = rig()
	studio.open('editor')
	studio.close()
	assert.equal(log.restored.length, 0)
	assert.equal(studio.phase, 'closed')
	assert.equal(session.active, false)
})

test('opening the picker from the editor keeps changes', () => {
	const { log, studio, session } = rig()
	studio.open('editor')
	studio.open('picker')
	assert.equal(log.restored.length, 0)
	assert.equal(studio.phase, 'picker')
	assert.equal(session.active, false)
})

test('leavePhone from the editor keeps changes; from closed does nothing', () => {
	const { log, studio } = rig()
	studio.open('editor')
	studio.leavePhone()
	assert.equal(log.restored.length, 0)
	assert.equal(studio.phase, 'closed')
	const shown = log.shown.length
	studio.leavePhone()
	assert.equal(log.shown.length, shown)
	assert.equal(studio.phase, 'closed')
})

test('re-entering the editor while already in it does not take a new snapshot', () => {
	const { log, studio } = rig()
	studio.open('editor')
	studio.open('editor')
	assert.equal(log.captured, 1)
	assert.equal(log.shown.length, 1)
})

test('begin while active keeps the first snapshot', () => {
	let n = 0
	const restored = []
	const s = createEditSession({ capture: () => ++n, restore: (x) => restored.push(x) })
	s.begin()
	s.begin()
	s.cancel()
	assert.equal(n, 1)
	assert.deepEqual(restored, [1])
	s.cancel()
	s.done()
	assert.deepEqual(restored, [1])
})

test('cancel or done outside the editor changes nothing', () => {
	const { log, studio } = rig()
	studio.cancel()
	studio.done()
	assert.equal(studio.phase, 'closed')
	studio.open('picker')
	studio.cancel()
	studio.done()
	assert.equal(studio.phase, 'picker')
	assert.equal(log.restored.length, 0)
	assert.deepEqual(log.shown, ['picker'])
})

test('show and onChange fire once per phase change, with the new phase', () => {
	const { log, studio } = rig()
	studio.open('picker')
	studio.open('picker')
	studio.open('editor')
	studio.cancel()
	studio.open('closed')
	studio.open('closed')
	assert.deepEqual(log.shown, ['picker', 'editor', 'picker', 'closed'])
	assert.deepEqual(log.changed, log.shown)
})

test('onChange returns an unsubscribe function', () => {
	const { log, studio } = rig()
	const off = studio.onChange(() => log.changed.push('extra'))
	off()
	studio.open('picker')
	assert.deepEqual(log.changed, ['picker'])
})

test('open(closed) from the editor keeps edits and closes', () => {
	const { log, studio } = rig()
	studio.open('editor')
	studio.open('closed')
	assert.equal(log.restored.length, 0)
	assert.equal(studio.phase, 'closed')
})

test('close and leavePhone work unbound', () => {
	const { studio } = rig()
	studio.open('picker')
	const { close, leavePhone } = studio
	close()
	assert.equal(studio.phase, 'closed')
	studio.open('picker')
	leavePhone()
	assert.equal(studio.phase, 'closed')
})

test('cancel still reaches the picker, and the session ends, when restore throws', () => {
	const session = createEditSession({ capture: () => 1, restore: () => { throw new Error('boom') } })
	const studio = createPhoneStudio({ session, show: () => {} })
	studio.open('editor')
	assert.throws(() => studio.cancel(), /boom/)
	assert.equal(studio.phase, 'picker')
	assert.equal(session.active, false)
})

test('phoneStudio() is one stable object that survives initPhoneStudio', () => {
	const early = phoneStudio()
	const heard = []
	early.onChange((p) => heard.push(p))
	const shown = []
	const made = initPhoneStudio({ capture: () => 1, restore: () => {}, show: (p) => shown.push(p) })
	assert.equal(made, early)
	assert.equal(phoneStudio(), early)
	early.open('picker')
	assert.deepEqual(shown, ['picker'])
	assert.deepEqual(heard, ['picker'])
	assert.equal(early.phase, 'picker')
	// a second init swaps the instance without doubling the listener
	initPhoneStudio({ capture: () => 1, restore: () => {}, show: () => {} })
	assert.equal(phoneStudio(), early)
	early.open('editor')
	assert.deepEqual(heard, ['picker', 'editor'])
})
