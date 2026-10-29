#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision highp float;
precision mediump int;
in vec3 worldPos;
in vec2 uv;
in vec3 normal;
in vec3 toView;
out vec4 fragColor;

uniform highp sampler2D cymtex;
uniform highp sampler2D reflection;
uniform highp sampler2D floor;
uniform highp sampler2D noise;
uniform float randomSeed;
uniform vec2 resolution;
uniform vec2 targetResolution;
uniform vec2 randomVec;


// settings 
#define MAX_NORMAL_LEVELS 5
uniform float normalPower;
uniform int normalLevelCount;
uniform vec2 normalLevels[MAX_NORMAL_LEVELS];
uniform float ior;				// index of refraction
uniform float useRefractedAmount;		// mix between refracted and straight normal

uniform float refmap_mul;
uniform float refmap_pow;
uniform float maxmmlevel;			// how many mmlevels does reflection have
uniform float refmap_scale;
uniform float refmap_saturation;
uniform float final_gamma;
uniform float final_mul;
uniform float absorb_strength;
uniform vec4 floorAttr;				// x = distancetofloor, y=pow, z=mul, w=scale
uniform vec3 emissiveColor;


uniform int nofLights;
struct Light {
	vec3 pos;
	vec3 color;
	float roughness;
};
uniform Light lights[8];				// 8 max lights


uniform vec3 baseColor;
uniform float roughness;
uniform float metalness;


vec3 diffuseRadiance = vec3(0.0);
vec3 specularRadiance = vec3(0.0);



vec3 F0;


#define M_PI 3.14159



float chiGGX(float v)
{
	// NOTE, OPTIMIZE THIS!!
    return v > 0.0 ? 1.0 : 0.0;
}

float ggxNormalDistribution_Sq(const float NdotH, const float roughnessSq)
{
    float d = ((NdotH * roughnessSq - NdotH) * NdotH + 1.0);
    return roughnessSq / (d * d * M_PI);
}

float ggxNormalDistribution(const float NdotH, const float roughness)
{
    float a2 = roughness * roughness;
    float d = ((NdotH * a2 - NdotH) * NdotH + 1.0);
    return a2 / (d * d * M_PI);
}

float GGX_PartialGeometryTerm(const float vdotn, const float vdoth, float alphaSq)
{
    // float chi = chiGGX( vdoth / clamp(dot(v,n), 0.0, 1.0) );
    float chi = chiGGX(vdoth / clamp(vdotn, 0.0, 1.0));
    float VoH2 = vdoth * vdoth;
    float tan2 = (1.0 - VoH2) / VoH2;
    return (chi * 2.0) / (1.0 + sqrt(1.0 + alphaSq * tan2));
}

vec3 fresnelSchlick(const vec3 F0, const float cosT)
{
    return F0 + (1.0 - F0) * pow(1.0 - cosT, 5.0);
}



void processLight( const Light light, const vec3 normal, const vec3 rdir ) {
	float roughnessSq = light.roughness * light.roughness;
	vec3 ldir = normalize(light.pos - worldPos);
	vec3 H = normalize(ldir + (-rdir)); // Half vector between both l and vn
	float NdotV = dot(normal, -rdir);
	float NdotH = clamp(dot(normal, H), 0.01, 1.0);
	float LdotH = clamp(dot(ldir, H), 0.01, 1.0);
	float VdotH = dot(-rdir, H);
	float NdotL = clamp( dot(normal, ldir), 0.0, 1.0);
	
	//float block = getLightBlock(hitpos, tpos, hi.primitive) * angleMul;
	float block = 1.0;

	// Evaluate our BRDF using a microfacet BRDF model
	float D = ggxNormalDistribution_Sq(NdotH, roughnessSq);
	float G = GGX_PartialGeometryTerm(NdotV, VdotH, roughnessSq);

	vec3 F = fresnelSchlick(F0, clamp(VdotH, 0.0, 1.0));
	// float ggxProb = clamp(D * NdotH / (4.0f * LdotH), 0.01f, 10.0f);
	float ggxTerm = ((D * G) / (4.0 * NdotL * NdotV + 0.000001)); // add something small to prevent /zero
	// What's the probability of sampling vector H from getGGXMicrofacet()?
/*
	// distance attenuation
	if (l->distanceAttMul > 0.0)
	{
		dtolight *= l->distanceAttMul;
		block *= (1.0f / (1.0f + dtolight * dtolight));
	}
	*/
	block *= NdotL;

	diffuseRadiance += light.color * ((clamp(vec3(1.0) - F, 0.0, 1.0) * block));
	specularRadiance += light.color * F * clamp(ggxTerm * block, 0.0, 150.0);
}



