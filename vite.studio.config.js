// The studio as one ES module plus one stylesheet, for pages that are not this
// app: `npm run build:studio` → dist-studio/cymatics-studio.js and style.css.
// Library mode inlines the assets, as the element build does.
import base from './vite.config.js'

// Bundles travel without the repo, so they carry their licence with them.
const banner = '/*! Cymatics | Copyright 2026 Miika Kuisma; engine ported from glbase, Copyright 2021-2022 Tuomo Hirvonen | PolyForm-Noncommercial-1.0.0 | https://github.com/miikakuisma/cymatics */'

export default {
	plugins: base.plugins,
	publicDir: false,
	build: {
		outDir: 'dist-studio',
		emptyOutDir: true,
		sourcemap: false,
		minify: 'esbuild',
		cssCodeSplit: false,
		// One file: the engine is imported dynamically by the canvas component.
		rollupOptions: { output: { inlineDynamicImports: true, banner } },
		lib: {
			entry: 'src/studio/index.js',
			formats: ['es'],
			fileName: () => 'cymatics-studio.js',
		},
	},
}
