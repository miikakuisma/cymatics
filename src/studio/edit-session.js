// An Adjust session: a snapshot taken when editing starts, so Cancel can put
// everything back. Done just ends it. capture/restore come from the studio.

export function createEditSession({ capture, restore }) {
	let snapshot = null
	let active = false
	return {
		begin() {
			if (active) return
			snapshot = capture()
			active = true
		},
		cancel() {
			if (!active) return
			const saved = snapshot
			snapshot = null
			active = false
			restore(saved)
		},
		done() {
			snapshot = null
			active = false
		},
		get active() {
			return active
		},
	}
}
