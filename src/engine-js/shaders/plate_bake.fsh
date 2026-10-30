#version 300 es
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// One polygon plate mode, baked into a texture spanning plateUv −1..1
// (plate-bake.js). The JS reference is evalPolygonMode in plate-modes.js,
// whose header defines every term here:
//
//   u = gain · ( Σᵢ cᵢ·Tₙᵢ(k r)·trig(nᵢθ′)·σ(nᵢ)  +  Σₜ dₜ·Cₜ )
//
// Outside the outline the series' continuation is kept for a few texels, so
// the field pass's linear filtering of the edge texels sees no step; beyond
// that the texel is 0, which is what evalPolygonMode says and what nothing
// samples.
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 uv;
out vec4 fragColor;

uniform sampler2D coeffTable;   // RG32F: row = stored mode, texel i = (nᵢ, cᵢ)
uniform sampler2D cornerTable;  // RGBA32F: row = stored mode, texel t = (m, kind, dₜ, 0)
uniform sampler2D besselTable;  // R32F: Tₙ over [0, besselXMax], row n, peak 1
uniform sampler2D cornerBessel; // R32F: raw J_μ, cornerSamples per order, wrapped

uniform int sides;
uniform int row;          // the stored mode
uniform int classJ;       // its symmetry class
uniform int partner;      // 1: the derived sin partner (mix 1)
uniform int sinMode;      // 1: sin(nθ′), else cos(nθ′)
uniform int nTerms;
uniform int nCorners;
uniform int cornerSamples;
uniform float k;
uniform float gain;
uniform float besselXMax;
uniform float cornerXMax;
uniform vec4 cornerFrame;   // vertex 0 (x, y), inward bisector b̂ (x, y)
uniform vec3 cornerFrame2;  // ŵ (x, y), half the interior angle
uniform vec4 cornerMu;      // the corner orders μ, 0 past the shape's last
uniform float polyOffset;
uniform float margin;

const float PI = 3.14159265358979;
// Mirrored in plate-bake.js (MAX_TERMS, MAX_CORNERS), whose
// checkBakeBounds holds the shipped data to them.
const int MAX_TERMS = 128;
const int MAX_CORNERS = 8;

// Both tables are read with texelFetch and interpolated here: float
// textures are not filterable everywhere.
float besselT(int n, float x)
{
    int w = textureSize(besselTable, 0).x;
    float f = clamp(x / besselXMax, 0.0, 1.0) * float(w - 1);
    int i = int(floor(f));
    int j = min(i + 1, w - 1);
    return mix(texelFetch(besselTable, ivec2(i, n), 0).r,
               texelFetch(besselTable, ivec2(j, n), 0).r, f - float(i));
}

// cornerTableLookup (plate-corners.js).
float cornerJ(int m, float x)
{
    int w = textureSize(cornerBessel, 0).x;
    float f = clamp(x / cornerXMax, 0.0, 1.0) * float(cornerSamples - 1);
    int i = min(int(floor(f)), cornerSamples - 2);
    int s0 = m * cornerSamples + i;
    int s1 = s0 + 1;
    float a = texelFetch(cornerBessel, ivec2(s0 % w, s0 / w), 0).r;
    float b = texelFetch(cornerBessel, ivec2(s1 % w, s1 / w), 0).r;
    return mix(a, b, f - float(i));
}

// cornerWeight (plate-corners.js), with c = cos(j·d), s = sin(j·d).
float cornerWeight(int kind, float c, float s, int h)
{
    if (kind == 0) return c;
    if (kind == 1) return h == 1 ? -c : c;
    if (kind == 2) return partner == 1 ? -s : c;
    return (h == 1 ? -1.0 : 1.0) * (partner == 1 ? c : s);
}

void main()
{
    vec2 p = uv * 2.0 - 1.0;
    float r = length(p);
    float tp = atan(p.x, p.y); // θ′, from +y towards +x

    // insidePolygon, widened by `margin`.
    float n = float(sides);
    float w = 2.0 * PI / n;
    float phi = tp - polyOffset - PI / n;
    phi -= w * floor((phi + PI / n) / w);
    if (r * cos(phi) > cos(PI / n) + margin) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float u = 0.0;
    float x = k * r;
    for (int i = 0; i < MAX_TERMS; i++) {
        if (i >= nTerms) break;
        vec2 nc = texelFetch(coeffTable, ivec2(i, row), 0).rg;
        int order = int(nc.x + 0.5);
        float a = float(order) * tp;
        float trig = sinMode == 1 ? sin(a) : cos(a);
        // partnerSign: +1 if n ≡ j (mod N), else −1.
        float sgn = (partner == 1 && order % sides != classJ) ? -1.0 : 1.0;
        u += nc.y * besselT(order, x) * trig * sgn;
    }

    if (nCorners > 0) {
        int cm[MAX_CORNERS];
        int ck[MAX_CORNERS];
        float cd[MAX_CORNERS];
        for (int t = 0; t < MAX_CORNERS; t++) {
            if (t >= nCorners) break;
            vec4 e = texelFetch(cornerTable, ivec2(t, row), 0);
            cm[t] = int(e.x + 0.5);
            ck[t] = int(e.y + 0.5);
            cd[t] = e.z;
        }
        // Every image of p under the plate's symmetries, about vertex 0.
        for (int q = 0; q < 8; q++) {
            if (q >= sides) break;
            float d = w * float(q);
            float cq = cos(d), sq = sin(d);
            float c = cos(float(classJ) * d), s = sin(float(classJ) * d);
            float qx = p.x * cq + p.y * sq;
            float qy = -p.x * sq + p.y * cq;
            for (int h = 0; h < 2; h++) {
                float dx = (h == 1 ? -qx : qx) - cornerFrame.x;
                float dy = qy - cornerFrame.y;
                float bu = dx * cornerFrame.z + dy * cornerFrame.w;
                float bs = dx * cornerFrame2.x + dy * cornerFrame2.y;
                float rr = length(vec2(bu, bs));
                if (rr < 1e-7) continue; // J_μ(0) = 0
                float ph = atan(bs, bu) + cornerFrame2.z;
                float z = k * rr;
                float psi[4];
                for (int m = 0; m < 4; m++) {
                    psi[m] = cornerMu[m] > 0.0 ? cornerJ(m, z) * cos(cornerMu[m] * ph) : 0.0;
                }
                for (int t = 0; t < MAX_CORNERS; t++) {
                    if (t >= nCorners) break;
                    u += cd[t] * cornerWeight(ck[t], c, s, h) * psi[cm[t]];
                }
            }
        }
    }

    fragColor = vec4(u * gain, 0.0, 0.0, 1.0);
}
