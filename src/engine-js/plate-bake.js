// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Polygon plates (field_mode 3–5) are drawn from baked figures. A mode's
// series is up to 65 Bessel terms plus its corner terms about every vertex
// (plate-modes.js) — far too much for every pixel of every frame, but it never
// changes, so each picked mode is rendered once into a texture
// (shaders/plate_bake.fsh) and the field pass only samples it. The few most
// recently used figures are kept, so a tone moving between neighbouring modes
// does not bake again.
//
// Bakes happen before the field pass binds its own target (cymatics.js
// render()), never inside it.

import { Fbo, FLOAT32_SINGLE, Program } from './glutil.js'
import { BESSEL_X_MAX } from './modes.js'
import {
	CORNER_X_MAX, cornerBesselTable, cornerFrame, cornerOrders, modeGain, plateCoeffTexture, plateCornerTexture,
	plateStoredModes, polygonModes,
} from './plate-modes.js'
import { polygon } from './polygons.js'

/**
 * A least-recently-used map. `put` returns the value it evicted to make room,
 * so the caller can recycle it, or undefined. `get` counts as a use.
 */
export function createLru(capacity) {
	const map = new Map() // insertion order = recency, oldest first
	return {
		get(key) {
			if (!map.has(key)) return undefined
			const value = map.get(key)
			map.delete(key)
			map.set(key, value)
			return value
		},
		put(key, value) {
			let evicted
			if (map.has(key)) map.delete(key)
			else if (map.size >= capacity) {
				const [oldest, old] = map.entries().next().value
				map.delete(oldest)
				evicted = old
			}
			map.set(key, value)
			return evicted
		},
		keys() { return map.keys() },
	}
}

// plate_bake.fsh's loop bounds: keep these equal to its MAX_TERMS and
// MAX_CORNERS, and its vec4 of corner orders.
export const MAX_TERMS = 128
export const MAX_CORNERS = 8
export const MAX_CORNER_ORDERS = 4

// How far outside the outline a bake keeps the series' continuation, in
// texels, so the field pass's linear filtering of the edge texels sees no step.
export const MARGIN_TEXELS = 3
/** The margin in plateUv units (−1..1 across `size` texels). */
export const bakeMargin = (size) => MARGIN_TEXELS * 2 / size

/**
 * Throws unless a shape's shipped data fits the bake shader: its loop bounds,
 * and its Bessel tables' x-ranges over every point a bake evaluates. That is
 * the outline widened by the margin, whose vertices lie at
 * reach = 1 + margin / cos(π/N) from the centre and 2·reach from vertex 0.
 */
export function checkBakeBounds(sides, size = 512) {
	const coeff = plateCoeffTexture(sides)
	const corner = plateCornerTexture(sides)
	const stored = plateStoredModes(sides)
	const fail = (what) => { throw new Error(`plate ${sides}: ${what} exceeds what plate_bake.fsh holds`) }
	if (coeff.width > MAX_TERMS) fail(`${coeff.width} centre terms`)
	if (corner.width > MAX_CORNERS) fail(`${corner.width} corner terms`)
	if (cornerOrders(sides).length > MAX_CORNER_ORDERS) fail(`${cornerOrders(sides).length} corner orders`)
	const reach = 1 + bakeMargin(size) / Math.cos(Math.PI / sides)
	for (const m of stored) {
		if (m.k * reach > BESSEL_X_MAX) fail(`k = ${m.k} over the Bessel table`)
		if (m.cornerM.length && 2 * m.k * reach > CORNER_X_MAX) fail(`k = ${m.k} over the corner Bessel table`)
	}
}

// Float data texture read with texelFetch only: float formats are not
// filterable everywhere.
function dataTexture(gl, internal, format, width, height, data) {
	const tex = gl.createTexture()
	gl.bindTexture(gl.TEXTURE_2D, tex)
	gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, gl.FLOAT, data)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
	gl.bindTexture(gl.TEXTURE_2D, null)
	return tex
}

export class PlateBaker {
	/**
	 * `bessel` is the engine's integer-order Bessel texture (modes.js
	 * besselTable()); `vertexSource` / `fragmentSource` the fullscreen vertex
	 * shader and plate_bake.fsh, passed in so this module stays loadable
	 * outside the bundler.
	 */
	constructor(ctx, { size = 512, capacity = 8, bessel, vertexSource, fragmentSource }) {
		this.ctx = ctx
		this.size = size
		this.bessel = bessel
		this.lru = createLru(capacity)
		this.fbos = new Set()
		this.shapes = {} // sides -> { coeff, corner, cornerBessel, ... }
		this.program = new Program(ctx, vertexSource, fragmentSource, 'plate_bake.fsh')
		this.bakes = 0
	}

