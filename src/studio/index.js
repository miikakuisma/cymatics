// The studio as one module, for pages that host it (the desktop's Cymatics
// app): npm run build:studio → dist-studio/cymatics-studio.js + style.css.
export { mountStudio } from './mount.js'
export { parsePresetFile, presetFile } from '../preset.js'
export { LOOKS } from '../element/looks.js'
