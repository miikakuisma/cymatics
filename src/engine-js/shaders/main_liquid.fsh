#version 300 es
// Cymatics engine.
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision highp float;
precision mediump int;

in vec2 uv;
out vec4 fragColor;

// Wave height field, 0.5 = flat. Either the raw cymatics texture or, when
// viscosity is up, the accumulation buffer that has been sloshing it around.
uniform highp sampler2D field;

uniform vec2 resolution;      // canvas size, for aspect correction
uniform float fieldTexel;     // 1.0 / cymatics size — the gradient step
uniform float rippleDepth;    // slope multiplier: flat sheet .. deep swell
uniform float polish;         // 0 = mirror, 1 = brushed
uniform float material;       // 0 = mercury, 1 = water
uniform float waterDepth;     // water only: refraction offset + absorption
uniform float causticStrength; // water only: 0 = off

uniform sampler2D floorTex;   // water only: user pool-floor image
uniform float hasFloorImage;  // 0 = fall back to the procedural tiles
uniform float floorAspect;    // that image's width / height
uniform vec3 tintColor;       // colorOuter — metal F0, or the water's body
uniform vec3 envTint;         // colorInner — ambient tint, or the pool floor
uniform float exposure;       // emissiveStrength

#define MAX_LIQUID_LIGHTS 8
uniform int lightCount;
uniform vec3 lightDir[MAX_LIQUID_LIGHTS];     // normalised, always above the pool
uniform vec3 lightColor[MAX_LIQUID_LIGHTS];

// The gradient taps scale their first derivative by 40. Curvature is a second
// derivative over a 2-texel span, so bringing it into the same 0..1 working
// range takes roughly the square of that — without it the term rounds to zero
// and both the occlusion and the caustics are silently inert.
#define CURV_SCALE 2400.0

float height(vec2 p) { return texture(field, p).r; }

// Two gradient scales: a wide tap for the large swell, a tight one for the
// capillary detail riding on top. Summed, they read as a surface with body
// rather than as a bumpy plane. Returned as the raw gradient rather than a
// normal because the caustics need its magnitude as well.
vec2 surfaceGradient(vec2 p) {
    float e = fieldTexel;

    float hl = height(p - vec2(e, 0.0));
    float hr = height(p + vec2(e, 0.0));
    float hd = height(p - vec2(0.0, e));
    float hu = height(p + vec2(0.0, e));

    float wl = height(p - vec2(e * 4.0, 0.0));
    float wr = height(p + vec2(e * 4.0, 0.0));
    float wd = height(p - vec2(0.0, e * 4.0));
    float wu = height(p + vec2(0.0, e * 4.0));

    vec2 fine  = vec2(hr - hl, hu - hd);
    vec2 broad = vec2(wr - wl, wu - wd) * 0.35;

    // 40.0 turns the per-texel delta into a workable slope at rippleDepth = 1.
    return (fine + broad) * rippleDepth * 40.0;
}

// Local curvature — negative where the surface bulges toward the viewer,
// positive in the pits. Mercury uses it as cheap ambient occlusion; water uses
// the same term for caustics, since a converging surface is exactly what
// focuses light onto the floor.
float curvature(vec2 p) {
    float e = fieldTexel * 2.0;
    float hc = height(p);
    float s = height(p - vec2(e, 0.0)) + height(p + vec2(e, 0.0))
            + height(p - vec2(0.0, e)) + height(p + vec2(0.0, e));
    return s - 4.0 * hc;
}

// A studio, procedurally. A liquid surface is mostly what it reflects, so this
// is the shader's actual subject — there is no environment texture to sample.
vec3 environment(vec3 r) {
    float sharp = mix(1.0, 0.12, polish);

    // The camera looks straight down into the pool, so r.z ~ 1 is the ceiling
    // directly overhead and r.z ~ 0 grazes out toward the walls. Shading along
    // that axis keeps the room radial around the viewer. Shading along r.y
    // instead — an ordinary horizon — maps to a dead-straight line across the
    // middle of the frame that no amount of ripple hides.
    float up = clamp(r.z, 0.0, 1.0);
    vec3 col = mix(vec3(0.20, 0.24, 0.33), vec3(0.045, 0.055, 0.085),
                   smoothstep(0.0, 0.88, up));

    // Softbox strip. Its normal is tilted well off vertical, so still water
    // never sits inside the band: the streak appears only where a ripple has
    // turned the surface toward the light. That is what draws the wave edges.
    vec3 stripNormal = normalize(vec3(-0.42, 0.70, 0.58));
    float width = 5.5 * sharp + 1.1;
    col += vec3(0.95, 0.97, 1.0) * exp(-pow(dot(r, stripNormal) * width, 2.0)) * 0.85;

    // The user's lights, off the XY pad. A tight core for the specular spark
    // plus a broad lobe so a light still reads as a light when it is nowhere
    // near the mirror direction.
    for (int i = 0; i < lightCount; i++) {
        float d = max(dot(r, lightDir[i]), 0.0);
        col += lightColor[i] * pow(d, mix(24.0, 220.0, sharp)) * 2.6;
        col += lightColor[i] * pow(d, 5.0) * 0.22;
    }

    return col;
}

