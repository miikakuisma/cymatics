// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// PBR/refraction uniform plumbing plus the emissive-mode colour state. All
// shading happens in shaders/main_lights_refmap2d.fsh.

import { Program, attrToValue, createColorTexture, createTextureFromImage, loadImageSource } from './glutil.js'
import { shader, blueNoiseUrl } from './shaders.js'

// Loading lights duplicates the list: a 2-light preset yields 4 lights, which
// doubles the effective intensity. That is a bug inherited from the original
// engine, but every saved preset was authored against it, so it is preserved.
// Set false to render "correctly" — expect existing presets to look dimmer.
const COMPAT_DUPLICATE_LIGHTS = true

const IDENTITY4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

// The projection used by the PBR path is identity, not a perspective matrix.
//
// main.vsh feeds it `vec4(cameraCoord.xy, -cameraCoord.z, 1.0)`, and the quad
// sits at z=0 through an identity camera, so identity maps it exactly to the
// full viewport — which is what every `worldPos` / `toView` expression in
// main_lights_refmap2d.fsh assumes. A real perspective matrix cannot work here
// at all: the quad lies in the camera plane, making w = 0 for every vertex.

export class Renderer {
	constructor(ctx) {
		this.ctx = ctx

		this.fshader = 'main_lights_refmap2d.fsh'
		this.loadedFshader = null
		this.program = null

		this.matCamera = IDENTITY4.slice()
		this.matModel = IDENTITY4.slice()
		this.matProj = IDENTITY4.slice()

		this.lightDir = [0, 0, -1]
		this.baseColor = [0.125, 0.125, 0.125]
		this.emissiveColor = [0, 0, 0]

		this.ior = 0.05
		this.viewz = 0.4081632653
		this.normalPower = 0.43
		this.useRefractedAmount = 1.0
		this.roughness = 0.01
		this.metalness = 0.1
		this.absorbStrength = 0.05
		this.finalMul = 0.18367346938
		this.finalGamma = 0.5

		this.refmapPow = 0.35
		this.refmapMul = 0.3
		this.refmapScale = 0.25
		this.refmapSaturation = 0.2

		this.floorDistance = 5.0
		this.floorPow = 0.35
		this.floorMul = 0.3
		this.floorScale = 0.5

		const s = 128.0
		this.normalLevels = [
			[8.0 / 256.0 * s, 0.5],
			[2.0 / 256.0 * s, 0.25],
		]

		this.lights = [
			{ pos: [1, 1, -5], color: [2, 1, 0], roughness: 0.01 },
			{ pos: [-1, -1, 5], color: [0, 1, 2], roughness: 0.01 },
		]

		// The lights exactly as authored, before COMPAT_DUPLICATE_LIGHTS gets at
		// them. The liquid path reads this; PBR keeps reading `lights` so its
		// presets render precisely as they always have.
		this.lightsAuthored = this.lights.map(l => ({ ...l, pos: [...l.pos], color: [...l.color] }))

		// Emissive mandala mode — the app's shipped default.
		this.emissiveMode = false
		this.colorInner = [0.23, 0.66, 1.0]
		this.colorOuter = [0.78, 0.30, 1.0]
		this.emissiveStrength = 1.4
		this.trailAmount = 0.0

		// Liquid metal mode. Shades the wave field as a mercury surface and
		// wins over both emissive and contour when on — see
		// shaders/main_liquid.fsh. It reuses colorOuter as the metal's tint and
		// colorInner as the environment tint, so existing presets still mean
		// something sensible after the toggle is flipped.
		this.liquidMode = false
		this.liquidMaterial = 0        // 0 = mercury, 1 = water
		this.viscosity = 0.55
		this.rippleDepth = 1.0
		this.surfacePolish = 0.15
		this.waterDepth = 0.45
		this.causticStrength = 0.3

		// Water's pool floor. Empty string = an empty floor: plain black, as the
		// factory Default's empty.png always gave, without fetching a file. The
		// shader's procedural tiles are no longer used.
		this.floorImage = ''
		this.loadedFloorImage = null
		this.floorAspect = 1.0
		this.hasFloorImage = true
		this.emptyFloor = { texture: createColorTexture(ctx, 0, 0, 0, 255), width: 1, height: 1 }

		// 1x1 grey placeholders until a preset supplies real maps.
		this.reflection = { texture: createColorTexture(ctx, 128, 128, 128, 255), width: 1, height: 1 }
		this.floor = this.emptyFloor
		this.noise = { texture: createColorTexture(ctx, 0, 0, 0, 255), width: 1, height: 1 }

		this.normalLevelBuffer = new Float32Array(5 * 2)
		this.lightPosBuffer = new Float32Array(8 * 3)
		this.lightColorBuffer = new Float32Array(8 * 3)
		this.lightRoughBuffer = new Float32Array(8)

		this.noiseRequested = false
	}

