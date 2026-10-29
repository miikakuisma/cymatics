// The curated looks. Each is complete for the render-path flags, and the
// element lays engine defaults under it, so switching looks never inherits a
// key from the previous one.
//
// water: the factory Default preset (src/default-presets.js), reduced to keys
// the engine reads. mercury, lines and glow start from engine-test.html's
// settings for their render paths.
//
// Each look is a preset like any the studio saves: its modulators are the
// studio's saved keys (dynamicFreqDetail…, dynamicLineColor…), run by
// presetModulators in modulate.js, as a preset of your own is.

const FIELD = {
	audio_lowpass: 0.4,
	audio_amplify_mul: 1.01,
	wave_distance_scale: 0.16,
	wave_distance_scale_finetune: 0,
	view_scale: 0.1,
	wave_center: [0, 0, 0],
	wave_levels: [1, 0.92, 0.846, 0.779, 0.717, 0.659, 0.607],
	poles: [
		[1, 0, 0], [0.283, 0.283, 0], [0, 1, 0], [-0.283, 0.283, 0],
		[-1, 0, 0], [-0.283, -0.283, 0], [0, -1, 0], [0.283, -0.283, 0],
		[0.707, 0.707, 0], [0, 0.4, 0], [-0.707, 0.707, 0], [-0.4, 0, 0],
		[-0.707, -0.707, 0], [0, -0.4, 0], [0.707, -0.707, 0], [0.4, 0, 0],
	],
	sim_scale: 0.1,
	faraday_threshold: 0.5,
	freq_response_speed: 1,
	// 0.75, not the factory 0.5: at freq_response_speed 1 a neutral release halves
	// the field on any frame the level dips, which strobes on music and makes the
	// idle swell flicker. CLAUDE.md: "Raising Release is what stops the picture
	// strobing on fast material."
	freq_release: 0.75,
	freq_detail_scale: 4.959423425837267,
	contour_mode: 1,
	contour_count: 18,
	// The factory Default's dynamicFreqDetail, as the studio saves it.
	dynamicFreqDetail: true,
	dynamicFreqDetailBand: 'band7',
	dynamicFreqDetailTrigger: 0.3,
	dynamicFreqDetailSpeed: 0.02,
	dynamicFreqDetailMin: 2,
	dynamicFreqDetailMax: 5,
}

// The factory Default's dynamicLineColor, as the studio saves it.
const LINE_COLOR = {
	dynamicLineColor: true,
	dynamicLineColorBand: 'band4',
	dynamicLineColorTrigger: 0.75,
	dynamicLineColorSpeed: 0.8,
	dynamicLineColorMin: '#0080ff',
	dynamicLineColorMax: '#ff6600',
}

const LIQUID = {
	pressure_iterations: 4,
	wave_pressure_on_liquid: 0.01,
	speed_mul: 1.1,
	velocity_slowdown: 0.1,
	liquidity_slowdown: 0.01,
	pressure_leak: 0,
}

const TWO_LIGHTS = [
	{ pos: [4.5, 6.2, 6.4], color: [1.0, 0.96, 0.88], roughness: 0.01 },
	{ pos: [-6.6, -4.2, 6.2], color: [0.55, 0.72, 1.0], roughness: 0.01 },
]

const DATA = [
	{
		id: 'water',
		name: 'Water',
		renderer: {
			light_dir: [0, 0, -1], ior: 0.05, view_z: 0.5, normal_power: 0.5, useRefractedAmount: 1,
			refmap_pow: 0.3, refmap_mul: 0.43, refmap_scale: 0.5, refmap_saturation: 0.32,
			roughness: 0, metalness: 0.01, final_gamma: 0.5, final_mul: 0.18367347121238708,
			absorb_strength: 0, refraction: { pow: 0.35, mul: 0.3, scale: 0.5, distance: 5 },
			normalLevels: [[4, 0.5], [1, 0.25]],
			lights: [{ color: [1, 1, 1], pos: [0, 0, 49], roughness: 0.01 }],
			base_color: [0, 0, 0], emissive_color: [0, 0, 0], emissive_mode: true,
			color_inner: [0, 0, 0], color_outer: [0.20221187221951575, 0.4813431032246768, 0.7977881277804842],
			emissive_strength: 2.45, trail_amount: 0, liquid_mode: true, liquid_material: 1,
			viscosity: 0.5, ripple_depth: 1.8, surface_polish: 0, water_depth: 0.64, caustic_strength: 0.3,
			...LINE_COLOR,
		},
		cymatics: FIELD,
		liquid: LIQUID,
	},
	{
		id: 'mercury',
		name: 'Mercury',
		renderer: {
			emissive_mode: false, liquid_mode: true, liquid_material: 0,
			color_outer: [0.95, 0.96, 1.0], color_inner: [0.05, 0.06, 0.09],
			lights: TWO_LIGHTS, viscosity: 0.5, ripple_depth: 1.8, surface_polish: 0,
		},
		cymatics: { ...FIELD, contour_mode: 0 },
		liquid: LIQUID,
	},
	{
		id: 'lines',
		name: 'Lines',
		renderer: {
			emissive_mode: true, liquid_mode: false,
			color_inner: [0, 0, 0], color_outer: [0.2, 0.48, 0.8], emissive_strength: 2.45,
			...LINE_COLOR,
		},
		cymatics: { ...FIELD, contour_mode: 1, contour_count: 12 },
		liquid: LIQUID,
	},
	{
		id: 'glow',
		name: 'Glow',
		renderer: {
			emissive_mode: true, liquid_mode: false,
			color_inner: [0.02, 0, 0.05], color_outer: [0.78, 0.3, 1.0], emissive_strength: 1.6,
		},
		cymatics: { ...FIELD, contour_mode: 0 },
		liquid: LIQUID,
	},
]

export const DEFAULT_LOOK = 'water'
export const LOOKS = DATA.map(({ id, name }) => ({ id, name }))

export function lookPreset(id) {
	const found = DATA.find((look) => look.id === id) || DATA[0]
	return structuredClone(found)
}
