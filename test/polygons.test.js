import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classOrders, insidePolygon, partnerSign, polygon, symmetryClasses } from '../src/engine-js/polygons.js'

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`)

test('vertices sit on the unit circle, triangle and pentagon point up, hexagon is flat on top', () => {
	for (const n of [3, 4, 5, 6]) for (const [x, y] of polygon(n).vertices) near(Math.hypot(x, y), 1, 1e-12, `${n}-gon vertex`)
	assert.deepEqual(polygon(3).vertices[0].map((v) => +v.toFixed(12)), [0, 1])
	assert.deepEqual(polygon(5).vertices[0].map((v) => +v.toFixed(12)), [0, 1])
	near(polygon(6).vertices[0][1], polygon(6).vertices[5][1], 1e-12, 'hexagon top edge is level')
})

test('insidePolygon agrees with the vertices', () => {
	for (const n of [3, 5, 6]) {
		assert.ok(insidePolygon(n, 0, 0))
		for (const [x, y] of polygon(n).vertices) {
			assert.ok(insidePolygon(n, 0.999 * x, 0.999 * y))
			assert.ok(!insidePolygon(n, 1.001 * x, 1.001 * y))
		}
		assert.ok(!insidePolygon(n, 0, -0.999))   // below every bottom edge
	}
	assert.ok(insidePolygon(6, 0, 0.866), 'hexagon top edge midpoint')
	assert.ok(!insidePolygon(3, 0, -0.51), 'triangle bottom edge is at y = −1/2')
})

test('symmetry classes and their orders', () => {
	assert.deepEqual(symmetryClasses(5).map((c) => [c.j, c.parity, c.partner]),
		[[0, 'cos', false], [0, 'sin', false], [1, 'cos', true], [2, 'cos', true]])
	assert.deepEqual(symmetryClasses(6).map((c) => [c.j, c.parity]),
		[[0, 'cos'], [0, 'sin'], [1, 'cos'], [2, 'cos'], [3, 'cos'], [3, 'sin']])
	assert.deepEqual([...classOrders(6, 0, 'cos', 13)], [0, 6, 12])
	assert.deepEqual([...classOrders(6, 0, 'sin', 13)], [6, 12])
	assert.deepEqual([...classOrders(5, 2, 'cos', 13)], [2, 3, 7, 8, 12, 13])
	assert.deepEqual([...classOrders(3, 1, 'cos', 8)], [1, 2, 4, 5, 7, 8])
	assert.equal(partnerSign(5, 2, 7), 1)
	assert.equal(partnerSign(5, 2, 8), -1)
})

test('the square (N = 4) has five classes', () => {
	assert.deepEqual(symmetryClasses(4).map((c) => [c.j, c.parity, c.partner]),
		[[0, 'cos', false], [0, 'sin', false], [1, 'cos', true], [2, 'cos', false], [2, 'sin', false]])
	assert.deepEqual([...classOrders(4, 0, 'cos', 9)], [0, 4, 8])
	assert.deepEqual([...classOrders(4, 1, 'cos', 9)], [1, 3, 5, 7, 9])
	assert.deepEqual([...classOrders(4, 2, 'cos', 10)], [2, 6, 10])
	assert.deepEqual([...classOrders(4, 2, 'sin', 10)], [2, 6, 10])
	assert.equal(partnerSign(4, 1, 5), 1)
	assert.equal(partnerSign(4, 1, 3), -1)
	assert.ok(insidePolygon(4, 0.49, 0.49) && !insidePolygon(4, 0.51, 0.51), 'offset 0: a diamond, |x| + |y| ≤ 1')
})
