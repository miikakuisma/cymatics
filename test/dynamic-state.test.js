import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDynamicState, dynamicState } from '../src/dynamic-state.js'
import { MODULATORS } from '../src/element/modulate.js'

test('dynamicState reads the globals into a preset shape', () => {
	const store = { __dynamicLineColor: true, __dynamicLineColorMax: '#ffffff', __autoResponseSpeed: true, __kickBeatDiv: 2 }
	const state = dynamicState(store)
	assert.equal(state.renderer.dynamicLineColor, true)
	assert.equal(state.renderer.dynamicLineColorMax, '#ffffff')
	assert.equal(state.cymatics.autoResponseSpeed, true)
	assert.equal(state.cymatics.kickBeatDiv, 2)
})

test('every modulator in the shared table round-trips', () => {
	const store = {}
	for (const m of MODULATORS) store[`__${m.prefix}`] = true
	const state = dynamicState(store)
	for (const m of MODULATORS) assert.equal(state[m.from][m.prefix], true, m.prefix)
})

test('applyDynamicState sets what the preset has and clears what it does not', () => {
	const store = { __dynamicLineColor: true, __dynamicViewScale: true }
	applyDynamicState({ renderer: { dynamicLineColor: false }, cymatics: { dynamicFreqDetail: true, dynamicFreqDetailMin: 2 } }, store)
	assert.equal(store.__dynamicLineColor, false)
	assert.equal('__dynamicViewScale' in store, false)
	assert.equal(store.__dynamicFreqDetail, true)
	assert.equal(store.__dynamicFreqDetailMin, 2)
})
