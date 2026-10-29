#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

precision highp float;
precision mediump int;

uniform highp vec2 resolution;
uniform highp vec2 inverseResolution;
uniform highp sampler2D vSampler;				// velocity.xy + "liquidity" + pressure.a
uniform highp float pressureLeak;

in highp vec2 uv;
out vec4 fragColor;



void main () {
    //highp vec2 step = vec2(1.0) / resolution;			// replaced with inverse resolution

    highp vec4 bg = texture(vSampler, uv);
    highp vec2 currentVelocity = bg.xy;
    
    //highp float center = bg.a;
    highp float left = texture(vSampler, uv + vec2(-inverseResolution.x, 0.0)).a;
    highp float right = texture(vSampler, uv + vec2(inverseResolution.x, 0.0)).a;
    highp float bottom = texture(vSampler, uv + vec2(0.0, -inverseResolution.y)).a;
    highp float top = texture(vSampler, uv + vec2(0.0, inverseResolution.y)).a;

    //compute gradient of pressure
   highp vec2 gradient = vec2(right - left, top - bottom) / 2.0;

    

	bg.z = 1.0;

	// pressure leak
	//bg.w = mix(bg.w, 0.5, 0.01);
	bg.w *= pressureLeak;
	

    // highp vec2 newVelocity = mix( currentVelocity, currentVelocity - gradient*bg.z, 1.0);
    highp vec2 newVelocity = currentVelocity - gradient*bg.z;

	// 0.99 is velocity leak
    fragColor = vec4(newVelocity, bg.zw);

 }
