// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// GLSL sources, bundled as strings at build time. These are `#version 300 es`,
// which is exactly what WebGL2 speaks, so nothing is rewritten at runtime.
const rawShaders = import.meta.glob('./shaders/**/*.{fsh,vsh,glsl}', {
	query: '?raw',
	import: 'default',
	eager: true,
})

// Key by path relative to shaders/ — 'main.vsh', 'fluid/jacobi.glsl'.
const shaders = {}
for (const [specifier, source] of Object.entries(rawShaders)) {
	shaders[specifier.replace('./shaders/', '')] = source
}

export function shader(path) {
	const src = shaders[path]
	if (src === undefined) {
		throw new Error(`Shader not bundled: ${path} (have: ${Object.keys(shaders).join(', ')})`)
	}
	return src
}

export { shaders }

// Blue noise dither texture, used by the PBR shader to break up banding.
export { default as blueNoiseUrl } from './bluenoise.png'

// --- Shaders small enough to live inline --------------------------------

// Passthrough vertex shader shared by the contour and emissive paths.
export const FULLSCREEN_VSH = `#version 300 es
layout(location=0) in vec3 pos;
out vec2 uv;
void main() {
  uv = pos.xy * 0.5 + 0.5;
  gl_Position = vec4(pos, 1.0);
}
`

// Contour mode draws the height field straight to screen.
export const PASSTHROUGH_FSH = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 fragColor;
uniform sampler2D tex;
void main() {
  float v = texture(tex, uv).r;
  fragColor = vec4(vec3(v), 1.0);
}
`
