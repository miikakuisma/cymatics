#version 300 es
// Cymatics engine.
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision highp float;
precision mediump int;

in vec2 uv;
out vec4 fragColor;

uniform highp sampler2D current;   // this frame's wave field, 0.5 = flat
uniform highp sampler2D history;   // last frame's accumulated field
uniform float viscosity;           // 0 = instant, 1 = syrup
uniform float texel;               // 1.0 / field size

// Inertia for the wave field.
//
// A plain lerp against the history would only fade ripples in place, which
// looks like a dimmer, not like a liquid. Blending against a *blurred* history
// makes them spread outward as they decay, so a bass hit throws a ring that
// travels and settles. The blur radius grows with viscosity: thicker fluid
// carries the disturbance further before it dies.
void main() {
    float cur = texture(current, uv).r;

    float radius = (1.0 + viscosity * 3.0) * texel;
    float h = texture(history, uv).r * 0.4;
    h += texture(history, uv + vec2( radius, 0.0)).r * 0.15;
    h += texture(history, uv + vec2(-radius, 0.0)).r * 0.15;
    h += texture(history, uv + vec2(0.0,  radius)).r * 0.15;
    h += texture(history, uv + vec2(0.0, -radius)).r * 0.15;

    // Relax toward the flat 0.5 mid-point so the surface eventually settles.
    // CLAMP_TO_EDGE means the blur alone would never fully drain the corners.
    float decay = mix(0.90, 0.995, viscosity);
    h = 0.5 + (h - 0.5) * decay;

    // Capped below 1.0: at a true 1.0 the buffer would stop accepting audio.
    float blend = viscosity * 0.92;

    fragColor = vec4(mix(cur, h, blend), 0.0, 0.0, 1.0);
}
