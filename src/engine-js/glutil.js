// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Minimal WebGL2 helpers: program/uniform caching, framebuffer objects and
// textures.

// Every UI control is a normalised 0..1 attribute; this maps it onto the real
// range the shader expects, with an optional exponent for perceptual taper.
// Presets store the 0..1 attribute, so the curve here defines what they mean.
export function attrToValue(attr, start, end, p = 1.0) {
	return start + Math.pow(attr, p) * (end - start)
}

export const FULLSCREEN_QUAD = new Float32Array([
	-1, -1, 0,
	 1, -1, 0,
	 1,  1, 0,
	-1,  1, 0,
])

// Render target formats, resolved against the actual context capabilities
// at init.
export const BYTE = 'BYTE'
export const FLOAT32 = 'FLOAT32'
export const FLOAT32_SINGLE = 'FLOAT32_SINGLE'

export class GLContext {
	constructor(canvas) {
		const gl = canvas.getContext('webgl2', {
			alpha: false,
			antialias: false,
			depth: true,
			stencil: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: false,
			powerPreference: 'high-performance',
		})
		if (!gl) throw new Error('WebGL2 is not available')
		this.gl = gl
		this.canvas = canvas

		// Float render targets are not core in WebGL2 — both of these are needed
		// for the float32 render targets the wave field and fluid solver use.
		this.extColorBufferFloat = gl.getExtension('EXT_color_buffer_float')
		this.extFloatLinear = gl.getExtension('OES_texture_float_linear')
		if (!this.extColorBufferFloat) {
			gl.getExtension('EXT_color_buffer_half_float')
		}

		// The float32 height field is sampled with LINEAR filtering. Without
		// OES_texture_float_linear that silently degrades to NEAREST (visible as
		// blocky normals), so drop to half-float, which WebGL2 filters natively.
		this.useHalfFloat = !this.extFloatLinear
		this.floatCaps = {
			colorBufferFloat: !!this.extColorBufferFloat,
			floatLinear: !!this.extFloatLinear,
			usingHalfFloat: this.useHalfFloat,
		}

		this.quadBuffer = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD, gl.STATIC_DRAW)

		// WebGL2 requires a VAO-less path to still have attrib 0 bound; one
		// shared VAO for every fullscreen pass is simpler and faster than the
		// per-draw enable/disable dance the passes would otherwise need.
		this.quadVao = gl.createVertexArray()
		gl.bindVertexArray(this.quadVao)
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
		gl.bindVertexArray(null)

		// Framebuffer/viewport stack, replacing Fbo::save()/restore().
		this.fboStack = []
		this.defaultViewport = [0, 0, canvas.width, canvas.height]
	}

	// One fullscreen TRIANGLE_FAN — every pass in this engine is one of these.
	drawQuad() {
		const gl = this.gl
		gl.bindVertexArray(this.quadVao)
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4)
		gl.bindVertexArray(null)
	}

	setDefaultViewport(x, y, w, h) {
		this.defaultViewport = [x, y, w, h]
	}

	bindDefaultFramebuffer() {
		const gl = this.gl
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		const v = this.defaultViewport
		gl.viewport(v[0], v[1], v[2], v[3])
	}
}

export class Program {
	constructor(ctx, vertexSource, fragmentSource, label = 'program') {
		const gl = ctx.gl
		this.ctx = ctx
		this.gl = gl
		this.label = label
		this.locations = new Map()
		this.textureSlot = 0

		const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource, label + ':vs')
		const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, label + ':fs')
		const handle = gl.createProgram()
		gl.attachShader(handle, vs)
		gl.attachShader(handle, fs)
		gl.bindAttribLocation(handle, 0, 'vPosition')
		gl.linkProgram(handle)
		if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
			const log = gl.getProgramInfoLog(handle)
			gl.deleteProgram(handle)
			throw new Error(`Link failed [${label}]: ${log}`)
		}
		gl.deleteShader(vs)
		gl.deleteShader(fs)
		this.handle = handle
	}

	use() {
		this.gl.useProgram(this.handle)
		// GLESProgram::use() resets the slot allocator; texture units are handed
		// out in bindTexture() call order, not by uniform name.
		this.textureSlot = 0
		return this
	}

	// Uniform locations are resolved once and cached, so a per-frame set is a
	// Map hit rather than a driver round-trip.
	loc(name) {
		let l = this.locations.get(name)
		if (l === undefined) {
			l = this.gl.getUniformLocation(this.handle, name)
			this.locations.set(name, l)
		}
		return l
	}

	int(name, v) { const l = this.loc(name); if (l) this.gl.uniform1i(l, v); return this }
	float(name, v) { const l = this.loc(name); if (l) this.gl.uniform1f(l, v); return this }
	vec2(name, x, y) { const l = this.loc(name); if (l) this.gl.uniform2f(l, x, y); return this }
	vec3(name, x, y, z) { const l = this.loc(name); if (l) this.gl.uniform3f(l, x, y, z); return this }
	vec4(name, x, y, z, w) { const l = this.loc(name); if (l) this.gl.uniform4f(l, x, y, z, w); return this }
	vec3v(name, arr) { const l = this.loc(name); if (l) this.gl.uniform3fv(l, arr); return this }
	vec2v(name, arr) { const l = this.loc(name); if (l) this.gl.uniform2fv(l, arr); return this }
	floatv(name, arr) { const l = this.loc(name); if (l) this.gl.uniform1fv(l, arr); return this }
	mat4(name, arr) { const l = this.loc(name); if (l) this.gl.uniformMatrix4fv(l, false, arr); return this }

	bindTexture(name, texture) {
		if (!texture) return false
		const l = this.loc(name)
		if (!l) return false
		const gl = this.gl
		const slot = this.textureSlot++
		gl.activeTexture(gl.TEXTURE0 + slot)
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.uniform1i(l, slot)
		return true
	}

	dispose() {
		this.gl.deleteProgram(this.handle)
		this.locations.clear()
	}
}

