#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision highp float;
precision mediump int;

uniform highp sampler2D current;
uniform highp sampler2D history;
uniform highp float blendFactor;   // 0.0 = no smoothing, 1.0 = frozen on history

in highp vec2 uv;
out vec4 fragColor;

void main()
{
    vec4 curr = texture(current, uv);
    vec4 prev = texture(history, uv);
    fragColor = mix(curr, prev, blendFactor);
}