// The pool bottom: the user's image if there is one, else a procedural tile
// grid. (The renderer now always supplies an image — a 1x1 black one for an
// empty floor — so the tiles below are no longer reached.) Deliberately patterned either way — refraction through a flat colour is
// invisible, so without something to bend there is no visual difference between
// shallow water and deep. A smooth or low-contrast image will read flat for
// exactly that reason.
vec3 poolFloor(vec2 p) {
    if (hasFloorImage > 0.5) {
        // Cover fit: shrink the sampled range on whichever axis is proportionally
        // longer, so the image fills the frame by cropping rather than stretching.
        // hasFloorImage is a uniform, so this branch is uniform across the draw
        // and the implicit mip derivatives inside it stay well defined.
        float frameAspect = resolution.x / max(resolution.y, 1.0);
        vec2 q = p - 0.5;
        if (floorAspect > frameAspect) q.x *= frameAspect / max(floorAspect, 0.001);
        else                           q.y *= max(floorAspect, 0.001) / frameAspect;
        // Brought down to a floor's worth of brightness and tinted by the
        // background colour, so that control still grades the pool with an image
        // loaded. Raw, the image competes with the caustics and blows out.
        // v is flipped: createTextureFromImage uploads with UNPACK_FLIP_Y_WEBGL
        // off, so texture v=0 is the image's top row rather than its bottom, and
        // the floor would otherwise appear upside down.
        vec2 fuv = q + 0.5;
        fuv.y = 1.0 - fuv.y;
        return texture(floorTex, fuv).rgb * (vec3(0.35) + envTint * 1.5);
    }

    vec2 t = p * 16.0;
    vec2 g = abs(fract(t) - 0.5);
    float grout = smoothstep(0.38, 0.5, max(g.x, g.y));
    float pattern = mix(1.0, 0.58, grout);

    // Blended toward a fixed slate so the floor never crushes to pure black
    // when the background colour is dark, which is the app's usual setting.
    vec3 base = mix(vec3(0.13, 0.21, 0.25), envTint * 2.0, 0.6);
    return base * pattern;
}

vec3 fresnelSchlick(vec3 f0, float cosT) {
    return f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0);
}

