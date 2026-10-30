import test from 'node:test';
import assert from 'node:assert/strict';
import { symEig, genSymEig } from '../scripts/plate-modes/linalg.mjs';

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}
function randSym(n, seed) {
  const r = lcg(seed), A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) A[i * n + j] = A[j * n + i] = r();
  return A;
}

test('symEig: fixed 4x4 with known eigenvalues', () => {
  // tridiag(-1, 2, -1): eigenvalues 2 - 2cos(k*pi/5), k = 1..4
  const n = 4, A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    A[i * n + i] = 2;
    if (i > 0) A[i * n + i - 1] = A[(i - 1) * n + i] = -1;
  }
  const A0 = Float64Array.from(A);
  const { values, vectors } = symEig(A, n);
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(values[k] - (2 - 2 * Math.cos(((k + 1) * Math.PI) / 5))) < 1e-12);
    let res = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += A0[i * n + j] * vectors[j * n + k];
      res = Math.max(res, Math.abs(s - values[k] * vectors[i * n + k]));
    }
    assert.ok(res < 1e-10, `residual ${res}`);
  }
  assert.deepEqual(A, A0, 'input not modified');
});

test('symEig: random 200x200 is orthonormal and ascending', () => {
  const n = 200, A = randSym(n, 12345);
  const { values, vectors } = symEig(A, n);
  for (let k = 1; k < n; k++) assert.ok(values[k] >= values[k - 1]);
  let err = 0;
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += vectors[i * n + a] * vectors[i * n + b];
    err = Math.max(err, Math.abs(s - (a === b ? 1 : 0)));
  }
  assert.ok(err < 1e-10, `orthonormality ${err}`);
  let res = 0;
  for (let k = 0; k < n; k += 17) for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i * n + j] * vectors[j * n + k];
    res = Math.max(res, Math.abs(s - values[k] * vectors[i * n + k]));
  }
  assert.ok(res < 1e-10, `residual ${res}`);
});

test('genSymEig: K = diag(1..5), M = I', () => {
  const n = 5, K = new Float64Array(n * n), M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) { K[i * n + i] = i + 1; M[i * n + i] = 1; }
  const { values } = genSymEig(K, M, n);
  assert.equal(values.length, 5);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(values[i] - (i + 1)) < 1e-12);
});

test('genSymEig: rank-deficient M truncated', () => {
  const n = 6, r = 4, rnd = lcg(7);
  const B = new Float64Array(n * r);
  for (let i = 0; i < B.length; i++) B[i] = rnd() * 2;
  const D = [0.5, 1.5, 3, 7];
  const M = new Float64Array(n * n), K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let m = 0, k = 0;
    for (let c = 0; c < r; c++) { const p = B[i * r + c] * B[j * r + c]; m += p; k += p * D[c]; }
    M[i * n + j] = m; K[i * n + j] = k;
  }
  const { values, vectors } = genSymEig(K, M, n);
  assert.equal(values.length, 4);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(values[i] - D[i]) < 1e-9, `${values[i]} vs ${D[i]}`);
  assert.equal(vectors.length, n * 4);
});

test('symEig: 400x400 in under 5 s', () => {
  const n = 400, A = randSym(n, 99);
  const t = performance.now();
  symEig(A, n);
  assert.ok(performance.now() - t < 5000);
});
