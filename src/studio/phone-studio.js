// The phone studio's three phases: closed, picker (a sheet of looks and
// presets) and editor (one control at a time). Entering the editor starts an
// edit session; Cancel is the only way out that undoes it.

import { createEditSession } from './edit-session.js'

export function createPhoneStudio({ session, show }) {
	let phase = 'closed'
	const listeners = new Set()

	function enter(next) {
		if (next === phase) return
		phase = next
		show(next)
		for (const fn of [...listeners]) fn(next)
	}

	return {
		get phase() {
			return phase
		},
		open(next) {
			if (next === phase) return
			if (next === 'editor') session.begin()
			else if (phase === 'editor') session.done()
			enter(next)
		},
		close() {
			this.open('closed')
		},
		cancel() {
			if (phase !== 'editor') return
			session.cancel()
			enter('picker')
		},
		done() {
			if (phase !== 'editor') return
			session.done()
			enter('picker')
		},
		leavePhone() {
			this.open('closed')
		},
		onChange(fn) {
			listeners.add(fn)
			return () => listeners.delete(fn)
		},
	}
}

// The app's instance. Before initPhoneStudio it is inert, as host() is before
// setHost: it has no studio to capture or show.
const noop = () => {}
let current = createPhoneStudio({ session: createEditSession({ capture: noop, restore: noop }), show: noop })

export function initPhoneStudio({ capture, restore, show }) {
	current = createPhoneStudio({ session: createEditSession({ capture, restore }), show })
	return current
}

export function phoneStudio() {
	return current
}