void processRefractedLight( const Light light, const vec3 normal, const vec3 rdir ) {
	float roughnessSq = light.roughness * light.roughness;
	vec3 ldir = (light.pos - worldPos);
	float distanceToLight = length(ldir);
	ldir /= distanceToLight;
	
	vec3 H = normalize(ldir + (-rdir)); // Half vector between both l and vn
	float NdotV = dot(normal, -rdir);
	float NdotH = clamp(dot(normal, H), 0.01, 1.0);
	float LdotH = clamp(dot(ldir, H), 0.01, 1.0);
	float VdotH = clamp(dot(-rdir, H), 0.01, 1.0);
	
	float NdotL = clamp( dot(normal, ldir), 0.0, 1.0);	

	// Evaluate our BRDF using a microfacet BRDF model
	float D = ggxNormalDistribution_Sq(NdotH, roughnessSq);
	float G = GGX_PartialGeometryTerm(NdotV, VdotH, roughnessSq);
	vec3 F = fresnelSchlick(F0, clamp(VdotH, 0.0, 1.0));
	//D=G=1.0;
	//F=vec3(1.0);
	// float ggxProb = clamp(D * NdotH / (4.0f * LdotH), 0.01f, 10.0f);
	float ggxTerm = ((D * G) / (4.0 * NdotL * NdotV + 0.000001)); // add something small to prevent /zero
	// What's the probability of sampling vector H from getGGXMicrofacet()?
	

	// absorb light
	NdotL *= exp(-absorb_strength/abs(rdir.z));			// NOTE, distance from point to light
	diffuseRadiance += light.color * ((clamp(vec3(1.0) - F, 0.0, 1.0) * NdotL));
	specularRadiance += light.color * F * clamp(ggxTerm * NdotL, 0.0, 150.0);
}



float getHeight( vec2 uv ) {
	//return texture(cymtex, uv).r;
	return texture(cymtex, uv).a;				// NOTE, FOR TESTING LIQUID
}

vec3 sobel( vec2 uv, vec2 svec, float strength ) {

        // surrounding pixels

        float tl = getHeight(uv + vec2(-svec.x, -svec.y)); // top left
        float l = getHeight(uv + vec2(-svec.x, 0));        // left
        float bl = getHeight(uv + vec2(-svec.x, svec.y));  // bottom left
        float t = getHeight(uv + vec2(0.0f, -svec.y));     // top
        float b = getHeight(uv + vec2(0.0f, svec.y));      // bottom
        float tr = getHeight(uv + vec2(svec.x, -svec.y));  // top right
        float r = getHeight(uv + vec2(svec.x, 0));         // right
        float br = getHeight(uv + vec2(svec.x, svec.y));   // bottom right

        // sobel filter
        float dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
        float dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);

        return normalize(vec3(dX, dY, strength));
}

vec3 calculateNormal(vec2 uv) {
	vec3 rval = vec3(0.0);
	for (int f=0; f<normalLevelCount; f++) {
		rval += sobel( uv, vec2(normalLevels[f].x) / resolution, normalLevels[f].y );
	}
	return normalize(rval);
}

vec3 mapColorToScreen( vec3 colorIn ) {
    return clamp((colorIn * (2.51 * colorIn + 0.03)) / (colorIn * (2.43 * colorIn + 0.59 ) + 0.14), 0.0, 1.0);
}




vec3 sampleEnvironment( const vec3 normal, const float roughness ) {
//	vec4 d = vec4(normal, 1.0) * envMatrix;
	vec3 rval = pow(textureLod( reflection, normal.xy*0.5*refmap_scale + vec2(0.5), pow(roughness, 0.25)*maxmmlevel ).rgb, vec3(refmap_pow)) * refmap_mul;
	vec3 gray = vec3(dot(rval, vec3(0.33333)));
	return (gray + (rval-gray) * refmap_saturation );
}


vec3 EnvBRDFApprox(vec3 SpecularColor, float Roughness, float NoV)
{
    vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = Roughness * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    vec2 AB = vec2(-1.04, 1.0) * a004 + vec2(r.z, r.w);
    return SpecularColor * AB.x + AB.y;
}


void main()
{
	vec3 normal = calculateNormal(uv);
	normal = normalize( vec3(normal.xy * normalPower, -normal.z) );			// better way to scale normal?
	vec3 view = normalize(toView);
	
	//vec3 refract = normalize( refract(view, -normal, ior ) );
	vec3 refract = refract(view, -normal, ior );
	
	
	
	float specMetallic = 0.04 + metalness * 0.96;
	F0 = vec3(abs((1.0 - ior) / (1.0 + ior)));
	F0 = mix(F0, baseColor, metalness);
	

	for (int f=0; f<nofLights; f++) 
		processLight( lights[f], normal, view );
	
       	
      
	diffuseRadiance += sampleEnvironment(normal, 1.0);
	specularRadiance += EnvBRDFApprox( sampleEnvironment(normalize(reflect(view, normal)), roughness), roughness, dot(normal, -view));
	


	       // REFRACTED LIGHT
	for (int f=0; f<nofLights; f++) 
		processRefractedLight( lights[f], -normal, refract );


	
	// refracted floor
	//uniform vec4 floorAttr;				// x = distancetofloor, y=pow, z=mul, w=scale
	float absorb_mul = exp(-(absorb_strength*floorAttr.x)/abs(refract.z));

	diffuseRadiance += mix( emissiveColor, pow( texture( floor, vec2(0.5) + refract.xy * floorAttr.w * floorAttr.x ).rgb, vec3(floorAttr.y)) * floorAttr.z, absorb_mul);
	

	vec3 light = diffuseRadiance * baseColor + specularRadiance * specMetallic;

       	

       	


       	float noiseValue = texture( noise, fract( (randomVec + uv) * targetResolution / vec2(256.0))).r;


        fragColor = vec4( pow(mapColorToScreen(light*final_mul), vec3(final_gamma)) + noiseValue/256.0, 1.0);
	//fragColor = vec4(noiseValue, noiseValue, noiseValue, 1.0);
	
	//fragColor = vec4( vec3(0.5) + normal.xyz*0.5, 1.0 );
        
        //fragColor = vec4( mapColorToScreen(sampleWorldEnvironment(normal, view, roughness)), 1.0);
}
