// First-person weapon + arms, rendered in its own scene so it never clips into walls.
import * as THREE from 'three';
import { flashTexture } from './textures.js';

const M = {};
function mat(c) { return M[c] || (M[c] = new THREE.MeshLambertMaterial({ color: c })); }
const SHINY = {};
function shiny(c) { return SHINY[c] || (SHINY[c] = new THREE.MeshPhongMaterial({ color: c, shininess: 90, specular: 0x9a9a9a })); }
// polished steel: a bright "studio" reflection map so blades flash as they turn
let ENV = null;
function studioEnv() {
  if (ENV) return ENV;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#f2f6fb'); sky.addColorStop(0.42, '#9aa6b6'); sky.addColorStop(0.55, '#4a4e57'); sky.addColorStop(1, '#17161a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 256);
  ctx.filter = 'blur(6px)';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillRect(0, 96, 512, 12);                                   // a long softbox along the horizon
  for (const x of [70, 230, 390]) ctx.fillRect(x, 34, 52, 44);     // and three windows above it
  ctx.filter = 'none';
  ENV = new THREE.CanvasTexture(c);
  ENV.mapping = THREE.EquirectangularReflectionMapping;
  ENV.colorSpace = THREE.SRGBColorSpace;
  return ENV;
}
const STEEL = {};
function steel(c) {
  return STEEL[c] || (STEEL[c] = new THREE.MeshPhongMaterial({
    color: c, shininess: 160, specular: 0xf0f4fa, envMap: studioEnv(), reflectivity: 0.55, combine: THREE.MixOperation,
  }));
}
// katana steel: a dark mirror body with a frosted white hamon along the edge
function darkSteel(c) {
  return STEEL['d' + c] || (STEEL['d' + c] = new THREE.MeshPhongMaterial({
    color: c, shininess: 180, specular: 0xffffff, envMap: studioEnv(), reflectivity: 0.42, combine: THREE.MixOperation,
  }));
}
function frost(c) {
  return STEEL['f' + c] || (STEEL['f' + c] = new THREE.MeshPhongMaterial({
    color: c, shininess: 50, specular: 0x9aa4b0, envMap: studioEnv(), reflectivity: 0.12, combine: THREE.MixOperation,
  }));
}
const box = new THREE.BoxGeometry(1, 1, 1);
function b(parent, w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0, material = null) {
  const m = new THREE.Mesh(box, material || mat(color));
  m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m); return m;
}
function cyl(parent, r, len, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat(color));
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m;
}
// a box stretched between two points (used for the stick arms)
function limb(parent, from, to, thick, color) {
  const a = new THREE.Vector3(...from), c = new THREE.Vector3(...to);
  const m = new THREE.Mesh(box, mat(color));
  m.position.copy(a).add(c).multiplyScalar(0.5);
  m.scale.set(thick, thick, a.distanceTo(c));
  m.lookAt(c);
  parent.add(m);
  return m;
}

// Your arms: thin Tung Tung arms in the friendly (green) team color, with a wristband.
const WOOD = 0x5d9236, KNOB = 0x8cc45a;
let bareGuns = false;   // displayGuns(): the guns on their own, no arms
function arms(g, band, twoHands, leftZ = -0.26) {
  if (bareGuns) return;
  b(g, 0.055, 0.07, 0.075, KNOB, 0.0, -0.075, 0.06);                      // right hand
  b(g, 0.05, 0.05, 0.03, band, 0.02, -0.1, 0.12);                          // wristband
  limb(g, [0.01, -0.09, 0.09], [0.13, -0.3, 0.42], 0.045, WOOD);           // right arm
  if (twoHands) {
    b(g, 0.065, 0.055, 0.08, KNOB, -0.01, -0.05, leftZ);                   // left hand
    b(g, 0.05, 0.05, 0.03, band, -0.05, -0.1, leftZ + 0.08);
    limb(g, [-0.02, -0.07, leftZ + 0.03], [-0.22, -0.32, leftZ + 0.36], 0.045, WOOD);
  }
}

// ---------- knife hands ----------
// A hand is built in "wrist space": wrist at the origin, forearm toward +z, fingers forward (-z),
// palm facing -x, thumb up (+y). The handle it holds runs along y through GRIP, so the blade comes
// out of the top of the fist (thumb side) and the pommel out of the bottom (little finger side).
// The fingers are jointed, so the hand can let go of the knife while it spins and catch it again.
const GRIP = new THREE.Vector3(-0.025, 0, -0.052);
const KNUCKLE = 0x7fb64e;
const FIST = [1.32, 1.55, 0.3];    // finger joint angles when gripping
const SPLAY = [0.2, 0.25, 0.12];   // ...and with the hand open
function buildHand(band) {
  const h = new THREE.Group();
  b(h, 0.024, 0.066, 0.08, KNOB, 0, 0, -0.036);                // back of the hand
  b(h, 0.03, 0.05, 0.026, band, 0.001, -0.002, 0.008);         // wristband
  const fingers = [];
  for (const [y, s] of [[0.0255, 1.04], [0.0085, 1.0], [-0.0085, 0.95], [-0.0255, 0.83]]) {
    b(h, 0.012, 0.0135, 0.018, KNUCKLE, 0.008, y, -0.071);       // knuckle
    const joints = [];
    let parent = h, at = [-0.005, y, -0.072];
    for (const len of [0.034, 0.024, 0.018]) {
      const j = new THREE.Group(); j.position.set(...at); parent.add(j);
      b(j, 0.0145, 0.0145, len * s + 0.006, KNOB, 0, 0, -len * s / 2);
      joints.push(j); parent = j; at = [0, 0, -len * s];
    }
    fingers.push(joints);
  }
  const t1 = new THREE.Group(); t1.position.set(-0.011, 0.024, -0.026); t1.rotation.order = 'YXZ'; h.add(t1);
  b(t1, 0.017, 0.017, 0.036, KNOB, 0, 0, -0.018);
  const t2 = new THREE.Group(); t2.position.set(0, 0, -0.036); t1.add(t2);
  b(t2, 0.0155, 0.0155, 0.028, KNOB, 0, 0, -0.012);
  return { group: h, fingers, thumb: [t1, t2] };
}
function setGrip(hand, open, keepIndex) {
  hand.fingers.forEach((f, i) => {
    const o = keepIndex && i === 0 ? 0 : open;
    f.forEach((j, k) => { j.rotation.y = FIST[k] + (SPLAY[k] - FIST[k]) * o; });
  });
  // the thumb wraps over the index finger, and lifts off when the hand opens
  hand.thumb[0].rotation.set(-0.12 + 0.35 * open, 0.62 - 0.45 * open, 0);
  hand.thumb[1].rotation.y = 0.55 - 0.45 * open;
}

// ---------- knife skins ----------
// Blades are drawn as 2D outlines (x = forward, y = up) and extruded a few mm thick.
// Each build(k, parts) adds meshes to k and registers moving parts for the animations.
function bladeMesh(shape, depth, color, material = steel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, material(color));
}
function shapeFrom(fn) { const s = new THREE.Shape(); fn(s); return s; }

function knifeRegular(k) {
  k.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, -0.014); s.lineTo(0.13, -0.014);
    s.quadraticCurveTo(0.168, -0.008, 0.18, 0.012);
    s.lineTo(0.13, 0.021); s.lineTo(0, 0.02);
  }), 0.006, 0xc8ccd2));
  b(k, 0.1, 0.004, 0.0095, 0, 0.065, 0.009, 0, 0, 0, 0, steel(0x80868f));           // fuller
  b(k, 0.012, 0.055, 0.026, 0, 0, 0.003, 0, 0, 0, 0, shiny(0x3a3c40));              // guard
  b(k, 0.11, 0.032, 0.026, 0x1d1d1f, -0.06, 0.002, 0);                              // handle
  b(k, 0.014, 0.036, 0.03, 0x3a3c40, -0.118, 0.002, 0);                             // pommel
}

function knifeKarambit(k) {
  k.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, 0.014);
    s.quadraticCurveTo(0.09, 0.03, 0.12, -0.06);   // outer curve down to the claw tip
    s.quadraticCurveTo(0.075, -0.01, 0, -0.012);   // inner (sharp) edge back
  }), 0.006, 0xd2d6dc));
  const handle = new THREE.Group(); handle.rotation.z = 0.25; k.add(handle);
  b(handle, 0.1, 0.03, 0.024, 0x6b1f1f, -0.05, 0, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 18), shiny(0x9aa0a8));
  ring.position.set(-0.12, 0, 0); handle.add(ring);
}

function knifeFlip(k, parts) {
  // the blade swings on a hinge at the front of the handle; folded = rotated half a turn
  const hinge = new THREE.Group(); hinge.position.set(-0.004, 0.003, 0); k.add(hinge);
  hinge.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0.004, -0.018); s.lineTo(0.124, -0.018);
    s.quadraticCurveTo(0.169, -0.015, 0.179, 0.001);
    s.quadraticCurveTo(0.144, 0.019, 0.084, 0.02);
    s.lineTo(0.004, 0.018);
    s.lineTo(0.008, 0.029); s.lineTo(-0.004, 0.027); // flipper tab
    s.lineTo(-0.004, -0.018);
  }), 0.005, 0xb9bec6));
  parts.blade = hinge; parts.trailParent = hinge;
  b(k, 0.11, 0.03, 0.024, 0x2b2e33, -0.062, 0.003, 0);
  b(k, 0.02, 0.032, 0.026, 0x8a9099, -0.005, 0.003, 0, 0, 0, 0, shiny(0x8a9099)); // bolster
}

function knifeButterfly(k, parts) {
  // the fist holds handle B; the blade swings around B's pin, and handle A swings around the blade's other pin
  const handle = (parent, x, y, z) => {
    const piv = new THREE.Group(); piv.position.set(x, y, z); parent.add(piv);
    b(piv, 0.12, 0.014, 0.012, 0, -0.06, 0, 0, 0, 0, 0, shiny(0x6d7480));
    b(piv, 0.1, 0.006, 0.013, 0x22262c, -0.06, 0, 0);
    return piv;
  };
  handle(k, 0, -0.006, -0.007);
  const swing = new THREE.Group(); swing.position.set(0, -0.006, 0); k.add(swing);
  swing.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, -0.006); s.lineTo(0.14, -0.006);
    s.lineTo(0.175, 0.01);
    s.lineTo(0.14, 0.024); s.lineTo(0, 0.022);
  }), 0.005, 0xcfd3d9));
  parts.bfA = handle(swing, 0, 0.015, 0.007);
  parts.bfSwing = swing; parts.trailParent = swing;
}

function knifeSword(k) {
  const blade = new THREE.Group(); blade.rotation.z = 0.12; k.add(blade);
  blade.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, -0.021); s.lineTo(0.62, -0.021);
    s.lineTo(0.7, 0); s.lineTo(0.62, 0.021); s.lineTo(0, 0.021);
  }), 0.007, 0xd7dbe2));
  b(blade, 0.56, 0.006, 0.009, 0, 0.31, 0, 0, 0, 0, 0, steel(0x8d939c));             // fuller
  b(blade, 0.016, 0.13, 0.032, 0, 0, 0, 0, 0, 0, 0, shiny(0xc9a13b));                // crossguard
  b(blade, 0.13, 0.028, 0.026, 0x3b2414, -0.07, 0, 0);                                // grip
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), shiny(0xc9a13b));
  pommel.position.set(-0.14, 0, 0); blade.add(pommel);
}

// ----- katana -----
// The blade bends along a circle of radius KAT_R (its curve), so the sheath can slide along it.
// Shape points are given as [distance along the blade, offset toward the spine].
const KAT_L = 0.6, KAT_R = 3.6;
function arcPt(x, off) { const a = x / KAT_R, r = KAT_R - off; return [Math.sin(a) * r, KAT_R - Math.cos(a) * r]; }
function arcShape(pts) {
  const s = new THREE.Shape();
  pts.forEach(([x, o], i) => { const [px, py] = arcPt(x, o); if (i) s.lineTo(px, py); else s.moveTo(px, py); });
  return s;
}
const bez = (a, c, d, u) => [0, 1].map((i) => (1 - u) * (1 - u) * a[i] + 2 * (1 - u) * u * c[i] + u * u * d[i]);