void main() {
    vec2 grad = surfaceGradient(uv);
    vec3 n = normalize(vec3(-grad, 1.0));

    // View ray. The surface is a screen-filling plane, so spreading the ray
    // across the frame is what gives fresnel somewhere to vary — without it the
    // whole thing shades flat, like foil rather than a pool.
    vec2 ndc = (uv - 0.5) * 2.0;
    ndc.x *= resolution.x / max(resolution.y, 1.0);
    vec3 v = normalize(vec3(-ndc * 0.55, 1.0));

    // Bias the normal outward from the centre, as if the pool were a shallow
    // dome rather than an infinite plane. Without it the flat regions all
    // reflect the same direction, which draws a dead-straight line across the
    // frame with a pinch at the exact centre — unmistakably a shader.
    n = normalize(n + vec3(ndc * 0.28, 0.0));

    vec3 r = reflect(-v, n);
    float ndotv = max(dot(n, v), 0.0);
    float curv = curvature(uv);

    vec3 col;

    if (material > 0.5) {
        // --- Water -------------------------------------------------------
        // Low F0 and a transmission term. Most of what you see is the floor;
        // the surface only turns mirror at grazing angles, which is what
        // fresnel does on its own here.
        vec3 refr = refract(-v, n, 1.0 / 1.333);
        vec3 refrFlat = refract(-v, vec3(0.0, 0.0, 1.0), 1.0 / 1.333);

        // Only the ripple's share of the bend. The rest is a fixed shift of the
        // whole floor, which slides it sideways and reads as nothing.
        //
        // Kept to a few percent of the frame, which is what refraction through
        // shallow water actually does. A repeating tile pattern hides a much
        // larger displacement — it just slides within a period — but a fitted
        // image does not, and an over-scaled warp shreds it past recognition.
        vec2 warp = (refr.xy - refrFlat.xy) * (0.02 + waterDepth * 0.13);
        vec3 bottom = poolFloor(uv + warp);

        // Caustics: bright where the surface converges and focuses light.
        // smoothstep rather than pow — real caustics have a crisp edge, and a
        // threshold keeps that edge put regardless of how hard the audio is
        // driving the field, where an exponent just dims the whole term.
        // Caustics have to hold across the whole range of field detail the app
        // can produce — freq_detail_scale alone spans 0.1 to 10, and curvature
        // grows with the square of spatial frequency. A raw curvature threshold
        // tuned for a broad swell is an order of magnitude too hot on a finely
        // detailed one, and lights the entire frame.
        //
        // Dividing by the local slope removes most of that: for a wave of
        // amplitude A and wavenumber k the gradient goes as A*k and the
        // curvature as A*k^2, so the ratio drops from quadratic in k to linear,
        // and loses the amplitude dependence entirely. The epsilon keeps flat
        // water — where both terms vanish together — from dividing out to noise.
        // What is left is scene-dependent enough to be worth a control.
        float focus = max(-curv * CURV_SCALE * rippleDepth / (length(grad) + 0.35), 0.0);
        float caustic = focus / (1.0 + focus);
        bottom += vec3(0.75, 0.92, 1.0) * pow(caustic, 4.0) * causticStrength;

        // Beer-Lambert: the body colour is what survives the trip down and
        // back, so absorption attenuates its complement.
        vec3 body = clamp(tintColor, vec3(0.0), vec3(1.0));
        vec3 absorb = exp(-(vec3(1.0) - body) * waterDepth * 3.2);
        vec3 transmitted = bottom * absorb;

        float f = 0.02 + 0.98 * pow(1.0 - ndotv, 5.0);
        col = mix(transmitted, environment(r), f);

        // Sun glitter. Looking straight down, fresnel sits at ~2% across the
        // whole frame, so the reflection alone is invisible — but a real sun is
        // orders of magnitude brighter than the sky around it, and its glint off
        // a tilted ripple is the single most recognisable thing about water.
        // environment() cannot carry that dynamic range, so the lights get an
        // explicit lobe here.
        for (int i = 0; i < lightCount; i++) {
            col += lightColor[i] * pow(max(dot(r, lightDir[i]), 0.0), 400.0) * 5.0;
        }
    } else {
        // --- Mercury -----------------------------------------------------
        // Metal: no diffuse lobe at all, the tint IS the reflectance. Real
        // metals sit at F0 0.5..0.95, so the colour is renormalised into that
        // range — hue is the user's, brightness is the material's. A dark tint
        // would otherwise shade like dark plastic rather than like metal.
        vec3 t = max(tintColor, vec3(0.001));
        vec3 f0 = t / max(max(t.r, t.g), t.b) * 0.92;
        vec3 spec = environment(r) * fresnelSchlick(f0, ndotv);

        // Pits darken, crests lift slightly. Bounded the same way, so a loud
        // passage deepens the shading rather than crushing it to the clamp.
        float shade = curv * CURV_SCALE * 0.4 * rippleDepth;
        float ao = 1.0 - shade / (1.0 + abs(shade)) * 0.55;
        col = spec * ao;

        // Ambient fill tinted by the background colour, so flat regions settle
        // into the chosen backdrop instead of crushing to black.
        col += envTint * (0.10 + 0.25 * (1.0 - ndotv));
    }

    col *= exposure;

    // Soft tonemap, same shape as the emissive path — highlights bloom but
    // never clip to a flat white.
    col = col / (vec3(1.0) + col * 0.35);

    // The environment is one big smooth gradient, which bands badly in 8 bits.
    float dither = fract(sin(dot(uv * resolution, vec2(12.9898, 78.233))) * 43758.5453);
    col += (dither - 0.5) / 255.0;

    fragColor = vec4(col, 1.0);
}
