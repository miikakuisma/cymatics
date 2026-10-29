import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'

const SHADER_RE = /\.(?:fsh|vsh|glsl)$/

// GLSL ships inlined in the bundle (shaders.js pulls it in with `?raw`), so the
// JS minifier never touches it — comments, indentation and all. Strip them here
// instead. Deliberately line-by-line: `#version` and the other preprocessor
// directives are line-sensitive, and joining lines buys almost nothing on top
// of gzip.
function minifyGlsl(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\/\/[^\n]*/g, '')
		.split('\n')
		.map((line) => line.replace(/[ \t]+/g, ' ').trim())
		.filter(Boolean)
		.join('\n')
}

function glslMinify() {
	return {
		name: 'glsl-minify',
		apply: 'build',
		enforce: 'pre',
		load(id) {
			const [file, query] = id.split('?')
			if (query !== 'raw' || !SHADER_RE.test(file)) return null
			return `export default ${JSON.stringify(minifyGlsl(readFileSync(file, 'utf8')))}`
		},
	}
}

// Vite emits index.html markup and its inline <script> exactly as authored.
function htmlMinify() {
	return {
		name: 'html-minify',
		apply: 'build',
		enforce: 'post',
		async transformIndexHtml(html) {
			// Park script/style bodies so the whitespace pass cannot reach them.
			const blocks = []
			let out = html.replace(
				/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
				(_match, open, tag, body, close) => {
					blocks.push({ open, tag, body, close })
					return `__HTML_BLOCK_${blocks.length - 1}__`
				}
			)

			out = out
				.replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
				.replace(/>[ \t\r\n]+</g, '><')
				.replace(/[ \t\r\n]+/g, ' ')
				.trim()

			for (let i = 0; i < blocks.length; i++) {
				const { open, tag, body, close } = blocks[i]
				let min = body
				if (body.trim()) {
					const res = await transform(body, {
						loader: tag.toLowerCase() === 'style' ? 'css' : 'js',
						minify: true,
					})
					min = res.code.trim()
				}
				out = out.replace(`__HTML_BLOCK_${i}__`, () => open + min + close)
			}
			return out
		},
	}
}

export default {
	plugins: [glslMinify(), htmlMinify()],
	build: {
		chunkSizeWarningLimit: 1000,
		sourcemap: false,
		minify: 'esbuild',
		cssMinify: 'esbuild',
	},
}