function knifeKatana(k) {
  const L = KAT_L, N = 30;
  const outline = [];
  for (let i = 0; i <= N; i++) outline.push([L * i / N, 0.012 - 0.003 * i / N]);       // spine
  for (let i = 0; i <= 8; i++) outline.push(bez([L + 0.018, 0.007], [L + 0.004, -0.016], [L - 0.05, -0.016], i / 8)); // tip
  for (let i = N; i >= 0; i--) outline.push([(L - 0.05) * i / N, -0.019 + 0.003 * (1 - i / N)]);           // edge
  k.add(bladeMesh(arcShape(outline), 0.0055, 0x5f6874, darkSteel));
  // hamon: the bright hardened edge, with its wavy border
  const hamon = [];
  for (let i = 0; i <= 44; i++) { const x = 0.035 + (L - 0.09) * i / 44; hamon.push([x, -0.0085 + 0.0024 * Math.sin(i * 1.9)]); }
  for (let i = 0; i <= 6; i++) hamon.push(bez([L - 0.055, -0.009], [L, -0.008], [L + 0.012, 0.002], i / 6));
  hamon.push([L + 0.006, -0.008]);
  for (let i = 0; i <= 6; i++) hamon.push(bez([L - 0.002, -0.0145], [L - 0.03, -0.0158], [L - 0.055, -0.0158], i / 6));
  for (let i = 44; i >= 0; i--) hamon.push([0.035 + (L - 0.09) * i / 44, -0.0168 + 0.002 * (1 - i / 44)]);
  k.add(bladeMesh(arcShape(hamon), 0.0062, 0xf2f5f9, frost));
  const hi = [];   // bo-hi: the groove along the spine
  for (let i = 0; i <= 20; i++) hi.push([0.04 + 0.42 * i / 20, 0.0072 - 0.001 * i / 20]);
  for (let i = 20; i >= 0; i--) hi.push([0.04 + 0.42 * i / 20, 0.0032 - 0.0006 * i / 20]);
  k.add(bladeMesh(arcShape(hi), 0.0063, 0x3a4048, darkSteel));
  const gold = shiny(0xc9a13b);
  b(k, 0.028, 0.034, 0.011, 0, 0.014, -0.003, 0, 0, 0, 0.004, gold);                 // habaki
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.008, 20), shiny(0x24242a));
  tsuba.rotation.z = Math.PI / 2; tsuba.position.set(-0.005, -0.002, 0); tsuba.scale.set(1, 1, 0.82); k.add(tsuba);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0028, 6, 24), gold);
  rim.rotation.y = Math.PI / 2; rim.position.copy(tsuba.position); rim.scale.set(1, 1, 0.82); k.add(rim);
  b(k, 0.01, 0.033, 0.027, 0, -0.014, -0.001, 0, 0, 0, 0, gold);                      // fuchi
  b(k, 0.19, 0.029, 0.023, 0xe9e3d3, -0.112, -0.001, 0);                               // tsuka (ray skin)
  const ito = mat(0x1b1c2e);                                                            // diamond cord wrap
  for (let i = 0; i < 8; i++) {
    const x = -0.031 - i * 0.0225;
    b(k, 0.04, 0.0085, 0.0255, 0, x, -0.001, 0, 0, 0, 0.62, ito);
    b(k, 0.04, 0.0085, 0.0255, 0, x, -0.001, 0, 0, 0, -0.62, ito);
  }
  b(k, 0.022, 0.009, 0.0262, 0, -0.1, -0.001, 0, 0, 0, 0, gold);                       // menuki
  b(k, 0.014, 0.032, 0.027, 0, -0.212, -0.001, 0, 0, 0, 0, shiny(0x24242a));           // kashira
}

// the scabbard, built around the sheathed blade (same coordinates as the katana)
function buildSaya(parent) {
  const L = KAT_L + 0.05, N = 30, pts = [];
  for (let i = 0; i <= N; i++) pts.push([L * i / N, 0.019]);
  pts.push([L + 0.014, 0.013], [L + 0.02, -0.003], [L + 0.014, -0.021]);
  for (let i = N; i >= 0; i--) pts.push([L * i / N, -0.027]);
  const lacquer = new THREE.MeshPhongMaterial({ color: 0x18161d, shininess: 70, specular: 0x3c3c46 });
  const body = bladeMesh(arcShape(pts), 0.019, 0, () => lacquer);
  parent.add(body);
  const ring = (x0, x1, color, extra) => {
    const r = [[x0, 0.019 + extra], [x1, 0.019 + extra], [x1, -0.027 - extra], [x0, -0.027 - extra]];
    parent.add(bladeMesh(arcShape(r), 0.019 + extra * 2, 0, () => shiny(color)));
  };
  ring(0, 0.014, 0x3a332c, 0.0015);              // koiguchi (horn mouth)
  ring(0.15, 0.158, 0xc9a13b, 0.001);            // gold band
  ring(L - 0.006, L + 0.004, 0xc9a13b, 0.001);
  const [kx, ky] = arcPt(0.118, 0.025);           // kurikata knob with the red sageo cord
  b(parent, 0.016, 0.01, 0.01, 0x3a332c, kx, ky, 0);
  b(parent, 0.012, 0.03, 0.024, 0x9b1d22, kx + 0.01, ky + 0.004, 0, 0, 0, -0.35);
}

// ----- Kuronami no Yaiba (Valorant): a pair of kunai joined by a chain, kusarigama style -----
// Each kunai: an arrowhead blade with two barbs at its base, dark steel with a silver bevel and a glowing
// blue edge, a little glowing glyph, a square collar, a maroon cord-wrapped handle, and a hooked pommel
// with the ring the chain hangs from.
const KUNAI_TIP = 0.178;
const GLOW = {};
function glow(c) { return GLOW[c] || (GLOW[c] = new THREE.MeshBasicMaterial({ color: c })); }
function gunmetal(c) {
  return STEEL['g' + c] || (STEEL['g' + c] = new THREE.MeshPhongMaterial({
    color: c, shininess: 120, specular: 0xb4c4dc, envMap: studioEnv(), reflectivity: 0.22, combine: THREE.MixOperation,
  }));
}
function knifeKunai(k, parts) {
  const D = 0.0055;
  k.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, 0.009); s.lineTo(-0.007, 0.022); s.lineTo(KUNAI_TIP, 0);
    s.lineTo(-0.007, -0.022); s.lineTo(0, -0.009);
  }), D, 0x343c4d, gunmetal));
  k.add(bladeMesh(shapeFrom((s) => {                                   // the dark hollow down the middle
    s.moveTo(0.008, 0.0115); s.lineTo(0.128, 0.0012); s.lineTo(0.128, -0.0012); s.lineTo(0.008, -0.0115);
  }), D + 0.0008, 0x151a26, darkSteel));
  for (const side of [1, -1]) {                                        // glowing edges, brightest at the tip
    k.add(bladeMesh(shapeFrom((s) => {
      s.moveTo(0.02, side * 0.0198); s.lineTo(KUNAI_TIP + 0.0015, 0); s.lineTo(0.02, side * 0.0142);
    }), D + 0.0004, 0x9fe6ff, glow));
  }
  const rune = glow(0x6fd0ff);                                         // the little glyph on each face
  for (const z of [D / 2 + 0.0024, -D / 2 - 0.0024]) {
    b(k, 0.0014, 0.012, 0.0006, 0, 0.032, 0, z, 0, 0, 0.15, rune);
    b(k, 0.0014, 0.007, 0.0006, 0, 0.0285, 0.0035, z, 0, 0, 0.9, rune);
    b(k, 0.0014, 0.007, 0.0006, 0, 0.0355, -0.003, z, 0, 0, 0.75, rune);
    b(k, 0.0014, 0.006, 0.0006, 0, 0.036, 0.004, z, 0, 0, -0.7, rune);
  }
  b(k, 0.016, 0.022, 0.013, 0, -0.008, 0, 0, 0, 0, 0, steel(0xaab2bf));          // collar
  b(k, 0.01, 0.014, 0.0142, 0, -0.008, 0, 0, 0, 0, 0, shiny(0x1c212b));           // ...and its dark inset
  b(k, 0.072, 0.016, 0.0135, 0x4b1d1f, -0.052, 0, 0);                             // handle
  for (let i = 0; i < 5; i++) {                                                    // cord wrap
    const x = -0.024 - i * 0.0132;
    b(k, 0.02, 0.0042, 0.0145, 0x2a0f12, x, 0, 0, 0, 0, 0.62);
    b(k, 0.02, 0.0042, 0.0145, 0x2a0f12, x, 0, 0, 0, 0, -0.62);
  }
  b(k, 0.004, 0.018, 0.0148, 0x1a1c22, -0.018, 0, 0);
  b(k, 0.004, 0.018, 0.0148, 0x1a1c22, -0.086, 0, 0);
  b(k, 0.012, 0.019, 0.015, 0, -0.094, 0, 0, 0, 0, 0, shiny(0x252a35));           // pommel block
  k.add(bladeMesh(shapeFrom((s) => {                                               // hooked claw on the pommel
    s.moveTo(-0.089, 0.006); s.quadraticCurveTo(-0.091, 0.03, -0.12, 0.039);
    s.quadraticCurveTo(-0.101, 0.024, -0.1, 0.006);
  }), 0.005, 0xc8ced8));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0062, 0.0019, 5, 12), steel(0xbfc6d1));
  ring.scale.set(1.3, 1, 1); ring.rotation.x = PI / 2; ring.position.set(-0.106, -0.004, 0); k.add(ring);
  parts.ring = new THREE.Object3D(); parts.ring.position.set(-0.112, -0.004, 0); k.add(parts.ring);
}

