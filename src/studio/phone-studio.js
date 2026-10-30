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

	function open(next) {
		if (next === phase) return
		if (next === 'editor') session.begin()
		else if (phase === 'editor') session.done()
		enter(next)
	}

	function cancel() {
		if (phase !== 'editor') return
		try {
			session.cancel()
		} finally {
			enter('picker')
		}
	}

	function done() {
		if (phase !== 'editor') return
		session.done()
		enter('picker')
	}

	const close = () => open('closed')

	function onChange(fn) {
		listeners.add(fn)
		return () => listeners.delete(fn)
	}

	return {
		get phase() {
			return phase
		},
		open,
		close,
		cancel,
		done,
		leavePhone: close,
		onChange,
	}
}

// The app's instance. phoneStudio() always returns the same facade, so a
// reference or a subscription taken before initPhoneStudio keeps working after
// it. Before init the underlying instance is inert, as host() is before
// setHost: it has no studio to capture or show.
const noop = () => {}
const subscribers = new Set()
let current
let unforward = noop

function use(instance) {
	unforward()
	current = instance
	unforward = instance.onChange((phase) => {
		for (const fn of [...subscribers]) fn(phase)
	})
}

const facade = {
	get phase() {
		return current.phase
	},
	open: (phase) => current.open(phase),
	close: () => current.close(),
	cancel: () => current.cancel(),
	done: () => current.done(),
	leavePhone: () => current.leavePhone(),
	onChange(fn) {
		subscribers.add(fn)
		return () => subscribers.delete(fn)
	},
}

use(createPhoneStudio({ session: createEditSession({ capture: noop, restore: noop }), show: noop }))

// Returns the facade, the same object phoneStudio() returns.
export function initPhoneStudio({ capture, restore, show }) {
	use(createPhoneStudio({ session: createEditSession({ capture, restore }), show }))
	return facade
}

export function phoneStudio() {
	return facade
}
