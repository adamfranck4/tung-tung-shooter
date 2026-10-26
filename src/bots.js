// AI teammates and enemies: the Tung Tung Tung Sahur model plus perception, aiming and navigation.
import * as THREE from 'three';
import { Combatant } from './combatant.js';
import { wrapAngle } from './physics.js';
import { flashTexture, markerTexture, tungSkinTexture, tungFaceTexture, rainbowSkin } from './textures.js';
import { matte } from './gfx.js';

export const DIFF = {
  easy:   { reaction: 0.7,  turn: 3.0, aimErr: 0.09,  settle: 1.4, head: 0.12, comp: 0.3,  spray: 4,  fov: 2.0, jitter: 0.016 },
  normal: { reaction: 0.42, turn: 5.5, aimErr: 0.05,  settle: 2.4, head: 0.3,  comp: 0.6,  spray: 7,  fov: 2.2, jitter: 0.009 },
  hard:   { reaction: 0.25, turn: 9.0, aimErr: 0.025, settle: 4.0, head: 0.55, comp: 0.85, spray: 10, fov: 2.4, jitter: 0.0045 },
};

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, matte({ color }));
  return matCache.get(color);
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function part(parent, w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(boxGeo, mat(color));
  m.scale.set(w, h, d); m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
let flashTex = null;

// round wooden limb between two points: a capsule, so elbows and knees come out rounded
const capsules = new Map();
function capsuleGeo(thick, len) {
  const key = `${thick.toFixed(3)}:${len.toFixed(3)}`;
  if (!capsules.has(key)) capsules.set(key, new THREE.CapsuleGeometry(thick / 2, Math.max(0.001, len - thick * 0.6), 3, 8).rotateX(Math.PI / 2));
  return capsules.get(key);
}
function stick(parent, from, to, thick, color) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const m = new THREE.Mesh(capsuleGeo(thick, a.distanceTo(b)), mat(color));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(b);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Colors by side: every Tung Tung is natural wood, tinted softly so you can still tell them apart.
// 5v5: your teammates are greenish wood, enemies reddish. Zombies are a darker red wood, and the
// other zombie types each have their own tint. legs / arms: one color per limb (the rainbow giant).
export const LOOKS = {
  default: { body: 0xf2d2a4, limb: 0xb88a58, hand: 0xd2a874 },
  friend:  { body: 0xbde48a, limb: 0x84a64e, hand: 0xa6c472 },
  enemy:   { body: 0xff9878, limb: 0xb85a40, hand: 0xd8806a },
  zombie:  { body: 0xd88a78, limb: 0x8a4636, hand: 0xa45a48 },
  zfast:   { body: 0xfff080, limb: 0xc4a43c, hand: 0xdcc25c },
  zcrawl:  { body: 0xb48660, limb: 0x6c4a2e, hand: 0x8a6440 },
  zfly:    { body: 0xb8a4ff, limb: 0x6a52b0, hand: 0x8a72cc },
  zthrow:  { body: 0xffbae0, limb: 0xc47aa2, hand: 0xdc98bc },
  zgiant:  { body: 0xffffff, limb: 0xffffff, hand: 0xffd23a, rainbow: true, legs: [0xff4a3a, 0x3a86ff], arms: [0x3ad06a, 0xb05ae6] },
  // the boss: repainted for each visit (see BOSS_LOOKS in zombies.js)
  zboss:   { body: 0x2a1410, limb: 0xff5a1a, hand: 0xffb02a },
};
// which look each zombie type uses (see VARIANTS in zombies.js)
const ZOMBIE_LOOK = { normal: 'zombie', big: 'zombie', fast: 'zfast', crawler: 'zcrawl', flyer: 'zfly', thrower: 'zthrow', giant: 'zgiant', boss: 'zboss' };
const bodyMats = {}, faceMats = {};
let skinTex = null, faceTex = null, rainbow = null, rainbowAt = 0;
function getBodyMat(look) {
  if (!bodyMats[look]) {
    const L = LOOKS[look];
    if (L.rainbow) {
      rainbow = rainbow || rainbowSkin(logHeightAt);
      bodyMats[look] = matte({ map: rainbow.tex });
    } else {
      skinTex = skinTex || tungSkinTexture();
      bodyMats[look] = matte({ map: skinTex, color: L.body }, { roughness: 0.72 });   // polished wood
    }
  }
  return bodyMats[look];
}
// slide the rainbow giant's colors up its body (redrawn ~15 times a second while one is around)
export function tickRainbow() {
  if (!rainbow) return;
  const now = performance.now();
  if (now - rainbowAt < 66) return;
  rainbowAt = now;
  rainbow.draw((now / 1000 * 0.22) % 1);
}
function getFaceMat(look) {
  if (!faceMats[look]) {
    faceTex = faceTex || tungFaceTexture();
    faceMats[look] = matte({ map: faceTex, transparent: true, depthWrite: false, color: LOOKS[look].body,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  return faceMats[look];
}
const glowRed = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
// tall log with a rounded top. [radius, height]
const LOG_PROFILE = [[0, 0], [0.24, 0], [0.252, 0.04], [0.255, 0.3], [0.252, 0.65], [0.248, 0.95], [0.243, 1.05],
  [0.23, 1.11], [0.205, 1.16], [0.16, 1.2], [0.09, 1.228], [0, 1.24]];
const logGeo = new THREE.LatheGeometry(LOG_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 28);
// the log's texture v runs along the profile points: v (0..1) -> height up the log (0..1)
function logHeightAt(v) {
  const j = Math.max(0, Math.min(1, v)) * (LOG_PROFILE.length - 1), i = Math.min(LOG_PROFILE.length - 2, Math.floor(j));
  const y = LOG_PROFILE[i][1] + (LOG_PROFILE[i + 1][1] - LOG_PROFILE[i][1]) * (j - i);
  return y / LOG_PROFILE[LOG_PROFILE.length - 1][1];
}
// painted face: a curved patch hugging the front of the log (front = -Z = theta PI), 0.62..1.08 m
const FACE_ARC = 2.1;
const faceGeo = new THREE.CylinderGeometry(0.2425, 0.258, 0.46, 20, 1, true, Math.PI - FACE_ARC / 2, FACE_ARC);
const sphereGeo = new THREE.SphereGeometry(1, 18, 14);
const noseGeo = new THREE.CapsuleGeometry(0.036, 0.15, 6, 12);
const browGeo = new THREE.CapsuleGeometry(0.018, 0.1, 4, 8);
const batGeo = new THREE.CylinderGeometry(0.032, 0.082, 0.95, 16);    // thick end at the bottom, like the meme
const gripGeo = new THREE.CylinderGeometry(0.036, 0.038, 0.2, 12);
const knobGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.035, 14);

function sphere(parent, color, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(sphereGeo, mat(color));
  m.scale.set(sx, sy, sz); m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// wooden baseball bat with a taped grip, held by the thin end (grip at the group origin, barrel along -y)
function makeBat() {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(batGeo, mat(0xb07a46));
  barrel.position.y = -0.4; barrel.castShadow = true; g.add(barrel);
  const cap = new THREE.Mesh(sphereGeo, mat(0xa06c3c)); cap.scale.set(0.082, 0.03, 0.082); cap.position.y = -0.875; g.add(cap);
  const grip = new THREE.Mesh(gripGeo, mat(0x2b2724)); grip.position.y = -0.02; g.add(grip);
  const knob = new THREE.Mesh(knobGeo, mat(0x8a5a30)); knob.position.y = 0.1; g.add(knob);
  return g;
}

// rounded mitten hand with a thumb
function hand(parent, x, y, z, color) {
  const h = new THREE.Group(); h.position.set(x, y, z); parent.add(h);
  sphere(h, color, 0.042, 0.038, 0.048, 0, 0, 0);
  sphere(h, color, 0.016, 0.016, 0.028, -0.036, 0.02, -0.022);
  return h;
}

// big bulging eyes on the front of the log; the iris/pupil group moves with where the bot looks
function sideFace(torso, look, bodyMat, z) {
  const face = new THREE.Mesh(faceGeo, getFaceMat(look));
  face.position.y = 0.85;
  torso.add(face);
  const pupils = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(sx * 0.095, 0.99, -0.226); torso.add(eye);
    // wide, staring eyes: big whites and small pupils, like the meme
    sphere(eye, z ? 0xe2d7a0 : 0xf8f6f0, 0.084, 0.096, 0.06, 0, 0, 0);
    const lookAt = new THREE.Group(); eye.add(lookAt);
    const iris = sphere(lookAt, 0x2a1a10, 0.032, 0.034, 0.02, sx * -0.006, 0.004, -0.05);
    if (z) iris.material = glowRed;     // glowing red zombie eyes
    sphere(lookAt, 0x050505, 0.02, 0.021, 0.012, sx * -0.006, 0.004, -0.062);
    if (!z) sphere(lookAt, 0xffffff, 0.007, 0.007, 0.005, sx * -0.006 + 0.01, 0.016, -0.07);
    pupils.push(lookAt);
    // carved brow ridge following the curve of the log
    const brow = new THREE.Mesh(browGeo, bodyMat);
    brow.rotation.set(0, -sx * 0.39, Math.PI / 2 - sx * 0.14); // inner ends raised: friendly, surprised look
    brow.position.set(sx * 0.097, 1.095, -0.214);
    brow.castShadow = true;
    torso.add(brow);
  }
  // long nose running down from between the eyes
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.position.set(0, 0.875, -0.255); nose.rotation.x = 0.16; nose.scale.set(1, 1, 1.3);
  nose.castShadow = true;
  torso.add(nose);
  return pupils;
}

// The crawler lies face down, so its face sits on the top of the log and looks ahead.
// In the face group, -z points out of the top of the log and +y is "up" while it crawls.
function capFace(torso, bodyMat) {
  const f = new THREE.Group(); f.position.set(0, 1.232, 0); f.rotation.x = Math.PI / 2; torso.add(f);
  const pupils = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(sx * 0.085, 0.035, 0); f.add(eye);
    sphere(eye, 0xe2d7a0, 0.07, 0.078, 0.055, 0, 0, 0);
    const lookAt = new THREE.Group(); eye.add(lookAt);
    sphere(lookAt, 0, 0.038, 0.04, 0.02, 0, 0.004, -0.044).material = glowRed;
    sphere(lookAt, 0x050505, 0.024, 0.026, 0.012, 0, 0.004, -0.056);
    pupils.push(lookAt);
    const brow = new THREE.Mesh(browGeo, bodyMat);
    brow.rotation.set(0, 0, Math.PI / 2 + sx * 0.3); brow.position.set(sx * 0.085, 0.11, 0.004);
    f.add(brow);
  }
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.position.set(0, -0.04, -0.01); nose.scale.set(0.9, 0.55, 1.1);
  f.add(nose);
  part(f, 0.12, 0.024, 0.02, 0x2a1006, 0, -0.13, 0.002);   // mouth
  return pupils;
}

// crawler arm reaching forward onto the ground, pivoting at the shoulder (sx: -1 left, 1 right)
function crawlArm(torso, sx, L) {
  const g = new THREE.Group(); g.position.set(sx * 0.24, 0.85, -0.02); torso.add(g);
  stick(g, [0, 0, 0], [sx * 0.1, 0.12, -0.3], 0.05, L.limb);
  stick(g, [sx * 0.1, 0.12, -0.3], [sx * 0.04, 0.3, -0.6], 0.045, L.limb);
  hand(g, sx * 0.04, 0.3, -0.62, L.hand);
  return g;
}

// bat wing for the flyer: a scalloped membrane on two bones, hinged at the shoulder blade
const wingGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.38, -0.1); s.lineTo(0.84, 0.02);           // leading edge out to the tip
  s.quadraticCurveTo(0.7, 0.1, 0.64, 0.27);             // scalloped trailing edge back to the body
  s.quadraticCurveTo(0.52, 0.17, 0.42, 0.22);
  s.quadraticCurveTo(0.3, 0.29, 0.25, 0.44);
  s.quadraticCurveTo(0.12, 0.31, 0, 0.36);
  s.lineTo(0, 0);
  return new THREE.ShapeGeometry(s, 6);
})();
const wingMat = matte({ color: 0x4a1c8c, side: THREE.DoubleSide });
const WING_TILT = Math.PI - 0.62;   // the membrane hangs down and back from the arm bone
function wing(torso, sx, L) {
  const pivot = new THREE.Group(); pivot.position.set(sx * 0.13, 1.05, 0.2); torso.add(pivot);
  const m = new THREE.Mesh(wingGeo, wingMat);
  m.rotation.x = WING_TILT; m.scale.x = sx;
  pivot.add(m);
  // bones: shape point -> wing space
  const at = (x, y) => [sx * x, y * Math.cos(WING_TILT), y * Math.sin(WING_TILT)];
  stick(pivot, at(0, 0), at(0.38, -0.1), 0.034, L.limb);
  stick(pivot, at(0.38, -0.1), at(0.84, 0.02), 0.028, L.limb);
  stick(pivot, at(0.38, -0.1), at(0.64, 0.27), 0.02, L.limb);
  stick(pivot, at(0.38, -0.1), at(0.25, 0.44), 0.02, L.limb);
  return pivot;
}