	// The dither texture is only sampled by the PBR shader, so it is fetched on
	// first use rather than at boot — the app's default emissive path never
	// needs it, and it is the single largest asset.
	ensureNoise() {
		if (this.noiseRequested) return
		this.noiseRequested = true
		loadImageSource(blueNoiseUrl)
			.then((image) => {
				// Texture::load(fn, true) → nearest filtering, no mipmaps.
				this.noise = createTextureFromImage(this.ctx, image, { nearest: true, repeat: true })
			})
			.catch((e) => {
				console.warn('[cymatics] blue noise texture failed to load, dither disabled:', e.message)
			})
	}

	async setReflectionFromSrc(src) {
		const image = await loadImageSource(src)
		this.reflection = createTextureFromImage(this.ctx, image, { mipmaps: true })
	}

	async setRefractionFromSrc(src) {
		const image = await loadImageSource(src)
		this.floor = createTextureFromImage(this.ctx, image, { mipmaps: true })
		this.floorAspect = this.floor.height > 0 ? this.floor.width / this.floor.height : 1.0
	}

	// The water floor image, as a data URL (or '' for an empty floor).
	//
	// setFromJson runs on every control tweak, not just on preset load, so this
	// guards on the source string: decoding a 1024px JPEG on each nudge of a
	// slider would be an obvious stall.
	setFloorImage(src) {
		const next = src || ''
		if (next === this.loadedFloorImage) return
		this.loadedFloorImage = next
		this.floorImage = next

		if (!next) {
			this.floor = this.emptyFloor
			this.hasFloorImage = true
			this.floorAspect = 1.0
			return
		}

		this.setRefractionFromSrc(next)
			.then(() => {
				// A newer image may have been set while this one was decoding.
				if (this.loadedFloorImage === next) this.hasFloorImage = true
			})
			.catch((e) => {
				console.warn('[cymatics] floor image failed to load, the floor stays empty:', e.message)
				if (this.loadedFloorImage === next) {
					this.floor = this.emptyFloor
					this.hasFloorImage = true
					this.floorAspect = 1.0
					this.floorImage = ''
					this.loadedFloorImage = ''
				}
			})
	}

	initRendering() {
		if (this.program && this.fshader !== this.loadedFshader) {
			this.program.dispose()
			this.program = null
		}
		if (!this.program) {
			this.program = new Program(
				this.ctx,
				shader('main.vsh'),
				shader(this.fshader),
				this.fshader,
			)
			this.loadedFshader = this.fshader
		}
		return this.program
	}

