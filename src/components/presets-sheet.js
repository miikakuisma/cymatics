// The picker's parts, on both layouts: thumbnail tiles, rows (phone) or grids
// (desktop) of them, and the small popover menus. cymatics-presets decides what goes in them and what a tap does.

const el = (tag, className, text) => {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text) node.textContent = text
	return node
}

const button = (className, text, onClick) => {
	const b = el('button', className, text)
	b.type = 'button'
	b.addEventListener('click', onClick)
	return b
}

export function label(text) {
	return el('p', 'sheet-label', text)
}

export function row(tiles) {
	const r = el('div', 'sheet-row')
	r.setAttribute('role', 'list')
	r.append(...tiles)
	return r
}

// The desktop panel's version of a row: tiles four across, wrapping.
export function grid(tiles) {
	const g = el('div', 'sheet-grid')
	g.setAttribute('role', 'list')
	g.append(...tiles)
	return g
}

// One preset as a thumbnail and its name. The picture is a dark placeholder
// until `img` is given a src. `more` opens the tile's menu: a ⋯ badge, shown
// on the selected tile only.
export function tile({ name, current = false, onPick, more = null, glyph = null }) {
	const t = el('div', 'tile')
	t.setAttribute('role', 'listitem')
	t.classList.toggle('current', current)
	const pick = button('tile-pick', '', onPick)
	pick.setAttribute('aria-pressed', String(current))
	// The whole name, for a pointer, where the tile's is cut short.
	pick.title = name
	const thumb = el('span', 'tile-thumb')
	const img = el('img')
	img.alt = ''
	img.draggable = false
	if (glyph) thumb.textContent = glyph
	else thumb.append(img)
	pick.append(thumb, el('span', 'tile-name', name))
	t.append(pick)
	if (more) {
		const badge = button('tile-more', '⋯', (e) => more(e.currentTarget))
		badge.setAttribute('aria-label', `${name} options`)
		t.append(badge)
	}
	return { tile: t, img }
}

export function moreButton(title, onOpen) {
	const b = button('sheet-more', '⋯', (e) => onOpen(e.currentTarget))
	b.setAttribute('aria-label', title)
	return b
}

// One menu open at a time, anchored to the button that opened it. A tap
// outside it or Escape closes it; its own button toggles it.
let open = null

export function closeMenu() {
	if (!open) return
	open.menu.remove()
	removeEventListener('pointerdown', open.onDown, true)
	removeEventListener('keydown', open.onKey, true)
	open = null
}

// items: [{ label, run, disabled }]. The menu goes in `parent`, which must not
// be transformed: the menu is fixed to the viewport.
export function openMenu(anchor, items, parent) {
	const again = open?.anchor === anchor
	closeMenu()
	if (again) return
	const menu = el('div', 'sheet-menu')
	menu.setAttribute('role', 'menu')
	for (const item of items) {
		const b = button('', item.label, () => {
			closeMenu()
			item.run()
		})
		b.setAttribute('role', 'menuitem')
		b.disabled = Boolean(item.disabled)
		menu.append(b)
	}
	parent.append(menu)
	place(menu, anchor)
	const onDown = (e) => {
		if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu()
	}
	const onKey = (e) => {
		if (e.key === 'Escape') closeMenu()
	}
	addEventListener('pointerdown', onDown, true)
	addEventListener('keydown', onKey, true)
	open = { menu, anchor, onDown, onKey }
}

// Above the anchor, right edges aligned, or below it when there is no room;
// always inside the viewport.
function place(menu, anchor) {
	const gap = 6
	const edge = 8
	const a = anchor.getBoundingClientRect()
	const m = menu.getBoundingClientRect()
	const top = a.top - gap - m.height >= edge
		? a.top - gap - m.height
		: Math.min(a.bottom + gap, innerHeight - edge - m.height)
	const left = Math.min(Math.max(edge, a.right - m.width), innerWidth - edge - m.width)
	menu.style.top = `${Math.max(edge, top)}px`
	menu.style.left = `${Math.max(edge, left)}px`
}
