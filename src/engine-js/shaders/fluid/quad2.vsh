#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision highp float;
precision mediump int;
layout(location = 0) in vec4 vPosition;
out vec2 uv;

void main()
{
	uv = vec2(0.5) + vPosition.xy*0.5;
	//uv = vec2(0.5) + vec2(vPosition.x, -vPosition.y)*0.5;
	gl_Position = vec4(vPosition.xyz, 1.0);
	//gl_Position = vec4(-vPosition.xyz, 1.0);

}
