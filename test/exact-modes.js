// Exact Neumann eigenvalues of the two polygons that have them, for checking
// the plate-mode solver. Both sorted ascending, with multiplicity, λ = 0 left
// out, λ ≤ lambdaMax. Shapes have circumradius 1.

function collect(lambdaMax, unit, form) {
	const out = []
	for (let m = 0; unit * form(m, 0) <= lambdaMax; m++) {
		for (let n = 0; unit * form(m, n) <= lambdaMax; n++) {
			if (m + n > 0) out.push(unit * form(m, n))
		}
	}
	return out.sort((a, b) => a - b)
}

// Square of side √2: λ = (π²/2)(m² + n²) over ordered pairs m, n ≥ 0.
export const exactSquare = (lambdaMax) => collect(lambdaMax, Math.PI ** 2 / 2, (m, n) => m * m + n * n)

// Equilateral triangle of side √3 (Lamé): λ = (16π²/27)(m² + mn + n²) over ordered pairs m, n ≥ 0.
export const exactTriangle = (lambdaMax) => collect(lambdaMax, 16 * Math.PI ** 2 / 27, (m, n) => m * m + m * n + n * n)
