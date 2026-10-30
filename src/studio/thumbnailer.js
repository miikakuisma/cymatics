// Renders a preset to a small JPEG with a short-lived engine of its own: the
// thumbnail is the preset's real look, not a drawing of it. Browser only.
import { CymaticsEngine } from '../engine-js/index.js'
import { applyPreset } from '../element/apply-preset.js'
import { idleSpectrum } from '../element/idle.js'
import { createBandFollower } from '../element/modulate.js'
import { BINS } from '../element/scale.js'

export const THUMB_CSS_PX = 64
const THUMB_FRAMES = 90
const DT = 1 / 60
const SAMPLE_RATE = 48000

// Throws when WebGL2 is missing; the queue then reports every thumbnail as null.
export function createThumbnailer() {
	const px = Math.round(THUMB_CSS_PX * Math.min(window.devicePixelRatio || 1, 3))
	const canvas = document.createElement('canvas')
	canvas.width = px
	canvas.height = px
	const engine = new CymaticsEngine(canvas, { cymaticsSize: 512 })
	engine.setViewport(px, px)
	const view = engine.view
	const defaults = {
		renderer: view.renderer.getJson(),
		cymatics: view.cymatics.getJson(),
		liquid: view.liquid.getJson(),
	}
	const out = document.createElement('canvas')
	out.width = px
	out.height = px
	const out2d = out.getContext('2d')
	const spectrum = new Float32Array(BINS)

	async function render(preset) {
		const { mods } = applyPreset(engine, defaults, preset)
		const floor = preset.renderer?.floor_image
		if (floor) await engine.uploadFromSrc('refraction', floor)
		const bands = createBandFollower()
		const gl = engine.ctx.gl
		// No awaits from here on: the drawing buffer is only readable in the
		// task that rendered it.
		for (let i = 0; i < THUMB_FRAMES; i++) {
			engine.ctx.bindDefaultFramebuffer()
			gl.clearColor(0, 0, 0, 1)
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
			idleSpectrum(i * DT, spectrum)
			engine.pushAudioSpectrum(spectrum, BINS, SAMPLE_RATE)
			bands.step(spectrum, SAMPLE_RATE, { now: i * DT * 1000 })
			mods.step(bands, (section, key, value) => {
				if (key === 'view_scale') { view.cymatics.viewScale = value; return }
				engine.command(`set ${section} ${JSON.stringify({ [key]: value })}`)
			})
			view.update(DT)
			view.render(px, px)
		}
		out2d.drawImage(canvas, 0, 0)
		return out.toDataURL('image/jpeg', 0.85)
	}

	function dispose() {
		const gl = engine.ctx.gl
		engine.dispose()
		// Free the context now rather than at GC: browsers cap live contexts.
		const lose = gl.getExtension('WEBGL_lose_context')
		if (lose) lose.loseContext()
	}

	return { render, dispose }
}
