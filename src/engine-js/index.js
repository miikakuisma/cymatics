// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Cymatics engine — WebGL2, entry point and command API.
//
// Owns the canvas, the render loop and the text command parser. Parameter
// changes are plain property writes; the command API exists so saved presets
// and existing call sites keep working unchanged.

import { GLContext } from './glutil.js'
import { View, CYMATICS_SIZE, WATER_SIZE } from './view.js'

export class CymaticsEngine {
	constructor(canvas, { cymaticsSize = CYMATICS_SIZE, waterSize = WATER_SIZE } = {}) {
		this.canvas = canvas
		this.ctx = new GLContext(canvas)
		this.view = new View(this.ctx, { cymaticsSize, waterSize })

		this.running = false
		this.rafHandle = 0
		this.lastTicks = 0
		this.sampleRate = 44100
		this.beforeFrame = null
		this.disposed = false

		this.stats = {
			fps: 0,
			frameMs: 0,
			frames: 0,
			floatCaps: this.ctx.floatCaps,
		}
		this._fpsAccum = 0
		this._fpsFrames = 0
		this._frameMsAccum = 0

		this.ctx.setDefaultViewport(0, 0, canvas.width, canvas.height)

		canvas.addEventListener('webglcontextlost', (e) => {
			e.preventDefault()
			this.stop()
			// <cymatics-view> loses the context on purpose after dispose(), to free
			// it at once: that is not a failure worth an error in the console.
			if (!this.disposed) console.error('[cymatics] WebGL context lost')
		}, false)
	}

	start() {
		if (this.running) return
		this.running = true
		this.lastTicks = performance.now()
		const loop = (now) => {
			if (!this.running) return
			this.rafHandle = requestAnimationFrame(loop)
			const frameStart = now
			const delta = Math.min((now - this.lastTicks) / 1000, 0.25)
			this.lastTicks = now

			const gl = this.ctx.gl
			this.ctx.bindDefaultFramebuffer()
			gl.clearColor(0, 0, 0, 1)
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

			// The element hands the engine its spectrum here, once per rendered
			// frame: the envelope follower advances once per push, so pushes tied
			// to anything but the render rate would change its speed.
			if (this.beforeFrame) this.beforeFrame(delta)

			this.view.update(delta)
			this.view.render(this.canvas.width, this.canvas.height)

			this._frameMsAccum += performance.now() - frameStart
			this._fpsAccum += delta
			this._fpsFrames++
			this.stats.frames++
			if (this._fpsAccum >= 0.5) {
				this.stats.fps = this._fpsFrames / this._fpsAccum
				this.stats.frameMs = this._frameMsAccum / this._fpsFrames
				this._fpsAccum = 0
				this._fpsFrames = 0
				this._frameMsAccum = 0
			}
		}
		this.rafHandle = requestAnimationFrame(loop)
	}

	stop() {
		this.running = false
		if (this.rafHandle) cancelAnimationFrame(this.rafHandle)
		this.rafHandle = 0
	}

	// Hot path: one Float32Array of normalised bins, straight into the envelope
	// follower. No allocation, no copies.
	pushAudioSpectrum(freqData, numBins = freqData.length, sampleRate = this.sampleRate) {
		this.view.cymatics.insertFreqSpectrum(freqData, numBins, sampleRate)
	}

	setCanvasSize(cssWidth, cssHeight, pixelRatio = window.devicePixelRatio || 1) {
		this.canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio))
		this.canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio))
		this.canvas.style.width = cssWidth + 'px'
		this.canvas.style.height = cssHeight + 'px'
		this.ctx.setDefaultViewport(0, 0, this.canvas.width, this.canvas.height)
	}

	setViewport(width, height) {
		const w = Math.max(1, Math.round(width))
		const h = Math.max(1, Math.round(height))
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w
			this.canvas.height = h
		}
		this.ctx.setDefaultViewport(0, 0, w, h)
	}

	// Text command API. Kept so existing call sites and saved presets keep
	// working unchanged; new code can touch view.cymatics / .renderer / .liquid
	// directly.
	command(cmdString) {
		if (typeof cmdString !== 'string') return { success: false, message: 'not a string' }

		const braceAt = cmdString.indexOf('{')
		const head = (braceAt === -1 ? cmdString : cmdString.slice(0, braceAt)).trim()
		const words = head.length ? head.split(/\s+/) : []
		let js = null
		if (braceAt !== -1) {
			try {
				js = JSON.parse(cmdString.slice(braceAt))
			} catch (e) {
				return { success: false, message: 'bad json: ' + e.message }
			}
		}

		const [verb, target] = words

		if (verb === 'get') {
			if (target === 'cymatics') return { success: true, message: 'get cymatics', payload: this.view.cymatics.getJson() }
			if (target === 'renderer') return { success: true, message: 'get renderer', payload: this.view.renderer.getJson() }
			if (target === 'liquid') return { success: true, message: 'get liquid', payload: this.view.liquid.getJson() }
		} else if (verb === 'set') {
			if (target === 'cymatics') {
				if (!js) return { success: false, message: 'set cymatics: no json' }
				this.view.cymatics.setFromJson(js)
				return { success: true, message: 'set cymatics' }
			}
			if (target === 'renderer') {
				if (!js) return { success: false, message: 'set renderer: no json' }
				this.view.renderer.setFromJson(js)
				return { success: true, message: 'set renderer' }
			}
			if (target === 'liquid') {
				if (!js) return { success: false, message: 'set liquid: ERROR' }
				this.view.liquid.setFromJson(js)
				return { success: true, message: 'set liquid' }
			}
			if (target === 'reflection_file_from_path') {
				this.view.renderer.setReflectionFromSrc(words[2]).catch(e => console.warn(e))
				return { success: true, message: 'reloading reflection file from path' }
			}
		} else if (verb === 'resize') {
			return { success: true, message: 'resize' }
		}

		return { success: true, message: 'Message received' }
	}

	// Load a reflection/refraction map from raw encoded PNG/JPEG bytes.
	//
	// Never rejects: a missing or corrupt image must not surface as an unhandled
	// rejection in the preset loader, so the current texture is kept instead.
	async upload(targetName, data) {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
		const blob = new Blob([bytes], { type: sniffImageMime(bytes) })
		const url = URL.createObjectURL(blob)
		try {
			await this.uploadFromSrc(targetName, url)
		} finally {
			URL.revokeObjectURL(url)
		}
	}

	async uploadFromSrc(targetName, src) {
		try {
			if (targetName === 'refraction') {
				await this.view.renderer.setRefractionFromSrc(src)
			} else {
				await this.view.renderer.setReflectionFromSrc(src)
			}
		} catch (e) {
			console.warn(`[cymatics] could not decode '${targetName}' image, keeping the current one:`, e.message)
		}
	}

	dispose() {
		this.disposed = true
		this.stop()
		this.view.dispose()
	}
}

// Blobs built from raw bytes carry no MIME type, and an untyped blob: URL is
// not reliably sniffed as an image. Recover the type from the magic bytes.
function sniffImageMime(b) {
	if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
	if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
	if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
	if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
	if (b.length > 4 && b[0] === 0x3c && (b[1] === 0x73 || b[1] === 0x3f)) return 'image/svg+xml'
	return 'application/octet-stream'
}

export { CYMATICS_SIZE, WATER_SIZE }