// coconut, thrown by the pink zombies
const cocoGeo = new THREE.IcosahedronGeometry(0.12, 1);
const cocoMat = matte({ color: 0x5e3b1e, flatShading: true });
export function makeCoconut() {
  const m = new THREE.Mesh(cocoGeo, cocoMat);
  m.castShadow = true;
  return m;
}

// "Tung Tung Tung Sahur", modelled on the reference picture: a tall polished log with a rounded
// top, big bulging eyes under carved brow ridges, a long nose, a small smile, thin arms and legs,
// and a baseball bat. opts.look: 'friend' | 'enemy' | 'zombie' | 'default'.
// Zombies: opts.zombie with opts.variant, the zombie type (see VARIANTS in zombies.js).
function buildModel(team, opts = {}) {
  const variant = opts.zombie ? (opts.variant || 'normal') : null;
  const look = opts.look || (variant ? ZOMBIE_LOOK[variant] || 'zombie' : 'default');
  const z = !!variant || look === 'zombie';
  const crawl = variant === 'crawler';
  const L = LOOKS[look];
  const gunColor = 0x1e1d1c;
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  const legL = new THREE.Group(); legL.position.set(-0.11, 0.64, 0); root.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.11, 0.64, 0); root.add(legR);
  [legL, legR].forEach((leg, i) => {
    stick(leg, [0, 0.03, 0], [0, -0.58, 0], 0.065, L.legs?.[i] ?? L.limb);
    sphere(leg, L.hand, 0.055, 0.032, 0.1, 0, -0.62, -0.04);   // rounded foot
  });

  const torso = new THREE.Group(); torso.position.set(0, 0.6, 0); root.add(torso);
  const bodyMat = getBodyMat(look);
  const log = new THREE.Mesh(logGeo, bodyMat);
  log.castShadow = true;
  torso.add(log);
  const pupils = crawl ? capFace(torso, bodyMat) : sideFace(torso, look, bodyMat, z);

  // thin arms with elbows, holding the weapon
  const armR = L.arms?.[0] ?? L.limb, armL = L.arms?.[1] ?? L.limb;
  const arms = new THREE.Group(); arms.position.set(0, 0.8, 0); torso.add(arms);
  stick(arms, [0.24, 0, 0], [0.31, -0.2, -0.12], 0.05, armR);
  stick(arms, [0.31, -0.2, -0.12], [0.13, -0.1, -0.36], 0.045, armR);
  stick(arms, [-0.24, 0, 0], [-0.29, -0.2, -0.2], 0.05, armL);
  stick(arms, [-0.29, -0.2, -0.2], [0.0, -0.07, -0.5], 0.045, armL);
  hand(arms, 0.12, -0.1, -0.36, L.hand);
  hand(arms, 0.0, -0.07, -0.5, L.hand);

  const gun = new THREE.Group(); gun.position.set(0.07, -0.05, -0.32); arms.add(gun);
  part(gun, 0.06, 0.1, 0.62, gunColor, 0, 0, -0.18);
  part(gun, 0.05, 0.13, 0.06, gunColor, 0, -0.1, -0.08);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.52); gun.add(muzzle);
  if (!flashTex) flashTex = flashTexture();
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.scale.set(0.5, 0.5, 0.5); flash.visible = false; muzzle.add(flash);

  // the signature baseball bat: in the right hand for melee (pointing down, like the picture),
  // slung on the back while using a gun
  const bat = makeBat(); bat.position.set(0.12, -0.1, -0.36); bat.rotation.x = 0.5; bat.visible = false; arms.add(bat);
  const backBat = makeBat(); backBat.position.set(-0.2, 0.95, 0.28); backBat.rotation.set(-0.1, 0, 2.6); torso.add(backBat);

  const extra = {};
  if (z) {
    gun.visible = false; backBat.visible = false; bat.visible = true;
    if (crawl) {   // pulls itself along on its hands instead of swinging a bat
      arms.visible = false;
      extra.armL = crawlArm(torso, -1, L); extra.armR = crawlArm(torso, 1, L);
    }
    if (variant === 'flyer' || variant === 'boss') { extra.wingL = wing(torso, -1, L); extra.wingR = wing(torso, 1, L); }
    if (variant === 'boss') extra.paint = bossDress(root, torso, bodyMat, L);
    if (variant === 'thrower') {   // a coconut ready in the throwing hand
      bat.visible = false;
      extra.coconut = makeCoconut(); extra.coconut.position.set(0.13, -0.03, -0.42); arms.add(extra.coconut);
    }
    // hordes are big: only the body casts a shadow
    root.traverse((o) => { if (o.isMesh && o !== log) o.castShadow = false; });
  }
  return { root, legL, legR, torso, head: null, arms, gun, bat, backBat, flash, pupils, ...extra };
}