// ---------- CS2-style animations ----------
// Keyframe tracks [time, value]; values blend with an ease-in-out between keys.
//   px py pz : the wrist's offset from its rest position (meters)
//   rx ry rz : the hand turned around the wrist, in screen axes (rz spins it like a clock hand, ry swings it
//              left/right, rx tips the blade toward/away from you)            roll : wrist roll around the forearm
//   twirl : knife spins around its handle         spin : knife rotates in the blade's plane around its pivot
//   open  : 0 = gripping, 1 = fingers open       blade : flip knife blade (0 open, PI folded)
//   bfB : butterfly blade folding into the held handle, bfA : the free handle (0 open, ±PI closed)
//   trail : brightness of the slash trail        glint / glintAt : sparkle on the blade and where (0 base .. 1 tip)
//   katana draw: lvis (scabbard shown), attach (1 = scabbard on the blade), sheath (meters slid off the blade),
//                lpx..lrz (how the scabbard falls once let go)
//   kuronami: reach (meters the kunai has flown out of the fist on its chain; with spin it orbits the fist),
//             lpx..lrz move the left hand, and lspin / lreach / lopen / ltrail are the left kunai's spin, reach,
//             fingers and trail
// A key [time, value, 1] is reached at a constant speed instead of easing (for steady spins).
// events: [time, sound] pairs played as the clip passes them.
// loop: [from, to] (kuronami inspect): pressing inspect again inside it spins faster and repeats that stretch.
const PI = Math.PI, TAU = Math.PI * 2;
const SLASH = {
  // forehand: cocked back to the right, ripped across to the left
  a: { dur: 0.42, events: [[0.06, 'swish']], tracks: {
    px: [[0, 0], [0.07, 0.05], [0.18, -0.19], [0.26, -0.22], [0.42, 0]],
    py: [[0, 0], [0.07, 0.03], [0.18, -0.02], [0.26, -0.05], [0.42, 0]],
    pz: [[0, 0], [0.07, 0.02], [0.18, -0.05], [0.42, 0]],
    ry: [[0, 0], [0.07, -0.55], [0.18, 0.75], [0.26, 0.85], [0.42, 0]],
    rz: [[0, 0], [0.07, -0.35], [0.18, 0.45], [0.26, 0.5], [0.42, 0]],
    rx: [[0, 0], [0.07, 0.25], [0.18, -0.3], [0.42, 0]],
    trail: [[0, 0], [0.08, 0.15], [0.12, 1], [0.21, 1], [0.27, 0]],
  } },
  // backhand: wound up to the left, swept back across to the right
  b: { dur: 0.42, events: [[0.06, 'swish']], tracks: {
    px: [[0, 0], [0.07, -0.13], [0.18, 0.08], [0.26, 0.09], [0.42, 0]],
    py: [[0, 0], [0.07, 0.05], [0.18, -0.04], [0.42, 0]],
    pz: [[0, 0], [0.07, 0.02], [0.18, -0.05], [0.42, 0]],
    ry: [[0, 0], [0.07, 0.8], [0.18, -0.6], [0.26, -0.68], [0.42, 0]],
    rz: [[0, 0], [0.07, 0.45], [0.18, -0.45], [0.26, -0.5], [0.42, 0]],
    rx: [[0, 0], [0.07, -0.15], [0.18, 0.2], [0.42, 0]],
    trail: [[0, 0], [0.08, 0.15], [0.12, 1], [0.21, 1], [0.27, 0]],
  } },
};
// a pose held from a to b, eased in from rest before it and back to rest by c (kept: held through a draw)
const held = (v, a, b, c) => [[0, 0], [a, v], [b, v], [c, 0]];
const kept = (v) => [[0, v], [0.45, v], [0.6, 0]];
const CLIPS = {
  knife: {
    // flipped up from below, spun once in the open hand and caught
    draw: { dur: 0.95, events: [[0.1, 'swish']], tracks: {
      px: [[0, 0.05], [0.3, -0.03], [0.7, 0]], py: [[0, -0.24], [0.3, 0.04], [0.65, 0]],
      rx: [[0, 0.7], [0.3, -0.1], [0.6, 0]], rz: [[0, -0.2], [0.3, 0.1], [0.52, -0.12], [0.75, 0.03], [0.95, 0]],
      spin: [[0, -TAU], [0.5, 0]], open: [[0, 0.65], [0.42, 0.65], [0.52, 0]],
      trail: [[0, 0], [0.08, 0.35], [0.42, 0.35], [0.5, 0]],
    } },
    // brings the blade up to show it off, tosses it to flip it over, checks the edge, flips it back
    inspect: { dur: 3.9, events: [[1.45, 'swish'], [2.95, 'swish']], tracks: {
      px: [[0, 0], [0.5, -0.085], [3.35, -0.085], [3.9, 0]],
      py: [[0, 0], [0.5, 0.1], [1.4, 0.1], [1.65, 0.14], [1.95, 0.1], [3.35, 0.1], [3.9, 0]],
      pz: [[0, 0], [0.5, 0.06], [3.35, 0.06], [3.9, 0]],
      rz: [[0, 0], [0.5, 0.9], [1.4, 0.95], [1.95, 0.9], [3.35, 0.9], [3.9, 0]],
      ry: [[0, 0], [0.5, 0.35], [1.4, 0.48], [1.95, 0.4], [3.35, 0.4], [3.9, 0]],
      roll: [[0, 0], [0.5, -0.5], [1.4, -0.5], [1.95, -0.3], [2.4, -0.3], [2.65, -1.25], [2.85, -1.25], [3.05, -0.3], [3.9, 0]],
      spin: [[0, 0], [1.42, 0], [1.92, TAU], [3.9, TAU]],
      twirl: [[0, 0], [1.42, 0], [1.92, PI], [2.95, PI], [3.35, TAU], [3.9, TAU]],
      open: [[0, 0], [1.38, 0], [1.45, 1], [1.88, 1], [1.95, 0], [2.92, 0], [2.98, 0.45], [3.3, 0.45], [3.38, 0]],
      trail: [[0, 0], [1.45, 0], [1.52, 0.4], [1.85, 0.4], [1.92, 0]],
      glint: [[0, 0], [0.55, 0], [0.75, 1], [1.2, 0], [2.0, 0], [2.2, 1], [2.55, 0]],
      glintAt: [[0, 0.1], [0.55, 0.12], [1.2, 0.95], [2.0, 0.15], [2.55, 0.9]],
    } },
  },
  karambit: {
    // brought up spinning twice around the index finger through the ring, then caught in the fist
    draw: { dur: 1.15, events: [[0.18, 'swish'], [0.5, 'swish']], tracks: {
      px: [[0, 0.04], [0.3, -0.03], [0.85, -0.03], [1.15, 0]],
      py: [[0, -0.24], [0.3, 0.04], [0.85, 0.03], [1.15, 0]],
      rx: [[0, 0.6], [0.3, -0.06], [0.55, 0]],
      spin: [[0, -2 * TAU], [0.82, 0]], open: [[0, 1], [0.72, 1], [0.86, 0]],
      rz: [[0, -0.25], [0.45, 0], [0.86, 0.12], [1.15, 0]],
      trail: [[0, 0], [0.12, 0.45], [0.72, 0.45], [0.84, 0]],
    } },
    // shows the claw, spins it on the finger, turns it over, spins twice more
    inspect: { dur: 4.2, events: [[0.95, 'swish'], [2.45, 'swish'], [2.95, 'swish']], tracks: {
      px: [[0, 0], [0.45, -0.07], [3.7, -0.07], [4.2, 0]],
      py: [[0, 0], [0.45, 0.07], [3.7, 0.07], [4.2, 0]],
      pz: [[0, 0], [0.45, 0.03], [3.7, 0.03], [4.2, 0]],
      rz: [[0, 0], [0.45, -0.35], [1.75, -0.35], [2.15, -0.1], [3.7, -0.1], [4.2, 0]],
      ry: [[0, 0], [0.45, -0.25], [1.75, -0.25], [2.15, 0.2], [3.7, 0.2], [4.2, 0]],
      twirl: [[0, 0], [1.75, 0], [2.15, PI], [3.7, PI], [4.2, TAU]],
      spin: [[0, 0], [0.85, 0], [1.45, -TAU], [2.35, -TAU], [3.35, -3 * TAU], [4.2, -3 * TAU]],
      open: [[0, 0], [0.78, 0], [0.86, 1], [1.45, 1], [1.55, 0], [1.75, 0], [1.8, 0.4], [2.1, 0.4], [2.28, 0], [2.36, 1], [3.35, 1], [3.45, 0]],
      trail: [[0, 0], [0.88, 0], [0.98, 0.4], [1.4, 0.4], [1.45, 0], [2.36, 0], [2.46, 0.4], [3.3, 0.4], [3.35, 0]],
      glint: [[0, 0], [0.4, 0], [0.55, 1], [0.8, 0]], glintAt: [[0, 0.2], [0.4, 0.2], [0.8, 0.95]],
    } },
  },
  flip: {
    // comes out folded, a flick of the wrist snaps the blade open
    draw: { dur: 1.0, events: [[0.42, 'bladeClick']], tracks: {
      px: [[0, 0.04], [0.25, -0.03], [0.6, -0.02], [1.0, 0]],
      py: [[0, -0.22], [0.25, 0.04], [0.6, 0.02], [1.0, 0]],
      rx: [[0, 0.6], [0.25, -0.05], [0.5, 0]],
      blade: [[0, PI], [0.28, PI], [0.44, 0]],
      rz: [[0, -0.1], [0.3, -0.3], [0.44, 0.3], [0.65, -0.05], [1.0, 0]],
      glint: [[0, 0], [0.44, 0], [0.55, 1], [0.8, 0]], glintAt: [[0, 0.95], [0.8, 0.45]],
    } },
    // turns it to the light, folds the blade, flicks it open again, little toss and catch
    inspect: { dur: 4.3, events: [[1.95, 'bladeClick'], [2.55, 'bladeClick'], [3.05, 'swish']], tracks: {
      px: [[0, 0], [0.4, -0.08], [3.8, -0.08], [4.3, 0]],
      py: [[0, 0], [0.4, 0.06], [3.0, 0.06], [3.25, 0.13], [3.55, 0.06], [3.8, 0.06], [4.3, 0]],
      pz: [[0, 0], [0.4, 0.03], [3.8, 0.03], [4.3, 0]],
      rz: [[0, 0], [0.4, 0.5], [1.1, 0.55], [1.6, 0.3], [2.4, 0.3], [2.5, 0.7], [2.7, 0.2], [3.8, 0.3], [4.3, 0]],
      ry: [[0, 0], [0.4, -0.3], [1.1, -0.3], [1.6, 0.25], [3.8, 0.25], [4.3, 0]],
      twirl: [[0, 0], [1.05, 0], [1.6, PI], [3.8, PI], [4.3, TAU]],
      blade: [[0, 0], [1.8, 0], [2.1, PI], [2.4, PI], [2.56, 0], [4.3, 0]],
      spin: [[0, 0], [3.0, 0], [3.55, TAU], [4.3, TAU]],
      open: [[0, 0], [1.05, 0], [1.1, 0.4], [1.55, 0.4], [1.62, 0], [2.98, 0], [3.05, 1], [3.5, 1], [3.6, 0]],
      trail: [[0, 0], [3.05, 0], [3.15, 0.45], [3.45, 0.45], [3.55, 0]],
      glint: [[0, 0], [0.45, 0], [0.65, 1], [0.95, 0], [2.6, 0], [2.75, 1], [3.0, 0]],
      glintAt: [[0, 0.15], [0.95, 0.9], [2.6, 0.9], [3.0, 0.3]],
    } },
  },
  butterfly: {
    // starts closed: one handle swings open, the knife rolls over, the second handle swings, locked open
    draw: { dur: 1.35, events: [[0.4, 'swish'], [0.98, 'bladeClick']], tracks: {
      px: [[0, 0.04], [0.3, -0.04], [0.98, -0.03], [1.35, 0]],
      py: [[0, -0.22], [0.3, 0.05], [0.98, 0.04], [1.35, 0]],
      rx: [[0, 0.5], [0.3, -0.04], [0.5, 0]],
      bfA: [[0, PI], [0.3, PI], [0.62, 0]], bfB: [[0, -PI], [0.62, -PI], [0.98, 0]],
      roll: [[0, 0], [0.3, -0.55], [0.62, 0.9], [0.98, -0.35], [1.35, 0]],
      rz: [[0, -0.2], [0.98, 0.1], [1.35, 0]],
      trail: [[0, 0], [0.32, 0], [0.4, 0.35], [0.95, 0.35], [1.0, 0]],
    } },
    // two full open/close flips, then an aerial: tossed, spun and caught by the handle
    inspect: { dur: 4.8, events: [[0.8, 'bladeClick'], [1.3, 'bladeClick'], [2.2, 'bladeClick'], [2.95, 'bladeClick'], [3.05, 'swish']], tracks: {
      px: [[0, 0], [0.4, -0.08], [4.3, -0.08], [4.8, 0]],
      py: [[0, 0], [0.4, 0.06], [3.0, 0.06], [3.3, 0.15], [3.6, 0.06], [4.3, 0.06], [4.8, 0]],
      pz: [[0, 0], [0.4, 0.03], [4.3, 0.03], [4.8, 0]],
      rz: [[0, 0], [0.4, 0.45], [4.3, 0.45], [4.8, 0]],
      ry: [[0, 0], [0.4, -0.25], [4.3, -0.25], [4.8, 0]],
      bfA: [[0, 0], [0.5, 0], [0.8, PI], [1.1, 0], [1.9, 0], [2.2, PI], [2.5, PI], [2.8, 0], [4.8, 0]],
      bfB: [[0, 0], [0.6, 0], [0.95, -PI], [1.3, 0], [2.0, 0], [2.3, -PI], [2.6, -PI], [2.95, 0], [4.8, 0]],
      roll: [[0, 0], [0.5, 0], [0.8, 0.8], [1.1, -0.6], [1.3, 0], [1.9, 0], [2.2, 0.8], [2.6, -0.6], [2.95, 0], [4.8, 0]],
      spin: [[0, 0], [3.0, 0], [3.6, TAU], [4.8, TAU]],
      open: [[0, 0], [2.98, 0], [3.04, 1], [3.55, 1], [3.65, 0]],
      trail: [[0, 0], [0.5, 0], [0.6, 0.3], [1.25, 0.3], [1.3, 0], [1.9, 0], [2.0, 0.3], [2.9, 0.3], [3.0, 0], [3.1, 0.45], [3.5, 0.45], [3.6, 0]],
      glint: [[0, 0], [3.65, 0], [3.8, 1], [4.1, 0]], glintAt: [[0, 0.2], [3.65, 0.2], [4.1, 0.9]],
    } },
  },
  sword: {
    // drawn from over the shoulder and swung down into the ready position
    draw: { dur: 1.15, events: [[0.05, 'bladeDraw'], [0.2, 'swish']], tracks: {
      px: [[0, 0.08], [0.42, -0.06], [1.15, 0]], py: [[0, 0.16], [0.42, -0.06], [0.75, 0.01], [1.15, 0]],
      rx: [[0, 1.4], [0.42, -0.4], [0.75, 0.06], [1.15, 0]], ry: [[0, -0.5], [0.42, 0.2], [1.15, 0]],
      trail: [[0, 0], [0.12, 0.8], [0.42, 0.8], [0.52, 0]],
      glint: [[0, 0], [0.7, 0], [0.85, 1], [1.1, 0]], glintAt: [[0, 0.3], [1.1, 0.95]],
    } },
    // two windmill spins around the grip, shows the blade, then a salute
    inspect: { dur: 4.2, events: [[0.45, 'swish'], [0.95, 'swish']], tracks: {
      spin: [[0, 0], [0.35, 0], [1.4, -2 * TAU], [4.2, -2 * TAU]],
      open: [[0, 0], [0.3, 0], [0.38, 0.55], [1.35, 0.55], [1.45, 0]],
      px: [[0, 0], [1.4, 0], [1.75, -0.08], [2.85, -0.08], [3.15, -0.03], [3.8, -0.03], [4.2, 0]],
      py: [[0, 0], [1.4, 0], [1.75, 0.03], [2.85, 0.03], [3.15, 0], [4.2, 0]],
      rz: [[0, 0], [1.4, 0], [1.75, 0.6], [2.85, 0.65], [3.15, 0]],
      ry: [[0, 0], [1.4, 0], [1.75, -0.35], [2.85, -0.4], [3.15, 0]],
      rx: [[0, 0], [3.1, 0], [3.4, 0.75], [3.8, 0.75], [4.2, 0]],
      trail: [[0, 0], [0.4, 0], [0.5, 0.45], [1.3, 0.45], [1.4, 0]],
      glint: [[0, 0], [1.8, 0], [2.0, 1], [2.7, 0]], glintAt: [[0, 0.1], [1.8, 0.1], [2.7, 1]],
    } },
  },
  katana: {
    // Iai draw: the sheathed katana comes up across the view with the left hand on the scabbard, the thumb pops
    // it loose, the right hand rips the blade out as the left pulls the scabbard away, straight into a cut
    // across the screen; the scabbard drops, a chiburi flick, and back to ready.
    draw: { dur: 1.75, events: [[0.31, 'bladeClick'], [0.41, 'bladeDraw'], [0.64, 'swish'], [1.0, 'swish']], tracks: {
      px: [[0, 0.04], [0.28, 0], [0.4, 0], [0.6, 0.06], [0.7, 0.02], [0.8, -0.03], [0.88, -0.06], [0.98, -0.05], [1.08, 0], [1.6, 0]],
      py: [[0, -0.2], [0.28, 0.09], [0.31, 0.09], [0.34, 0.1], [0.4, 0.09], [0.6, 0.08], [0.8, 0.09], [0.88, 0.1], [0.98, 0.12], [1.08, 0.0], [1.2, 0.02], [1.6, 0]],
      pz: [[0, 0.02], [0.28, 0], [0.4, 0], [0.6, 0.04], [0.8, -0.02], [1.3, 0]],
      rx: [[0, 0.3], [0.28, -0.3], [0.6, -0.3], [0.7, -0.25], [0.8, -0.2], [0.98, 0.25], [1.08, -0.45], [1.2, -0.3], [1.65, 0]],
      ry: [[0, 0.65], [0.6, 0.65], [0.7, 0.0], [0.8, -0.3], [0.88, -0.25], [1.08, -0.15], [1.65, 0]],
      rz: [[0, 0.75], [0.6, 0.75], [0.7, 0.3], [0.8, -0.6], [0.88, -1.35], [0.98, -1.2], [1.08, -0.5], [1.2, -0.3], [1.65, 0]],
      lvis: [[0, 1], [1.05, 1], [1.06, 0]],
      attach: [[0, 1], [0.6, 1], [0.601, 0]],
      sheath: [[0, 0], [0.3, 0], [0.35, 0.03], [0.41, 0.03], [0.6, 0.64]],
      lpx: [[0, 0], [0.6, 0], [0.8, -0.05], [1.05, -0.12]],
      lpy: [[0, 0], [0.6, 0], [0.8, -0.1], [1.05, -0.38]],
      lpz: [[0, 0], [0.6, 0], [1.05, 0.06]],
      lrz: [[0, 0], [0.6, 0], [1.05, 0.5]],
      lrx: [[0, 0], [0.6, 0], [1.05, -0.4]],
      trail: [[0, 0], [0.45, 0], [0.56, 0.5], [0.64, 1], [0.86, 1], [0.93, 0]],
      glint: [[0, 0], [0.3, 0], [0.35, 1], [0.46, 0], [1.3, 0], [1.42, 1], [1.7, 0]],
      glintAt: [[0, 0.01], [0.46, 0.02], [1.3, 0.1], [1.7, 1]],
    } },
    // windmill spins around the grip, turns the blade flat to run the light along it, chiburi flick
    inspect: { dur: 4.6, events: [[0.45, 'swish'], [0.95, 'swish'], [3.6, 'swish']], tracks: {
      spin: [[0, 0], [0.35, 0], [1.45, -2 * TAU], [4.6, -2 * TAU]],
      open: [[0, 0], [0.3, 0], [0.38, 0.55], [1.4, 0.55], [1.5, 0]],
      px: [[0, 0], [1.45, 0], [1.85, -0.09], [3.3, -0.09], [3.55, 0.03], [3.75, 0.04], [4.6, 0]],
      py: [[0, 0], [1.45, 0], [1.85, 0.03], [3.3, 0.03], [3.55, -0.04], [4.6, 0]],
      pz: [[0, 0], [1.45, 0], [1.85, 0.02], [3.3, 0.02], [3.55, 0], [4.6, 0]],
      rz: [[0, 0], [1.45, 0], [1.85, 0.75], [3.3, 0.8], [3.55, -0.2], [4.6, 0]],
      ry: [[0, 0], [1.45, 0], [1.85, -0.25], [3.3, -0.3], [3.55, 0.2], [4.6, 0]],
      rx: [[0, 0], [1.45, 0], [1.85, 0.1], [3.3, 0.1], [3.5, -0.35], [3.65, 0.1], [4.6, 0]],
      trail: [[0, 0], [0.4, 0], [0.5, 0.45], [1.35, 0.45], [1.45, 0], [3.35, 0], [3.45, 0.8], [3.62, 0.8], [3.7, 0]],
      glint: [[0, 0], [1.95, 0], [2.15, 1], [3.05, 1], [3.25, 0]], glintAt: [[0, 0.05], [1.95, 0.05], [3.25, 1]],
    } },
  },
  // Kuronami no Yaiba, timed from Riot's preview video. The hand angles below turn each spin into the plane it
  // needs (flat rings over the palms, a propeller facing you, or a sweep across the screen).
  kuronami: {
    // floats in: both hands come up open while the kunai whirl in glowing rings over the palms, then snatch them
    draw: { dur: 0.95, trailFrom: 0.6, events: [[0.02, 'chain'], [0.16, 'swish'], [0.33, 'swish'], [0.55, 'bladeClick']], tracks: {
      px: [[0, 0.04], [0.15, 0.03], [0.45, 0.02], [0.56, -0.01], [0.95, 0]],
      py: [[0, -0.26], [0.15, 0.01], [0.45, 0.0], [0.56, -0.08], [0.95, 0]],
      pz: [[0, 0], [0.15, -0.04], [0.45, -0.04], [0.6, 0], [0.95, 0]],
      rx: kept(-0.456), ry: kept(1.586), rz: kept(0.695),
      lpx: [[0, -0.04], [0.15, -0.03], [0.45, -0.02], [0.56, 0.01], [0.95, 0]],
      lpy: [[0, -0.26], [0.15, 0.03], [0.45, 0.02], [0.56, -0.08], [0.95, 0]],
      lpz: [[0, 0], [0.15, -0.04], [0.45, -0.04], [0.6, 0], [0.95, 0]],
      lrx: kept(0.714), lry: kept(2.065), lrz: kept(-2.017),
      open: [[0, 1], [0.48, 1], [0.56, 0]], lopen: [[0, 1], [0.48, 1], [0.56, 0]],
      reach: [[0, -0.02], [0.45, -0.02], [0.56, 0]], lreach: [[0, -0.02], [0.45, -0.02], [0.56, 0]],
      spin: [[0, -4.5], [0.45, 5.0, 1], [0.56, TAU]], lspin: [[0, 4.5], [0.45, -5.0, 1], [0.56, -TAU]],
      trail: [[0, 0], [0.06, 0.8], [0.45, 0.8], [0.52, 0]], ltrail: [[0, 0], [0.06, 0.8], [0.45, 0.8], [0.52, 0]],
      glint: [[0, 0], [0.62, 0], [0.75, 1], [0.92, 0]], glintAt: [[0, 0.5], [0.62, 0.5], [0.92, 1]],
    } },
    // the right hand lifts its kunai on the chain and spins it like a propeller facing you (inspect again to spin
    // faster), the left shows off its blade; then the kunai is caught and the left one tossed and caught
    inspect: { dur: 3.6, trailFrom: 0.55, loop: [0.6, 2.6],
      events: [[0.12, 'chain'], [0.62, 'swish'], [0.95, 'swish'], [1.28, 'swish'], [1.61, 'swish'], [1.94, 'swish'], [2.27, 'swish'],
        [2.84, 'swish'], [2.98, 'bladeClick']], tracks: {
      px: [[0, 0], [0.3, 0.01], [2.75, 0.01], [3.1, 0]],
      py: [[0, 0], [0.3, 0.03], [2.75, 0.03], [3.0, -0.02], [3.4, 0]],
      pz: [[0, 0], [0.3, -0.08], [2.75, -0.08], [3.2, 0]],
      rx: held(-1.101, 0.3, 2.85, 3.3), ry: held(0.662, 0.3, 2.85, 3.3), rz: held(-1.62, 0.3, 2.85, 3.3),
      twirl: held(-2.1, 0.3, 2.85, 3.3),
      open: [[0, 0], [0.1, 0], [0.18, 0.7], [0.3, 0.3], [2.85, 0.3], [2.95, 0]],
      reach: [[0, 0], [0.12, 0], [0.3, 0.1], [2.75, 0.1], [2.97, 0]],
      spin: [[0, 0], [0.3, 0], [0.45, 0.6, 1], [0.6, 2.4, 1], [2.6, 2.4 + 12 * PI, 1], [2.8, 5 + 12 * PI, 1], [2.97, 14 * PI]],
      trail: [[0, 0], [0.3, 0], [0.45, 0.5], [0.6, 1], [2.75, 1], [2.92, 0]],
      lpx: [[0, 0], [0.35, 0.02], [2.75, 0.02], [3.2, 0]],
      lpy: [[0, 0], [0.35, -0.03], [2.78, -0.03], [2.95, 0.05], [3.15, -0.02], [3.5, 0]],
      lrx: held(-0.226, 0.35, 2.78, 3.2), lry: held(-0.701, 0.35, 2.78, 3.2), lrz: held(-0.346, 0.35, 2.78, 3.2),
      lspin: [[0, 0], [2.8, 0], [3.12, -TAU]],
      lopen: [[0, 0], [2.79, 0], [2.84, 1], [3.08, 1], [3.14, 0]],
      ltrail: [[0, 0], [2.82, 0], [2.88, 0.6], [3.06, 0.6], [3.12, 0]],
      glint: [[0, 0], [0.15, 0], [0.28, 1], [0.5, 0], [3.1, 0], [3.25, 1], [3.5, 0]],
      glintAt: [[0, 0.3], [0.5, 0.95], [3.1, 0.4], [3.5, 1]],
    } },
    // chain whips (attacks alternate): wind up high and right, fling the kunai out so it sweeps across the screen
    // from the upper right to the lower left, yank it back; and out to the right, over the top to the upper left
    slash: [
      { dur: 0.45, events: [[0.06, 'chain'], [0.11, 'swish']], tracks: {
        px: [[0, 0], [0.07, 0.03], [0.21, -0.13], [0.3, -0.07], [0.45, 0]],
        py: [[0, 0], [0.07, 0.09], [0.21, -0.05], [0.3, -0.03], [0.45, 0]],
        pz: [[0, 0], [0.07, -0.02], [0.21, -0.05], [0.45, 0]],
        rx: held(-0.378, 0.07, 0.24, 0.32), ry: held(1.792, 0.07, 0.24, 0.32), rz: held(-2.238, 0.07, 0.24, 0.32),
        twirl: held(2.4, 0.07, 0.24, 0.32),
        reach: [[0, 0], [0.07, 0.04], [0.13, 0.45], [0.21, 0.45], [0.3, 0]],
        spin: [[0, 0], [0.1, 0], [0.21, 3.1], [0.3, TAU]],
        open: [[0, 0], [0.06, 0.25], [0.3, 0.25], [0.36, 0]],
        trail: [[0, 0], [0.09, 0.3], [0.12, 1], [0.2, 1], [0.23, 0]],
        lpx: [[0, 0], [0.1, -0.06], [0.3, -0.06], [0.45, 0]], lpy: [[0, 0], [0.1, -0.2], [0.3, -0.2], [0.45, 0]],
        lrx: [[0, 0], [0.1, 0.4], [0.3, 0.4], [0.45, 0]],
      } },
      { dur: 0.45, events: [[0.06, 'chain'], [0.11, 'swish']], tracks: {
        px: [[0, 0], [0.07, -0.07], [0.21, 0.03], [0.3, 0.02], [0.45, 0]],
        py: [[0, 0], [0.07, -0.02], [0.21, 0.1], [0.3, 0.04], [0.45, 0]],
        pz: [[0, 0], [0.07, 0.0], [0.21, -0.05], [0.45, 0]],
        rx: held(0.471, 0.07, 0.24, 0.32), ry: held(1.849, 0.07, 0.24, 0.32), rz: held(-2.16, 0.07, 0.24, 0.32),
        twirl: held(3.15, 0.07, 0.24, 0.32),
        reach: [[0, 0], [0.07, 0.04], [0.13, 0.45], [0.21, 0.45], [0.3, 0]],
        spin: [[0, 0], [0.1, 0], [0.21, 3.0], [0.3, TAU]],
        open: [[0, 0], [0.06, 0.25], [0.3, 0.25], [0.36, 0]],
        trail: [[0, 0], [0.09, 0.3], [0.12, 1], [0.2, 1], [0.23, 0]],
        lpx: [[0, 0], [0.1, -0.06], [0.3, -0.06], [0.45, 0]], lpy: [[0, 0], [0.1, -0.2], [0.3, -0.2], [0.45, 0]],
        lrx: [[0, 0], [0.1, 0.4], [0.3, 0.4], [0.45, 0]],
      } },
    ],
  },
};
const ease = (t) => t * t * (3 - 2 * t);
function sampleTrack(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, linear] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1], u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (linear ? u : ease(u));
    }
  }
  return keys[keys.length - 1][1];
}

