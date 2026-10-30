// Writes the app icons into public/: a square Chladni figure, white on the
// Start button's purple. Run with `npm run icons` after changing anything here.
//
// The figure is the nodal set of cos(πx)cos(4πy) + cos(4πx)cos(πy) over the
// plate, x and y in -1..1: where sand gathers on a square plate ringing in
// that mode. Small icons zoom into its centre, where the full figure would
// be too fine to read.

import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ICONS = [
	['icon.png', 1024],
	['android-chrome-512x512.png', 512],
	['android-chrome-192x192.png', 192],
	['apple-touch-icon.png', 180],
	['favicon-32x32.png', 32],
	['favicon-16x16.png', 16],
]

// Below this size the figure is drawn zoomed in, with bolder lines.
const SMALL = 40
const TOP = [118, 96, 172]
const BOTTOM = [74, 58, 120]
const LINE = [255, 255, 255]

const field = (zoom) => (x, y) => {
	x *= zoom
	y *= zoom
	return Math.cos(Math.PI * x) * Math.cos(4 * Math.PI * y) + Math.cos(4 * Math.PI * x) * Math.cos(Math.PI * y)
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

// RGB rows of an n×n icon. A pixel is line where the field's zero is within
// half a line width, measured as |f| / |∇f|; 3×3 samples per pixel smooth the edges.
export function render(n) {
	const small = n < SMALL
	const f = field(small ? 0.6 : 1)
	const width = Math.max(1.5, n * (small ? 0.07 : 0.034))
	const ss = 3
	const h = 1 / n
	const rgb = new Uint8Array(n * n * 3)
	for (let py = 0; py < n; py++) {
		for (let px = 0; px < n; px++) {
			let cover = 0
			for (let sy = 0; sy < ss; sy++) {
				for (let sx = 0; sx < ss; sx++) {
					const x = ((px + (sx + 0.5) / ss) / n) * 2 - 1
					const y = 1 - ((py + (sy + 0.5) / ss) / n) * 2
					const gx = (f(x + h, y) - f(x - h, y)) / (2 * h)
					const gy = (f(x, y + h) - f(x, y - h)) / (2 * h)
					const dist = (Math.abs(f(x, y)) / (Math.hypot(gx, gy) || 1e-9)) * (n / 2)
					if (dist < width / 2) cover++
				}
			}
			const bg = mix(TOP, BOTTOM, (py + 0.5) / n)
			const out = mix(bg, LINE, cover / (ss * ss))
			rgb.set(out.map(Math.round), (py * n + px) * 3)
		}
	}
	return rgb
}

// A minimal 8-bit RGB PNG.
export function png(n, rgb) {
	const raw = Buffer.alloc(n * (n * 3 + 1))
	for (let y = 0; y < n; y++) {
		raw[y * (n * 3 + 1)] = 0
		Buffer.from(rgb.buffer, rgb.byteOffset + y * n * 3, n * 3).copy(raw, y * (n * 3 + 1) + 1)
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(n, 0)
	ihdr.writeUInt32BE(n, 4)
	ihdr.set([8, 2, 0, 0, 0], 8)
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	])
}

function chunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(body))
	return Buffer.concat([len, body, crc])
}

function crc32(buf) {
	let c = ~0
	for (const byte of buf) {
		c ^= byte
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
	}
	return ~c >>> 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const dir = new URL('../public/', import.meta.url)
	for (const [name, n] of ICONS) {
		writeFileSync(new URL(name, dir), png(n, render(n)))
		console.log(`public/${name} ${n}×${n}`)
	}
}
