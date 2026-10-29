#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

precision highp float;
precision mediump int;

uniform highp vec2 resolution;
uniform highp vec2 inverseResolution;
uniform highp sampler2D vSampler;					// velocity.rg + "liquidiness".b + alpha=pressure
uniform highp sampler2D divText;					// calculated in previous phase, divergence-texture
uniform highp float velocitySlowdown;
uniform highp float liquiditySlowdown;

in highp vec2 uv;
out vec4 fragColor;


void main () {

//	if (uv.y>0.5) discard;
    highp vec4 bg = texture(vSampler, uv);

    highp float divergenceCenter = texture(divText, uv).r;

    //highp float center = bg.a;
    highp float left = texture(vSampler, uv - vec2(inverseResolution.x, 0.0)).a;
    highp float right = texture(vSampler, uv + vec2(inverseResolution.x, 0.0)).a;
    highp float bottom = texture(vSampler, uv - vec2(0.0, inverseResolution.y)).a;
    highp float top = texture(vSampler, uv + vec2(0.0, inverseResolution.y)).a;

    highp float newPressure = (left + right + bottom + top - divergenceCenter) / 4.0;
    

	//bg.z = 1.0;
    //gl_FragColor = vec4(newPressure, 0.0, 0.0, 0.0);
    //gl_FragColor = vec4( bg.xy * 0.95, bg.z, newPressure * 0.95); 			// slowdown movement and make pressure go down
    fragColor = vec4( bg.xy*velocitySlowdown, bg.z*liquiditySlowdown, mix(bg.a, newPressure, bg.z)); 	// slowdown movement and make pressure go down

  	//fragColor = bg;
}