export const KNIFE_SKINS = [
  // grip: the point (in blade space) the fist closes around; pivot: what `spin` turns around (karambit: its ring);
  // gripAngle: how far the handle is tilted from the blade; reverse: blade comes out of the little-finger side;
  // trail: blade base and tip, for glints and the slash trail (which starts trailFrom of the way up long blades).
  { id: 'knife', name: 'Knife', build: knifeRegular, grip: [-0.058, 0.002], pivot: [-0.058, 0.002],
    trail: [[0.02, 0.003], [0.178, 0.01]] },
  { id: 'karambit', name: 'Karambit', build: knifeKarambit, reverse: true, gripAngle: 0.25, ring: true,
    grip: [-0.072, -0.018], pivot: [-0.1163, -0.0297], trail: [[0.02, 0.006], [0.118, -0.056]] },
  { id: 'flip', name: 'Flip Knife', build: knifeFlip, grip: [-0.064, 0.003], pivot: [-0.064, 0.003],
    trail: [[0.02, 0.0], [0.178, -0.002]] },
  { id: 'butterfly', name: 'Butterfly Knife', build: knifeButterfly, grip: [-0.06, -0.004], pivot: [-0.03, -0.004],
    trail: [[0.02, 0.008], [0.172, 0.01]] },
  { id: 'sword', name: 'Sword', build: knifeSword, gripAngle: 0.12, grip: [-0.07, -0.0084], pivot: [-0.07, -0.0084],
    trail: [[0.04, 0.005], [0.69, 0.083]], trailFrom: 0.5, big: true },
  { id: 'katana', name: 'Katana', build: knifeKatana, grip: [-0.06, 0], pivot: [-0.07, 0],
    trail: [arcPt(0.03, -0.004), arcPt(KAT_L + 0.012, 0.004)], trailFrom: 0.5, big: true, katana: true },
  // one kunai in each hand (the right one in a reverse grip), joined by a chain; blue trails
  { id: 'kuronami', name: 'Kuronami no Yaiba', build: knifeKunai, reverse: true, grip: [-0.052, 0], pivot: [-0.052, 0],
    trail: [[-0.1, 0], [KUNAI_TIP, 0]], chained: true,
    trailColor: 0x7cc8ff, trailInner: 0x1238e0, trailAlpha: [0.9, 1], trailSolid: true, trailLife: 0.18 },
];
export function knifeName(id) { return (KNIFE_SKINS.find((s) => s.id === id) || KNIFE_SKINS[0]).name; }