export function buildTungModel(team, opts) { return buildModel(team, opts); }

// The boss: a spiky gold crown and a soft glow round it, and its own copies of the limb, hand and
// wing materials. Returns paint(colors): recolors it (body, limb, hand, wing, glow) for each visit.
const spikeGeo = new THREE.ConeGeometry(0.035, 0.13, 6);
let haloTex = null;
function bossDress(root, torso, bodyMat, L) {
  const gold = matte({ color: 0xffd23a, emissive: 0x5a3c00 }, { metalness: 0.2, roughness: 0.32 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.215, 0.07, 18, 1, true), gold);
  band.position.y = 1.19; torso.add(band);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, sp = new THREE.Mesh(spikeGeo, gold);
    sp.position.set(Math.cos(a) * 0.2, 1.28, Math.sin(a) * 0.2); torso.add(sp);
  }
  if (!haloTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d'), gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(c);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(1.9, 2.3, 1); halo.position.y = 0.95; root.add(halo);
  const limbM = mat(L.limb), handM = mat(L.hand), own = { limb: [], hand: [], wing: [] };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const k = o.material === limbM ? 'limb' : o.material === handM ? 'hand' : o.material === wingMat ? 'wing' : null;
    if (!k) return;
    o.material = o.material.clone(); own[k].push(o.material);
  });
  return (c) => {
    bodyMat.color.setHex(c.body); bodyMat.emissive.setHex(c.glow).multiplyScalar(0.1);
    for (const m of own.limb) { m.color.setHex(c.limb); m.emissive.setHex(c.glow).multiplyScalar(0.55); }
    for (const m of own.hand) { m.color.setHex(c.hand); m.emissive.setHex(c.hand).multiplyScalar(0.3); }
    for (const m of own.wing) { m.color.setHex(c.wing); m.emissive.setHex(c.glow).multiplyScalar(0.35); }
    halo.material.color.setHex(c.glow);
  };
}

