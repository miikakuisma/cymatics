// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Picks which of the three render paths runs, and sequences its passes.
//
// Pass counts per frame:
//   emissive mode (the app's shipped default) ... 2 passes
//   contour mode, emissive off ................. 2 passes
//   liquid metal mode .......................... 3 passes (2 at zero viscosity)
//   full PBR path .............................. ~52 passes
// The app forces emissive mode on at boot, so the default is the cheap one.

import { Fbo, Program, FLOAT32, FLOAT32_SINGLE } from './glutil.js'
import { shader, FULLSCREEN_VSH, PASSTHROUGH_FSH } from './shaders.js'
import { Cymatics } from './cymatics.js'
import { LiquidSim } from './liquidsim.js'
import { Renderer } from './renderer.js'

export const CYMATICS_SIZE = 1024
export const WATER_SIZE = 256

export class View {
	constructor(ctx, { cymaticsSize = CYMATICS_SIZE, waterSize = WATER_SIZE } = {}) {
		this.ctx = ctx
		this.cymaticsSize = cymaticsSize
		this.waterSize = waterSize
		this.mainTime = 0

		this.renderer = new Renderer(ctx)
		this.cymatics = new Cymatics(ctx, cymaticsSize, cymaticsSize)
		this.liquid = new LiquidSim(ctx, waterSize, waterSize)

		this.programPassthrough = null
		this.programEmissive = null
		this.programTemporalBlend = null
		this.temporalFbo = null
		this.temporalHistoryFbo = null

		this.programLiquid = null
		this.programLiquidAccum = null
		this.liquidFront = null
		this.liquidBack = null

		// Scratch buffers so the per-frame light upload allocates nothing.
		this.liquidLightDirBuffer = new Float32Array(8 * 3)
		this.liquidLightColorBuffer = new Float32Array(8 * 3)
	}

	update(frameDelta) {
		this.mainTime += frameDelta
	}

	render(width, height) {
		const gl = this.ctx.gl

		// Mercury shades the raw wave field. Contour mode replaces that field
		// with thin lines, which carry no usable gradient for surface normals,
		// so it is suppressed for this pass and restored straight after — the
		// user's setting survives toggling liquid mode off again.
		const savedContourMode = this.cymatics.contourMode
		if (this.renderer.liquidMode) this.cymatics.contourMode = 0
		this.cymatics.render()
		this.cymatics.contourMode = savedContourMode

		const tex = this.cymatics.texture
		if (!tex) return

		// --- Liquid metal: the wave field shaded as a mercury surface ---
		if (this.renderer.liquidMode) {
			this.renderLiquid(tex, width, height)
			return
		}

		// --- Contour mode: height field straight to screen ---
		if (this.cymatics.isContourMode && !this.renderer.emissiveMode) {
			if (!this.programPassthrough) {
				this.programPassthrough = new Program(this.ctx, FULLSCREEN_VSH, PASSTHROUGH_FSH, 'passthrough')
			}
			this.ctx.bindDefaultFramebuffer()
			gl.clearColor(0, 0, 0, 1)
			gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT)
			gl.disable(gl.DEPTH_TEST)
			gl.disable(gl.CULL_FACE)
			gl.disable(gl.BLEND)

			const p = this.programPassthrough.use()
			p.bindTexture('tex', tex)
			this.ctx.drawQuad()
			return
		}

		// --- Emissive mode: colourise the height field, skip fluid + PBR ---
		if (this.renderer.emissiveMode) {
			if (!this.programEmissive) {
				this.programEmissive = new Program(
					this.ctx,
					FULLSCREEN_VSH,
					shader('main_emissive.fsh'),
					'emissive',
				)
			}
			this.ctx.bindDefaultFramebuffer()
			gl.clearColor(0, 0, 0, 1)
			gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT)
			gl.disable(gl.DEPTH_TEST)
			gl.disable(gl.CULL_FACE)
			gl.disable(gl.BLEND)

