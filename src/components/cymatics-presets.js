import { LOOKS, lookPreset } from '../element/looks.js'
import { host } from '../studio/host.js'
import { dynamicState } from '../dynamic-state.js'
import { overDefaults } from '../studio/look-config.js'
import { defaultPresets } from '../default-presets.js'
import { phoneQuery } from '../studio/layout.js'
import { phoneStudio } from '../studio/phone-studio.js'
import { thumbnailFor } from '../studio/thumbs.js'
import { closeMenu, label, moreButton, openMenu, row, tile } from './presets-sheet.js'

// What is on the plate now, as a preset: the engine's three sections plus the
// panel's modulator settings.
export function currentPreset() {
	const dyn = dynamicState()
	return {
		poleMode: s('pole-config').selected,
		renderer: { ...engine.state.rendererConfig, ...dyn.renderer },
		cymatics: { ...engine.state.cymaticsConfig, ...dyn.cymatics },
		liquid: engine.state.liquidConfig,
	}
}

export class PuhdeCymaticsPresets extends HTMLElement {

	constructor() {
    super()
		this.visible = 'false'
		this.mine = []
		this.current = { source: 'look', id: LOOKS[0].id, name: LOOKS[0].name }
		// Thumbnails drawn so far, by tile, so a re-render shows them at once.
		this.thumbs = new Map()
		// Counts picks, so a slow read of an own preset cannot land after a
		// later tap.
		this.picks = 0
  }

  connectedCallback() {
		this.render()
		void this.refresh()
		window.exportPreset = () => console.log(JSON.stringify(currentPreset()))
		// Phone and desktop lay the panel out differently.
		phoneQuery().addEventListener('change', () => {
			closeMenu()
			this.render()
			this.listPresets()
		})
  }

	static get observedAttributes() {
		return ['visible']
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
		if (property !== 'visible') return
		if (newValue === 'true') {
			this.listPresets()
			this.place()
		}
		if (newValue === 'false') {
			closeMenu()
			this.place()
		}
	}

	render() {
		this.innerHTML = phoneQuery().matches
			? `
			<div class="presets sheet">
				<div class="sheet-body"></div>
			</div>
		`
			: `
			<div class="presets">
				<ul></ul>
			</div>
		`
		// Read when it fires, not now: the panel can be shown between the two.
		setTimeout(() => this.place())
  }

	// In or out: from the left in the desktop studio; on a phone the CSS slides
	// the sheet up (or in from the right, sideways) on .shown.
	place() {
		const panel = this.querySelector('.presets')
		if (!panel) return
		const shown = this.visible === 'true'
		if (panel.classList.contains('sheet')) {
			panel.style.transform = ''
			panel.classList.toggle('shown', shown)
			return
		}
		const studioMode = s('#app').getAttribute('mode') === 'studio'
		panel.style.transform = shown
			? (studioMode ? 'translateX(0)' : 'translateY(0)')
			: (studioMode ? 'translateX(-300px)' : 'translateY(200px)')
	}

	async refresh() {
		try { this.mine = await host().presets.list() } catch { this.mine = [] }
		this.listPresets()
	}

	// A preset from outside the panel: a file the host opened, or a look.
	open(preset, { id = null, name = null, mine = false } = {}) {
		this.picks++
		s('p-cymatics').loadConfig(overDefaults(preset))
		this.current = mine ? { source: 'own', id, name } : { source: 'file', id: null, name }
		this.listPresets()
	}

	listPresets() {
		if (phoneQuery().matches) return this.listSheet()
		const ul = this.querySelector('.presets ul')
		if (!ul) return
		ul.replaceChildren()
		const heading = (text) => {
			const li = document.createElement('li')
			li.className = 'preset-group'
			li.textContent = text
			ul.append(li)
		}
		const row = (label, selected, onPick, buttons = []) => {
			const li = document.createElement('li')
			if (selected) li.classList.add('activated')
			const span = document.createElement('span')
			span.textContent = label
			li.append(span, ...buttons)
			li.onclick = (e) => { if (!e.target.closest('button')) onPick() }
			ul.append(li)
		}
		const button = (fn, title, glyph, onClick) => {
			const b = document.createElement('button')
			b.setAttribute('fn', fn)
			b.title = title
			b.textContent = glyph
			b.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
			return b
		}
		heading('Looks')
		for (const look of LOOKS) {
			row(look.name, this.current.source === 'look' && this.current.id === look.id, () => this.loadLook(look))
		}
		// Factory presets first, then the user's own. Factory ones have no rename
		// or delete, and Save on one goes to Save As, so they cannot be lost.
		heading('Presets')
		for (const f of defaultPresets) {
			row(f.name, this.current.source === 'factory' && this.current.id === f.objectId, () => this.loadFactory(f))
		}
		for (const p of this.mine) {
			row(p.name, this.current.source === 'own' && this.current.id === p.id, () => this.loadOwn(p), [
				button('rename', 'Rename', '✎', () => this.renamePreset(p)),
				button('delete', 'Delete', '×', () => this.deletePreset(p)),
			])
		}
		for (const action of host().actions) {
			const ok = this.canRun(action)
			const b = button('action', action.label, action.label, () => ok && action.run({ id: this.current.id, name: this.current.name }))
			b.disabled = !ok
			const li = document.createElement('li')
			li.className = 'preset-action'
			li.append(b)
			ul.append(li)
		}
	}