// rest poses of the right hand in view space (before the whole view model's 0.85 scale)
// p: wrist position, r: hand rotation (YXZ), elbow: where the forearm goes back to (below the screen edge)
const POSE = {
  base: { p: [-0.01, 0.03, 0.09], r: [1.11, -0.66, 0.75], elbow: [0.3, -0.3, 0.22] },
  karambit: { p: [-0.03, 0.07, 0.08], r: [-0.34, 2.43, 2.11], elbow: [0.3, -0.3, 0.22] },
  big: { p: [0.02, -0.02, 0.06], r: [0.7, -0.51, 0.9], elbow: [0.3, -0.3, 0.22] },
  kuronami: { p: [0.0, 0.1, 0.06], r: [0.15, 1.05, -1.45], elbow: [0.3, -0.3, 0.22] },   // reverse grip, blade down-left
};
// the Kuronami's left hand (drawn mirrored), with its kunai pointing in toward the crosshair
const LPOSE = { p: [-0.34, 0.06, 0.06], r: [0.7, 0.3, -1.6], elbow: [-0.62, -0.32, 0.24] };
const TILT = 0.8;          // saber grip: the handle runs diagonally across the palm so the blade leans forward
const L_FOREARM = new THREE.Vector3(-0.45, -0.75, 0.5).normalize().multiplyScalar(0.32); // left wrist -> elbow
// basis that maps blade space (x along the blade, y spine, z flat side) into a fist
const FWD = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
const REV = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));

// a forearm: a stick from the wrist back to an elbow below the screen edge
function forearm(g) {
  const m = new THREE.Mesh(box, mat(WOOD));
  g.add(m);
  return m;
}
const _v = new THREE.Vector3(), _zAxis = new THREE.Vector3(0, 0, 1);
function aimLimb(m, from, to, thick = 0.036) {
  _v.subVectors(to, from);
  const len = _v.length();
  m.position.copy(from).addScaledVector(_v, 0.5);
  m.scale.set(thick, thick, len);
  m.quaternion.setFromUnitVectors(_zAxis, _v.normalize());
}

