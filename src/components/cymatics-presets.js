import { LOOKS, lookPreset } from '../element/looks.js'
import { host } from '../studio/host.js'
import { dynamicState } from '../dynamic-state.js'
import { overDefaults } from '../studio/look-config.js'
import { defaultPresets } from '../default-presets.js'

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
  }

  connectedCallback() {
		this.render()
		void this.refresh()
		window.exportPreset = () => console.log(JSON.stringify(currentPreset()))
  }

	static get observedAttributes() {
		return ['visible']
	}

	attributeChangedCallback(property, oldValue, newValue) {
		if (oldValue === newValue) return
		this[property] = newValue
		const studioMode = s('#app').getAttribute('mode') === 'studio'
		if (property === 'visible' && newValue === 'true') {
			this.listPresets()
			this.querySelector('.presets').style.transform = studioMode ? 'translateX(0)' : 'translateY(0)'
		}
    if (property === 'visible' && newValue === 'false') {
			this.querySelector('.presets').style.transform = studioMode ? 'translateX(-300px)' : 'translateY(200px)'
		}
	}

	render() {
		const studioMode = s('#app').getAttribute('mode') === 'studio'
		this.innerHTML = `
			<div class="presets">
				<ul></ul>
			</div>
		`
		// Read when it fires, not now: the panel can be shown between the two.
		setTimeout(() => {
			const shown = this.visible === 'true'
			this.querySelector('.presets').style.transform = shown
				? (studioMode ? 'translateX(0)' : 'translateY(0)')
				: (studioMode ? 'translateX(-300px)' : 'translateY(200px)')
		})
  }

	async refresh() {
		try { this.mine = await host().presets.list() } catch { this.mine = [] }
		this.listPresets()
	}

	// A preset from outside the panel: a file the host opened, or a look.
	open(preset, { id = null, name = null, mine = false } = {}) {
		s('p-cymatics').loadConfig(overDefaults(preset))
		this.current = mine ? { source: 'own', id, name } : { source: 'file', id: null, name }
		this.listPresets()
	}

	listPresets() {
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
			row(look.name, this.current.source === 'look' && this.current.id === look.id, () => {
				const { renderer, cymatics, liquid } = lookPreset(look.id)
				s('p-cymatics').loadConfig(overDefaults({ renderer, cymatics, liquid }))
				this.current = { source: 'look', id: look.id, name: look.name }
				this.listPresets()
			})
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
			const ok = !action.needsSaved || this.current.source === 'own'
			const b = button('action', action.label, action.label, () => ok && action.run({ id: this.current.id, name: this.current.name }))
			b.disabled = !ok
			const li = document.createElement('li')
			li.className = 'preset-action'
			li.append(b)
			ul.append(li)
		}
	}

	// Over the engine defaults, as a look is: a factory preset that predates a
	// key (No Plate has no field_mode) must not keep the last preset's value.
	loadFactory(f) {
		s('p-cymatics').loadConfig(overDefaults(f.preset))
		this.current = { source: 'factory', id: f.objectId, name: f.name }
		this.listPresets()
	}

	async loadOwn(p) {
		try {
			s('p-cymatics').loadConfig(overDefaults(await host().presets.read(p.id)))
			this.current = { source: 'own', id: p.id, name: p.name }
		} catch (error) {
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
