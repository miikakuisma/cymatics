// Swipe down to close the phone's sheet and editor. Only a drag that starts on
// a handle counts (the sheet's header, the editor's tab row), and only one
// that falls further than it travels sideways: a row scrolled sideways never
// closes anything.

export const SWIPE_MIN = 60

export function isSwipeDown(dx, dy) {
	return dy >= SWIPE_MIN && dy > Math.abs(dx)
}

// Calls fn on a swipe down that starts on `handle` (a selector) inside root.
// The release is heard on the window, as the finger or the mouse may leave the
// handle; the click that a release on a button would then send is swallowed,
// so a swipe that ends on a tab does not also pick it. The handles carry
// touch-action: pan-x in the CSS, so a vertical drag reaches here instead of
// being taken by the browser.
export function onSwipeDown(root, handle, fn) {
	// The swipe being followed. A new press drops it: its release may have
	// been lost outside the window, and must not close anything later.
	let pending = null
	const drop = () => {
		if (!pending) return
		removeEventListener('pointerup', pending, true)
		removeEventListener('pointercancel', pending, true)
		pending = null
	}
	root.addEventListener('pointerdown', (down) => {
		drop()
		if (!down.isPrimary || !down.target.closest?.(handle)) return
		const end = (e) => {
			if (e.pointerId !== down.pointerId) return
			drop()
			if (e.type !== 'pointerup' || !isSwipeDown(e.clientX - down.clientX, e.clientY - down.clientY)) return
			const swallow = (click) => {
				click.preventDefault()
				click.stopPropagation()
			}
			addEventListener('click', swallow, { capture: true, once: true })
			setTimeout(() => removeEventListener('click', swallow, true))
			fn()
		}
		pending = end
		addEventListener('pointerup', end, true)
		addEventListener('pointercancel', end, true)
	})
}
