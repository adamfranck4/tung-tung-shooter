// Trains the aim classifier (see src/aimml.js) on simulated aim (see aimsim.js) and prints
// src/aimmodel.js. Open tools/train-aim.html from the game's folder served over http.
import { aimGate, aimFeatures, forward, N_FEAT, FEATURES } from '../src/aimml.js';
import { simulate, rng, CHEATS } from './aimsim.js';

const log = (s) => { const el = document.getElementById('log'); el.textContent += s + '\n'; console.log(s); };
const tick = () => new Promise((r) => setTimeout(r, 0));

async function makeSet(R, n, kind, windows = 1) {
  const X = [], groups = [];
  for (let i = 0; i < n; i++) {
    const ws = simulate(R, kind, { windows }), g = [];
    for (const S of ws) if (aimGate(S)) { const f = aimFeatures(S); if (f.every(Number.isFinite)) { X.push(f); g.push(f); } }
    if (g.length) groups.push(g);
    if (i % 500 === 0) await tick();
  }
  return { X, groups };
}

function init(R, sizes) {
  const layers = [];
  for (let l = 1; l < sizes.length; l++) {
    const s = Math.sqrt(1 / sizes[l - 1]);
    layers.push({ w: Array.from({ length: sizes[l] }, () => Array.from({ length: sizes[l - 1] }, () => (R() * 2 - 1) * s * 1.7)), b: new Array(sizes[l]).fill(0) });
  }
  return layers;
}

// plain mini-batch training with Adam on the log loss
async function train(R, X, Y, model, { epochs = 40, lr = 0.003, batch = 128, l2 = 1e-4 } = {}) {
  const L = model.layers;
  const m = L.map((x) => ({ w: x.w.map((r) => r.map(() => 0)), b: x.b.map(() => 0) }));
  const v = L.map((x) => ({ w: x.w.map((r) => r.map(() => 0)), b: x.b.map(() => 0) }));
  let step = 0;
  const idx = X.map((_, i) => i);
  const xs = X.map((x) => x.map((val, i) => (val - model.mean[i]) / model.std[i]));
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
    let loss = 0;
    for (let s = 0; s < idx.length; s += batch) {
      const g = L.map((x) => ({ w: x.w.map((r) => r.map(() => 0)), b: x.b.map(() => 0) }));
      const B = idx.slice(s, s + batch);
      for (const n of B) {
        const acts = [xs[n]];
        L.forEach((layer, li) => {
          const a = acts[acts.length - 1], out = layer.b.slice();
          for (let j = 0; j < out.length; j++) { let z = out[j]; const w = layer.w[j]; for (let i = 0; i < a.length; i++) z += w[i] * a[i]; out[j] = li < L.length - 1 ? Math.tanh(z) : z; }
          acts.push(out);
        });
        const p = 1 / (1 + Math.exp(-acts[acts.length - 1][0])), y = Y[n];
        loss += -(y * Math.log(p + 1e-9) + (1 - y) * Math.log(1 - p + 1e-9));
        let d = [p - y];
        for (let li = L.length - 1; li >= 0; li--) {
          const a = acts[li], layer = L[li], nd = new Array(a.length).fill(0);
          for (let j = 0; j < d.length; j++) {
            g[li].b[j] += d[j];
            for (let i = 0; i < a.length; i++) { g[li].w[j][i] += d[j] * a[i]; nd[i] += d[j] * layer.w[j][i]; }
          }
          if (li > 0) d = nd.map((x, i) => x * (1 - a[i] * a[i]));
        }
      }
      step++;
      const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** step, c2 = 1 - b2 ** step;
      L.forEach((layer, li) => {
        for (let j = 0; j < layer.b.length; j++) {
          const gb = g[li].b[j] / B.length;
          m[li].b[j] = b1 * m[li].b[j] + (1 - b1) * gb; v[li].b[j] = b2 * v[li].b[j] + (1 - b2) * gb * gb;
          layer.b[j] -= lr * (m[li].b[j] / c1) / (Math.sqrt(v[li].b[j] / c2) + 1e-8);
          for (let i = 0; i < layer.w[j].length; i++) {
            const gw = g[li].w[j][i] / B.length + l2 * layer.w[j][i];
            m[li].w[j][i] = b1 * m[li].w[j][i] + (1 - b1) * gw; v[li].w[j][i] = b2 * v[li].w[j][i] + (1 - b2) * gw * gw;
            layer.w[j][i] -= lr * (m[li].w[j][i] / c1) / (Math.sqrt(v[li].w[j][i] / c2) + 1e-8);
          }
        }
      });
    }
    if (ep % 5 === 4 || ep === epochs - 1) log(`epoch ${ep + 1}: loss ${(loss / idx.length).toFixed(4)}`);
    if (ep > epochs * 0.6) lr *= 0.9;
    await tick();
  }
}

