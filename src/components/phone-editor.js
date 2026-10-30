// The phone editor's parts: the Cancel / Done bar, the shell, a tool's
// wrapper, its round icon button, the tab buttons and a slider's name row.
// cymatics-controls builds the controls into the wrappers and decides which
// one shows.

import { TABS } from '../studio/control-tabs.js'

// The EQ is not in controls.js: it is p-equalizer, a tool of the Audio tab.
export const EQ_TOOL = { id: 'eq', label: 'EQ', icon: 'eq', tab: 'audio' }

const el = (tag, className, text) => {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text) node.textContent = text
	return node
}

const button = (className, onClick) => {
	const b = el('button', className)
	b.type = 'button'
	b.addEventListener('click', onClick)
	return b
}

// Bottom to top: tabs, tool icons, the selected tool. The bar is outside
// .controls, which slides with a transform: a fixed child of a transformed
// element is fixed to that element, not to the screen.
export function editorShell({ onCancel, onDone, onTab }) {
	const bar = el('div', 'editor-bar')
	const cancel = button('editor-cancel', onCancel)
	cancel.textContent = 'Cancel'
	const done = button('editor-done', onDone)
	done.textContent = 'Done'
	bar.append(cancel, done)

	const panel = el('div', 'controls editor')
	const area = el('div', 'tool-area')
	const toolRow = el('div', 'tool-row')
	toolRow.setAttribute('role', 'toolbar')
	const tabs = el('div', 'tab-row')
	tabs.setAttribute('role', 'tablist')
	for (const tab of TABS) {
		const b = button('editor-tab', () => onTab(tab.id))
		b.textContent = tab.label
		b.dataset.tab = tab.id
		b.setAttribute('role', 'tab')
		tabs.append(b)
	}
	panel.append(area, toolRow, tabs)
	return { bar, panel, area }
}

// One tool's control. `big` ones (anything not a single slider) always take
// the tall area; a slider does while its Auto settings are open.
export function toolWrapper({ id, tab, big = false }) {
	const w = el('div', 'tool')
	w.dataset.tool = id
	w.dataset.tab = tab
	if (big) w.dataset.big = ''
	return w
}

export function toolButton({ id, label, icon }, selected, onPick) {
	const b = button('tool-icon', () => onPick(id))
	b.dataset.tool = id
	b.classList.toggle('selected', selected)
	b.setAttribute('aria-pressed', String(selected))
	const glyph = el('span', 'tool-glyph')
	glyph.innerHTML = window.icons?.[icon] ?? ''
	b.append(glyph, el('span', 'tool-name', label))
	return b
}

// Name, then the Auto pill if it has one, then the value as a plain number.
export function sliderHead(label, autoLabel, slider, { step, name }) {
	const head = el('div', 'tool-head')
	const value = el('span', 'tool-value')
	// Sliders carry their value x100, except light_distance (see createSlider).
	const scale = name === 'light_distance' ? 1 : 100
	const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
	const paint = () => {
		value.textContent = (parseFloat(slider.value) / scale).toFixed(decimals)
	}
	slider.addEventListener('input', paint)
	paint()
	head.append(label)
	if (autoLabel) head.append(autoLabel)
	head.append(value)
	head.paint = paint
	return head
}
