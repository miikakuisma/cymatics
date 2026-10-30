// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The wave field.
//
// Everything that actually computes a wave lives in
// shaders/cymatics_freq_bands.fsh and runs on the GPU. This class is the
// envelope follower plus the uniform setup — the entire per-frame CPU cost.

import { Fbo, Program, attrToValue, createColorTexture, FLOAT32 } from './glutil.js'
import { FULLSCREEN_VSH, shader } from './shaders.js'
import {
	BESSEL_ROWS, BESSEL_WIDTH, BESSEL_X_MAX, FIELD_ROUND, FIELD_SOURCES, MAX_ACTIVE_MODES, POLYGON_SIDES,
	besselTable, clampFieldMode, modeBinRanges, pickModes, plateFundamentalHz, roundModes, squareModes,
} from './modes.js'
import { PlateBaker } from './plate-bake.js'
import { polygonModes } from './plate-modes.js'
import { polygon } from './polygons.js'

const PLATE_MODE_SAMPLERS = ['plateMode0', 'plateMode1', 'plateMode2', 'plateMode3']

const BAND_MIN_HZ = [20, 80, 250, 2000]
const BAND_MAX_HZ = [80, 250, 2000, 20000]
const BAND_CENTER_HZ = [50, 165, 1000, 10000]

// Release scales the speed-derived decay rather than replacing it.
//
// Giving Release the falling edge outright made Response Speed feel dead. The
// slider still sharpened the attack exactly as it always had — a step settles in
// 12 frames at 0.1 and 2 at 1.0 — but the fall is at least half of what the eye
// reads as motion, and a fixed release pinned it. Measured against a 2 Hz
// modulation, tracking error across the whole Speed range collapsed to
// 0.142..0.094, where the original coupling spanned 0.231..0.046.
//
// As a multiplier, Speed scales both edges again, so it speeds the picture up;
// Release independently stretches or shortens the tail, which is what stops the
// strobing. The two are separable without either being inert.
//
// 0.5 is neutral and reproduces the original coupling exactly, so presets that
// predate the control need no conversion at all.
const RELEASE_NEUTRAL = 0.5
const RELEASE_RANGE = 32        // x/div at the ends of the slider
const RELEASE_TAU_MIN = 0.01    // seconds
const RELEASE_TAU_MAX = 4.0
const FRAME_DT = 1 / 60

function releaseToDecay(responseSpeed, release) {
	// The original coupling, kept as the base curve.
	const baseDecay = Math.min(Math.max(0.99 - responseSpeed * 0.49, 1e-6), 0.999999)
	const baseTau = -FRAME_DT / Math.log(baseDecay)

	const r = Math.min(Math.max(release, 0), 1)
	const scaled = baseTau * Math.pow(RELEASE_RANGE, (r - RELEASE_NEUTRAL) * 2)
	const tau = Math.min(Math.max(scaled, RELEASE_TAU_MIN), RELEASE_TAU_MAX)
	return Math.exp(-FRAME_DT / tau)
}

// Physical constants for the water dispersion relation.
const DISP_G = 9.81
const DISP_SIGMA = 0.072
const DISP_RHO = 1000.0
const DISP_D = 0.02

// Newton solve of omega^2 = (g*k + sigma*k^3/rho) * tanh(k*d).
//
// NOTE: this only runs in the constructor, and insertFreqSpectrum() then
// overwrites every bandK with a plain log2 mapping — so the dispersion physics
// is dead at runtime. Kept because it is the model the README describes and the
// natural thing to switch back on.
function solveDispersion(freqHz) {
	const f = Math.max(freqHz, 1.0)
	const omega = 2.0 * Math.PI * f
	const omega2 = omega * omega
	let k = omega / Math.sqrt(DISP_G * DISP_D)
	if (k < 1e-6) k = 1e-6

	for (let iter = 0; iter < 30; iter++) {
		const kd = k * DISP_D
		const th = Math.tanh(kd)
		const A = DISP_G * k + DISP_SIGMA * k * k * k / DISP_RHO
		const fk = A * th - omega2
		const dA = DISP_G + 3.0 * DISP_SIGMA * k * k / DISP_RHO
		const sech2 = 1.0 - th * th
		const df = dA * th + A * DISP_D * sech2
		if (Math.abs(df) < 1e-12) break
		const dk = -fk / df
		k += dk
		if (k < 1e-6) k = 1e-6
		if (Math.abs(dk) < 1e-7 * k) break
	}
	return k
}

