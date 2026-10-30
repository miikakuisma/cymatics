import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeskStudio, deskStudio, initDeskStudio } from '../src/studio/desk-studio.js'

const now = (studio) => ({ on: studio.open, panel: studio.panel })

test('the cog / Tab toggle switches the studio and its panel together', () => {
	const shown = []
	const studio = createDeskStudio({ show: (s) => shown.push(s) })
	assert.deepEqual(now(studio), { on: false, panel: false })
	studio.toggle()
	assert.deepEqual(now(studio), { on: true, panel: true })
	studio.toggle()
	assert.deepEqual(now(studio), { on: false, panel: false })
	assert.deepEqual(shown, [{ on: true, panel: true }, { on: false, panel: false }])
})

test('the nav toggles only the panel; the studio, and so the nav, stays on', () => {
	const studio = createDeskStudio({ show: () => {} })
	studio.set(true)
	studio.togglePanel()
	assert.deepEqual(now(studio), { on: true, panel: false })
	studio.togglePanel()
	assert.deepEqual(now(studio), { on: true, panel: true })
})

test('a plate tap closes only the panel, and does nothing with the studio off', () => {
	const shown = []
	const studio = createDeskStudio({ show: (s) => shown.push(s) })
	studio.closePanel()
	assert.deepEqual(shown, [], 'off stays off')
	studio.set(true)
	studio.closePanel()
	assert.deepEqual(now(studio), { on: true, panel: false })
	studio.closePanel()
	assert.equal(shown.length, 2, 'closing a closed panel shows nothing')
})

test('the cog with only the nav showing turns the studio off; again, on with the panel', () => {
	const studio = createDeskStudio({ show: () => {} })
	studio.set(true)
	studio.closePanel()
	studio.toggle()
	assert.deepEqual(now(studio), { on: false, panel: false })
	studio.toggle()
	assert.deepEqual(now(studio), { on: true, panel: true })
})

test('close and set: a panel never stays open with the studio off', () => {
	const studio = createDeskStudio({ show: () => {} })
	studio.set(true)
	studio.close()
	assert.deepEqual(now(studio), { on: false, panel: false })
	studio.set(true)
	studio.set(true)
	assert.deepEqual(now(studio), { on: true, panel: true })
	studio.set(false)
	assert.deepEqual(now(studio), { on: false, panel: false })
})

test('setting the state it is already in does nothing', () => {
	const shown = []
	const seen = []
	const studio = createDeskStudio({ show: (s) => shown.push(s) })
	studio.onChange((s) => seen.push(s))
	studio.close()
	studio.set(true)
	studio.set(true)
	studio.set(1)
	assert.deepEqual(shown, [{ on: true, panel: true }])
	assert.deepEqual(seen, [{ on: true, panel: true }])
})

test('onChange returns an unsubscribe', () => {
	const seen = []
	const studio = createDeskStudio({ show: () => {} })
	const off = studio.onChange((s) => seen.push(s.on))
	studio.toggle()
	off()
	studio.toggle()
	assert.deepEqual(seen, [true])
})

test('the facade is inert before init and keeps subscribers across it', () => {
	const seen = []
	deskStudio().onChange((s) => seen.push(s.on))
	deskStudio().toggle()
	const shown = []
	const facade = initDeskStudio((s) => shown.push(s))
	assert.equal(facade, deskStudio())
	assert.equal(deskStudio().open, false, 'init starts off')
	deskStudio().toggle()
	deskStudio().togglePanel()
	assert.equal(deskStudio().open, true)
	assert.equal(deskStudio().panel, false)
	assert.deepEqual(shown, [{ on: true, panel: true }, { on: true, panel: false }])
	assert.deepEqual(seen, [true, true, true])
})
