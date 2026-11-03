// Machine-learned aim check: a small neural network that tells human aim from aimbot aim.
//
// The input is one second of a player's view (about 30 updates) while an enemy is near their
// crosshair: where they looked, and where the enemy was as they saw it. aimFeatures() turns that
// into a few numbers that describe how the aim moved: how close it stayed, how well its speed
// matched the target's, how long it took to react when the target changed direction, how
// smooth or shaky it was, and how evenly the error shrank. People react a fifth of a second
// late, overshoot and correct in little jumps, and shake; aimbots match the target's movement
// at once, close the error at an even rate, and don't shake (or shake in a way that doesn't
// match how hands move).
//
// The network was trained on simulated people (reaction delays, overshooting flicks, corrective
// jumps, tremor, varied skill) and simulated aimbots (hard locks, smoothed, humanised with
// noise and delays, aim assist on top of a person, constant-speed) run through the same network
// timing as real players. See tools/train-aim.html to retrain it; its output is aimmodel.js.
//
// It doesn't use three.js, so the trainer can load it on its own.
import { MODEL } from './aimmodel.js';

export const FEATURES = [
  'mean error', 'error spread', 'late error', 'time on target', 'speed mismatch', 'target speed',
  'view speed', 'speed match', 'reaction delay', 'delay helps', 'jerkiness', 'error decay evenness',
  'up/down shake', 'crossings', 'speed gain', 'peak speed',
];
export const N_FEAT = FEATURES.length;
const DEG = 180 / Math.PI;

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const rms = (a) => { let s = 0; for (const x of a) s += x * x; return a.length ? Math.sqrt(s / a.length) : 0; };
const mean = (a) => { let s = 0; for (const x of a) s += x; return a.length ? s / a.length : 0; };
function corr(a, b, lag = 0) {
  // Pearson correlation of a[i] with b[i - lag]
  const n = a.length - lag;
  if (n < 6) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i + lag]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i + lag] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa < 1e-6 || sbb < 1e-6 ? 0 : sab / Math.sqrt(saa * sbb);
}

// errors and speeds (degrees, degrees per second) for a window of samples
// S: [{t, yaw, pitch, ty, tp}]: view angles, and the angles to the target as the player saw it
function series(S) {
  const n = S.length, ex = [], ey = [], e = [], vx = [], vy = [], ux = [], uy = [];
  for (let i = 0; i < n; i++) {
    const s = S[i], c = Math.cos(s.tp);
    ex.push(wrap(s.yaw - s.ty) * c * DEG); ey.push((s.pitch - s.tp) * DEG);
    e.push(Math.hypot(ex[i], ey[i]));
    if (!i) continue;
    const p = S[i - 1], dt = Math.min(0.1, Math.max(0.015, s.t - p.t));
    vx.push(wrap(s.yaw - p.yaw) * c * DEG / dt); vy.push((s.pitch - p.pitch) * DEG / dt);
    ux.push(wrap(s.ty - p.ty) * c * DEG / dt); uy.push((s.tp - p.tp) * DEG / dt);
  }
  return { n, ex, ey, e, vx, vy, ux, uy };
}

// Is there anything to learn from this window? The target has to be near the crosshair most of
// the time, and something has to move (holding still on a still target looks the same for
// everyone).
export function aimGate(S) {
  if (!S || S.length < 20) return false;
  const { e, ux, uy, vx, vy } = series(S);
  let near = 0;
  for (const x of e) if (x < 4) near++;
  if (mean(e) > 8 || near < e.length * 0.4) return false;
  const u = Math.hypot(rms(ux), rms(uy)), v = Math.hypot(rms(vx), rms(vy));
  return u > 4 || v > 8;
}

export function aimFeatures(S) {
  const { n, ex, ey, e, vx, vy, ux, uy } = series(S);
  const rx = vx.map((v, i) => v - ux[i]), ry = vy.map((v, i) => v - uy[i]);
  const me = mean(e);
  let sd = 0;
  for (const x of e) sd += (x - me) ** 2;
  sd = Math.sqrt(sd / n);
  const late = e.slice(n >> 1).sort((a, b) => a - b), med = late[late.length >> 1];
  let on = 0;
  for (const x of e) if (x < 0.6) on++;
  // reaction delay: how many updates later the view's speed best follows the target's
  const c0 = corr(vx, ux);
  let best = c0, lag = 0;
  for (let k = 1; k <= 6; k++) { const c = corr(vx, ux, k); if (c > best) { best = c; lag = k; } }
  // jerkiness: how much the view's speed changes from one update to the next, for its speed
  const dv = [];
  for (let i = 1; i < vx.length; i++) dv.push(Math.hypot(vx[i] - vx[i - 1], vy[i] - vy[i - 1]));
  const vr = Math.hypot(rms(vx), rms(vy));
  // how evenly the error shrinks (smoothed aimbots close a fixed share of it every frame)
  const lr = [];
  for (let i = 1; i < n; i++) if (e[i - 1] > 0.8 && e[i] > 0.05) lr.push(Math.log(e[i] / e[i - 1]));
  let decay = 1;
  if (lr.length >= 4) { const m = mean(lr); decay = Math.sqrt(mean(lr.map((x) => (x - m) ** 2))); }
  // crossings: how often the aim swings from one side of the target to the other
  let zc = 0;
  for (let i = 1; i < n; i++) if ((ex[i] > 0) !== (ex[i - 1] > 0) && Math.abs(ex[i] - ex[i - 1]) > 0.05) zc++;
  // speed gain: the view's sideways speed against the target's
  let suu = 0, svu = 0;
  for (let i = 0; i < ux.length; i++) { suu += ux[i] * ux[i]; svu += vx[i] * ux[i]; }
  const gain = suu > ux.length * 4 ? Math.max(-1, Math.min(3, svu / suu)) : 1;
  let peak = 0;
  for (let i = 0; i < vx.length; i++) peak = Math.max(peak, Math.hypot(vx[i], vy[i]));
  return [
    Math.log(me + 0.05), Math.log(sd + 0.05), Math.log(med + 0.05), on / n,
    Math.log(Math.hypot(rms(rx), rms(ry)) + 0.5), Math.log(Math.hypot(rms(ux), rms(uy)) + 1), Math.log(vr + 1),
    c0, lag / 6, best - c0, Math.log(rms(dv) + 1) - Math.log(vr + 1), Math.min(2, decay),
    Math.log(rms(ry) + 0.5) - Math.log(rms(rx) + 0.5), zc / (n - 1), gain, Math.log(peak + 1),
  ];
}

// ---------- the network ----------
// layers: [{w: [[...inputs] per unit], b: [...]}], tanh between, a sigmoid at the end
export function forward(model, x) {
  let a = x.map((v, i) => (v - model.mean[i]) / model.std[i]);
  model.layers.forEach((L, li) => {
    const out = L.b.slice();
    for (let j = 0; j < out.length; j++) { const w = L.w[j]; let s = out[j]; for (let i = 0; i < a.length; i++) s += w[i] * a[i]; out[j] = s; }
    a = li < model.layers.length - 1 ? out.map(Math.tanh) : out;
  });
  return 1 / (1 + Math.exp(-a[0]));
}

// how likely (0..1) a window of aim is an aimbot's; null if there's nothing to learn from it
export function aimScore(S, model = MODEL) {
  if (!model || !aimGate(S)) return null;
  return forward(model, aimFeatures(S));
}
export const AIM_THRESHOLD = MODEL?.threshold ?? 0.98;