export class Cymatics {
	constructor(ctx, width, height) {
		this.ctx = ctx
		this.width = width
		this.height = height

		this.viewScale = 0.25
		this.waveCenter = [0, 0, 0]
		this.waveDistanceScale = 0.16
		this.waveDistanceScaleFinetune = 0.0
		this.audioAmplifyMul = 1.0
		this.waveLowpass = 0.4
		this.simScale = 0.1
		this.faradayThreshold = 0.0
		this.freqResponseSpeed = 0.5
		// Release is independent of attack. See insertFreqSpectrum().
		this.freqRelease = RELEASE_NEUTRAL
		this.freqDetailScale = 1.0
		this.contourMode = 0.0
		this.contourCount = 8.0
		this.freqTime = 0.0
		this.freqSpectrumMode = false

		// Plate modes, off by default: 0 keeps the radiating sources every
		// preset was tuned on. See modes.js.
		this.fieldMode = FIELD_SOURCES
		this.plates = {} // field mode -> { modes, env, ranges, rangesKey, offset }
		this.modePick = new Float32Array(MAX_ACTIVE_MODES * 2)
		this.modeParams = new Float32Array(MAX_ACTIVE_MODES * 4)
		this.modeAmp = new Float32Array(MAX_ACTIVE_MODES)
		this.modeAmpScaled = new Float32Array(MAX_ACTIVE_MODES)
		this.modeCount = 0
		// The listing index of each picked mode, and the field it was picked
		// on: a field switched between pick and render must not index the new
		// field's listing with the old one's picks.
		this.modeIndex = new Int32Array(MAX_ACTIVE_MODES)
		this.modeField = FIELD_SOURCES
		this.besselTex = null
		this.placeholderTex = null
		// Polygons: baked figures (plate-bake.js), made on first use.
		this.baker = null
		this.plateTex = new Array(MAX_ACTIVE_MODES).fill(null)

		this.bandAmp = new Float32Array(4)
		this.bandK = new Float32Array(4)
		// Scratch buffers so the per-frame uniform upload allocates nothing.
		this.bandAmpScaled = new Float32Array(4)
		this.poleBuffer = new Float32Array(16 * 3)

		const kGridMax = 200.0
		for (let b = 0; b < 4; b++) {
			const kPhys = solveDispersion(BAND_CENTER_HZ[b])
			this.bandK[b] = Math.min(kPhys * this.simScale, kGridMax)
		}

		// Default pole layout: pentagon on the unit circle.
		this.poles = []
		const poleCount = 5
		for (let i = 0; i < poleCount; i++) {
			const a = (i / poleCount) * Math.PI * 2
			this.poles.push([Math.cos(a), Math.sin(a), 0])
		}

		this.waveLevels = []
		for (let i = 0; i < 7; i++) this.waveLevels.push(Math.exp(-(i / 6) * 0.5))

		// Neutral 0.5 so the emissive shader sees zero signal before audio starts.
		this.fbo = new Fbo(ctx, width, height, {
			dataType: FLOAT32,
			clearColor: [0.5, 0.5, 0.5],
			clearAlpha: 1.0,
		})

		this.fshader = 'cymatics_freq_bands.fsh'
		this.loadedFshader = null
		this.program = null
	}

	get texture() { return this.fbo ? this.fbo.texture : null }
	get isContourMode() { return this.contourMode > 0.5 }

