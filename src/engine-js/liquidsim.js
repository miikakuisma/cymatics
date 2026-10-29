// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Fluid: a ping-pong Jacobi pressure solver.
//
// Channel layout of the velocity/pressure target (see the fluid shaders):
//   rg = velocity, b = "liquidity" multiplier, a = pressure
//
// Note this whole solver is skipped in the app's shipped default preset, which
// forces emissive mode (see view.js). It runs when emissive mode is off.

import { Fbo, Program, attrToValue, FLOAT32 } from './glutil.js'
import { shader } from './shaders.js'

export class LiquidSim {
	constructor(ctx, width, height) {
		this.ctx = ctx
		this.width = width
		this.height = height

		this.velocitySlowdown = 0.1
		this.liquiditySlowdown = 0.1
		this.pressureLeak = 0.001
		this.nofIterations = 8
		this.wavePressureOnLiquid = 0.5
		this.speedMul = 1.0

		const opts = { dataType: FLOAT32, clearColor: [0, 0, 0], clearAlpha: 0 }
		this.front = new Fbo(ctx, width, height, opts)
		this.back = new Fbo(ctx, width, height, opts)
		// RGBA rather than single-channel float: some mobile GPUs do not support
		// R32F render targets, and the shader only reads .r either way.
		this.divergence = new Fbo(ctx, width, height, {
			dataType: FLOAT32, clearColor: [0, 0, 0], clearAlpha: 1,
		})
		// There is no colour-advection target: that feature was never wired up.

		this.programs = {}
	}

	program(name, fragPath) {
		let p = this.programs[name]
		if (!p) {
			p = new Program(
				this.ctx,
				shader('fluid/quad2.vsh'),
				shader(fragPath),
				name,
			)
			this.programs[name] = p
		}
		return p
	}

	flip() {
		const t = this.back
		this.back = this.front
		this.front = t
	}

	setupState() {
		const gl = this.ctx.gl
		gl.disable(gl.BLEND)
		gl.disable(gl.DEPTH_TEST)
	}

	// Stamp the cymatics height field into the fluid's pressure channel.
	blitPressure(sourceTexture, amount) {
		if (!sourceTexture) return
		this.setupState()
		const p = this.program('blitPressure', 'fluid/blitpressure.glsl')

		this.front.bind()
		p.use()
		p.bindTexture('back', this.back.texture)
		p.bindTexture('source', sourceTexture)
		p.vec2('resolution', this.width, this.height)
		p.float('amount', amount)
		this.ctx.drawQuad()
		this.front.unbind()
		this.flip()
	}

	iterate() {
		const invW = 1.0 / this.width
		const invH = 1.0 / this.height
		this.setupState()

		// 1. Advect velocity along itself.
		{
			const p = this.program('advect', 'fluid/advect.glsl')
			this.front.bind()
			p.use()
			p.bindTexture('back', this.back.texture)
			p.bindTexture('vSampler', this.back.texture)
			p.vec2('resolution', this.width, this.height)
			p.float('speedMul', attrToValue(this.speedMul, 0.1, 1.0))
			this.ctx.drawQuad()
			this.front.unbind()
			this.flip()
		}

		// 2. Divergence of the velocity field.
		{
			const p = this.program('divergence', 'fluid/compute_divergence.glsl')
			this.divergence.bind()
			p.use()
			p.bindTexture('vSampler', this.back.texture)
			p.vec2('resolution', this.width, this.height)
			p.vec2('inverseResolution', invW, invH)
			this.ctx.drawQuad()
			this.divergence.unbind()
		}

		// 3. Two Jacobi relaxation steps toward a divergence-free field.
		{
			const p = this.program('jacobi', 'fluid/jacobi.glsl')
			const vs = attrToValue(this.velocitySlowdown, 0.99999, 0.9)
			const ls = attrToValue(this.liquiditySlowdown, 0.99999, 0.9)
			for (let i = 0; i < 2; i++) {
				this.front.bind()
				p.use()
				p.bindTexture('vSampler', this.back.texture)
				p.bindTexture('divText', this.divergence.texture)
				p.vec2('resolution', this.width, this.height)
				p.vec2('inverseResolution', invW, invH)
				p.float('velocitySlowdown', vs)
				p.float('liquiditySlowdown', ls)
				this.ctx.drawQuad()
				this.front.unbind()
				this.flip()
			}
		}

		// 4. Subtract the pressure gradient.
		{
			const p = this.program('subtract', 'fluid/subtract.glsl')
			this.front.bind()
			p.use()
			p.bindTexture('vSampler', this.back.texture)
			p.vec2('resolution', this.width, this.height)
			p.vec2('inverseResolution', invW, invH)
			p.float('pressureLeak', attrToValue(this.pressureLeak, 1.0, 0.9))
			this.ctx.drawQuad()
			this.front.unbind()
			this.flip()
		}
	}

	clearBuffers() {
		this.front.clear()
		this.back.clear()
	}

	setFromJson(js) {
		if (js == null) return
		if (js.pressure_iterations !== undefined) this.nofIterations = Number(js.pressure_iterations)
		if (js.wave_pressure_on_liquid !== undefined) this.wavePressureOnLiquid = Number(js.wave_pressure_on_liquid)
		if (js.pressure_leak !== undefined) this.pressureLeak = Number(js.pressure_leak)
		if (js.speed_mul !== undefined) this.speedMul = Number(js.speed_mul)
		if (js.velocity_slowdown !== undefined) this.velocitySlowdown = Number(js.velocity_slowdown)
		// Note liquidity_slowdown writes velocitySlowdown, so liquiditySlowdown
		// can never actually be set from a preset. That is almost certainly a
		// typo inherited from the original engine, but existing presets are
		// tuned around it — fixing it changes how they render.
		if (js.liquidity_slowdown !== undefined) this.velocitySlowdown = Number(js.liquidity_slowdown)
	}

	getJson() {
		return {
			pressure_iterations: this.nofIterations,
			wave_pressure_on_liquid: this.wavePressureOnLiquid,
			speed_mul: this.speedMul,
			velocity_slowdown: this.velocitySlowdown,
			liquidity_slowdown: this.liquiditySlowdown,
			pressure_leak: this.pressureLeak,
		}
	}

	dispose() {
		for (const p of Object.values(this.programs)) p.dispose()
		this.front.dispose()
		this.back.dispose()
		this.divergence.dispose()
	}
}
