#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision mediump int;
precision highp float;

in vec3 worldPos;
in vec2 plateUv;
out highp vec4 fragColor;

uniform highp int poleCount;
uniform vec3 poles[16];
uniform vec3 mainPos;

// 4 frequency bands: sub-bass, bass, mid, high
uniform float bandAmp[4];   // normalised linear amplitude [0, 1]
uniform float bandK[4];     // wavenumber in world-space (rad / world-unit)

// Faraday threshold: amplitudes at or below this are suppressed (0 = disabled)
uniform float faradayThreshold;

// Time in seconds for wave propagation
uniform float uTime;
uniform float contourMode;
uniform float contourCount;

// Plate modes (field_mode 1 square, 2 round, 3–5 triangle, pentagon,
// hexagon). See modes.js and plate-modes.js.
// modeParams[i] = (a, b, omega, mix): square a = m, b = n, mix = ±1 or 0;
// round a = n, b = alpha; polygon a = stored mode, b = k, mix 0 or 1.
// modeAmp arrives already thresholded and sharpened by pickModes().
const int MAX_MODES = 4;
uniform int fieldMode;
uniform int modeCount;
uniform vec4 modeParams[MAX_MODES];
uniform float modeAmp[MAX_MODES];
// J_n(x) over [0, besselXMax], one row per n, each row scaled to peak 1.
uniform highp sampler2D besselTable;
uniform float besselXMax;
// Polygons: each picked mode's figure, baked across plateUv −1..1
// (plate-bake.js). Always bound, to a placeholder when unused.
uniform highp sampler2D plateMode0;
uniform highp sampler2D plateMode1;
uniform highp sampler2D plateMode2;
uniform highp sampler2D plateMode3;
uniform int polySides;
uniform float polyOffset;

const float PI = 3.14159265358979;

float besselJ(int n, float x)
{
    int w = textureSize(besselTable, 0).x;
    float u = clamp(x / besselXMax, 0.0, 1.0) * float(w - 1);
    int i = int(floor(u));
    int j = min(i + 1, w - 1);
    return mix(texelFetch(besselTable, ivec2(i, n), 0).r,
               texelFetch(besselTable, ivec2(j, n), 0).r, u - float(i));
}

// Explicit LOD: the polygon's outline test returns early, so these are not
// in uniform control flow, and the figures have no mipmaps anyway.
float plateMode(int i, vec2 xy)
{
    if (i == 0) return textureLod(plateMode0, xy, 0.0).r;
    if (i == 1) return textureLod(plateMode1, xy, 0.0).r;
    if (i == 2) return textureLod(plateMode2, xy, 0.0).r;
    return textureLod(plateMode3, xy, 0.0).r;
}

// insidePolygon (polygons.js): θ′ = atan(x, y) reduced to the nearest edge's
// sector, then the distance along its normal against the apothem.
bool outsidePolygon(vec2 p)
{
    float n = float(polySides);
    float w = 2.0 * PI / n;
    float phi = atan(p.x, p.y) - polyOffset - PI / n;
    phi -= w * floor((phi + PI / n) / w);
    return length(p) * cos(phi) > cos(PI / n) + 1e-6;
}

// A standing wave: the shape is fixed and only breathes. Its nodal lines never
// move, which is what makes a Chladni figure, and it never flattens to nothing
// the way a full cos(wt) would, which on screen reads as a blink.
float plateField(out bool outside)
{
    outside = false;
    float wave = 0.0;
    float r = length(plateUv);
    if ((fieldMode == 2 && r > 1.0) || (fieldMode >= 3 && outsidePolygon(plateUv))) {
        outside = true;
        return 0.0;
    }
    float theta = atan(plateUv.y, plateUv.x);
    vec2 xy = plateUv * 0.5 + 0.5;

    for (int i = 0; i < MAX_MODES; i++) {
        if (i >= modeCount) break;
        vec4 m = modeParams[i];
        float shape;
        if (fieldMode == 1) {
            float a = cos(m.y * PI * xy.x) * cos(m.x * PI * xy.y);
            float b = cos(m.x * PI * xy.x) * cos(m.y * PI * xy.y);
            // mix is 0 when m == n: not degenerate, nothing to superpose.
            shape = (a + m.w * b) / (1.0 + abs(m.w));
        } else if (fieldMode == 2) {
            int n = int(m.x + 0.5);
            shape = besselJ(n, m.y * r) * cos(float(n) * theta);
        } else {
            shape = plateMode(i, xy);
        }
        wave += modeAmp[i] * shape * (0.75 + 0.25 * cos(m.z * uTime));
    }
    return wave;
}

void main()
{
    bool outside = false;
    float wave = 0.0;
    if (fieldMode != 0) {
        wave = plateField(outside);
    } else {
        float normFactor = float(poleCount) + 1.0;

        // Angular frequencies for each band — controls propagation speed
        // Higher bands propagate faster, matching real water wave dispersion
        float omega[4];
        omega[0] = 1.0;    // sub-bass: slow, large patterns
        omega[1] = 2.5;    // bass
        omega[2] = 5.0;    // mid
        omega[3] = 9.0;    // high: fast, fine patterns

        for (int b = 0; b < 4; b++) {
            float amp = bandAmp[b];
            float k   = bandK[b];
            float w   = omega[b];

            // Faraday-instability gate: snap-on behaviour below threshold
            if (faradayThreshold > 0.0) {
                if (amp <= faradayThreshold) {
                    amp = 0.0;
                } else {
                    amp = amp - faradayThreshold;
                }
            }

            if (amp > 0.0 && k > 0.0) {
                float phase = w * uTime;

                // Central reference point — outward-propagating wave
                vec3 dc = worldPos - mainPos;
                wave += amp * cos(k * length(dc) - phase);

                // Pole contributions — each source radiates outward
                for (int p = 0; p < poleCount; p++) {
                    vec3 dp = worldPos - poles[p];
                    wave += amp * cos(k * length(dp) - phase);
                }
            }
        }

        // Normalise by number of sources
        wave /= normFactor;
    }

    // Contour mode: render only thin lines
    if (contourMode > 0.5 && fieldMode != 0) {
        // A plate draws only its nodal lines, where the sand would gather:
        // that is the Chladni figure. The other contours are height levels a
        // real plate never shows. Two to three pixels wide, whatever the slope.
        float fw = max(fwidth(wave), 1e-6);
        float line = 1.0 - smoothstep(fw * 1.0, fw * 2.5, abs(wave));
        wave = line * 0.5;
    } else if (contourMode > 0.5) {
        float scaled = wave * contourCount;
        float fw = fwidth(scaled);
        float line = 1.0 - smoothstep(0.0, fw * 1.5, abs(fract(scaled + 0.5) - 0.5));
        wave = line * 0.5;
    }

    // Suppress output when no effective audio energy (accounting for faraday
    // threshold). Without this, contour mode lights up the zero-crossing.
    float effectiveAmp = 0.0;
    if (fieldMode != 0) {
        for (int i = 0; i < MAX_MODES; i++) if (i < modeCount) effectiveAmp += modeAmp[i];
    } else {
        for (int b = 0; b < 4; b++) {
            float a = bandAmp[b];
            if (faradayThreshold > 0.0) a = max(a - faradayThreshold, 0.0);
            effectiveAmp += a;
        }
    }
    // Off the round or polygon plate there is nothing to draw, contour line or otherwise.
    if (effectiveAmp < 0.001 || outside) wave = 0.0;

    // Map to [0, 1]
    fragColor = vec4(clamp(vec3(0.5) + vec3(wave * 0.5), 0.0, 1.0), 1.0);
}