// A chain of steel links laid along a path: from a thrown kunai's ring back to the fist holding the chain,
// then hanging in a loop below the screen over to the other kunai.
const LINK = 0.0125;
const _d = new THREE.Vector3(), _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3(), _y = new THREE.Vector3();
class Chain {
  constructor(max = 180) {
    const geo = new THREE.TorusGeometry(0.0046, 0.0016, 5, 10);
    geo.scale(1.45, 1, 1);                       // oval links, long way along the chain
    this.mesh = new THREE.InstancedMesh(geo, steel(0xbfc6d1), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.max = max;
    this.r = new THREE.Vector3(); this.f = new THREE.Vector3(); this.l = new THREE.Vector3(); this.a = new THREE.Vector3();
    this.pool = Array.from({ length: 26 }, () => new THREE.Vector3());
    this.path = [];
    this.m = new THREE.Matrix4();
  }
  // ring: the free kunai's ring, fist: where the right hand holds the chain, lring: the left kunai's ring
  // (all in world space); thrown: 0 = the loop hangs from the ring, 1 = from the fist (kunai flung out)
  update(model, ring, fist, lring, thrown) {
    const { r, f, l, a, pool, path } = this;
    model.worldToLocal(r.copy(ring)); model.worldToLocal(f.copy(fist)); model.worldToLocal(l.copy(lring));
    a.lerpVectors(r, f, thrown);
    path.length = 0; path.push(r);
    // a U hanging below the screen: straight down from each end, the bottom out of view
    const p1x = a.x + 0.03, p1y = a.y - 0.32, p1z = a.z + 0.05, p2x = l.x - 0.02, p2y = l.y - 0.32, p2z = l.z + 0.05;
    for (let i = 0; i <= 24; i++) {
      const u = i / 24, w = 1 - u;
      const c0 = w * w * w, c1 = 3 * w * w * u, c2 = 3 * w * u * u, c3 = u * u * u;
      path.push(pool[i].set(c0 * a.x + c1 * p1x + c2 * p2x + c3 * l.x, c0 * a.y + c1 * p1y + c2 * p2y + c3 * l.y,
        c0 * a.z + c1 * p1z + c2 * p2z + c3 * l.z));
    }
    this.lay(path);
  }
  lay(path) {
    let n = 0, s = 0;
    for (let i = 0; i + 1 < path.length && n < this.max; i++) {
      const p = path[i];
      _d.subVectors(path[i + 1], p);
      const len = _d.length();
      if (len < 1e-6) continue;
      _d.divideScalar(len);
      _n1.set(0, 1, 0); if (Math.abs(_d.y) > 0.9) _n1.set(1, 0, 0);
      _n1.cross(_d).normalize(); _n2.crossVectors(_d, _n1);
      for (; s <= len && n < this.max; s += LINK, n++) {
        const nrm = n % 2 ? _n1 : _n2;                    // each link turned a quarter turn from the last
        _y.crossVectors(nrm, _d);
        this.m.makeBasis(_d, _y, nrm).setPosition(p.x + _d.x * s, p.y + _d.y * s, p.z + _d.z * s);
        this.mesh.setMatrixAt(n, this.m);
      }
      s -= len;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Puts a knife in a hand. Nested frames: k (twirl: turns it around the handle), spin (turns it in the blade's
// plane around the pivot), reach (slides it out along its own length, for blades on a chain), inner (the model).
function gripKnife(H, skin, reverse) {
  const holder = new THREE.Group();       // puts the knife's grip in the fist
  holder.quaternion.setFromRotationMatrix(reverse ? REV : FWD)
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), reverse ? 0 : -TILT));
  holder.position.copy(GRIP);
  H.add(holder);
  const k = new THREE.Group(); holder.add(k);
  const align = new THREE.Group(); align.rotation.z = -(skin.gripAngle || 0); k.add(align);
  const spin = new THREE.Group();
  spin.position.set(skin.pivot[0] - skin.grip[0], skin.pivot[1] - skin.grip[1], 0); align.add(spin);
  const reach = new THREE.Group(); spin.add(reach);
  const inner = new THREE.Group(); inner.position.set(-skin.pivot[0], -skin.pivot[1], 0); reach.add(inner);
  const parts = {};
  skin.build(inner, parts);
  const tp = parts.trailParent || inner;
  const tA = new THREE.Object3D(); tA.position.set(skin.trail[0][0], skin.trail[0][1], 0); tp.add(tA);
  const tB = new THREE.Object3D(); tB.position.set(skin.trail[1][0], skin.trail[1][1], 0); tp.add(tB);
  return { holder, k, align, spin, reach, inner, parts, tA, tB };
}

function buildKnife(skin, band) {
  const g = new THREE.Group();
  const hand = buildHand(band);
  const H = hand.group; g.add(H);
  const rk = gripKnife(H, skin, skin.reverse);
  const { holder, k, align, spin, reach, inner, parts, tA, tB } = rk;
  const pose = POSE[skin.id] || (skin.big ? POSE.big : POSE.base);
  const elbow = new THREE.Vector3(...pose.elbow);   // stays put; the forearm swings from it as the hand moves
  const kn = { skin, hand, H, k, spin, reach, parts, tA, tB, pose, elbow, clips: CLIPS[skin.id], arm: forearm(g) };
  if (skin.chained) {
    // the second kunai in the left hand (a mirrored right hand, forward grip), and the chain between them
    const lh = buildHand(band);
    const mirror = new THREE.Group(); mirror.scale.x = -1; mirror.add(lh.group);
    const LH = new THREE.Group(); LH.add(mirror); g.add(LH);
    const chain = new Chain(); g.add(chain.mesh);
    Object.assign(kn, { LH, lhand: lh, lk: gripKnife(lh.group, skin, false), lpose: LPOSE,
      lelbow: new THREE.Vector3(...LPOSE.elbow), larm: forearm(g), chain });
  }
  if (skin.katana) {
    // left hand holding the scabbard, used by the draw
    const S = new THREE.Group(); S.visible = false; g.add(S);
    buildSaya(S);
    const lh = buildHand(band);
    const mirror = new THREE.Group(); mirror.scale.x = -1; mirror.add(lh.group);
    const LH = new THREE.Group(); LH.add(mirror); S.add(LH);
    // the left fist closes around the scabbard near its mouth, thumb toward the guard
    const toHand = new THREE.Matrix4().copy(REV);
    const gp = new THREE.Vector3(0.075, -0.004, 0).applyMatrix4(toHand);
    toHand.setPosition(GRIP.x * -1 - gp.x, GRIP.y - gp.y, GRIP.z - gp.z);
    toHand.invert().decompose(LH.position, LH.quaternion, LH.scale);
    setGrip(lh, 0, false);
    // blade space -> right hand space, to put the scabbard on the blade
    holder.updateMatrix(); k.updateMatrix(); align.updateMatrix(); spin.updateMatrix(); reach.updateMatrix(); inner.updateMatrix();
    const shapeToHand = new THREE.Matrix4().copy(holder.matrix).multiply(k.matrix).multiply(align.matrix)
      .multiply(spin.matrix).multiply(reach.matrix).multiply(inner.matrix);
    Object.assign(kn, { S, LH, lhand: lh, larm: forearm(g), shapeToHand,
      drop: { p: new THREE.Vector3(), q: new THREE.Quaternion() } });
  }
  g.userData.muzzle = null;
  g.userData.knife = kn;
  return g;
}

// The gun models without arms or knives, with their own materials (for props out in the world,
// like the guns on the Zombies Gun Shop wall). key -> Group, barrel toward -z, about 1 unit = 1 m.
export function displayGuns() {
  bareGuns = true;
  let models;
  try { models = buildModels(null, true); } finally { bareGuns = false; }
  for (const g of Object.values(models)) {
    g.traverse((m) => { if (m.isMesh) m.material = m.material.clone(); });
  }
  return models;
}

function buildModels(team, gunsOnly = false) {
  const band = team === 'T' ? 0xe0852b : team === 'CT' ? 0x2f6be0 : 0xa01818;
  const models = {};
  let g, mz;

  g = new THREE.Group(); // AK
  b(g, 0.05, 0.07, 0.42, 0x2b2b2d, 0, 0, -0.05);
  b(g, 0.055, 0.055, 0.2, 0x7a4a24, 0, -0.005, -0.33);
  b(g, 0.022, 0.022, 0.24, 0x1d1d1f, 0, 0.018, -0.52);
  b(g, 0.03, 0.025, 0.2, 0x1d1d1f, 0, 0.045, -0.33);
  b(g, 0.045, 0.085, 0.24, 0x7a4a24, 0, -0.025, 0.26, -0.12);
  b(g, 0.035, 0.16, 0.06, 0x3a3027, 0, -0.11, -0.1, 0.35);
  b(g, 0.035, 0.09, 0.045, 0x5a3a20, 0, -0.07, 0.07, -0.3);
  b(g, 0.008, 0.04, 0.008, 0x111111, 0, 0.05, -0.6);
  arms(g, band, true, -0.3); mz = new THREE.Object3D(); mz.position.set(0, 0.02, -0.66); g.add(mz); g.userData.muzzle = mz;
  models.ak = g;

  g = new THREE.Group(); // M4
  b(g, 0.05, 0.075, 0.4, 0x2a2c2f, 0, 0, -0.05);
  b(g, 0.06, 0.06, 0.22, 0x1f2124, 0, -0.005, -0.33);
  b(g, 0.022, 0.022, 0.24, 0x161616, 0, 0.012, -0.54);
  b(g, 0.03, 0.03, 0.34, 0x1a1b1d, 0, 0.055, -0.15);
  b(g, 0.01, 0.05, 0.01, 0x111111, 0, 0.06, -0.52);                        // front sight post
  b(g, 0.04, 0.07, 0.22, 0x222428, 0, -0.01, 0.24);
  b(g, 0.035, 0.15, 0.055, 0x26282b, 0, -0.1, -0.08, 0.1);
  b(g, 0.035, 0.09, 0.045, 0x1c1d20, 0, -0.07, 0.07, -0.3);
  arms(g, band, true, -0.3); mz = new THREE.Object3D(); mz.position.set(0, 0.012, -0.68); g.add(mz); g.userData.muzzle = mz;
  models.m4 = g;

  g = new THREE.Group(); // SMG
  b(g, 0.055, 0.08, 0.32, 0x2c2e31, 0, 0, -0.05);
  b(g, 0.025, 0.025, 0.12, 0x161616, 0, 0.012, -0.27);
  b(g, 0.03, 0.17, 0.045, 0x1c1d20, 0, -0.12, -0.08);
  b(g, 0.035, 0.09, 0.045, 0x1c1d20, 0, -0.07, 0.06, -0.3);
  b(g, 0.03, 0.03, 0.18, 0x1a1a1a, 0, 0.0, 0.18);
  b(g, 0.008, 0.03, 0.008, 0x111111, 0, 0.05, -0.19);                      // front sight post
  for (const sx of [-0.011, 0.011]) b(g, 0.006, 0.02, 0.012, 0x111111, sx, 0.048, 0.08);   // rear sight
  arms(g, band, true, -0.2); mz = new THREE.Object3D(); mz.position.set(0, 0.012, -0.34); g.add(mz); g.userData.muzzle = mz;
  models.smg = g;

  g = new THREE.Group(); // sniper
  b(g, 0.055, 0.075, 0.5, 0x3d4a32, 0, 0, 0.0);
  b(g, 0.026, 0.026, 0.5, 0x1a1a1a, 0, 0.015, -0.48);
  cyl(g, 0.028, 0.3, 0x111111, 0, 0.08, -0.05);
  b(g, 0.05, 0.1, 0.24, 0x3d4a32, 0, -0.03, 0.3);
  b(g, 0.035, 0.08, 0.06, 0x111111, 0, -0.08, -0.06);
  arms(g, band, true, -0.28); mz = new THREE.Object3D(); mz.position.set(0, 0.015, -0.75); g.add(mz); g.userData.muzzle = mz;
  models.sniper = g;

  g = new THREE.Group(); // pistol
  b(g, 0.035, 0.045, 0.2, 0x2a2b2e, 0, 0.02, -0.05);
  b(g, 0.032, 0.11, 0.05, 0x1d1e20, 0, -0.045, 0.03, -0.25);
  b(g, 0.006, 0.014, 0.008, 0x111111, 0, 0.047, -0.14);                    // front sight
  for (const sx of [-0.009, 0.009]) b(g, 0.006, 0.012, 0.008, 0x111111, sx, 0.046, 0.04);  // rear sight
  arms(g, band, true, 0.0); mz = new THREE.Object3D(); mz.position.set(0, 0.025, -0.16); g.add(mz); g.userData.muzzle = mz;
  models.pistol = g;

  g = new THREE.Group(); // Desert Eagle: big brushed-steel slide with a ribbed top
  const deSteel = shiny(0xa4a7ad), deDark = shiny(0x75787e);
  b(g, 0.044, 0.05, 0.26, 0, 0, 0.024, -0.075, 0, 0, 0, deSteel);          // slide
  b(g, 0.026, 0.016, 0.24, 0, 0, 0.056, -0.08, 0, 0, 0, deDark);           // top rib over the barrel
  b(g, 0.038, 0.03, 0.15, 0x2a2b2e, 0, -0.012, -0.08);                     // frame
  b(g, 0.012, 0.028, 0.04, 0x1d1e20, 0, -0.035, -0.035);                   // trigger guard
  b(g, 0.04, 0.125, 0.058, 0x1d1e20, 0, -0.065, 0.035, -0.22);             // grip
  b(g, 0.008, 0.014, 0.008, 0x111111, 0, 0.07, -0.19);                     // front sight
  b(g, 0.022, 0.012, 0.008, 0x111111, 0, 0.07, 0.04);                      // rear sight
  b(g, 0.046, 0.012, 0.03, 0, 0, 0.03, 0.035, 0, 0, 0, deDark);            // hammer end
  arms(g, band, true, 0.0); mz = new THREE.Object3D(); mz.position.set(0, 0.03, -0.22); g.add(mz); g.userData.muzzle = mz;
  models.deagle = g;

  g = new THREE.Group(); // M16: carry handle, round handguard, long thin barrel, fixed stock
  b(g, 0.05, 0.072, 0.36, 0x26282b, 0, 0, -0.04);                          // receiver
  b(g, 0.022, 0.016, 0.2, 0x1b1c1f, 0, 0.082, -0.03);                      // carry handle
  b(g, 0.02, 0.04, 0.022, 0x1b1c1f, 0, 0.056, -0.12);
  b(g, 0.02, 0.04, 0.022, 0x1b1c1f, 0, 0.056, 0.06);
  cyl(g, 0.034, 0.25, 0x2f3134, 0, 0.0, -0.34);                            // handguard
  b(g, 0.02, 0.02, 0.26, 0x161616, 0, 0.008, -0.57);                       // barrel
  b(g, 0.012, 0.065, 0.014, 0x161616, 0, 0.045, -0.48);                    // front sight post
  b(g, 0.007, 0.032, 0.008, 0x161616, 0, 0.092, -0.48);                    // ...and its tip, over the carry handle
  b(g, 0.034, 0.15, 0.052, 0x1c1d20, 0, -0.105, -0.1, 0.18);               // magazine
  b(g, 0.035, 0.09, 0.045, 0x1c1d20, 0, -0.07, 0.07, -0.3);                // grip
  b(g, 0.045, 0.08, 0.26, 0x222428, 0, -0.014, 0.27);                      // stock
  arms(g, band, true, -0.32); mz = new THREE.Object3D(); mz.position.set(0, 0.008, -0.71); g.add(mz); g.userData.muzzle = mz;
  models.m16 = g;

  g = new THREE.Group(); // Scout: slim bolt-action with a light scope
  b(g, 0.045, 0.06, 0.44, 0x2b3a2c, 0, 0, 0.0);                            // body
  b(g, 0.02, 0.02, 0.44, 0x151515, 0, 0.012, -0.42);                       // barrel
  cyl(g, 0.022, 0.24, 0x111111, 0, 0.068, -0.05);                          // scope tube
  cyl(g, 0.03, 0.05, 0x111111, 0, 0.068, -0.18);                           // front bell
  b(g, 0.012, 0.03, 0.012, 0x111111, 0, 0.045, -0.1);                      // scope mounts
  b(g, 0.012, 0.03, 0.012, 0x111111, 0, 0.045, 0.02);
  b(g, 0.04, 0.012, 0.012, 0x8a8c90, 0.035, 0.02, 0.07);                   // bolt handle
  b(g, 0.044, 0.09, 0.22, 0x2b3a2c, 0, -0.03, 0.29);                       // stock
  b(g, 0.03, 0.06, 0.05, 0x111111, 0, -0.055, -0.06);                      // magazine
  arms(g, band, true, -0.26); mz = new THREE.Object3D(); mz.position.set(0, 0.012, -0.66); g.add(mz); g.userData.muzzle = mz;
  models.scout = g;

  g = new THREE.Group(); // pump shotgun
  b(g, 0.05, 0.07, 0.3, 0x2a2b2e, 0, 0, 0.0);
  b(g, 0.03, 0.03, 0.55, 0x1b1c1e, 0, 0.022, -0.38);
  b(g, 0.026, 0.026, 0.42, 0x2a2b2e, 0, -0.02, -0.32);
  b(g, 0.055, 0.05, 0.16, 0x6b4426, 0, -0.025, -0.3);            // wooden pump
  b(g, 0.045, 0.09, 0.26, 0x6b4426, 0, -0.03, 0.26, -0.15);      // stock
  b(g, 0.035, 0.09, 0.045, 0x3a2a1a, 0, -0.07, 0.08, -0.3);
  b(g, 0.01, 0.012, 0.01, 0xd8d8d8, 0, 0.043, -0.64);            // bead sight
  arms(g, band, true, -0.3); mz = new THREE.Object3D(); mz.position.set(0, 0.022, -0.67); g.add(mz); g.userData.muzzle = mz;
  models.shotgun = g;

  g = new THREE.Group(); // drum LMG
  b(g, 0.07, 0.1, 0.46, 0x2b2d24, 0, 0, -0.05);
  b(g, 0.03, 0.03, 0.34, 0x161616, 0, 0.02, -0.45);
  b(g, 0.06, 0.06, 0.2, 0x3a3d32, 0, 0.005, -0.32);
  cyl(g, 0.075, 0.07, 0x1d1e1a, 0, -0.1, -0.05).rotation.set(0, 0, Math.PI / 2);  // drum mag
  b(g, 0.05, 0.1, 0.24, 0x2b2d24, 0, -0.02, 0.28, -0.1);
  b(g, 0.035, 0.09, 0.045, 0x1c1d20, 0, -0.08, 0.1, -0.3);
  b(g, 0.01, 0.04, 0.01, 0x111111, 0, 0.05, -0.58);                                 // front sight post
  for (const sx of [-0.014, 0.014]) b(g, 0.008, 0.024, 0.014, 0x111111, sx, 0.054, 0.1);   // rear sight
  arms(g, band, true, -0.3); mz = new THREE.Object3D(); mz.position.set(0, 0.02, -0.63); g.add(mz); g.userData.muzzle = mz;
  models.lmg = g;

  g = new THREE.Group(); // ray gun (retro sci-fi pistol)
  const glow = new THREE.MeshBasicMaterial({ color: 0x5dff7a });
  b(g, 0.05, 0.07, 0.2, 0xb02a22, 0, 0.02, -0.06);
  cyl(g, 0.03, 0.12, 0xb8bcc4, 0, 0.03, -0.2);
  for (const z of [-0.12, -0.17, -0.22]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.007, 6, 16), glow);
    ring.position.set(0, 0.03, z); g.add(ring);
  }
  cyl(g, 0.016, 0.06, 0x5dff7a, 0, 0.03, -0.28).material = glow;
  b(g, 0.006, 0.02, 0.008, 0, 0, 0.078, -0.25, 0, 0, 0, glow);    // glowing sight fin
  b(g, 0.034, 0.11, 0.05, 0x7a1d18, 0, -0.045, 0.03, -0.25);
  arms(g, band, true, 0.0); mz = new THREE.Object3D(); mz.position.set(0, 0.03, -0.32); g.add(mz); g.userData.muzzle = mz;
  models.raygun = g;

