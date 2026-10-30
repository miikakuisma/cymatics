// Solve, refit and encode the triangle's, pentagon's and hexagon's modes into
// src/engine-js/plate-data.js:  npm run plate-modes  (about a quarter of an hour).
//
// Each symmetry class of each shape runs in its own worker:
//  1. solve the class up to the shape's kMax (galerkin.mjs) and report its k;
//  2. once every class of the shape has, the main thread picks the modes to
//     ship — the lowest COUNT listed entries, a derived partner counting as
//     one, extended by at most two so a degenerate run is never cut — and
//     tells each worker which of its modes those are, at what (float32) k;
//  3. the worker refits each (fit.mjs), scales it to peak 1, quantises it and
//     measures what ships: its residual against the solver and its edge flux.
// Then the main thread encodes, writes, and prints a report. It exits non-zero
// if a refit misses (relResidual > 1e-3, before or after quantising), a
// triangle eigenvalue is off by more than 1e-4 relative (or the count differs
// from the exact one), a shipped mode's edge flux (5% clear of corners)
// reaches 5e-3, a mode would read past a Bessel table, or plate-data.js
// gzips past 150 000 bytes.
//
// Options: --shapes 3,5,6  --count 620  --out <file>  (a quick look:
// --count 40 --out /tmp/plate-data.js).

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { BESSEL_X_MAX } from '../../src/engine-js/modes.js'
import { CORNER_X_MAX } from '../../src/engine-js/plate-corners.js'
import { decodePlate, evalStoredMode, listModes } from '../../src/engine-js/plate-modes.js'
import { polygon, symmetryClasses } from '../../src/engine-js/polygons.js'
import { encodePlate, quantiseMode } from './encode.mjs'
import { fitSamples, fitValues, sampleModes } from './fit.mjs'
import { solveClass } from './galerkin.mjs'
import { edgeFlux, peakOf } from './measure.mjs'

const RESIDUAL_MAX = 1e-3
const TRIANGLE_ERROR_MAX = 1e-4
const FLUX_MAX = 5e-3
const GZIP_MAX = 150_000
const SNAP = 1e-7 // k closer than this (relative) across or within classes: one degenerate value
const KMAX_MARGIN = 1.15

if (isMainThread) await main()
else await worker()

// ---------------------------------------------------------------- worker ---

async function worker() {
	const { sides, cls, kMax } = workerData
	const t0 = performance.now()
	const modes = solveClass(sides, cls, { kMax })
	const solveSeconds = (performance.now() - t0) / 1000
	parentPort.postMessage({ type: 'solved', ks: modes.map((m) => m.k), solveSeconds })
	const keep = await new Promise((resolve) => parentPort.once('message', resolve))
	const t1 = performance.now()
	const out = []
	if (keep.length) {
		const kept = keep.map(({ index }) => modes[index])
		const samples = fitSamples(sides, cls, Math.max(...keep.map((e) => e.k)))
		const values = sampleModes(kept, samples)
		keep.forEach(({ index, k }, i) => out.push(shipMode(sides, cls, samples, k, values[i], index)))
	}
	parentPort.postMessage({ type: 'fitted', modes: out, fitSeconds: (performance.now() - t1) / 1000 })
}

function shipMode(sides, cls, samples, k, values, index) {
	const fit = fitValues(samples, k, values)
	const mode = {
		j: cls.j, parity: cls.parity, partner: cls.partner, partnerGain: 1, k,
		orders: fit.orders, coeffs: fit.coeffs, corners: fit.corners,
		cornerM: fit.corners.ms, cornerKind: fit.corners.kinds, cornerCoeffs: fit.corners.coeffs,
	}
	// Peak 1, positive there.
	const { peak, value } = peakOf(sides, (x, y) => evalStoredMode(sides, mode, 0, x, y))
	const s = Math.sign(value) / peak
	mode.coeffs = mode.coeffs.map((c) => c * s)
	mode.corners = { ...mode.corners, coeffs: mode.corners.coeffs.map((c) => c * s) }
	// What decodes.
	const q = quantiseMode(mode)
	const shipped = { ...mode, coeffs: q.disc, cornerCoeffs: q.corner }
	if (cls.partner) {
		const p = peakOf(sides, (x, y) => evalStoredMode(sides, shipped, 1, x, y)).peak
		mode.partnerGain = shipped.partnerGain = Math.fround(1 / p)
	}
	const shippedResidual = residual(sides, cls, samples, values, s, shipped)
	const flux = edgeFlux(sides, (x, y) => evalStoredMode(sides, shipped, 0, x, y))
	if (cls.partner) {
		const f1 = edgeFlux(sides, (x, y) => evalStoredMode(sides, shipped, 1, x, y))
		flux.clear = Math.max(flux.clear, f1.clear)
		flux.full = Math.max(flux.full, f1.full)
	}
	const sumAbs = q.disc.reduce((a, c) => a + Math.abs(c), 0) + q.corner.reduce((a, c) => a + Math.abs(c), 0)
	return {
		index, k, j: cls.j, parity: cls.parity, partner: cls.partner, partnerGain: mode.partnerGain,
		coeffs: Array.from(mode.coeffs), corners: { ms: Array.from(mode.corners.ms), kinds: Array.from(mode.corners.kinds), coeffs: Array.from(mode.corners.coeffs) },
		relResidual: fit.relResidual, shippedResidual, flux, scale: q.scale, sumAbs,
	}
}

