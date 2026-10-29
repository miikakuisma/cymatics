#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// #version 410 COMPILES WITH MACOS
// NOTE, TESTING!!
layout(location = 0) in vec4 vPosition;
out vec3 worldPos;
out vec3 normal;
out vec2 uv;
out vec3 toView;

uniform highp mat4 cameraMatrix;
uniform highp mat4 modelMatrix;
uniform highp mat4 projMatrix;

uniform float view_z;

void main()
{
	highp vec3 cameraPos = cameraMatrix[3].xyz;
	vec4 wp = modelMatrix * vPosition;
	worldPos = wp.xyz;
	uv = vPosition.xy*0.5 + vec2(0.5);
	//toView = normalize( vec3(wp.xy, 1.0) );
	toView = vec3(wp.xy, view_z);
	
	normal = normalize( mat3(modelMatrix) * vec3(0.0, 0.0, -1.0) );
	
	vec3 cameraCoord =  transpose(mat3(cameraMatrix)) * (worldPos.xyz-cameraPos);
	gl_Position = projMatrix * vec4(cameraCoord.x, cameraCoord.y, -cameraCoord.z,1.0);	
/*

	
	toView = (worldPos.xyz - cameraPos) * toViewMulVec;
	pixelAo = aomul;
	pixelNormal = normalize(mat3(modelMatrix) * normal);
	pixelTangent = vec4( normalize(mat3(modelMatrix) * tangent.xyz), tangent.w);
	texCoord = uv;
	//texCoord = vec2(uv.x, 1.0-uv.y);			// inverse v

	cameraCoord =  transpose(mat3(cameraMatrix)) * (worldPos.xyz-cameraPos);
	gl_Position = projMatrix * vec4(cameraCoord.x, cameraCoord.y, -cameraCoord.z,1.0);	
	*/
	
	//worldPos = vPosition.xyz*0.9;
	//normal = vec3(0.0, 0.0, -1.0);
	//gl_Position = vec4(worldPos, 1.0);
}