const quantile = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const round = (x) => Math.round(x * 1e4) / 1e4;

export async function run({ seed = 7, perKind = 5000, engagements = 1500 } = {}) {
  const R = rng(seed);
  log('simulating training data...');
  const H = await makeSet(R, perKind * 2, 'human');
  const C = [];
  for (const k of CHEATS) { const s = await makeSet(R, Math.round(perKind * 2 / CHEATS.length), k); C.push(...s.X); log(`  ${k}: ${s.X.length} windows`); }
  log(`  human: ${H.X.length} windows`);
  const X = [...H.X, ...C], Y = [...H.X.map(() => 0), ...C.map(() => 1)];
  const mean = [], std = [];
  for (let i = 0; i < N_FEAT; i++) {
    const col = X.map((x) => x[i]), mu = col.reduce((a, b) => a + b, 0) / col.length;
    mean.push(mu); std.push(Math.sqrt(col.reduce((a, b) => a + (b - mu) ** 2, 0) / col.length) || 1);
  }
  const model = { mean, std, layers: init(R, [N_FEAT, 20, 10, 1]) };
  // humans count double: a false ban is worse than a missed cheat
  const Xw = [...X, ...H.X], Yw = [...Y, ...H.X.map(() => 0)];
  await train(R, Xw, Yw, model);

  // fresh data: whole engagements (4 windows a quarter second apart, averaged, as the host does)
  log('testing on new engagements...');
  const R2 = rng(seed * 31 + 1);
  const hT = await makeSet(R2, engagements * 2, 'human', 4);
  const score = (g) => g.reduce((a, f) => a + forward(model, f), 0) / g.length;
  const hw = hT.X.map((f) => forward(model, f)), he = hT.groups.filter((g) => g.length >= 3).map(score);
  const threshold = Math.min(0.995, Math.max(0.97, quantile(he, 0.999) + 0.01, he.reduce((a, b) => Math.max(a, b), 0) + 0.003));
  log(`humans: windows over 0.5: ${(hw.filter((p) => p > 0.5).length / hw.length * 100).toFixed(2)}%, ` +
    `engagements: median ${quantile(he, 0.5).toFixed(3)}, 99.9% ${quantile(he, 0.999).toFixed(3)}, max ${Math.max(...he).toFixed(3)}`);
  log(`threshold: ${threshold.toFixed(3)}`);
  const caught = {};
  for (const k of CHEATS) {
    const t = await makeSet(R2, engagements, k, 4), es = t.groups.filter((g) => g.length >= 3).map(score);
    caught[k] = es.filter((p) => p > threshold).length / Math.max(1, es.length);
    log(`  ${k}: ${(caught[k] * 100).toFixed(1)}% of engagements over the threshold (median ${quantile(es, 0.5).toFixed(3)})`);
  }
  const out = {
    features: FEATURES, threshold: round(threshold), mean: mean.map(round), std: std.map(round),
    layers: model.layers.map((l) => ({ w: l.w.map((r) => r.map(round)), b: l.b.map(round) })),
    trained: { seed, windows: X.length, caught: Object.fromEntries(Object.entries(caught).map(([k, v]) => [k, round(v)])) },
  };
  const src = '// Weights of the aim classifier (src/aimml.js), made by tools/train-aim.html. Don\'t edit by hand.\n' +
    `export const MODEL = ${JSON.stringify(out)};\n`;
  document.getElementById('out').value = src;
  window.result = src;
  log('done: copy the text below into src/aimmodel.js');
  return src;
}