// The quantised, scaled series against the solver's mode (scaled the same) over
// the fit's points, weighted as the fit is (partner rows for a 2-D class).
function residual(sides, cls, samples, values, s, mode) {
	const { x, y, w, count } = samples
	const d = 2 * Math.PI / sides, cj = Math.cos(cls.j * d), sj = Math.sin(cls.j * d)
	const unit = { ...mode, partnerGain: 1 }
	let err = 0, norm = 0
	for (let p = 0; p < count; p++) {
		const u = values[p] * s
		err += w[p] * (evalStoredMode(sides, unit, 0, x[p], y[p]) - u) ** 2
		norm += w[p] * u * u
		if (cls.partner) {
			const ut = (cj * values[p] - values[count + p]) / sj * s
			err += w[p] * (evalStoredMode(sides, unit, 1, x[p], y[p]) - ut) ** 2
			norm += w[p] * ut * ut
		}
	}
	return Math.sqrt(err / norm)
}

// ------------------------------------------------------------------ main ---

function option(name, fallback) {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 ? process.argv[i + 1] : fallback
}

// Two-term Weyl law for Neumann: N(λ) ≈ Aλ/4π + L√λ/4π; the k where it reaches
// `count`, with a margin so the count'th eigenvalue is comfortably inside.
function weylKMax(sides, count) {
	const A = sides / 2 * Math.sin(2 * Math.PI / sides), L = 2 * sides * Math.sin(Math.PI / sides)
	const a = A / (4 * Math.PI), b = L / (4 * Math.PI)
	return KMAX_MARGIN * (-b + Math.sqrt(b * b + 4 * a * count)) / (2 * a)
}

// Lamé: the equilateral triangle of circumradius 1, λ = (16π²/27)(m² + mn + n²).
function exactTriangle(lambdaMax) {
	const unit = 16 * Math.PI ** 2 / 27, out = []
	for (let m = 0; unit * m * m <= lambdaMax; m++) for (let n = 0; unit * (m * m + m * n + n * n) <= lambdaMax; n++) {
		if (m + n > 0) out.push(unit * (m * m + m * n + n * n))
	}
	return out.sort((a, b) => a - b)
}

// Every solved mode as a candidate, k snapped so that a degenerate set shares
// one float32 value; then the classes' keep lists.
function choose(sides, classes, solved, count) {
	const cands = []
	solved.forEach((ks, c) => ks.forEach((k, index) => cands.push({ c, index, k, partner: classes[c].partner })))
	cands.sort((p, q) => p.k - q.k || p.c - q.c || p.index - q.index)
	let snapped = 0, widestSnap = 0, narrowestGap = Infinity
	for (let i = 0; i < cands.length;) {
		let e = i + 1
		while (e < cands.length && (cands[e].k - cands[i].k) / cands[i].k < SNAP) e++
		if (e < cands.length) narrowestGap = Math.min(narrowestGap, (cands[e].k - cands[e - 1].k) / cands[e].k)
		const group = cands.slice(i, e)
		const k = Math.fround(group.reduce((a, g) => a + g.k, 0) / group.length)
		if (group.length > 1) { snapped += group.length; widestSnap = Math.max(widestSnap, (group.at(-1).k - group[0].k) / group[0].k) }
		for (const g of group) g.stored = k
		i = e
	}
	// Runs of equal stored k, whole, until `count` entries.
	const kept = []
	let total = 0
	for (let i = 0; i < cands.length && total < count;) {
		let e = i + 1
		while (e < cands.length && cands[e].stored === cands[i].stored) e++
		const run = cands.slice(i, e)
		const size = run.reduce((a, g) => a + (g.partner ? 2 : 1), 0)
		if (total + size > count + 2) throw new Error(`${sides}-gon: a run of ${size} at entry ${total} would pass ${count} + 2`)
		kept.push(...run)
		total += size
		i = e
	}
	if (total < count) throw new Error(`${sides}-gon: only ${total} entries below kMax; raise KMAX_MARGIN`)
	const keep = classes.map(() => [])
	for (const g of kept) keep[g.c].push({ index: g.index, k: g.stored })
	return { keep, total, snapped, widestSnap, narrowestGap }
}

