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
 
uniform mediump sampler2D back;
uniform mediump sampler2D source;
uniform highp vec2 resolution;
uniform highp float amount;

in highp vec2 uv;
out vec4 fragColor;


void main()
{	// advection
	highp vec4 bg = texture( back, uv );

	float newVal = texture( source, uv ).r;
	
	//fragColor = vec4( bg.rgb, bg.a + (newVal-0.5)*amount);
	fragColor = vec4( bg.rgb, bg.a + (newVal-0.5)*amount);			// NOTE, WAS THIS!!
	
	
	//fragColor = vec4( bg.rgb, mix(bg.a,newVal,amount));

	//highp vec4 newbg = texture2D( back, uv - oldmovement/resolution * speedMul);
	//highp vec2 newMovement = (newbg.xy)*0.95;
	//gl_FragColor = vec4( newMovement, newbg.zw );
	
}