	// The phone picker: the open preset's name and menu, a row of looks, a row
	// of presets ending in ＋ Save, and Adjust. Rebuilt on every change, so each
	// row keeps where it was scrolled to.
	listSheet() {
		const body = this.querySelector('.sheet-body')
		if (!body) return
		closeMenu()
		const scrolled = [...body.querySelectorAll('.sheet-row')].map((r) => r.scrollLeft)
		const is = (source, id) => this.current.source === source && this.current.id === id

		const head = document.createElement('div')
		head.className = 'sheet-head'
		const title = document.createElement('span')
		title.className = 'sheet-title'
		title.textContent = this.current.name || 'Untitled'
		head.append(title, moreButton('Preset options', (anchor) => openMenu(anchor, [
			{ label: 'Save', run: () => this.save() },
			...(host().chrome.standalone ? [{ label: 'Set as Default', run: () => this.setAsDefault() }] : []),
		], this)))

		const looks = LOOKS.map((look) => {
			const t = tile({ name: look.name, current: is('look', look.id), onPick: () => this.loadLook(look) })
			this.paint(t.img, `look:${look.id}`, () => lookPreset(look.id))
			return t.tile
		})
		const factory = defaultPresets.map((f) => {
			const t = tile({ name: f.name, current: is('factory', f.objectId), onPick: () => this.loadFactory(f) })
			this.paint(t.img, `factory:${f.objectId}`, () => f.preset)
			return t.tile
		})
		const mine = this.mine.map((p) => {
			const current = is('own', p.id)
			const t = tile({
				name: p.name,
				current,
				onPick: () => this.loadOwn(p),
				more: current ? (anchor) => openMenu(anchor, [
					{ label: 'Rename', run: () => this.renamePreset(p) },
					{ label: 'Delete', run: () => this.deletePreset(p) },
					...host().actions.map((action) => ({
						label: action.label,
						disabled: !this.canRun(action),
						run: () => action.run({ id: this.current.id, name: this.current.name }),
					})),
				], this) : null,
			})
			this.paint(t.img, `own:${p.id}`, () => host().presets.read(p.id))
			return t.tile
		})
		const add = tile({ name: 'Save', glyph: '＋', onPick: () => this.saveAs() }).tile

		const adjust = document.createElement('button')
		adjust.type = 'button'
		adjust.className = 'sheet-adjust'
		adjust.textContent = 'Adjust ›'
		adjust.addEventListener('click', () => phoneStudio().open('editor'))

		body.replaceChildren(
			head,
			label('Looks'), row(looks),
			label('Presets'), row([...factory, ...mine, add]),
			adjust,
		)
		body.querySelectorAll('.sheet-row').forEach((r, i) => { r.scrollLeft = scrolled[i] ?? 0 })
	}

	// A tile's picture: the one drawn before at once, then the queue's, which
	// is fresh if the preset changed. Only while the sheet is open, so nothing
	// renders before it is first wanted; a tile replaced meanwhile is left be.
	paint(img, key, load) {
		const known = this.thumbs.get(key)
		if (known) img.src = known
		if (this.visible !== 'true') return
		Promise.resolve()
			.then(load)
			.then((preset) => thumbnailFor(preset))
			.then((url) => {
				if (!url) return
				this.thumbs.set(key, url)
				if (img.isConnected && img.getAttribute('src') !== url) img.src = url
			})
			.catch(() => { /* an unreadable preset keeps its placeholder */ })
	}

	// A host action that needs a saved preset waits for one of yours.
	canRun(action) {
		return !action.needsSaved || this.current.source === 'own'
	}

	loadLook(look) {
		this.picks++
		const { renderer, cymatics, liquid } = lookPreset(look.id)
		s('p-cymatics').loadConfig(overDefaults({ renderer, cymatics, liquid }))
		this.current = { source: 'look', id: look.id, name: look.name }
		this.listPresets()
	}

	// Over the engine defaults, as a look is: a factory preset that predates a
	// key (No Plate has no field_mode) must not keep the last preset's value.
	loadFactory(f) {
		this.picks++
		s('p-cymatics').loadConfig(overDefaults(f.preset))
		this.current = { source: 'factory', id: f.objectId, name: f.name }
		this.listPresets()
	}

	// Picking a source brings its kind of field: the tone generator is for
	// finding single-frequency figures, so it opens on the Round Plate; music,
	// radio, the mic and files open on No Plate. Only a switch of kind loads
	// anything — a tone on the Square Plate stays there, and a song over the
	// user's own ripple preset keeps it.
	matchSource(source) {
		const wantPlate = source === 'tone'
		const onPlate = (engine.state.cymaticsConfig.field_mode ?? 0) !== 0
		if (wantPlate === onPlate) return
		const f = defaultPresets.find((d) => wantPlate
			? d.preset.cymatics?.field_mode === 2
			: !d.preset.cymatics?.field_mode)
		if (f) this.loadFactory(f)
	}