async function main() {
	const shapes = option('shapes', '3,5,6').split(',').map(Number)
	const count = Number(option('count', 620))
	const outPath = option('out', fileURLToPath(new URL('../../src/engine-js/plate-data.js', import.meta.url)))
	const started = performance.now()
	const failures = []
	const reports = {}
	const encoded = {}

	await Promise.all(shapes.map(async (sides) => {
		const classes = symmetryClasses(sides)
		const kMax = weylKMax(sides, count)
		const rep = (reports[sides] = { kMax, classes: [] })
		const workers = classes.map((cls) => new Worker(fileURLToPath(import.meta.url), { workerData: { sides, cls, kMax } }))
		const next = (w) => new Promise((resolve, reject) => {
			w.once('message', resolve)
			w.once('error', reject)
		})
		const solved = await Promise.all(workers.map(next))
		const solvedKs = solved.map((s) => s.ks)
		classes.forEach((cls, c) => rep.classes.push({ name: `${cls.j}${cls.parity}`, solved: solvedKs[c].length, solveSeconds: solved[c].solveSeconds }))
		console.log(`${sides}-gon: solved ${solvedKs.reduce((a, k) => a + k.length, 0)} modes to kMax ${kMax.toFixed(2)} (${((performance.now() - started) / 1000).toFixed(0)} s)`)

		if (sides === 3) {
			const all = []
			solvedKs.forEach((ks, c) => ks.forEach((k) => { all.push(k * k); if (classes[c].partner) all.push(k * k) }))
			all.sort((a, b) => a - b)
			const bound = (0.999 * kMax) ** 2
			const got = all.filter((l) => l <= bound)
			const want = exactTriangle(bound)
			let worst = 0
			for (let i = 0; i < Math.min(got.length, want.length); i++) worst = Math.max(worst, Math.abs(got[i] / want[i] - 1))
			rep.triangle = { worst, got: got.length, want: want.length }
			if (got.length !== want.length) failures.push(`triangle: ${got.length} eigenvalues below (0.999·kMax)², exactly ${want.length}`)
			if (worst > TRIANGLE_ERROR_MAX) failures.push(`triangle: eigenvalue error ${worst.toExponential(2)}`)
		}

		const pick = choose(sides, classes, solvedKs, count)
		Object.assign(rep, { listed: pick.total, snapped: pick.snapped, widestSnap: pick.widestSnap, narrowestGap: pick.narrowestGap })
		const fittedP = workers.map(next)
		workers.forEach((w, c) => w.postMessage(pick.keep[c]))
		const fitted = await Promise.all(fittedP)
		workers.forEach((w) => w.terminate())
		console.log(`${sides}-gon: fitted (${((performance.now() - started) / 1000).toFixed(0)} s)`)

		const stored = []
		fitted.forEach((f, c) => {
			const ms = f.modes
			const cr = rep.classes[c]
			Object.assign(cr, {
				kept: ms.length, fitSeconds: f.fitSeconds,
				residual: worstOf(ms, (m) => m.relResidual), shipped: worstOf(ms, (m) => m.shippedResidual),
				flux: worstOf(ms, (m) => m.flux.clear), fluxFull: worstOf(ms, (m) => m.flux.full),
				terms: Math.max(0, ...ms.map((m) => m.coeffs.length)), corners: Math.max(0, ...ms.map((m) => m.corners.coeffs.length)),
				scale: Math.max(0, ...ms.map((m) => m.scale)), sumAbs: Math.max(0, ...ms.map((m) => m.sumAbs)),
				gain: ms.filter((m) => m.partner).reduce((a, m) => [Math.min(a[0], m.partnerGain), Math.max(a[1], m.partnerGain)], [Infinity, 0]),
			})
			for (const m of ms) stored.push({ ...m, c })
		})
		stored.sort((p, q) => p.k - q.k || p.c - q.c || p.index - q.index)
		for (const m of stored) {
			const where = `${sides}-gon ${m.j}${m.parity} k=${m.k.toFixed(4)}`
			if (!(m.relResidual <= RESIDUAL_MAX)) failures.push(`${where}: relResidual ${m.relResidual.toExponential(2)}`)
			if (!(m.shippedResidual <= RESIDUAL_MAX)) failures.push(`${where}: shipped residual ${m.shippedResidual.toExponential(2)}`)
			if (!(m.flux.clear < FLUX_MAX)) failures.push(`${where}: edge flux ${m.flux.clear.toExponential(2)}`)
			if (m.k > BESSEL_X_MAX) failures.push(`${where}: k past BESSEL_X_MAX`)
			if (m.corners.coeffs.length && m.k * 2 > CORNER_X_MAX) failures.push(`${where}: 2k past CORNER_X_MAX`)
		}
		const bytes = encodePlate(sides, stored)
		const base64 = Buffer.from(bytes).toString('base64')
		// The listing the engine will make from exactly these bytes.
		const listing = listModes(decodePlate(base64).modes)
		if (listing.length < count || listing.length > count + 2) failures.push(`${sides}-gon: ${listing.length} listed`)
		Object.assign(rep, { stored: stored.length, bytes: bytes.length, base64: base64.length, gzip: gzipSync(base64).length, entries: listing.length, lastRatio: listing.at(-1).ratio, lastK: stored.at(-1).k })
		encoded[sides] = base64
	}))

	const source = '// Generated by `npm run plate-modes` (scripts/plate-modes/generate.mjs). Do not edit.\n'
		+ '// Each shape\'s modes in binary format PLT2, base64; see plate-modes.js.\n'
		+ 'export const PLATE_DATA = {\n'
		+ shapes.map((s) => `\t${s}: '${encoded[s]}',\n`).join('')
		+ '}\n'
	const gzip = gzipSync(source).length
	if (gzip > GZIP_MAX) failures.push(`plate-data.js gzips to ${gzip} bytes`)
	// A failing run must not overwrite the committed data.
	if (!failures.length) writeFileSync(outPath, source)

	console.log(`\nPlate modes — ${count} listed per shape, written to ${outPath}\n`)
	for (const sides of shapes) {
		const r = reports[sides]
		console.log(`${sides}-gon  kMax ${r.kMax.toFixed(2)} (Weyl × ${KMAX_MARGIN}); ${r.stored} stored → ${r.entries} listed; last k ${r.lastK.toFixed(3)}, ratio ${r.lastRatio.toFixed(1)}`)
		console.log(`  ${'class'.padEnd(6)} ${'solved'.padStart(6)} ${'kept'.padStart(5)} ${'solve s'.padStart(8)} ${'fit s'.padStart(6)}  ${'residual'.padStart(9)} ${'shipped'.padStart(9)} ${'flux 5%'.padStart(9)} ${'flux all'.padStart(9)} terms corner  max|c|  Σ|c|  partnerGain`)
		for (const c of r.classes) {
			const gain = c.gain[1] ? `${c.gain[0].toFixed(3)}–${c.gain[1].toFixed(3)}` : '—'
			console.log(`  ${c.name.padEnd(6)} ${String(c.solved).padStart(6)} ${String(c.kept).padStart(5)} ${c.solveSeconds.toFixed(0).padStart(8)} ${c.fitSeconds.toFixed(0).padStart(6)}  ${exp(c.residual)} ${exp(c.shipped)} ${exp(c.flux)} ${exp(c.fluxFull)} ${String(c.terms).padStart(5)} ${String(c.corners).padStart(6)} ${c.scale.toFixed(2).padStart(7)} ${c.sumAbs.toFixed(1).padStart(5)}  ${gain}`)
		}
		const worst = (key) => Math.max(...r.classes.map((c) => c[key]))
		console.log(`  worst relResidual ${exp(worst('residual'))}, shipped ${exp(worst('shipped'))}; worst edge flux ${exp(worst('flux'))} (5% clear), ${exp(worst('fluxFull'))} (whole edge)`)
		if (r.triangle) console.log(`  triangle: max |λ/λ_exact − 1| ${exp(r.triangle.worst)} over all ${r.triangle.got} solved (exact count ${r.triangle.want})`)
		console.log(`  degenerate snaps: ${r.snapped} modes, widest ${exp(r.widestSnap)}; narrowest gap left ${exp(r.narrowestGap)}`)
		console.log(`  ${r.bytes} bytes, ${r.base64} base64, ${r.gzip} gzipped alone`)
	}
	console.log(`\nplate-data.js: ${source.length} bytes, ${gzip} gzipped (budget ${GZIP_MAX}); ${((performance.now() - started) / 60000).toFixed(1)} min`)
	if (failures.length) {
		console.log(`\nFAILED (${failures.length}):\n  ${failures.slice(0, 40).join('\n  ')}`)
		process.exit(1)
	}
	console.log('All checks pass.')
}

function worstOf(list, f) {
	let w = 0
	for (const x of list) w = Math.max(w, f(x))
	return w
}

function exp(v) {
	return (Number.isFinite(v) ? v.toExponential(2) : String(v)).padStart(9)
}
