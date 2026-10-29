#version 300 es
// Cymatics engine: ported from glbase, the C++ engine by Tuomo Hirvonen.
// Copyright 2021-2022 Tuomo Hirvonen
// Copyright 2026 Miika Kuisma
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
precision mediump int;
precision highp float;

in vec3 worldPos;
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

void main()
{
    float wave = 0.0;
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

    // Contour mode: render only thin lines
    if (contourMode > 0.5) {
        float scaled = wave * contourCount;
        float fw = fwidth(scaled);
        float line = 1.0 - smoothstep(0.0, fw * 1.5, abs(fract(scaled + 0.5) - 0.5));
        wave = line * 0.5;
    }

    // Suppress output when no effective audio energy (accounting for faraday
    // threshold). Without this, contour mode lights up the zero-crossing.
    float effectiveAmp = 0.0;
    for (int b = 0; b < 4; b++) {
        float a = bandAmp[b];
        if (faradayThreshold > 0.0) a = max(a - faradayThreshold, 0.0);
        effectiveAmp += a;
    }
    if (effectiveAmp < 0.001) wave = 0.0;

    // Map to [0, 1]
    fragColor = vec4(clamp(vec3(0.5) + vec3(wave * 0.5), 0.0, 1.0), 1.0);
}
