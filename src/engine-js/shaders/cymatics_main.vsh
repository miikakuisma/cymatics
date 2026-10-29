#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
layout(location = 0) in vec4 vPosition;
out vec3 worldPos;
uniform float vscale;

//uniform highp mat4 cameraMatrix;
//uniform highp mat4 modelMatrix;
//uniform highp mat4 projMatrix;


void main()
{
	worldPos = vPosition.xyz * vscale;
	gl_Position = vec4(vPosition.xyz, 1.0);
}
