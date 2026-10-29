import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playButtonAction } from '../src/studio/sources.js'

test('playing: the button stops it', () => {
	assert.equal(playButtonAction({ playing: true, mode: 'external', offered: ['music', 'mic'] }), 'stop')
})

// The hosted studio starts on Music, so its mode is 'external' from launch:
// the button must still offer the microphone when stopped.
test('stopped with more than one source: the menu, whatever played last', () => {
	assert.equal(playButtonAction({ playing: false, mode: 'external', offered: ['music', 'mic'] }), 'menu')
	assert.equal(playButtonAction({ playing: false, mode: 'mic', offered: ['music', 'mic'] }), 'menu')
	assert.equal(playButtonAction({ playing: false, mode: '', offered: ['file', 'mic', 'radio'] }), 'menu')
})

test('stopped with Music the only source: follow it again', () => {
	assert.equal(playButtonAction({ playing: false, mode: 'external', offered: ['music'] }), 'external')
})
