// <cymatics-view>, as one module. Importing it registers the element.
import { CymaticsView } from './cymatics-view.js'

export { CymaticsView }
export { LOOKS, DEFAULT_LOOK, lookPreset } from './looks.js'
export { presetModulators } from './modulate.js'
export { parsePresetFile, presetFile } from '../preset.js'
export { createSpectrumTap } from './tap.js'
export { BINS, FFT_SIZE } from './scale.js'

if (!customElements.get('cymatics-view')) customElements.define('cymatics-view', CymaticsView)
