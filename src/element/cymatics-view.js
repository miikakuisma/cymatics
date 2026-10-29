import { CymaticsEngine } from '../engine-js/index.js'
import { BINS, hasSignal } from './scale.js'
import { blend, freshSpectrum, idleSpectrum, idleWeight } from './idle.js'
import { coverSize, parseMaxDpr } from './size.js'
import { DEFAULT_LOOK, lookPreset } from './looks.js'
import { createBandFollower, createModulators, isModulatorKey, presetModulators } from './modulate.js'
import { createSpectrumTap } from './tap.js'

const STYLE = `
:host { display: block; position: relative; overflow: hidden; contain: layout paint; background: #000 }
canvas { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: block }
`

// A cymatics plate that covers its box. Feed it with connect(audioNode), or
// with push(bins, sampleRate) from anything that has a spectrum. With nothing
// fed it eases into a slow idle swell.
export class CymaticsView extends HTMLElement {
	static get observedAttributes() { return ['look', 'max-dpr'] }

	constructor() {
		super()
		this._shadow = this.attachShadow({ mode: 'open' })
		this._shadow.innerHTML = `<style>${STYLE}</style>`
		this._engine = null
		this._canvas = null
		this._failed = false
		this._paused = false
		this._inView = true
		this._zoom = 1
		this._tap = null
		this._sampleRate = 48000
		this._real = new Float32Array(BINS)
		this._idle = new Float32Array(BINS)
		this._mix = new Float32Array(BINS)
		this._lastPush = -Infinity
		this._lastSignal = -Infinity
		this._custom = null
		this._bands = createBandFollower()
		this._viewScale = 0.1
		this._lights = []
		this._onVisibility = () => this._run()
	}

	get supported() { return Boolean(this._engine) }

	get look() { return this.getAttribute('look') || DEFAULT_LOOK }
	set look(id) { this.setAttribute('look', id) }

	// A whole preset (the `preset` part of a preset file). Set, it wins over
	// `look`; null hands the plate back to `look`.
	get preset() { return this._custom ? structuredClone(this._custom) : null }
	set preset(value) {
		this._custom = value && typeof value === 'object' ? structuredClone(value) : null
		if (this._engine) this._applyLook()
	}

	get paused() { return this._paused }
	set paused(on) { this._paused = Boolean(on); this._run() }

	get zoom() { return this._zoom }
	set zoom(value) {
		const z = Number(value)
		if (!(z > 0) || z === this._zoom) return
		this._zoom = z
		this._applyZoom()
	}

	connectedCallback() {
		if (!this._engine && !this._failed) this._mount()
		this._run()
	}

	disconnectedCallback() {
		this._teardown()
	}

	attributeChangedCallback(name, oldValue, newValue) {
		if (oldValue === newValue || !this._engine) return
		if (name === 'look') this._applyLook()
		if (name === 'max-dpr') this._fit()
	}

	push(bins, sampleRate) {
		if (!bins || bins.length !== BINS) return false
		this._real.set(bins)
		this._sampleRate = sampleRate || this._sampleRate
		const now = performance.now()
		this._lastPush = now
		if (hasSignal(bins)) this._lastSignal = now
		return true
	}

	connect(node) {
		if (this._tap) this._tap.disconnect()
		const tap = createSpectrumTap(node)
		this._tap = tap
		this._sampleRate = tap.sampleRate
		return () => {
			tap.disconnect()
			if (this._tap === tap) this._tap = null
		}
	}

	_mount() {
		const canvas = document.createElement('canvas')
		this._shadow.append(canvas)
		try {
			this._engine = new CymaticsEngine(canvas)
		} catch (error) {
			canvas.remove()
			this._failed = true
			this.dispatchEvent(new CustomEvent('cymatics-unsupported', {
				bubbles: true,
				detail: { reason: String((error && error.message) || error) },
			}))
			return
		}
		this._canvas = canvas
		const view = this._engine.view
		this._defaults = {
			renderer: view.renderer.getJson(),
			cymatics: view.cymatics.getJson(),
			liquid: view.liquid.getJson(),
		}
		this._applyLook()
		this._engine.beforeFrame = () => this._frame()
		this._resize = new ResizeObserver(() => this._fit())
		this._resize.observe(this)
		this._seen = new IntersectionObserver((entries) => {
			this._inView = entries[entries.length - 1].isIntersecting
			this._run()
		})
		this._seen.observe(this)
		document.addEventListener('visibilitychange', this._onVisibility)
		this._fit()
	}

	_teardown() {
		if (this._tap) { this._tap.disconnect(); this._tap = null }
		if (this._resize) { this._resize.disconnect(); this._resize = null }
		if (this._seen) { this._seen.disconnect(); this._seen = null }
		document.removeEventListener('visibilitychange', this._onVisibility)
		if (!this._engine) return
		const gl = this._engine.ctx.gl
		this._engine.dispose()
		// Free the context now, not when the GC gets to it: a visualizer toggled
		// ten times would otherwise hold ten, and browsers cap them at ~16.
		const lose = gl.getExtension('WEBGL_lose_context')
		if (lose) lose.loseContext()
		this._engine = null
		this._canvas.remove()
		this._canvas = null
	}

	_run() {
		if (!this._engine) return
		const go = this.isConnected && this._inView && !this._paused && document.visibilityState !== 'hidden'
		if (go) this._engine.start()
		else this._engine.stop()
	}

	_fit() {
		if (!this._engine) return
		const box = this.getBoundingClientRect()
		const { side, pixels } = coverSize(box.width, box.height, window.devicePixelRatio, parseMaxDpr(this.getAttribute('max-dpr')))
		this._canvas.style.width = `${side}px`
		this._canvas.style.height = `${side}px`
		this._engine.setViewport(pixels, pixels)
	}

	// Engine defaults first, then the preset: a key the new one leaves out goes
	// back to the engine's value rather than keeping the old one's. Modulator
	// settings are not engine keys; they become the modulators.
	_applyLook() {
		const preset = this._custom ?? lookPreset(this.look)
		for (const section of ['renderer', 'cymatics', 'liquid']) {
			const own = Object.fromEntries(Object.entries(preset[section] || {}).filter(([key]) => !isModulatorKey(key)))
			const merged = { ...this._defaults[section], ...own }
			this._engine.command(`set ${section} ${JSON.stringify(merged)}`)
			if (section === 'renderer') this._lights = merged.lights || []
			if (section === 'cymatics') this._viewScale = merged.view_scale
		}
		this._mods = createModulators(presetModulators(preset), { lights: () => this._lights })
		this._applyZoom()
	}

	_applyZoom() {
		if (!this._engine) return
		this._engine.view.cymatics.viewScale = Math.min(1, Math.max(0.01, this._viewScale * this._zoom))
	}

	_frame() {
		const now = performance.now()
		if (this._tap) {
			this._tap.read(this._real)
			this._lastPush = now
			if (hasSignal(this._real)) this._lastSignal = now
		}
		freshSpectrum(this._real, now - this._lastPush)
		const weight = idleWeight(now - this._lastSignal)
		if (weight > 0) idleSpectrum(now / 1000, this._idle)
		blend(this._real, this._idle, weight, this._mix)
		this._engine.pushAudioSpectrum(this._mix, BINS, this._sampleRate)
		this._bands.step(this._mix, this._sampleRate, { now })
		this._mods.step(this._bands, (section, key, value) => {
			// A modulated distance is still scaled by zoom.
			if (key === 'view_scale') { this._viewScale = value; this._applyZoom(); return }
			this._engine.command(`set ${section} ${JSON.stringify({ [key]: value })}`)
		})
	}
}