  if (gunsOnly) return models;
  for (const skin of KNIFE_SKINS) models['knife_' + skin.id] = buildKnife(skin, band);
  return models;
}

// ---------- slash trail + glint ----------
// A ribbon swept by the blade over the last fraction of a second, drawn additively so it glows.
class Trail {
  constructor() {
    this.max = 160;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 6);
    this.col = new Float32Array(this.max * 8);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < this.max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 2;
    this.samples = [];
    this.life = 0.13;
    this.color = new THREE.Color(0xd8ecff);   // at the blade's edge of the ribbon
    this.inner = new THREE.Color(0xd8ecff);   // ...and at its inner side
    this.alpha = [0.12, 0.75];
  }
  // a knife's own trail look (the Kuronami's is a solid blue ribbon with a bright edge, not a white glow)
  style(skin) {
    this.color.setHex(skin.trailColor || 0xd8ecff);
    this.inner.setHex(skin.trailInner || skin.trailColor || 0xd8ecff);
    this.life = skin.trailLife || 0.13;
    this.alpha = skin.trailAlpha || [0.12, 0.75];
    const m = this.mesh.material, bl = skin.trailSolid ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (m.blending !== bl) { m.blending = bl; m.needsUpdate = true; }
  }
  clear() { this.samples.length = 0; this.mesh.visible = false; }
  add(a, b, s, t) {
    const last = this.samples[this.samples.length - 1];
    if (last && t - last.t < 1 / 200) return;
    this.samples.push({ a: a.clone(), b: b.clone(), s, t });
  }
  update(now) {
    const S = this.samples;
    while (S.length && now - S[0].t > this.life) S.shift();
    if (S.length < 2) { this.mesh.visible = false; return; }
    const sub = Math.max(1, Math.min(6, Math.floor((this.max - 1) / (S.length - 1))));
    let n = 0;
    const put = (p0, p1, p2, p3, u) => {
      const t = p1.t + (p2.t - p1.t) * u, s = p1.s + (p2.s - p1.s) * u;
      const fade = Math.max(0, 1 - (now - t) / this.life), al = s * fade * fade;
      for (const [key, off, alpha, col] of [['a', 0, al * this.alpha[0], this.inner], ['b', 1, al * this.alpha[1], this.color]]) {
        const i = (n * 2 + off);
        for (let c = 0; c < 3; c++) {
          const ax = 'xyz'[c];
          const v0 = p0[key][ax], v1 = p1[key][ax], v2 = p2[key][ax], v3 = p3[key][ax];
          this.pos[i * 3 + c] = 0.5 * ((2 * v1) + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u + (-v0 + 3 * v1 - 3 * v2 + v3) * u * u * u);
        }
        this.col[i * 4] = col.r; this.col[i * 4 + 1] = col.g; this.col[i * 4 + 2] = col.b;
        this.col[i * 4 + 3] = alpha;
      }
      n++;
    };
    for (let i = 0; i < S.length - 1; i++) {
      const p0 = S[Math.max(0, i - 1)], p1 = S[i], p2 = S[i + 1], p3 = S[Math.min(S.length - 1, i + 2)];
      for (let j = 0; j < sub && n < this.max - 1; j++) put(p0, p1, p2, p3, j / sub);
    }
    const L = S.length - 1;
    put(S[Math.max(0, L - 1)], S[L], S[L], S[L], 0);
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
    this.mesh.visible = true;
  }
}

function sparkleTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.translate(S / 2, S / 2);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.22);
  glow.addColorStop(0, 'rgba(255,255,255,1)'); glow.addColorStop(0.35, 'rgba(210,235,255,0.55)'); glow.addColorStop(1, 'rgba(160,200,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(-S / 2, -S / 2, S, S);
  ctx.fillStyle = '#fff';
  for (const [len, w, rot] of [[0.5, 0.035, 0], [0.5, 0.035, Math.PI / 2], [0.26, 0.025, Math.PI / 4], [0.26, 0.025, -Math.PI / 4]]) {
    ctx.save(); ctx.rotate(rot);
    ctx.beginPath(); ctx.moveTo(-S * len, 0); ctx.lineTo(0, -S * w); ctx.lineTo(S * len, 0); ctx.lineTo(0, S * w); ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TRACKS = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'roll', 'twirl', 'spin', 'open', 'blade', 'bfA', 'bfB', 'trail', 'glint', 'glintAt',
  'sheath', 'attach', 'lpx', 'lpy', 'lpz', 'lrx', 'lry', 'lrz', 'lvis', 'reach', 'lspin', 'lreach', 'lopen', 'ltrail'];
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _r1 = new THREE.Vector3(), _f1 = new THREE.Vector3(), _l1 = new THREE.Vector3();

// Aiming down sights: the height of each gun's sight line (the top of its front sight, in model
// space) and how far in front of the eye it's held. The gun moves to the middle of the screen with
// that line on the screen's center, so the front sight sits right where the bullets go.
const SIGHTS = {
  ak: { y: 0.07, z: -0.4 }, m4: { y: 0.085, z: -0.4 }, m16: { y: 0.108, z: -0.4 }, smg: { y: 0.065, z: -0.38 },
  lmg: { y: 0.07, z: -0.4 }, shotgun: { y: 0.049, z: -0.4 }, pistol: { y: 0.054, z: -0.42 }, deagle: { y: 0.077, z: -0.42 },
  raygun: { y: 0.088, z: -0.4 },
};

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a48, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.8); sun.position.set(1, 2, 1); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xcfe2ff, 0.9); rim.position.set(-1.5, 0.6, -0.4); this.scene.add(rim); // picks out blade edges
    this.root = new THREE.Group();
    this.root.scale.setScalar(0.85);
    this.scene.add(this.root);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.16, 0.16, 0.16); this.flash.visible = false;
    this.scene.add(this.flash);
    this.trail = new Trail();
    this.scene.add(this.trail.mesh);
    this.trail2 = new Trail();                 // the Kuronami's second kunai
    this.scene.add(this.trail2.mesh);
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkleTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.glint.visible = false; this.glint.renderOrder = 3;
    this.scene.add(this.glint);
    this.team = null; this.models = null; this.current = null; this.key = null;
    this.knifeSkin = 'knife';
    this.bob = 0; this.swayX = 0; this.swayY = 0; this.kick = 0; this.flashT = 0;
    this.inspectT = 0;           // generic gun inspect
    this.clip = null; this.clipT = 0; // knife draw / inspect / slash keyframe animation
    this.boost = 0; this.loops = 0;   // Kuronami inspect: how much faster it spins, and repeats left
    this.slashN = 0; this.clock = 0;
    this.v = Object.fromEntries(TRACKS.map((n) => [n, 0]));
  }

  setTeam(team) {
    if (this.team === team) return;
    if (this.models) for (const m of Object.values(this.models)) this.root.remove(m);
    this.team = team;
    this.models = buildModels(team);
    for (const m of Object.values(this.models)) { m.visible = false; this.root.add(m); }
    this.key = null;
  }

  setKnife(id) { this.knifeSkin = KNIFE_SKINS.some((s) => s.id === id) ? id : 'knife'; this.key = null; }

  setWeapon(vmKey) {
    if (this.key === vmKey) return;
    if (this.current) this.current.visible = false;
    this.key = vmKey;
    this.current = this.models[vmKey];
    if (this.current) this.current.visible = true;
    this.inspectT = 0; this.clip = null;
    this.trail.clear(); this.trail2.clear();
    const knife = this.current?.userData.knife;
    if (knife) {
      this.trail.style(knife.skin); this.trail2.style(knife.skin);
      this.play(knife.clips.draw);   // every knife has its own draw animation
    }
  }

  play(clip) { this.clip = clip; this.clipT = 0; this.boost = 0; this.loops = 0; }

  fire(melee) {
    this.inspectT = 0;
    if (melee) {                               // attacking cancels draw / inspect: alternate forehand and backhand slashes
      this.slashN ^= 1;
      const s = this.current?.userData.knife?.clips.slash || [SLASH.a, SLASH.b];   // a knife can have its own
      this.play(this.slashN ? s[0] : s[1]);
      return;
    }
    this.clip = null;
    this.kick = 1;
    this.flashT = 0.045;
    this.flash.material.rotation = Math.random() * 6;
  }

  inspect() {
    const knife = this.current?.userData.knife;
    if (knife) {
      const c = this.clip;
      if (!c) this.play(knife.clips.inspect);
      // Kuronami: inspecting again during the spin spins it faster (up to three times) and keeps it going
      else if (c.loop && this.clipT < c.loop[1]) { this.boost = Math.min(3, this.boost + 1); this.loops = 1; }
      return;
    }
    if (this.inspectT <= 0) this.inspectT = 2.6;
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  update(dt, p, game, mouseDx, mouseDy) {
    const w = p.weapon;
    if (!w) return;
    this.setWeapon(w.def.melee ? 'knife_' + this.knifeSkin : w.def.vm);
    this.clock += dt;
    const t = game.time;
    const sp = p.horizSpeed();
    const moving = p.body.onGround ? Math.min(1, sp / 5) : 0;
    this.bob += dt * (4 + sp * 1.2);
    this.swayX += ((-mouseDx * 0.0006) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += ((mouseDy * 0.0006) - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-0.05, Math.min(0.05, this.swayX));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY));
    this.kick = Math.max(0, this.kick - dt * 12);

    let x = 0.16 + Math.sin(this.bob) * 0.012 * moving + this.swayX;
    let y = -0.17 - Math.abs(Math.cos(this.bob)) * 0.012 * moving + this.swayY + (p.body.onGround ? 0 : 0.02);
    let z = -0.38 + this.kick * 0.04;
    let rx = this.kick * 0.06, ry = 0, rz = 0;

    if (p.reloading) {
      this.inspectT = 0;
      const k = 1 - (p.reloadEnd - t) / (p.reloadDur || w.def.reload);
      const dip = Math.sin(Math.min(1, Math.max(0, k)) * Math.PI);
      y -= dip * 0.12; rx -= dip * 0.45; rz += dip * 0.35;
    }
    if (t < p.deployUntil && !w.def.melee) {   // knives use their own draw animation instead
      const k = (p.deployUntil - t) / (w.def.deploy || 0.5);
      y -= k * k * 0.3; rx -= k * 0.6;
    }
    // last stand (Zombies, downed): the pistol is held low and canted, from the ground
    if (p.downed) { x -= 0.03; y -= 0.03; rz += 0.25; }
    // gun inspect: turn the weapon to show it off
    if (this.inspectT > 0) {
      this.inspectT -= dt;
      const k = 1 - Math.max(0, this.inspectT) / 2.6;
      const e = Math.sin(Math.min(1, k * 1.15) * Math.PI);
      x -= e * 0.07; y += e * 0.04; z += e * 0.05;
      ry += e * 0.75; rz -= e * 0.55 + Math.sin(k * Math.PI * 2) * 0.15 * e; rx += e * 0.2;
    }
    // aiming down sights (Zombies): the gun comes up to the middle of the screen, sights on the
    // center, with no bob or sway; firing only nudges it back
    const ads = p.adsK(), sight = SIGHTS[w.def.vm];
    if (ads > 0 && sight && !w.def.melee) {
      this.inspectT = 0;
      x += (0 - x) * ads;
      y += (-0.85 * sight.y - y) * ads;              // (0.85: the root's scale)
      z += (sight.z + this.kick * 0.03 - z) * ads;
      rx += (this.kick * 0.02 - rx) * ads; ry *= 1 - ads; rz *= 1 - ads;
    }
    this.root.position.set(x, y, z);
    this.root.rotation.set(rx, ry, rz);
    this.root.visible = !p.scoped;

    const knife = this.current?.userData.knife;
    if (knife) this.animateKnife(knife, dt, game);
    else { this.trail.clear(); this.trail2.clear(); this.glint.visible = false; }

    this.flashT -= dt;
    const mz = this.current?.userData.muzzle;
    if (mz && this.flashT > 0 && !p.scoped) {
      this.root.updateMatrixWorld(true);
      mz.getWorldPosition(this.flash.position);
      this.flash.visible = true;
    } else this.flash.visible = false;
  }

  // knife draw / inspect / slash keyframes, the hands, the trail and the glint
  animateKnife(kn, dt, game) {
    const v = this.v;
    for (const n of TRACKS) v[n] = 0;
    if (this.clip) {
      const c = this.clip, L = c.loop;
      let t0 = this.clipT;
      const inLoop = L && this.boost && t0 >= L[0] && t0 < L[1];
      this.clipT += dt * (inLoop ? 1 + 0.25 * this.boost : 1);
      if (inLoop && this.loops > 0 && this.clipT >= L[1]) { this.clipT -= L[1] - L[0]; t0 = L[0]; this.loops--; }
      for (const name in c.tracks) v[name] = sampleTrack(c.tracks[name], this.clipT);
      if (c.events && game?.sound) {
        for (const [et, snd] of c.events) if ((et > t0 || (et === 0 && t0 === 0)) && et <= this.clipT) game.sound[snd]?.();
      }
      if (this.clipT >= c.dur) this.clip = null;
    }
    const { H, pose } = kn;
    // hand = screen-space turn (rx ry rz) * rest pose * wrist roll around the forearm
    H.quaternion.setFromEuler(_e.set(v.rx, v.ry, v.rz, 'YXZ'))
      .multiply(_q.setFromEuler(_e.set(pose.r[0], pose.r[1], pose.r[2], 'YXZ')))
      .multiply(_q.setFromAxisAngle(_zAxis, v.roll));
    H.position.set(pose.p[0] + v.px, pose.p[1] + v.py, pose.p[2] + v.pz);
    kn.k.rotation.x = v.twirl;
    kn.spin.rotation.z = v.spin;
    kn.reach.position.x = v.reach;
    setGrip(kn.hand, Math.min(1, Math.max(0, v.open)), kn.skin.ring);
    if (kn.lk) {
      // Kuronami's left hand: its rest pose (mirrored) turned by lrx..lrz and moved by lpx..lpz
      const lp = kn.lpose, LH = kn.LH;
      LH.quaternion.setFromEuler(_e.set(v.lrx, v.lry, v.lrz, 'YXZ'))
        .multiply(_q.setFromEuler(_e.set(lp.r[0], lp.r[1], lp.r[2], 'YXZ')));
      LH.position.set(lp.p[0] + v.lpx, lp.p[1] + v.lpy, lp.p[2] + v.lpz);
      kn.lk.spin.rotation.z = v.lspin;
      kn.lk.reach.position.x = v.lreach;
      setGrip(kn.lhand, Math.min(1, Math.max(0, v.lopen)), false);
      _a.set(0, 0, 0.014).applyQuaternion(LH.quaternion).add(LH.position);
      aimLimb(kn.larm, _a, kn.lelbow);
    }
    const P = kn.parts;
    if (P.blade) P.blade.rotation.z = v.blade;
    if (P.bfSwing) { P.bfSwing.rotation.z = -v.bfB; P.bfA.rotation.z = v.bfA; }

    if (kn.S) {
      const S = kn.S;
      S.visible = kn.larm.visible = v.lvis > 0.5;
      if (S.visible) {
        if (v.attach > 0.5) {
          // the scabbard rides the blade, slid `sheath` meters along its curve toward the tip (the left hand
          // pulls it off while the right hand draws)
          H.updateMatrix();
          const beta = v.sheath / KAT_R;
          _m.makeTranslation(0, KAT_R, 0).multiply(_m2.makeRotationZ(beta)).multiply(_m2.makeTranslation(0, -KAT_R, 0));
          _m.premultiply(kn.shapeToHand).premultiply(H.matrix);
          _m.decompose(kn.drop.p, kn.drop.q, _s);
          S.position.copy(kn.drop.p); S.quaternion.copy(kn.drop.q);
        } else {
          // let go: it falls away from where it left the blade
          S.position.set(v.lpx, v.lpy, v.lpz).add(kn.drop.p);
          S.quaternion.copy(kn.drop.q).multiply(_q.setFromEuler(_e.set(v.lrx, v.lry, v.lrz, 'YXZ')));
        }
        S.updateMatrix();
        _a.set(0, 0, 0.014).applyMatrix4(kn.LH.matrix).applyMatrix4(S.matrix);
        aimLimb(kn.larm, _a, _b.copy(_a).add(L_FOREARM));
      }
    }
    _a.set(0, 0, 0.014).applyQuaternion(H.quaternion).add(H.position);
    aimLimb(kn.arm, _a, kn.elbow);

    // trail and glint follow the blade in view space
    this.root.updateMatrixWorld(true);
    kn.tA.getWorldPosition(_a); kn.tB.getWorldPosition(_b);
    const trailFrom = this.clip?.trailFrom ?? kn.skin.trailFrom ?? 0;   // a clip can draw a narrower ribbon
    if (v.trail > 0.01 && this.root.visible) {
      _p.lerpVectors(_a, _b, trailFrom);
      this.trail.add(_p, _b, Math.min(1, v.trail), this.clock);
    }
    this.trail.update(this.clock);
    if (kn.lk) {
      // the chain from the right kunai (or the fist, once it has flown out) down to the left kunai
      kn.parts.ring.getWorldPosition(_r1); kn.spin.getWorldPosition(_f1); kn.lk.parts.ring.getWorldPosition(_l1);
      const thrown = Math.min(1, Math.max(0, (v.reach - 0.06) / 0.04));
      kn.chain.update(this.current, _r1, _f1, _l1, thrown);
      kn.lk.tA.getWorldPosition(_l1); kn.lk.tB.getWorldPosition(_r1);
      if (v.ltrail > 0.01 && this.root.visible) {
        _p.lerpVectors(_l1, _r1, trailFrom);
        this.trail2.add(_p, _r1, Math.min(1, v.ltrail), this.clock);
      }
    }
    this.trail2.update(this.clock);
    if (v.glint > 0.01 && this.root.visible) {
      this.glint.position.lerpVectors(_a, _b, v.glintAt);
      const s = 0.075 * v.glint * (kn.skin.big ? 1.3 : 1);
      this.glint.scale.set(s, s, s);
      this.glint.material.rotation = this.clock * 2.5;
      this.glint.visible = true;
    } else this.glint.visible = false;
  }
}
