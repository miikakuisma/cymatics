// <cymatics-view> as one ES module, for pages that are not this app:
// `npm run build:element` → dist-element/cymatics-view.js. Library mode inlines
// every asset (the blue-noise PNG becomes a data URL) and the shaders are
// already strings, so the file has no imports and nothing to serve beside it.
import base from './vite.config.js'

// Bundles travel without the repo, so they carry their licence with them.
const banner = '/*! Cymatics | Copyright 2026 Miika Kuisma; engine ported from glbase, Copyright 2021-2022 Tuomo Hirvonen | PolyForm-Noncommercial-1.0.0 | https://github.com/miikakuisma/cymatics */'

export default {
	plugins: base.plugins,
	publicDir: false,
	build: {
		outDir: 'dist-element',
		emptyOutDir: true,
		sourcemap: false,
		minify: 'esbuild',
		rollupOptions: { output: { banner } },
		lib: {
			entry: 'src/element/index.js',
			formats: ['es'],
			fileName: () => 'cymatics-view.js',
		},
	},
}
