#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision highp float;
precision mediump int;
/*
 * rg = movement direction
 * b = ?
 * a = pressure of the point
 *
 */
 
uniform highp sampler2D vSampler;
uniform highp vec2 resolution;
uniform highp vec2 inverseResolution;
in highp vec2 uv;
out vec4 fragColor;


// diffuse phase

void main()
{
    //highp vec2 inverseResolution = vec2(1.0) / resolution.xy;
 
    highp float x0 = texture(vSampler, uv - vec2(inverseResolution.x, 0.0)).x;
    highp float x1 = texture(vSampler, uv + vec2(inverseResolution.x, 0.0)).x;
    highp float y0 = texture(vSampler, uv - vec2(0.0, inverseResolution.y)).y;
    highp float y1 = texture(vSampler, uv + vec2(0.0, inverseResolution.y)).y;
    highp float divergence = ((x1-x0) + (y1-y0)) * 0.5;
    fragColor = vec4(divergence);
}