			const r = this.renderer
			const p = this.programEmissive.use()
			p.bindTexture('cymtex', tex)
			p.vec3('colorInner', r.colorInner[0], r.colorInner[1], r.colorInner[2])
			p.vec3('colorOuter', r.colorOuter[0], r.colorOuter[1], r.colorOuter[2])
			p.float('emissiveStrength', r.emissiveStrength)
			p.vec2('resolution', width, height)
			this.ctx.drawQuad()
			return
		}

		// --- Full path: fluid sim → temporal blend → PBR ---
		const iterations = Math.max(1, this.liquid.nofIterations | 0)
		const pressurePerStep = this.liquid.wavePressureOnLiquid / iterations
		for (let i = 0; i < iterations; i++) {
			this.liquid.blitPressure(tex, pressurePerStep)
			this.liquid.iterate()
		}

		let depthTexture = this.liquid.front.texture

		// Temporal smoothing suppresses per-frame flashing.
		{
			if (!this.temporalFbo) {
				const opts = { dataType: FLOAT32, clearColor: [0, 0, 0], clearAlpha: 0 }
				this.temporalFbo = new Fbo(this.ctx, this.waterSize, this.waterSize, opts)
				this.temporalHistoryFbo = new Fbo(this.ctx, this.waterSize, this.waterSize, opts)
				this.temporalHistoryFbo.clear()
			}
			if (!this.programTemporalBlend) {
				this.programTemporalBlend = new Program(
					this.ctx,
					shader('fluid/quad2.vsh'),
					shader('fluid/temporal_blend.glsl'),
					'temporalBlend',
				)
			}

			gl.disable(gl.BLEND)
			gl.disable(gl.DEPTH_TEST)

			this.temporalFbo.bind()
			const p = this.programTemporalBlend.use()
			p.bindTexture('current', depthTexture)
			p.bindTexture('history', this.temporalHistoryFbo.texture)
			p.float('blendFactor', 0.4)
			this.ctx.drawQuad()
			this.temporalFbo.unbind()

			this.temporalHistoryFbo.copyFrom(this.temporalFbo)
			depthTexture = this.temporalFbo.texture
		}

		this.ctx.bindDefaultFramebuffer()
		gl.clearColor(0, 0, 0, 1)
		gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT)
		gl.disable(gl.DEPTH_TEST)
		gl.disable(gl.CULL_FACE)
		gl.disable(gl.BLEND)

		// Deliberately the cymatics size, not the water size: `resolution` only
		// scales the sobel step, and the look is tuned around this value.
		this.renderer.startRendering(
			this.mainTime, depthTexture,
			this.cymaticsSize, this.cymaticsSize,
			width, height,
		)
		this.ctx.drawQuad()
	}

	// Mercury. Optional viscosity accumulation, then one shading pass.
	renderLiquid(tex, width, height) {
		const gl = this.ctx.gl
		const r = this.renderer

		gl.disable(gl.DEPTH_TEST)
		gl.disable(gl.CULL_FACE)
		gl.disable(gl.BLEND)

		let field = tex

		// At zero viscosity the surface has no memory, so the whole
		// accumulation stage is skipped rather than run as a no-op.
		const viscosity = Math.min(Math.max(r.viscosity, 0), 1)
		if (viscosity > 0.001) {
			if (!this.liquidFront) {
				// Cleared to the flat mid-point, not to black: 0.0 is a
				// full-amplitude trough, and the first frames would slam.
				const opts = { dataType: FLOAT32_SINGLE, clearColor: [0.5, 0.5, 0.5], clearAlpha: 1 }
				this.liquidFront = new Fbo(this.ctx, this.cymaticsSize, this.cymaticsSize, opts)
				this.liquidBack = new Fbo(this.ctx, this.cymaticsSize, this.cymaticsSize, opts)
			}
			if (!this.programLiquidAccum) {
				this.programLiquidAccum = new Program(
					this.ctx, FULLSCREEN_VSH, shader('liquid_accum.glsl'), 'liquidAccum',
				)
			}

			this.liquidBack.bind()
			const a = this.programLiquidAccum.use()
			a.bindTexture('current', tex)
			a.bindTexture('history', this.liquidFront.texture)
			a.float('viscosity', viscosity)
			a.float('texel', 1.0 / this.cymaticsSize)
			this.ctx.drawQuad()
			this.liquidBack.unbind()

			// Ping-pong rather than blit through copyFrom: the accumulation
			// only ever reads the previous frame, so a copy is pure overhead.
			const swap = this.liquidFront
			this.liquidFront = this.liquidBack
			this.liquidBack = swap
			field = this.liquidFront.texture
		}

		if (!this.programLiquid) {
			this.programLiquid = new Program(
				this.ctx, FULLSCREEN_VSH, shader('main_liquid.fsh'), 'liquid',
			)
		}

		this.ctx.bindDefaultFramebuffer()
		gl.clearColor(0, 0, 0, 1)
		gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT)
		gl.disable(gl.DEPTH_TEST)
		gl.disable(gl.CULL_FACE)
		gl.disable(gl.BLEND)

		const p = this.programLiquid.use()
		p.bindTexture('field', field)
		p.vec2('resolution', width, height)
		p.float('fieldTexel', 1.0 / this.cymaticsSize)
		p.float('rippleDepth', r.rippleDepth)
		p.float('polish', r.surfacePolish)
		p.float('material', r.liquidMaterial > 0.5 ? 1.0 : 0.0)
		p.float('waterDepth', Math.min(Math.max(r.waterDepth, 0), 1))
		p.float('causticStrength', Math.max(r.causticStrength, 0))
		p.bindTexture('floorTex', r.floor.texture)
		p.float('hasFloorImage', r.hasFloorImage ? 1.0 : 0.0)
		p.float('floorAspect', r.floorAspect)
		p.vec3('tintColor', r.colorOuter[0], r.colorOuter[1], r.colorOuter[2])
		p.vec3('envTint', r.colorInner[0], r.colorInner[1], r.colorInner[2])
		p.float('exposure', r.emissiveStrength)
		this.uploadLiquidLights(p)
		this.ctx.drawQuad()
	}

	// The XY pad edits `renderer.lights` as world positions. The liquid shader
	// only ever wants a direction, so each one is normalised — through abs(z),
	// because a light behind the surface can never appear in its reflection and
	// would simply vanish. One uniform3fv per array rather than a set per light.
	uploadLiquidLights(p) {
		const r = this.renderer
		const src = (r.lightsAuthored && r.lightsAuthored.length) ? r.lightsAuthored : r.lights
		const count = Math.min(src.length, 8)

		// The XY pad works in roughly +/-6, while light_distance runs to 50, so
		// raw positions would sit within a few degrees of straight overhead no
		// matter where the handle is dragged. Spreading x and y gives the pad
		// real authority over the direction across the whole distance range.
		const SPREAD = 4.0

		for (let i = 0; i < count; i++) {
			const l = src[i]
			const x = l.pos[0] * SPREAD
			const y = l.pos[1] * SPREAD
			const z = Math.abs(l.pos[2])
			const len = Math.hypot(x, y, z)
			// A light at the origin has no direction to point in; park it overhead.
			const inv = len > 1e-6 ? 1 / len : 0
			this.liquidLightDirBuffer[i * 3 + 0] = x * inv
			this.liquidLightDirBuffer[i * 3 + 1] = y * inv
			this.liquidLightDirBuffer[i * 3 + 2] = len > 1e-6 ? z * inv : 1

			this.liquidLightColorBuffer[i * 3 + 0] = l.color[0]
			this.liquidLightColorBuffer[i * 3 + 1] = l.color[1]
			this.liquidLightColorBuffer[i * 3 + 2] = l.color[2]
		}

		p.int('lightCount', count)
		if (count > 0) {
			p.vec3v('lightDir[0]', this.liquidLightDirBuffer.subarray(0, count * 3))
			p.vec3v('lightColor[0]', this.liquidLightColorBuffer.subarray(0, count * 3))
		}
	}

	dispose() {
		this.cymatics.dispose()
		this.liquid.dispose()
		this.renderer.dispose()
		if (this.programPassthrough) this.programPassthrough.dispose()
		if (this.programEmissive) this.programEmissive.dispose()
		if (this.programTemporalBlend) this.programTemporalBlend.dispose()
		if (this.temporalFbo) this.temporalFbo.dispose()
		if (this.temporalHistoryFbo) this.temporalHistoryFbo.dispose()
		if (this.programLiquid) this.programLiquid.dispose()
		if (this.programLiquidAccum) this.programLiquidAccum.dispose()
		if (this.liquidFront) this.liquidFront.dispose()
		if (this.liquidBack) this.liquidBack.dispose()
	}
}
