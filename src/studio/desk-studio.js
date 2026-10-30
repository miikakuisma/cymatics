// The desktop studio: one panel, open or closed. The cog, Tab, both of the
// nav's buttons and a tap on the plate all go through here, so they agree.
// `show(open)` puts it on screen (mount.js).

export function createDeskStudio({ show }) {
	let open = false
	const listeners = new Set()

	function set(on) {
		on = Boolean(on)
		if (on === open) return
		open = on
		show(on)
		for (const fn of [...listeners]) fn(on)
	}

	return {
		get open() {
			return open
		},
		set,
		toggle: () => set(!open),
		close: () => set(false),
		onChange(fn) {
			listeners.add(fn)
			return () => listeners.delete(fn)
		},
	}
}

// The app's instance. deskStudio() always returns the same facade, so a
// reference or a subscription taken before initDeskStudio keeps working after
// it. Before init it is inert, as phoneStudio() is: it has nothing to show.
const subscribers = new Set()
let current
let unforward = () => {}

function use(instance) {
	unforward()
	current = instance
	unforward = instance.onChange((on) => {
		for (const fn of [...subscribers]) fn(on)
	})
}

use(createDeskStudio({ show: () => {} }))

const facade = {
	get open() {
		return current.open
	},
	set: (on) => current.set(on),
	toggle: () => current.toggle(),
	close: () => current.close(),
	onChange(fn) {
		subscribers.add(fn)
		return () => subscribers.delete(fn)
	},
}

// Returns the facade, the same object deskStudio() returns. Starts closed.
export function initDeskStudio(show) {
	use(createDeskStudio({ show }))
	return facade
}

export function deskStudio() {
	return facade
}
