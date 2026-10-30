import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PHONE_QUERY } from '../src/studio/layout.js'

// The stylesheets with phone rules. CSS cannot import the constant, so each
// carries a copy; a copy that drifts would split phone and desktop.
const FILES = [
	'src/components/cymatics-presets.css',
	'src/components/cymatics-controls.css',
	'src/components/cymatics-component.css',
	'src/components/p-audio.css',
]

for (const file of FILES) {
	test(`${file} uses PHONE_QUERY verbatim`, () => {
		const css = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
		assert.ok(css.includes(`@media ${PHONE_QUERY} {`), 'no phone rules under PHONE_QUERY')
		// Any other query that speaks of a phone is a copy that has drifted.
		const phoneLike = [...css.matchAll(/@media ([^{]*)\{/g)]
			.map((m) => m[1].trim())
			.filter((q) => q.includes('768px') || q.includes('pointer: coarse'))
		for (const q of phoneLike) assert.equal(q, PHONE_QUERY)
	})
}