	// One frame of the JS FFT spectrum (0..1 per bin) folded into 4 bands.
	// This is the entire CPU cost of the "simulation": ~1000 adds.
	insertFreqSpectrum(freqData, numBins, sampleRate = 44100.0) {
		const binHz = sampleRate / 2048.0

		// Attack and release are deliberately separate. Tied to a single speed —
		// as they were — the top of the range gives a decay of 0.5, which halves
		// the amplitude every frame: about -6 dB per 16.7 ms. The field collapses
		// between transients and the picture visibly flashes. A fast rise with a
		// slow fall is what every envelope follower, compressor and meter does,
		// and it is what lets the pattern track quick material without strobing.
		const attack = 0.1 + this.freqResponseSpeed * 0.8
		const decay = releaseToDecay(this.freqResponseSpeed, this.freqRelease)

		for (let b = 0; b < 4; b++) {
			const binMin = Math.max(Math.trunc(BAND_MIN_HZ[b] / binHz), 0)
			const binMax = Math.min(Math.trunc(BAND_MAX_HZ[b] / binHz), numBins - 1)

			let target = 0
			if (binMin <= binMax) {
				let sum = 0
				for (let i = binMin; i <= binMax; i++) sum += freqData[i]
				target = sum / (binMax - binMin + 1)
			}

			if (target > this.bandAmp[b]) {
				this.bandAmp[b] += attack * (target - this.bandAmp[b])
			} else {
				this.bandAmp[b] *= decay
			}
		}

		if (this.fieldMode !== FIELD_SOURCES) this.updateModes(freqData, numBins, sampleRate, attack, decay)

		// Overwrites the dispersion-derived wavenumbers every frame.
		for (let b = 0; b < 4; b++) {
			this.bandK[b] = Math.log2(BAND_CENTER_HZ[b] / 20.0) * 5.0 * this.freqDetailScale
		}

		this.freqSpectrumMode = true
	}

	plate(fieldMode) {
		let plate = this.plates[fieldMode]
		if (!plate) {
			const sides = POLYGON_SIDES[fieldMode]
			const modes = sides ? polygonModes(sides) : fieldMode === FIELD_ROUND ? roundModes() : squareModes()
			plate = {
				modes, env: new Float32Array(modes.length), ranges: null, rangesKey: '',
				offset: sides ? polygon(sides).offset : 0, // the outline's turn, for the shader
			}
			this.plates[fieldMode] = plate
		}
		return plate
	}

	// Each mode follows the spectrum a semitone either side of its own
	// frequency, through the same envelope as the bands; the strongest few ring.
	updateModes(freqData, numBins, sampleRate, attack, decay) {
		const plate = this.plate(this.fieldMode)
		// Distance is the plate's size: it sets which mode each note reaches.
		const fundamentalHz = plateFundamentalHz(this.viewScale)
		const key = `${fundamentalHz}|${sampleRate}|${numBins}`
		if (plate.rangesKey !== key) {
			plate.ranges = modeBinRanges(plate.modes, fundamentalHz, sampleRate, numBins)
			plate.rangesKey = key
		}
		const { env, ranges, modes } = plate
		for (let i = 0; i < modes.length; i++) {
			const lo = ranges[i * 2]
			const hi = ranges[i * 2 + 1]
			let target = 0
			for (let b = lo; b <= hi; b++) if (freqData[b] > target) target = freqData[b]
			if (target > env[i]) env[i] += attack * (target - env[i])
			else env[i] *= decay
		}

		const count = pickModes(env, this.faradayThreshold, MAX_ACTIVE_MODES, this.modePick)
		for (let j = 0; j < count; j++) {
			const mode = modes[this.modePick[j * 2]]
			this.modeParams[j * 4 + 0] = mode.a
			this.modeParams[j * 4 + 1] = mode.b
			// Breathing rate, rad/s: higher modes breathe faster, as ripples do.
			this.modeParams[j * 4 + 2] = 1.5 + 0.4 * Math.sqrt(mode.ratio)
			this.modeParams[j * 4 + 3] = mode.mix
			this.modeAmp[j] = this.modePick[j * 2 + 1]
			this.modeIndex[j] = this.modePick[j * 2]
		}
		for (let j = count; j < MAX_ACTIVE_MODES; j++) this.modeAmp[j] = 0
		this.modeCount = count
		this.modeField = this.fieldMode
	}