	startRendering(time, cymTexture, cymWidth, cymHeight, targetW, targetH) {
		this.ensureNoise()
		const gl = this.ctx.gl
		const p = this.initRendering().use()

		const levelCount = Math.min(this.normalLevels.length, 5)
		p.int('normalLevelCount', levelCount)
		for (let i = 0; i < levelCount; i++) {
			this.normalLevelBuffer[i * 2 + 0] = this.normalLevels[i][0]
			this.normalLevelBuffer[i * 2 + 1] = this.normalLevels[i][1]
		}
		p.vec2v('normalLevels[0]', this.normalLevelBuffer.subarray(0, levelCount * 2))
		p.float('useRefractedAmount', this.useRefractedAmount)

		// Mip count of the reflection map.
		let maxmmlevel = 0
		if (this.reflection.width > 0) {
			let w = this.reflection.width
			while (w > 2) { w /= 2; maxmmlevel++ }
		}
		p.float('maxmmlevel', maxmmlevel)

		const lightCount = Math.min(this.lights.length, 8)
		p.int('nofLights', lightCount)
		for (let i = 0; i < lightCount; i++) {
			const l = this.lights[i]
			this.lightPosBuffer[i * 3 + 0] = l.pos[0]
			this.lightPosBuffer[i * 3 + 1] = l.pos[1]
			this.lightPosBuffer[i * 3 + 2] = l.pos[2]
			this.lightColorBuffer[i * 3 + 0] = l.color[0]
			this.lightColorBuffer[i * 3 + 1] = l.color[1]
			this.lightColorBuffer[i * 3 + 2] = l.color[2]
			this.lightRoughBuffer[i] = l.roughness
			// Struct-array members are not contiguous, so these need one call each.
			p.vec3(`lights[${i}].pos`, l.pos[0], l.pos[1], l.pos[2])
			p.vec3(`lights[${i}].color`, l.color[0], l.color[1], l.color[2])
			p.float(`lights[${i}].roughness`, l.roughness)
		}

		p.float('ior', attrToValue(this.ior, 0.1, 4.0, 1.0))
		p.float('roughness', this.roughness)
		p.float('metalness', this.metalness)
		p.float('final_gamma', attrToValue(this.finalGamma, 1.0 / 3.0, 3.0 / 1.0))
		p.float('final_mul', attrToValue(this.finalMul, 0.1, 5.0))
		p.vec2('randomVec', Math.random(), Math.random())
		p.float('absorb_strength', attrToValue(this.absorbStrength, 0.0001, 5.0))
		p.vec3('baseColor', this.baseColor[0], this.baseColor[1], this.baseColor[2])

		// Bind order defines the texture slots.
		p.bindTexture('cymtex', cymTexture)
		p.bindTexture('noise', this.noise.texture)
		p.bindTexture('floor', this.floor.texture)

		p.float('mainTime', time)

		// These apply to `floor`, the texture bound immediately above.
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

		p.mat4('cameraMatrix', this.matCamera)
		p.mat4('projMatrix', this.matProj)
		p.mat4('modelMatrix', this.matModel)

		const d = this.lightDir
		const len = Math.hypot(d[0], d[1], d[2]) || 1
		p.vec3('lightDir', d[0] / len, d[1] / len, d[2] / len)

		p.float('normalPower', attrToValue(this.normalPower, 0.1, 50.0, 4.0))
		p.float('view_z', attrToValue(this.viewz, 0.1, 5.0, 1.0))
		p.float('refmap_pow', attrToValue(this.refmapPow, 0.25, 15.0, 2.0))
		p.float('refmap_mul', attrToValue(this.refmapMul, 0.0, 15.0, 2.0))
		p.float('refmap_scale', attrToValue(this.refmapScale, 0.1, 4.0))
		p.float('refmap_saturation', this.refmapSaturation)
		p.vec2('resolution', cymWidth, cymHeight)
		p.vec2('targetResolution', targetW, targetH)
		p.vec4('floorAttr',
			this.floorDistance,
			attrToValue(this.floorPow, 0.25, 15.0, 2.0),
			attrToValue(this.floorMul, 0.0, 15.0, 2.0),
			attrToValue(this.floorScale, 0.1, 1.0, 2.0))
		p.vec3('emissiveColor', this.emissiveColor[0], this.emissiveColor[1], this.emissiveColor[2])

		p.bindTexture('reflection', this.reflection.texture)

		p.vec3('colorInner', this.colorInner[0], this.colorInner[1], this.colorInner[2])
		p.vec3('colorOuter', this.colorOuter[0], this.colorOuter[1], this.colorOuter[2])
		p.float('emissiveStrength', this.emissiveStrength)

		return p
	}