const _e = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Vector3(), _h = new THREE.Vector3(), _dir = new THREE.Vector3();

export class Bot extends Combatant {
  constructor(game, name, team, difficulty, look = 'enemy') {
    super(game, name, team);
    this.isBot = true;
    this.meleeName = 'Bat';
    this.diff = DIFF[difficulty] || DIFF.normal;
    this.model = buildModel(team, { look });
    game.scene.add(this.model.root);
    this.objective = null; this.pending = null; this.pendingAt = 0;
    this.path = null; this.pathIdx = 0; this.arrived = false; this.nextPathTime = 0;
    this.target = null; this.targetVisible = false; this.lastSeen = -10; this.lastKnown = new THREE.Vector3();
    this.reactAt = 0; this.aimErr = new THREE.Vector2(); this.aimHead = false;
    this.burst = 0; this.burstPause = 0; this.nextSemi = 0;
    this.perceiveT = Math.random() * 0.2; this.lookPoint = null; this.lookUntil = 0; this.alertUntil = 0;
    this.stuckT = 0; this.walkPhase = 0; this.deathT = 0; this.waitUntil = 0;
    this.scan = Math.random() * 10; this.stepT = 0;
  }

  addMarker(color) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(color), depthWrite: false }));
    s.scale.set(0.28, 0.28, 0.28); s.position.set(0, 2.15, 0);
    this.model.root.add(s);
    this.marker = s;
  }

  dispose() { this.game.scene.remove(this.model.root); }

  spawn(pos, yaw) {
    super.spawn(pos, yaw);
    this.objective = null; this.pending = null; this.path = null; this.arrived = false;
    this.target = null; this.targetVisible = false; this.lookPoint = null;
    this.deathT = 0; this.stuckT = 0;
    const m = this.model;
    m.root.visible = true; m.root.rotation.set(0, yaw, 0);
    if (this.marker) this.marker.visible = true;
    this.animate(0);
  }

  // o: { pos, look, kind, site, via?: waypoints to pass on the way, quiet?: walk (silently) once within this many meters }
  setObjective(o) {
    if (o) o.viaIdx = 0;
    this.objective = o; this.path = null; this.arrived = false; this.pending = null; this.nextPathTime = 0;
  }
  queueObjective(o, delay) { this.pending = o; this.pendingAt = this.game.time + delay; }

  onDamaged(attacker) {
    if (!attacker || attacker.team === this.team) return;
    this.alertUntil = this.game.time + 1.5;
    if (!this.targetVisible) {
      this.lookPoint = attacker.eyePos(new THREE.Vector3());
      this.lookUntil = this.game.time + 2;
      this.perceiveT = 0.05;
    }
  }
  hear(pos, src) {
    if (this.targetVisible || !this.alive || src.team === this.team) return;
    this.lookPoint = new THREE.Vector3(pos.x, pos.y + 1.4, pos.z);
    this.lookUntil = this.game.time + 2.5;
  }
  onDeath() {
    this.deathT = 0;
    this.deathTilt = (Math.random() - 0.5) * 0.6;
    this.model.flash.visible = false;
    if (this.marker) this.marker.visible = false;
  }

  perceive() {
    const g = this.game;
    const eye = this.eyePos(_e);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const halfFov = Math.cos(this.diff.fov / 2);
    let best = null, bestScore = Infinity;
    for (const e of g.combatants) {
      if (!e.alive || e.team === this.team) continue;
      const c = e.chestPos(_c);
      const dx = c.x - eye.x, dz = c.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > 140) continue;
      const cos = (dx * fx + dz * fz) / (d || 1);
      const aware = (e === this.target && g.time - this.lastSeen < 1.5) || (g.time < this.alertUntil && e === this.lastAttacker);
      if (cos < halfFov && d > 3.5 && !aware) continue;
      // far away enemies are only noticed near the center of view
      if (d > 45 && cos < 0.8 && !aware) continue;
      if (!g.lineClear(eye, e.headPos(_h)) && !g.lineClear(eye, c)) continue;
      const score = d * (e === this.target ? 0.6 : 1);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      if (best !== this.target || g.time - this.lastSeen > 1.2) {
        this.target = best;
        let react = this.diff.reaction * (0.75 + Math.random() * 0.6) + bestScore * 0.005;
        if (g.time < this.alertUntil) react *= 0.6;
        this.reactAt = g.time + react;
        const mag = this.diff.aimErr * (0.6 + Math.random() * 0.8);
        const a = Math.random() * Math.PI * 2;
        this.aimErr.set(Math.cos(a) * mag, Math.sin(a) * mag * 0.6);
        this.aimHead = Math.random() < this.diff.head;
        this.burst = 0;
      }
      this.targetVisible = true;
      this.lastSeen = g.time;
      this.lastKnown.copy(best.body.pos);
      best.spottedUntil = g.time + 1.2;
      g.director.onSpotted(this, best);
    } else {
      this.targetVisible = false;
      if (this.target && (!this.target.alive || g.time - this.lastSeen > 4)) this.target = null;
    }
  }

  turnToward(yawT, pitchT, rate, dt) {
    const k = Math.min(1, dt * rate);
    this.yaw += wrapAngle(yawT - this.yaw) * k;
    this.pitch += (pitchT - this.pitch) * k;
  }
  lookAtPoint(p, rate, dt) {
    const eye = this.eyePos(_e);
    const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
    this.turnToward(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)) * 0.5, rate, dt);
  }

  aimAt(t, dt) {
    const eye = this.eyePos(_e);
    const p = this.aimHead ? t.headPos(_p) : t.chestPos(_p);
    const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
    this.aimErr.multiplyScalar(Math.exp(-dt * this.diff.settle));
    // hand wobble that never fully settles, so long shots can miss
    const wt = this.game.time + this.scan * 7, j = this.diff.jitter;
    const wobX = (Math.sin(wt * 2.3) + Math.sin(wt * 5.1) * 0.5) * j;
    const wobY = (Math.sin(wt * 1.9 + 1) + Math.sin(wt * 4.3) * 0.5) * j * 0.7;
    const wantYaw = Math.atan2(-dx, -dz) + this.aimErr.x + wobX;
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.aimErr.y + wobY - this.recoilPitch() * this.diff.comp;
    const yd = wrapAngle(wantYaw - this.yaw), pd = wantPitch - this.pitch;
    const mag = Math.hypot(yd, pd);
    const step = Math.min(mag, this.diff.turn * dt + mag * Math.min(1, dt * 5));
    if (mag > 1e-6) { this.yaw += yd / mag * step; this.pitch += pd / mag * step; }
    return mag - step;
  }

  handleFire(err, dist) {
    const g = this.game, w = this.weapon;
    if (!w) return;
    const d = w.def;
    const tol = Math.max(0.012, Math.atan2(0.3, dist)) * 1.15;
    if (g.time - this.lastShot > 0.45) this.burst = 0;
    if (err > tol || g.time < this.burstPause) return;
    if (d.melee) { if (dist < 2.0) this.tryFire(true); return; }
    if (!d.auto) {
      if (g.time >= this.nextSemi && this.tryFire(true)) this.nextSemi = g.time + d.rate + 0.08 + Math.random() * 0.25;
      return;
    }
    const maxBurst = dist > 28 ? 2 : dist > 14 ? 4 : this.diff.spray;
    if (this.tryFire(true)) {
      this.burst++;
      if (this.burst >= maxBurst) { this.burst = 0; this.burstPause = g.time + 0.22 + Math.random() * 0.25; }
    }
  }

  manageWeapons() {
    const s1 = this.slots[1], s2 = this.slots[2];
    const has = (w) => w && (w.mag + w.reserve) > 0;
    if (has(s1)) { if (this.slot !== 1 && !this.reloading) this.selectSlot(1); }
    else if (has(s2)) { if (this.slot !== 2) this.selectSlot(2); }
    else if (this.slot !== 3) this.selectSlot(3);
  }

  // Direction to walk this tick (or null). Goes through the objective's waypoints in order, then to its spot.
  navigate() {
    const o = this.objective, g = this.game, b = this.body;
    if (!o) return null;
    for (let guard = 0; guard < 4; guard++) {
      const via = o.via && o.viaIdx < o.via.length ? o.via[o.viaIdx] : null;
      if (!this.path) {
        if (g.time < this.nextPathTime) return null;
        this.nextPathTime = g.time + 0.5;
        this.path = g.map.findPath(b.pos, via || o.pos);
        this.pathIdx = 1; this.arrived = false;
        if (!this.path) {
          if (!via) return null;
          o.viaIdx++; this.nextPathTime = 0;   // unreachable waypoint: skip it
          continue;
        }
      }
      while (this.pathIdx < this.path.length) {
        const p = this.path[this.pathIdx];
        const dx = p.x - b.pos.x, dz = p.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        const last = this.pathIdx === this.path.length - 1;
        // waypoints only need passing near, the final spot needs reaching
        if (d < (last ? (via ? 1.6 : 0.45) : 0.75)) { this.pathIdx++; continue; }
        return _dir.set(dx / d, 0, dz / d);
      }
      if (!via) break;
      o.viaIdx++; this.path = null; this.nextPathTime = 0;
    }
    this.arrived = !(o.via && o.viaIdx < o.via.length);
    return null;
  }

  update(dt) {
    const g = this.game, b = this.body;
    if (!this.alive) { this.animateDeath(dt); return; }
    if (this.pending && g.time >= this.pendingAt) this.setObjective(this.pending);
    this.updateWeapon(dt);
    this.manageWeapons();
    this.wantsUse = false;

    this.perceiveT -= dt;
    if (this.perceiveT <= 0) { this.perceiveT = 0.1 + Math.random() * 0.08; this.perceive(); }

    const frozen = g.phase === 'freeze';
    let wx = 0, wz = 0, speedMul = 1, jump = false;
    const t = this.target;
    const engaging = t && t.alive && this.targetVisible;
    const w = this.weapon;

    if (engaging) {
      const err = this.aimAt(t, dt);
      const dist = b.pos.distanceTo(t.body.pos);
      if (w?.def.scope) this.scoped = true;
      if (!frozen && g.time >= this.reactAt) this.handleFire(err, dist);
      if (w?.def.melee) {
        const dx = t.body.pos.x - b.pos.x, dz = t.body.pos.z - b.pos.z, l = Math.hypot(dx, dz) || 1;
        wx = dx / l; wz = dz / l;
      }
    } else {
      this.scoped = false;
      if (w && !w.def.melee && !this.reloading && w.mag < w.def.mag * 0.4 && w.reserve > 0 && g.time - this.lastSeen > 1.5) this.startReload();
      if (!frozen && g.time >= this.waitUntil) {
        const dir = this.navigate();
        const o = this.objective;
        if (dir) {
          wx = dir.x; wz = dir.z;
          // sneaking up: shift-walk (silent) for the last stretch
          if (o?.quiet && Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) < o.quiet) speedMul = 0.52;
        }
        // final approach to bomb (it may sit next to a crate, off the nav grid)
        if (o && this.arrived && (o.kind === 'defuse' || o.kind === 'pickup')) {
          const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz);
          if (d > 0.6) { wx = dx / d; wz = dz / d; speedMul = 0.5; }
        }
      }
      // where to look
      if (t && g.time - this.lastSeen < 3) {
        this.lookAtPoint(_p.set(this.lastKnown.x, this.lastKnown.y + 1.5, this.lastKnown.z), 6, dt);
      } else if (this.lookPoint && g.time < this.lookUntil) {
        this.lookAtPoint(this.lookPoint, 7, dt);
      } else if (wx || wz) {
        this.turnToward(Math.atan2(-wx, -wz), 0, 6, dt);
      } else if (this.objective?.look) {
        const l = this.objective.look, eye = this.eyePos(_e);
        const yawT = Math.atan2(-(l.x - eye.x), -(l.z - eye.z)) + Math.sin(g.time * 0.45 + this.scan) * 0.35;
        this.turnToward(yawT, 0, 3, dt);
      }
      // objectives
      const o = this.objective;
      if (o && o.kind === 'plant' && this.hasBomb && this.arrived && g.map.inSite(b.pos)) { this.wantsUse = true; wx = wz = 0; }
      if (o && o.kind === 'defuse' && g.bomb.state === 'planted') {
        const d = Math.hypot(g.bomb.pos.x - b.pos.x, g.bomb.pos.z - b.pos.z);
        if (d < 1.3) { this.wantsUse = true; wx = wz = 0; }
      }
    }
    if (frozen) { wx = wz = 0; }

    // unstick
    if (wx || wz) {
      if (this.horizSpeed() < 0.8) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.7 && b.onGround) jump = true;
      if (this.stuckT > 1.6) { this.path = null; this.stuckT = 0; }
    } else this.stuckT = 0;

    this.applyMovement(dt, wx, wz, speedMul, jump);

    const sp = this.horizSpeed();
    if (b.onGround && sp > 3.6) {
      this.stepT -= dt * sp / 5;
      if (this.stepT <= 0) { this.stepT = 0.38; g.sound.step(b.pos, false); g.emitNoise(b.pos, 14, this); }
    }
    this.animate(dt);
  }

  animate(dt) {
    const m = this.model, g = this.game;
    m.root.position.copy(this.body.pos);
    m.root.rotation.set(0, this.yaw, 0);
    const sp = this.horizSpeed();
    this.walkPhase += dt * sp * 1.9;
    const amp = Math.min(1, sp / 4) * 0.65;
    m.legL.rotation.x = Math.sin(this.walkPhase) * amp;
    m.legR.rotation.x = -Math.sin(this.walkPhase) * amp;
    m.torso.position.y = 0.6 + Math.abs(Math.cos(this.walkPhase)) * 0.035 * amp;
    m.torso.rotation.z = Math.sin(this.walkPhase) * 0.05 * amp; // log waddle
    m.arms.rotation.x = this.pitch;
    for (const pu of m.pupils) pu.position.y = Math.max(-0.02, Math.min(0.02, this.pitch * 0.05));
    const w = this.weapon;
    const melee = !!w?.def.melee;
    m.gun.visible = !melee; m.bat.visible = melee; m.backBat.visible = !melee;
    m.gun.scale.z = w?.def.slot === 2 ? 0.45 : w?.def.scope ? 1.35 : 1;
    const flashing = w && !w.def.melee && g.time - this.lastShot < 0.05;
    m.flash.visible = !!flashing;
    if (flashing) m.flash.material.rotation = Math.random() * 6;
  }

  animateDeath(dt) {
    const m = this.model;
    if (this.deathT > 1) return;
    this.deathT += dt;
    const k = Math.min(1, this.deathT / 0.5), e = k * k;
    m.root.rotation.set(e * Math.PI / 2 * 0.97, this.yaw, e * this.deathTilt);
    m.root.position.set(this.body.pos.x, this.body.pos.y + e * 0.15, this.body.pos.z);
    m.legL.rotation.x *= 0.9; m.legR.rotation.x *= 0.9;
    m.flash.visible = false;
  }
}
