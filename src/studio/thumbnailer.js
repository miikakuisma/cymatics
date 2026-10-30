// Renders a preset to a small JPEG with a short-lived engine of its own: the
// thumbnail is the preset's real look, not a drawing of it, driven by a fixed,
// music-like spectrum so every look shows its character. Browser only.
import { CymaticsEngine } from '../engine-js/index.js'
import { applyPreset } from '../element/apply-preset.js'
import { createBandFollower } from '../element/modulate.js'
import { BINS } from '../element/scale.js'

export const THUMB_CSS_PX = 64
const THUMB_FRAMES = 90
// A render yields to the next animation frame every few frames, or sooner
// once a task has run this long, so a thumbnail never holds the main thread
// long enough to drop a live frame. Counted for the GPU (whose work is waited
// for when the result is read back), timed for the CPU (the first frame of a
// plate builds its modes and programs).
const FRAMES_PER_TASK = 15
const TASK_MS = 6
const DT = 1 / 60
const SAMPLE_RATE = 48000

// Constant over time: strong bass, a mid bump and a broad tail, so rings,
// detail and plates all form. The idle swell is too quiet for most looks.
export function thumbSpectrum(out) {
	const n = out.length
	for (let i = 0; i < n; i++) {
		const f = i / n
		out[i] = Math.min(0.95, Math.exp(-f * 30) * 0.8 + Math.exp(-Math.pow((f - 0.08) * 25, 2)) * 0.45 + 0.3 * Math.exp(-f * 5))
	}
	return out
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))

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
		thumbSpectrum(spectrum)
		const bands = createBandFollower()
		const gl = engine.ctx.gl
		const frame = (i) => {
			engine.ctx.bindDefaultFramebuffer()
			gl.clearColor(0, 0, 0, 1)
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
			engine.pushAudioSpectrum(spectrum, BINS, SAMPLE_RATE)
			bands.step(spectrum, SAMPLE_RATE, { now: i * DT * 1000 })
			mods.step(bands, (section, key, value) => {
				if (key === 'view_scale') { view.cymatics.viewScale = value; return }
				engine.command(`set ${section} ${JSON.stringify({ [key]: value })}`)
			})
			view.update(DT)
			view.render(px, px)
		}
		let task = performance.now()
		let batch = 0
		for (let i = 0; i < THUMB_FRAMES; i++) {
			if (batch === FRAMES_PER_TASK || (batch > 0 && performance.now() - task > TASK_MS)) {
				// Sent now, the batch runs on the GPU while the page draws.
				gl.flush()
				await nextFrame()
				task = performance.now()
				batch = 0
			}
			frame(i)
			batch++
		}
		// Read in the task that drew the last frame: the drawing buffer is not
		// readable after it.
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