function compileShader(gl, type, source, label) {
	const sh = gl.createShader(type)
	gl.shaderSource(sh, source)
	gl.compileShader(sh)
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh)
		gl.deleteShader(sh)
		throw new Error(`Compile failed [${label}]: ${log}`)
	}
	return sh
}

// Render target. bind()/unbind() save and restore both the bound framebuffer
// and the viewport, so passes can nest.
export class Fbo {
	constructor(ctx, width, height, {
		dataType = BYTE,
		nearest = false,
		clearColor = [0, 0, 0],
		clearAlpha = 0,
	} = {}) {
		const gl = ctx.gl
		this.ctx = ctx
		this.gl = gl
		this.width = width
		this.height = height

		const fmt = resolveFormat(gl, ctx, dataType)
		this.texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, this.texture)
		const filter = nearest ? gl.NEAREST : gl.LINEAR
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, width, height, 0, fmt.format, fmt.type, null)

		this.framebuffer = gl.createFramebuffer()
		this.bind()
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			this.unbind()
			throw new Error(`Incomplete framebuffer (${width}x${height}, ${dataType}): 0x${status.toString(16)}`)
		}
		gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearAlpha)
		gl.clear(gl.COLOR_BUFFER_BIT)
		this.unbind()
	}

	bind() {
		const gl = this.gl
		// Save both the bound framebuffer and the viewport, exactly as
		// Fbo::save() does, so nested passes restore correctly.
		this.ctx.fboStack.push({
			framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
			viewport: gl.getParameter(gl.VIEWPORT),
		})
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
		gl.viewport(0, 0, this.width, this.height)
	}

	unbind() {
		const gl = this.gl
		const prev = this.ctx.fboStack.pop()
		if (!prev) {
			this.ctx.bindDefaultFramebuffer()
			return
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, prev.framebuffer)
		const v = prev.viewport
		gl.viewport(v[0], v[1], v[2], v[3])
	}

	clear(r = 0, g = 0, b = 0, a = 0) {
		const gl = this.gl
		this.bind()
		gl.clearColor(r, g, b, a)
		gl.clear(gl.COLOR_BUFFER_BIT)
		this.unbind()
	}

	// Fbo::copyFbo — glBlitFramebuffer is core in WebGL2.
	copyFrom(source) {
		const gl = this.gl
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer)
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer)
		gl.blitFramebuffer(
			0, 0, source.width, source.height,
			0, 0, this.width, this.height,
			gl.COLOR_BUFFER_BIT, gl.NEAREST,
		)
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
		this.ctx.bindDefaultFramebuffer()
	}

	dispose() {
		this.gl.deleteFramebuffer(this.framebuffer)
		this.gl.deleteTexture(this.texture)
	}
}

function resolveFormat(gl, ctx, dataType) {
	if (dataType === FLOAT32) {
		return ctx.useHalfFloat
			? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
			: { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT }
	}
	if (dataType === FLOAT32_SINGLE) {
		return ctx.useHalfFloat
			? { internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT }
			: { internal: gl.R32F, format: gl.RED, type: gl.FLOAT }
	}
	return { internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE }
}

// --- Textures -------------------------------------------------------------

export function createColorTexture(ctx, r, g, b, a = 255) {
	const gl = ctx.gl
	const tex = gl.createTexture()
	gl.bindTexture(gl.TEXTURE_2D, tex)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
		new Uint8Array([r, g, b, a]))
	return tex
}

// Texture::load(fn, nearest) + generateMipmaps(). `source` is anything
// createImageBitmap/Image accepts, so file uploads and preset URLs share it.
export function createTextureFromImage(ctx, image, { nearest = false, mipmaps = true, repeat = false } = {}) {
	const gl = ctx.gl
	const tex = gl.createTexture()
	gl.bindTexture(gl.TEXTURE_2D, tex)
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
	const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
	if (nearest) {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
	} else if (mipmaps) {
		gl.generateMipmap(gl.TEXTURE_2D)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
	} else {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
	}
	return { texture: tex, width: image.width, height: image.height }
}

export async function loadImageSource(src) {
	const img = new Image()
	img.crossOrigin = 'anonymous'
	img.decoding = 'async'
	await new Promise((resolve, reject) => {
		img.onload = resolve
		img.onerror = () => reject(new Error(`Failed to load image: ${String(src).slice(0, 80)}`))
		img.src = src
	})
	if (typeof createImageBitmap === 'function') {
		try { return await createImageBitmap(img) } catch { /* fall through */ }
	}
	return img
}
