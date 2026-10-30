// Everything the editor can change, taken when Adjust opens and put back on
// Cancel: the preset on the plate (modulators included), the EQ and Input
// Sensitivity. Neither of the last two lives in a preset.

import { currentPreset } from '../components/cymatics-presets.js'

export function captureStudio() {
	return {
		preset: structuredClone(currentPreset()),
		eq: [...(s('p-equalizer')?.gains ?? [])],
		inputSensitivity: s('p-audio')?.inputGain ?? 1,
	}
}

// Leaves cymatics-presets' current preset alone: Cancel returns to it.
export function restoreStudio(snapshot) {
	s('p-cymatics').loadConfig(structuredClone(snapshot.preset))
	s('p-equalizer')?.setGains(snapshot.eq)
	s('p-audio')?.setInputGain(snapshot.inputSensitivity)
	const slider = s('input[name="input_sensitivity"]')
	if (slider) slider.value = snapshot.inputSensitivity * 100
}