	ensureBesselTexture() {
		if (this.besselTex) return this.besselTex
		const gl = this.ctx.gl
		const tex = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, tex)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, BESSEL_WIDTH, BESSEL_ROWS, 0, gl.RED, gl.FLOAT, besselTable())
		// Read with texelFetch and interpolated in the shader: R32F is not
		// filterable everywhere.
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.bindTexture(gl.TEXTURE_2D, null)
		this.besselTex = tex
		return tex
	}

	render() {
		if (!this.freqSpectrumMode || !this.fbo) return

		if (this.fshader !== this.loadedFshader && this.program) {
			this.program.dispose()
			this.program = null
		}
		if (!this.program) {
			this.program = new Program(
				this.ctx,
				shader('cymatics_main.vsh'),
				shader(this.fshader),
				this.fshader,
			)
			this.loadedFshader = this.fshader
		}

		const gl = this.ctx.gl
		gl.disable(gl.DEPTH_TEST)
		gl.disable(gl.CULL_FACE)
		gl.disable(gl.BLEND)

		// Picks made on another field mean nothing on this one.
		const modeCount = this.modeField === this.fieldMode ? this.modeCount : 0
		// A polygon's figures are baked here, before the field pass binds its
		// own target: a bake is a render pass of its own.
		const sides = POLYGON_SIDES[this.fieldMode]
		if (sides) {
			if (!this.baker) {
				this.baker = new PlateBaker(this.ctx, {
					bessel: this.ensureBesselTexture(),
					vertexSource: FULLSCREEN_VSH,
					fragmentSource: shader('plate_bake.fsh'),
				})
			}
			for (let j = 0; j < MAX_ACTIVE_MODES; j++) {
				this.plateTex[j] = j < modeCount ? this.baker.texture(sides, this.modeIndex[j]) : null
			}
		}

		this.fbo.bind()
		const p = this.program.use()
		gl.clearColor(0.5, 0.5, 0.5, 1.0)
		gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT)

		p.float('vscale', attrToValue(this.viewScale, 0.1, 2.0))
		p.vec3('mainPos', this.waveCenter[0], this.waveCenter[1], this.waveCenter[2])

		// One uniform3fv over the whole array, rather than a set per pole.
		const poleCount = Math.min(this.poles.length, 16)
		p.int('poleCount', poleCount)
		for (let i = 0; i < poleCount; i++) {
			this.poleBuffer[i * 3 + 0] = this.poles[i][0]
			this.poleBuffer[i * 3 + 1] = this.poles[i][1]
			this.poleBuffer[i * 3 + 2] = this.poles[i][2]
		}
		p.vec3v('poles[0]', this.poleBuffer.subarray(0, poleCount * 3))

		for (let b = 0; b < 4; b++) this.bandAmpScaled[b] = this.bandAmp[b] * this.audioAmplifyMul
		p.floatv('bandAmp[0]', this.bandAmpScaled)
		p.floatv('bandK[0]', this.bandK)

		p.float('faradayThreshold', this.faradayThreshold)
		p.float('uTime', this.freqTime)
		p.float('contourMode', this.contourMode)
		p.float('contourCount', this.contourCount)

		p.int('fieldMode', this.fieldMode)
		// Every sampler must always point at something. Left alone one reads
		// unit 0, which can hold this pass's own render target, and WebGL
		// refuses that draw as a feedback loop (INVALID_OPERATION, blank field).
		if (!this.placeholderTex) this.placeholderTex = createColorTexture(this.ctx, 0, 0, 0)
		p.bindTexture('besselTable', this.fieldMode === FIELD_ROUND ? this.ensureBesselTexture() : this.placeholderTex)
		for (let j = 0; j < MAX_ACTIVE_MODES; j++) {
			p.bindTexture(PLATE_MODE_SAMPLERS[j], (sides && this.plateTex[j]) || this.placeholderTex)
		}
		if (sides) {
			p.int('polySides', sides)
			p.float('polyOffset', this.plate(this.fieldMode).offset)
		}
		if (this.fieldMode !== FIELD_SOURCES) {
			p.int('modeCount', modeCount)
			// Gain applies to the picked weights, as it does to the bands.
			for (let j = 0; j < MAX_ACTIVE_MODES; j++) this.modeAmpScaled[j] = this.modeAmp[j] * this.audioAmplifyMul
			p.floatv('modeAmp[0]', this.modeAmpScaled)
			p.vec4v('modeParams[0]', this.modeParams)
			p.float('besselXMax', BESSEL_X_MAX)
		}
		this.freqTime += 1.0 / 60.0

		this.ctx.drawQuad()
		// Deliberately no gl.finish()/gl.flush(): both are hard pipeline stalls.
		this.fbo.unbind()
	}

	setFromJson(js) {
		if (js == null) return
		const num = (k, cur) => (js[k] !== undefined ? Number(js[k]) : cur)
		this.audioAmplifyMul = num('audio_amplify_mul', this.audioAmplifyMul)
		this.waveLowpass = num('audio_lowpass', this.waveLowpass)
		this.waveDistanceScale = num('wave_distance_scale', this.waveDistanceScale)
		this.waveDistanceScaleFinetune = num('wave_distance_scale_finetune', this.waveDistanceScaleFinetune)
		this.viewScale = num('view_scale', this.viewScale)
		this.simScale = num('sim_scale', this.simScale)
		this.faradayThreshold = num('faraday_threshold', this.faradayThreshold)
		this.freqResponseSpeed = num('freq_response_speed', this.freqResponseSpeed)

		// No conversion needed for presets that predate Release: the control is
		// neutral at its default, which is the original coupling exactly.
		this.freqRelease = num('freq_release', this.freqRelease)
		this.freqDetailScale = num('freq_detail_scale', this.freqDetailScale)
		this.contourMode = num('contour_mode', this.contourMode)
		this.contourCount = num('contour_count', this.contourCount)
		this.fieldMode = clampFieldMode(num('field_mode', this.fieldMode))

		if (Array.isArray(js.wave_center)) {
			this.waveCenter = [Number(js.wave_center[0]), Number(js.wave_center[1]), Number(js.wave_center[2])]
		}
		if (Array.isArray(js.poles)) {
			this.poles = js.poles.map(p => [Number(p[0]), Number(p[1]), Number(p[2])])
		}
		if (Array.isArray(js.wave_levels)) {
			this.waveLevels = js.wave_levels.map(Number)
		}
	}

	getJson() {
		return {
			audio_lowpass: this.waveLowpass,
			audio_amplify_mul: this.audioAmplifyMul,
			wave_distance_scale: this.waveDistanceScale,
			wave_distance_scale_finetune: this.waveDistanceScaleFinetune,
			view_scale: this.viewScale,
			wave_center: [...this.waveCenter],
			wave_levels: [...this.waveLevels],
			poles: this.poles.map(p => [...p]),
			sim_scale: this.simScale,
			faraday_threshold: this.faradayThreshold,
			freq_response_speed: this.freqResponseSpeed,
			freq_release: this.freqRelease,
			freq_detail_scale: this.freqDetailScale,
			contour_mode: this.contourMode,
			contour_count: this.contourCount,
			field_mode: this.fieldMode,
		}
	}

	dispose() {
		if (this.program) this.program.dispose()
		if (this.fbo) this.fbo.dispose()
		if (this.besselTex) this.ctx.gl.deleteTexture(this.besselTex)
		if (this.placeholderTex) this.ctx.gl.deleteTexture(this.placeholderTex)
		if (this.baker) this.baker.dispose()
	}
}