	async loadOwn(p) {
		const pick = ++this.picks
		try {
			const preset = await host().presets.read(p.id)
			if (pick !== this.picks) return
			s('p-cymatics').loadConfig(overDefaults(preset))
			this.current = { source: 'own', id: p.id, name: p.name }
		} catch (error) {
			if (pick !== this.picks) return
			this.say(error?.message || 'That preset could not be read.')
		}
		this.listPresets()
	}

	// ⌘S: over the open preset when it is yours, otherwise as a new one.
	save() {
		if (this.current.source !== 'own') return this.saveAs()
		return this.write({ id: this.current.id, name: this.current.name, replace: true })
	}

	saveAs() {
		engine.api.getInput({
			type: 'text',
			title: 'Save preset as…',
			buttonText: 'Save',
			onSubmit: (name) => { void this.write({ id: null, name: (name || '').trim() || 'Untitled', replace: false }) },
		})
	}

	async write({ id, name, replace }) {
		try {
			const saved = await host().presets.save({ id, name, preset: currentPreset(), replace })
			this.current = { source: 'own', id: saved.id, name: saved.name }
			await this.refresh()
			this.say(`Saved “${saved.name}”.`)
		} catch (error) {
			if (error?.code === 'exists' && !replace) {
				if (await this.ask(`“${name}” already exists. Replace it?`, 'Replace')) {
					return this.write({ id, name, replace: true })
				}
				return
			}
			this.say(error?.message || 'That preset could not be saved.')
		}
	}

	// Standalone only: the scene the app opens on next time (mount.js reads it).
	// `button`, when given, says so on itself, as the panel's button always has.
	setAsDefault(button = null) {
		const preset = {
			poleMode: s('pole-config').selected,
			renderer: engine.state.rendererConfig,
			cymatics: engine.state.cymaticsConfig,
			liquid: engine.state.liquidConfig,
		}
		localStorage.setItem('cymatics_default_preset', JSON.stringify(preset))
		if (!button) return this.say('Default Saved!')
		button.textContent = 'Default Saved!'
		setTimeout(() => { button.textContent = 'Set as Default' }, 2000)
	}

	renamePreset(p) {
		engine.api.getInput({
			type: 'text',
			title: 'Rename preset',
			buttonText: 'Rename',
			onSubmit: async (name) => {
				const next = (name || '').trim()
				if (!next || next === p.name) return
				try {
					const renamed = await host().presets.rename(p.id, next)
					if (this.current.source === 'own' && this.current.id === p.id) this.current = { source: 'own', ...renamed }
					await this.refresh()
				} catch (error) {
					this.say(error?.code === 'exists' ? `“${next}” already exists.` : error?.message || 'That preset could not be renamed.')
				}
			},
		})
	}

	async deletePreset(p) {
		if (!(await this.ask(`Delete “${p.name}”?`, 'Delete'))) return
		try {
			await host().presets.remove(p.id)
			if (this.current.source === 'own' && this.current.id === p.id) this.current = { source: 'file', id: null, name: p.name }
			await this.refresh()
		} catch (error) {
			this.say(error?.message || 'That preset could not be deleted.')
		}
	}

	// A two-button modal in the same style as engine.api.getInput.
	ask(text, yes) {
		return new Promise((resolve) => {
			const modal = document.createElement('div')
			modal.className = 'modal'
			const box = document.createElement('div')
			box.className = 'modal-box'
			const p = document.createElement('p')
			p.textContent = text
			const cancel = document.createElement('button')
			cancel.textContent = 'Cancel'
			const ok = document.createElement('button')
			ok.className = 'primary'
			ok.textContent = yes
			box.append(p, cancel, ok)
			modal.append(box)
			// Enter confirms and Escape cancels here, captured ahead of any key
			// handler an earlier dialog left on the window.
			const onKey = (e) => {
				if (e.key !== 'Enter' && e.key !== 'Escape') return
				e.preventDefault()
				e.stopImmediatePropagation()
				done(e.key === 'Enter')
			}
			const done = (answer) => {
				removeEventListener('keydown', onKey, true)
				modal.remove()
				resolve(answer)
			}
			addEventListener('keydown', onKey, true)
			cancel.onclick = () => done(false)
			ok.onclick = () => done(true)
			modal.onclick = (e) => { if (e.target === modal) done(false) }
			s('#app').append(modal)
		})
	}

	// One line under the list, gone after four seconds.
	say(text) {
		let note = this.querySelector('.preset-note')
		if (!note) {
			note = document.createElement('p')
			note.className = 'preset-note'
			this.querySelector('.presets')?.append(note)
		}
		if (!note) return
		note.textContent = text
		clearTimeout(this.noteTimer)
		this.noteTimer = setTimeout(() => { note.textContent = '' }, 4000)
	}

}

customElements.define('cymatics-presets', PuhdeCymaticsPresets)
