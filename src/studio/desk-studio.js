// The desktop studio has two switches. `on` is the studio itself: the nav bar
// shows and the cog is lit. `panel` is the one panel on the right, which only
// opens while the studio is on. The cog and Tab switch the studio, panel and
// all; the nav's grid and sliders buttons switch only the panel, and a tap on
// the plate closes only the panel, so the nav (and its play button) stays.
// `show({ on, panel })` puts a change on screen (mount.js).

export function createDeskStudio({ show }) {
	let state = { on: false, panel: false }
	const listeners = new Set()

	function go(next) {
		next = { on: Boolean(next.on), panel: Boolean(next.on && next.panel) }
		if (next.on === state.on && next.panel === state.panel) return
		state = next
		show({ ...state })
		for (const fn of [...listeners]) fn({ ...state })
	}

	return {
		get open() {
			return state.on
		},
		get panel() {
			return state.panel
		},
		// The studio on with its panel open, or off.
		set: (on) => go({ on, panel: on }),
		toggle: () => go({ on: !state.on, panel: !state.on }),
		close: () => go({ on: false, panel: false }),
		togglePanel: () => go({ on: true, panel: !state.panel }),
		closePanel: () => go({ on: state.on, panel: false }),
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
	unforward = instance.onChange((state) => {
		for (const fn of [...subscribers]) fn(state)
	})
}

use(createDeskStudio({ show: () => {} }))

const facade = {
	get open() {
		return current.open
	},
	get panel() {
		return current.panel
	},
	set: (on) => current.set(on),
	toggle: () => current.toggle(),
	close: () => current.close(),
	togglePanel: () => current.togglePanel(),
	closePanel: () => current.closePanel(),
	onChange(fn) {
		subscribers.add(fn)
		return () => subscribers.delete(fn)
	},
}

// Returns the facade, the same object deskStudio() returns. Starts off.
export function initDeskStudio(show) {
	use(createDeskStudio({ show }))
	return facade
}

export function deskStudio() {
	return facade
}