	shape(sides) {
		if (this.shapes[sides]) return this.shapes[sides]
		const gl = this.ctx.gl
		const coeff = plateCoeffTexture(sides)
		const corner = plateCornerTexture(sides)
		const table = cornerBesselTable(sides)
		const frame = cornerFrame(sides)
		checkBakeBounds(sides, this.size)
		const mus = new Float32Array(MAX_CORNER_ORDERS) // 0 past the last order
		cornerOrders(sides).forEach((mu, m) => { mus[m] = mu })
		return (this.shapes[sides] = {
			coeff: dataTexture(gl, gl.RG32F, gl.RG, coeff.width, coeff.height, coeff.data),
			corner: dataTexture(gl, gl.RGBA32F, gl.RGBA, corner.width, corner.height, corner.data),
			cornerBessel: dataTexture(gl, gl.R32F, gl.RED, table.width, Math.max(1, table.rows), table.data),
			terms: plateStoredModes(sides).map((m) => [m.orders.length, m.cornerM.length]),
			frame,
			mus,
			offset: polygon(sides).offset,
			samples: table.samples,
		})
	}

	/** The baked figure of entry `listIndex` of polygonModes(sides). */
	texture(sides, listIndex) {
		const key = `${sides}:${listIndex}`
		const hit = this.lru.get(key)
		if (hit) return hit.fbo.texture
		// Everything that can throw comes before the cache is touched, so a
		// bad request never leaves an unbaked entry behind.
		this.shape(sides)
		const mode = polygonModes(sides)[listIndex]
		if (!mode) throw new Error(`plate ${sides}: no mode ${listIndex}`)
		const entry = { fbo: null }
		// The figure pushed out to make room gives up its render target.
		const evicted = this.lru.put(key, entry)
		// One channel is all a figure needs: R32F, or R16F under glutil's
		// half-float fallback, which the field itself also follows.
		entry.fbo = evicted ? evicted.fbo : new Fbo(this.ctx, this.size, this.size, { dataType: FLOAT32_SINGLE })
		this.fbos.add(entry.fbo)
		this.bake(entry.fbo, sides, mode)
		return entry.fbo.texture
	}

	bake(fbo, sides, entry) {
		const gl = this.ctx.gl
		const s = this.shape(sides)
		const mode = plateStoredModes(sides)[entry.a]
		const [nTerms, nCorners] = s.terms[entry.a]
		const f = s.frame

		fbo.bind()
		const p = this.program.use()
		p.bindTexture('coeffTable', s.coeff)
		p.bindTexture('cornerTable', s.corner)
		p.bindTexture('besselTable', this.bessel)
		p.bindTexture('cornerBessel', s.cornerBessel)
		p.int('sides', sides)
		p.int('row', entry.a)
		p.int('classJ', mode.j)
		p.int('partner', entry.mix)
		p.int('sinMode', mode.parity === 'sin' || entry.mix === 1 ? 1 : 0)
		p.int('nTerms', nTerms)
		p.int('nCorners', nCorners)
		p.float('k', mode.k)
		p.float('gain', modeGain(sides, entry))
		p.float('besselXMax', BESSEL_X_MAX)
		p.float('cornerXMax', cornerBesselTable(sides).xMax)
		p.int('cornerSamples', s.samples)
		p.vec4('cornerFrame', f.vx, f.vy, f.bx, f.by)
		p.vec3('cornerFrame2', f.wx, f.wy, f.halfAngle)
		p.vec4('cornerMu', s.mus[0], s.mus[1], s.mus[2], s.mus[3])
		p.float('polyOffset', s.offset)
		// Past this distance outside the outline nothing samples the figure;
		// inside it, the series' own continuation keeps the edge texels'
		// filtering honest.
		p.float('margin', bakeMargin(this.size))
		this.ctx.drawQuad()
		fbo.unbind()
		this.bakes++
	}

	dispose() {
		const gl = this.ctx.gl
		for (const fbo of this.fbos) fbo.dispose()
		this.fbos.clear()
		for (const s of Object.values(this.shapes)) {
			gl.deleteTexture(s.coeff)
			gl.deleteTexture(s.corner)
			gl.deleteTexture(s.cornerBessel)
		}
		this.shapes = {}
		this.program.dispose()
	}
}