	setFromJson(set) {
		if (set == null) return
		const vec3 = (k, cur) => (Array.isArray(set[k])
			? [Number(set[k][0]), Number(set[k][1]), Number(set[k][2])]
			: cur)
		const num = (k, cur) => (set[k] !== undefined ? Number(set[k]) : cur)

		this.lightDir = vec3('light_dir', this.lightDir)
		this.baseColor = vec3('base_color', this.baseColor)
		this.emissiveColor = vec3('emissive_color', this.emissiveColor)
		this.colorInner = vec3('color_inner', this.colorInner)
		this.colorOuter = vec3('color_outer', this.colorOuter)

		// Presets have been written with both key names over time; accept either
		// so old and new saves both round-trip.
		const floorObj = set.floor || set.refraction
		if (floorObj) {
			if (floorObj.mul !== undefined) this.floorMul = Number(floorObj.mul)
			if (floorObj.pow !== undefined) this.floorPow = Number(floorObj.pow)
			if (floorObj.scale !== undefined) this.floorScale = Number(floorObj.scale)
			if (floorObj.distance !== undefined) this.floorDistance = Number(floorObj.distance)
		}

		this.absorbStrength = num('absorb_strength', this.absorbStrength)
		this.finalGamma = num('final_gamma', this.finalGamma)
		this.finalMul = num('final_mul', this.finalMul)
		this.roughness = num('roughness', this.roughness)
		this.metalness = num('metalness', this.metalness)
		this.normalPower = num('normal_power', this.normalPower)
		this.viewz = num('view_z', this.viewz)
		this.refmapPow = num('refmap_pow', this.refmapPow)
		this.refmapMul = num('refmap_mul', this.refmapMul)
		this.refmapScale = num('refmap_scale', this.refmapScale)
		this.refmapSaturation = num('refmap_saturation', this.refmapSaturation)
		this.ior = num('ior', this.ior)
		this.useRefractedAmount = num('useRefractedAmount', this.useRefractedAmount)
		this.emissiveStrength = num('emissive_strength', this.emissiveStrength)
		this.trailAmount = num('trail_amount', this.trailAmount)
		this.viscosity = num('viscosity', this.viscosity)
		this.rippleDepth = num('ripple_depth', this.rippleDepth)
		this.surfacePolish = num('surface_polish', this.surfacePolish)
		this.waterDepth = num('water_depth', this.waterDepth)
		this.causticStrength = num('caustic_strength', this.causticStrength)
		if (set.floor_image !== undefined) this.setFloorImage(String(set.floor_image))
		this.liquidMaterial = num('liquid_material', this.liquidMaterial)

		if (Array.isArray(set.normalLevels)) {
			this.normalLevels = set.normalLevels.map(n => [Number(n[0]), Number(n[1])])
		}

		if (set.emissive_mode !== undefined) {
			// Accept bool (preset) or number (UI 0/1 slider).
			this.emissiveMode = typeof set.emissive_mode === 'boolean'
				? set.emissive_mode
				: Number(set.emissive_mode) > 0.5
		}

		if (set.liquid_mode !== undefined) {
			this.liquidMode = typeof set.liquid_mode === 'boolean'
				? set.liquid_mode
				: Number(set.liquid_mode) > 0.5
		}

		if (Array.isArray(set.lights)) {
			const incoming = set.lights.map(nl => ({
				pos: [Number(nl.pos[0]), Number(nl.pos[1]), Number(nl.pos[2])],
				color: [Number(nl.color[0]), Number(nl.color[1]), Number(nl.color[2])],
				roughness: nl.roughness !== undefined ? Number(nl.roughness) : this.roughness,
			}))
			this.lightsAuthored = incoming.map(l => ({ ...l, pos: [...l.pos], color: [...l.color] }))
			this.lights = []
			const passes = COMPAT_DUPLICATE_LIGHTS ? incoming.length : 1
			for (let i = 0; i < passes; i++) this.lights.push(...incoming.map(l => ({ ...l })))
		}
	}

	getJson() {
		return {
			light_dir: [...this.lightDir],
			ior: this.ior,
			view_z: this.viewz,
			normal_power: this.normalPower,
			useRefractedAmount: this.useRefractedAmount,
			refmap_pow: this.refmapPow,
			refmap_mul: this.refmapMul,
			refmap_scale: this.refmapScale,
			refmap_saturation: this.refmapSaturation,
			roughness: this.roughness,
			metalness: this.metalness,
			final_gamma: this.finalGamma,
			final_mul: this.finalMul,
			absorb_strength: this.absorbStrength,
			refraction: {
				pow: this.floorPow,
				mul: this.floorMul,
				scale: this.floorScale,
				distance: this.floorDistance,
			},
			normalLevels: this.normalLevels.map(n => [...n]),
			// Deliberately the authored list. COMPAT_DUPLICATE_LIGHTS pushes the
			// whole list once per entry, so it squares the count rather than
			// doubling it — 2 lights load as 4, 3 as 9. Serialising the expanded
			// list would compound that on every save/load round trip (2 -> 4 ->
			// 16). Writing back what was authored keeps the file stable and every
			// existing preset rendering exactly as it does today.
			lights: this.lightsAuthored.map(l => ({
				pos: [...l.pos],
				color: [...l.color],
				roughness: l.roughness,
			})),
			base_color: [...this.baseColor],
			emissive_color: [...this.emissiveColor],
			emissive_mode: this.emissiveMode,
			color_inner: [...this.colorInner],
			color_outer: [...this.colorOuter],
			emissive_strength: this.emissiveStrength,
			trail_amount: this.trailAmount,
			liquid_mode: this.liquidMode,
			liquid_material: this.liquidMaterial,
			viscosity: this.viscosity,
			ripple_depth: this.rippleDepth,
			surface_polish: this.surfacePolish,
			water_depth: this.waterDepth,
			caustic_strength: this.causticStrength,
			floor_image: this.floorImage,
		}
	}

	dispose() {
		if (this.program) this.program.dispose()
	}
}
