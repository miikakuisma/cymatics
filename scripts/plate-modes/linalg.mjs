// Dense symmetric eigensolvers for the offline plate-mode script (never shipped).
// symEig: Householder tridiagonalisation + implicit QL (the classic tred2/tqli,
// in the 0-based JAMA formulation). Row-major Float64Arrays throughout.

/**
 * Eigen-decompose a symmetric n×n matrix. `A` is not modified.
 * @returns {{values: Float64Array, vectors: Float64Array}} ascending values;
 *   column j of the row-major n×n `vectors` is eigenvector j.
 */
export function symEig(A, n) {
  const V = Float64Array.from(A);
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  if (n === 0) return { values: d, vectors: V };

  // --- Householder reduction to tridiagonal form (accumulating V) ---
  for (let j = 0; j < n; j++) d[j] = V[(n - 1) * n + j];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0, h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) {
        d[j] = V[(i - 1) * n + j];
        V[i * n + j] = 0;
        V[j * n + i] = 0;
      }
    } else {
      for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1];
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j];
        V[j * n + i] = f;
        g = e[j] + V[j * n + j] * f;
        for (let k = j + 1; k < i; k++) {
          const v = V[k * n + j];
          g += v * d[k];
          e[k] += v * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j]; g = e[j];
        for (let k = j; k < i; k++) V[k * n + j] -= f * e[k] + g * d[k];
        d[j] = V[(i - 1) * n + j];
        V[i * n + j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[(n - 1) * n + i] = V[i * n + i];
    V[i * n + i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k * n + i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j];
        for (let k = 0; k <= i; k++) V[k * n + j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0;
  }
  for (let j = 0; j < n; j++) {
    d[j] = V[(n - 1) * n + j];
    V[(n - 1) * n + j] = 0;
  }
  V[(n - 1) * n + n - 1] = 1;
  e[0] = 0;

  // Work on the transpose (row i = eigenvector i) so the QL rotations touch
  // contiguous memory.
  const W = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) W[i * n + k] = V[k * n + i];

  // --- Implicit QL on the tridiagonal (d, e) ---
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0, tst1 = 0;
  const eps = Math.pow(2, -52);
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n - 1 && Math.abs(e[m]) > eps * tst1) m++;
    if (m > l) {
      let iter = 0;
      do {
        if (++iter > 200) throw new Error('symEig: QL iteration did not converge');
        let g = d[l];
        let p = (d[l + 1] - g) / (2 * e[l]);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r);
        d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1, c2 = 1, c3 = 1, s = 0, s2 = 0;
        const el1 = e[l + 1];
        for (let i = m - 1; i >= l; i--) {
          c3 = c2; c2 = c; s2 = s;
          g = c * e[i];
          h = c * p;
          r = Math.hypot(p, e[i]);
          e[i + 1] = s * r;
          s = e[i] / r;
          c = p / r;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          const ri = i * n, rj = (i + 1) * n;
          for (let k = 0; k < n; k++) {
            const hv = W[rj + k];
            const wi = W[ri + k];
            W[rj + k] = s * wi + c * hv;
            W[ri + k] = c * wi - s * hv;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]) / dl1;
        e[l] = s * p;
        d[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f;
    e[l] = 0;
  }

  // --- Sort ascending; write vectors back as columns ---
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[a] - d[b]);
  const values = new Float64Array(n);
  const vectors = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    const src = order[j] * n;
    values[j] = d[order[j]];
    for (let k = 0; k < n; k++) vectors[k * n + j] = W[src + k];
  }
  return { values, vectors };
}

/**
 * Solve K a = λ M a for symmetric K and symmetric positive semi-definite M,
 * which may be near-singular: M's eigenvalues μ ≤ tol·μ_max are dropped.
 * @returns {{values: Float64Array, vectors: Float64Array}} ascending λ;
 *   `vectors` is n×m row-major (m = kept count ≤ n), M-orthonormal columns.
 * Accuracy: M-orthonormality (AᵀMA = I) degrades to ~1e-6 for columns near the
 * cutoff (eigenvector error ~eps·μmax against kept μ ≥ tol·μmax); it is not
 * re-orthonormalised. Inputs are not modified.
 */
export function genSymEig(K, M, n, { tol = 1e-11 } = {}) {
  const { values: mu, vectors: Vm } = symEig(M, n);
  const muMax = mu[n - 1];
  let first = 0;
  while (first < n && !(mu[first] > tol * muMax)) first++;
  const m = n - first;
  if (m <= 0) return { values: new Float64Array(0), vectors: new Float64Array(0) };

  // P = V_keep · diag(μ^-½), n×m
  const P = new Float64Array(n * m);
  for (let j = 0; j < m; j++) {
    const sc = 1 / Math.sqrt(mu[first + j]);
    for (let i = 0; i < n; i++) P[i * m + j] = Vm[i * n + first + j] * sc;
  }
  // KP = K·P  (n×m), then H = Pᵀ·KP (m×m)
  const KP = new Float64Array(n * m);
  for (let i = 0; i < n; i++) {
    const out = i * m;
    for (let k = 0; k < n; k++) {
      const kik = K[i * n + k];
      if (kik === 0) continue;
      const pr = k * m;
      for (let j = 0; j < m; j++) KP[out + j] += kik * P[pr + j];
    }
  }
  const H = new Float64Array(m * m);
  for (let k = 0; k < n; k++) {
    const pr = k * m;
    for (let a = 0; a < m; a++) {
      const pka = P[pr + a];
      if (pka === 0) continue;
      const ho = a * m;
      for (let b = 0; b < m; b++) H[ho + b] += pka * KP[pr + b];
    }
  }
  // Symmetrise away rounding asymmetry.
  for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) {
    const v = 0.5 * (H[a * m + b] + H[b * m + a]);
    H[a * m + b] = H[b * m + a] = v;
  }
  const { values, vectors: Y } = symEig(H, m);
  // a = P·y
  const vectors = new Float64Array(n * m);
  for (let i = 0; i < n; i++) {
    const out = i * m;
    for (let k = 0; k < m; k++) {
      const pik = P[i * m + k];
      const yr = k * m;
      for (let j = 0; j < m; j++) vectors[out + j] += pik * Y[yr + j];
    }
  }
  return { values, vectors };
}
