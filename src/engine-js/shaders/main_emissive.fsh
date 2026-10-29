#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision highp float;
precision mediump int;

in vec3 worldPos;
in vec2 uv;
in vec3 normal;
in vec3 toView;

out vec4 fragColor;

uniform highp sampler2D cymtex;

uniform vec3 colorInner;       // dark / background colour
uniform vec3 colorOuter;       // bright / line colour
uniform float emissiveStrength;
uniform vec2 resolution;

// Raw height value 0..1 from the cymatics height field. The freq-band, mandala,
// and chladni shaders all write into this same range; we treat distance from the
// neutral 0.5 mid-grey as the "interesting" signal.
float signal(vec2 p) {
    float h = texture(cymtex, p).r;
    float a = abs(h - 0.5) * 2.0;       // 0 in flat regions, 1 at peaks/troughs
    return clamp(a, 0.0, 1.0);
}

void main() {
    vec2 px = 1.0 / resolution;

    // Sharp center sample (lines, ridges).
    float a = signal(uv);

    // Soft halo: 8-tap ring at +/-3 px and a wider one at +/-7 px.
    float h1 = 0.0;
    h1 += signal(uv + vec2( 3.0,  0.0) * px);
    h1 += signal(uv + vec2(-3.0,  0.0) * px);
    h1 += signal(uv + vec2( 0.0,  3.0) * px);
    h1 += signal(uv + vec2( 0.0, -3.0) * px);
    h1 *= 0.25;

    float h2 = 0.0;
    h2 += signal(uv + vec2( 7.0,  0.0) * px);
    h2 += signal(uv + vec2(-7.0,  0.0) * px);
    h2 += signal(uv + vec2( 0.0,  7.0) * px);
    h2 += signal(uv + vec2( 0.0, -7.0) * px);
    h2 *= 0.25;

    // Strong contrast curve so subtle detail in the freq-band shader still
    // shows up as colour, not just black.
    float core = pow(a,  0.45);
    float halo = pow(h1, 0.6) * 0.6 + pow(h2, 0.7) * 0.3;

    // Two-stop colormap: background colour for low signal, bright colour for peaks.
    float t = smoothstep(0.0, 0.85, core);
    vec3 col = mix(colorInner, colorOuter, t);

    // Composite the bright core on top of a halo glow tinted by the inner colour.
    vec3 outCol = col * core * 1.5
                + colorInner * halo * 0.8
                + colorOuter * pow(core, 4.0) * 0.6;     // hot specular tip on peaks

    outCol *= emissiveStrength;

    // Soft tonemap so highlights bloom but never blow out to a flat white.
    outCol = outCol / (vec3(1.0) + outCol * 0.35);

    fragColor = vec4(outCol, 1.0);
}
