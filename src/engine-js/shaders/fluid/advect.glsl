#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision highp float;
precision mediump int;
/*
 * rg = movement direction
 * b = "multiplier for movement"
 * a = pressure of the point
 *
 */
 
uniform highp sampler2D back;
uniform highp sampler2D vSampler;
uniform highp vec2 resolution;
uniform highp float speedMul;

in highp vec2 uv;
out vec4 fragColor;


void main()
{	// advection
	highp vec4 bg = texture( vSampler, uv );
	
	

	highp vec2 oldmovement = bg.xy;	

	//highp vec4 newbg = texture2D( back, uv - oldmovement/resolution * speedMul);
	//highp vec2 newMovement = (newbg.xy)*0.95;
	//gl_FragColor = vec4( newMovement, newbg.zw );
	fragColor = texture( back, uv - oldmovement/resolution * speedMul );
	
}
