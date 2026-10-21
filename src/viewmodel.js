// First-person weapon + arms, rendered in its own scene so it never clips into walls.
import * as THREE from 'three';
import { flashTexture } from './textures.js';

const M = {};
function mat(c) { return M[c] || (M[c] = new THREE.MeshLambertMaterial({ color: c })); }
const SHINY = {};
function shiny(c) { return SHINY[c] || (SHINY[c] = new THREE.MeshPhongMaterial({ color: c, shininess: 90, specular: 0x9a9a9a })); }
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

// Wooden stick arms (everyone is a Tung Tung Tung Sahur log), with a team-colored wristband.
const WOOD = 0x8a5d33, KNOB = 0xc0915e;
function arms(g, band, twoHands, leftZ = -0.26) {
  b(g, 0.055, 0.07, 0.075, KNOB, 0.0, -0.075, 0.06);                      // right hand
  b(g, 0.05, 0.05, 0.03, band, 0.02, -0.1, 0.12);                          // wristband
  limb(g, [0.01, -0.09, 0.09], [0.13, -0.3, 0.42], 0.045, WOOD);           // right stick arm
  if (twoHands) {
    b(g, 0.065, 0.055, 0.08, KNOB, -0.01, -0.05, leftZ);                   // left hand
    b(g, 0.05, 0.05, 0.03, band, -0.05, -0.1, leftZ + 0.08);
    limb(g, [-0.02, -0.07, leftZ + 0.03], [-0.22, -0.32, leftZ + 0.36], 0.045, WOOD);
  }
}

// ---------- knife skins ----------
// Blades are drawn as 2D outlines (x = forward, y = up) and extruded a few mm thick.
function bladeMesh(shape, depth, color) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, shiny(color));
}
function shapeFrom(fn) { const s = new THREE.Shape(); fn(s); return s; }

function knifeRegular(k) {
  k.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, -0.014); s.lineTo(0.13, -0.014);
    s.quadraticCurveTo(0.168, -0.008, 0.18, 0.012);
    s.lineTo(0.13, 0.021); s.lineTo(0, 0.02);
  }), 0.006, 0xc8ccd2));
  b(k, 0.012, 0.055, 0.026, 0, 0, 0.003, 0, 0, 0, 0, shiny(0x3a3c40));          // guard
  b(k, 0.11, 0.032, 0.026, 0x1d1d1f, -0.06, 0.002, 0);                          // handle
  b(k, 0.014, 0.036, 0.03, 0x3a3c40, -0.118, 0.002, 0);                         // pommel
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

function knifeFlip(k) {
  k.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, -0.015); s.lineTo(0.12, -0.015);
    s.quadraticCurveTo(0.165, -0.012, 0.175, 0.004);
    s.quadraticCurveTo(0.14, 0.022, 0.08, 0.023);
    s.lineTo(0.0, 0.021);
    s.lineTo(0.004, 0.032); s.lineTo(-0.008, 0.03); // flipper
    s.lineTo(-0.008, -0.015);
  }), 0.005, 0xb9bec6));
  b(k, 0.11, 0.03, 0.024, 0x2b2e33, -0.062, 0.003, 0);
  b(k, 0.02, 0.032, 0.026, 0x8a9099, -0.005, 0.003, 0, 0, 0, 0, shiny(0x8a9099)); // bolster
}

function knifeButterfly(k) {
  k.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, -0.012); s.lineTo(0.14, -0.012);
    s.lineTo(0.175, 0.004);
    s.lineTo(0.14, 0.018); s.lineTo(0, 0.016);
  }), 0.005, 0xcfd3d9));
  // two handle halves that swing around the pivots during flips
  const mk = (y, z) => {
    const piv = new THREE.Group(); piv.position.set(0, y, z); k.add(piv);
    b(piv, 0.12, 0.014, 0.012, 0, -0.06, 0, 0, 0, 0, 0, shiny(0x6d7480));
    b(piv, 0.1, 0.006, 0.013, 0x22262c, -0.06, 0, 0);
    return piv;
  };
  k.userData.bfA = mk(0.009, 0.007);
  k.userData.bfB = mk(-0.006, -0.007);
}

function knifeSword(k) {
  const blade = new THREE.Group(); blade.rotation.z = 0.12; k.add(blade);
  blade.add(bladeMesh(shapeFrom((s) => {
    s.moveTo(0, -0.021); s.lineTo(0.62, -0.021);
    s.lineTo(0.7, 0); s.lineTo(0.62, 0.021); s.lineTo(0, 0.021);
  }), 0.007, 0xd7dbe2));
  b(blade, 0.56, 0.006, 0.009, 0x8d939c, 0.31, 0, 0);                                 // fuller
  b(blade, 0.016, 0.13, 0.032, 0, 0, 0, 0, 0, 0, 0, shiny(0xc9a13b));                // crossguard
  b(blade, 0.13, 0.028, 0.026, 0x3b2414, -0.07, 0, 0);                                // grip
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), shiny(0xc9a13b));
  pommel.position.set(-0.14, 0, 0); blade.add(pommel);
}

export const KNIFE_SKINS = [
  { id: 'knife', name: 'Knife', build: knifeRegular },
  { id: 'karambit', name: 'Karambit', build: knifeKarambit },
  { id: 'flip', name: 'Flip Knife', build: knifeFlip },
  { id: 'butterfly', name: 'Butterfly Knife', build: knifeButterfly },
  { id: 'sword', name: 'Sword', build: knifeSword },
];
export function knifeName(id) { return (KNIFE_SKINS.find((s) => s.id === id) || KNIFE_SKINS[0]).name; }

function buildKnife(skin, band) {
  const g = new THREE.Group();
  const k = new THREE.Group();     // knife in "shape space" (x forward, y up)
  skin.build(k);
  k.rotation.order = 'YXZ';          // so rotation.x twirls around the blade's length
  k.rotation.set(0, Math.PI / 2, 0); // shape +x -> view -z
  const holder = new THREE.Group();
  holder.position.set(0, -0.055, 0.04);
  holder.rotation.set(0.25, 0.35, 0); // tip angled up and toward the screen center
  holder.add(k);
  g.add(holder);
  arms(g, band, false);
  g.userData.muzzle = null;
  g.userData.knife = k;
  return g;
}

function buildModels(team) {
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
  arms(g, band, true, 0.0); mz = new THREE.Object3D(); mz.position.set(0, 0.025, -0.16); g.add(mz); g.userData.muzzle = mz;
  models.pistol = g;

  g = new THREE.Group(); // pump shotgun
  b(g, 0.05, 0.07, 0.3, 0x2a2b2e, 0, 0, 0.0);
  b(g, 0.03, 0.03, 0.55, 0x1b1c1e, 0, 0.022, -0.38);
  b(g, 0.026, 0.026, 0.42, 0x2a2b2e, 0, -0.02, -0.32);
  b(g, 0.055, 0.05, 0.16, 0x6b4426, 0, -0.025, -0.3);            // wooden pump
  b(g, 0.045, 0.09, 0.26, 0x6b4426, 0, -0.03, 0.26, -0.15);      // stock
  b(g, 0.035, 0.09, 0.045, 0x3a2a1a, 0, -0.07, 0.08, -0.3);
  arms(g, band, true, -0.3); mz = new THREE.Object3D(); mz.position.set(0, 0.022, -0.67); g.add(mz); g.userData.muzzle = mz;
  models.shotgun = g;

  g = new THREE.Group(); // drum LMG
  b(g, 0.07, 0.1, 0.46, 0x2b2d24, 0, 0, -0.05);
  b(g, 0.03, 0.03, 0.34, 0x161616, 0, 0.02, -0.45);
  b(g, 0.06, 0.06, 0.2, 0x3a3d32, 0, 0.005, -0.32);
  cyl(g, 0.075, 0.07, 0x1d1e1a, 0, -0.1, -0.05).rotation.set(0, 0, Math.PI / 2);  // drum mag
  b(g, 0.05, 0.1, 0.24, 0x2b2d24, 0, -0.02, 0.28, -0.1);
  b(g, 0.035, 0.09, 0.045, 0x1c1d20, 0, -0.08, 0.1, -0.3);
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
  b(g, 0.034, 0.11, 0.05, 0x7a1d18, 0, -0.045, 0.03, -0.25);
  arms(g, band, true, 0.0); mz = new THREE.Object3D(); mz.position.set(0, 0.03, -0.32); g.add(mz); g.userData.muzzle = mz;
  models.raygun = g;

  for (const skin of KNIFE_SKINS) models['knife_' + skin.id] = buildKnife(skin, band);
  return models;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a48, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.8); sun.position.set(1, 2, 1); this.scene.add(sun);
    this.root = new THREE.Group();
    this.root.scale.setScalar(0.85);
    this.scene.add(this.root);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.16, 0.16, 0.16); this.flash.visible = false;
    this.scene.add(this.flash);
    this.team = null; this.models = null; this.current = null; this.key = null;
    this.knifeSkin = 'knife';
    this.bob = 0; this.swayX = 0; this.swayY = 0; this.kick = 0; this.flashT = 0; this.swing = 0;
    this.inspectT = 0; this.flipT = 0;
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
    this.inspectT = 0;
    if (vmKey === 'knife_butterfly') this.flipT = 0.7; // flip it open on deploy
  }

  fire(melee) {
    this.inspectT = 0;
    if (melee) { this.swing = 1; return; }
    this.kick = 1;
    this.flashT = 0.045;
    this.flash.material.rotation = Math.random() * 6;
  }

  inspect() {
    if (this.inspectT > 0) return;
    this.inspectT = 2.6;
    if (this.key === 'knife_butterfly') this.flipT = 2.2;
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  update(dt, p, game, mouseDx, mouseDy) {
    const w = p.weapon;
    if (!w) return;
    this.setWeapon(w.def.melee ? 'knife_' + this.knifeSkin : w.def.vm);
    const t = game.time;
    const sp = p.horizSpeed();
    const moving = p.body.onGround ? Math.min(1, sp / 5) : 0;
    this.bob += dt * (4 + sp * 1.2);
    this.swayX += ((-mouseDx * 0.0006) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += ((mouseDy * 0.0006) - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-0.05, Math.min(0.05, this.swayX));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY));
    this.kick = Math.max(0, this.kick - dt * 12);
    this.swing = Math.max(0, this.swing - dt * 3.5);

    let x = 0.16 + Math.sin(this.bob) * 0.012 * moving + this.swayX;
    let y = -0.17 - Math.abs(Math.cos(this.bob)) * 0.012 * moving + this.swayY + (p.body.onGround ? 0 : 0.02);
    let z = -0.38 + this.kick * 0.04;
    let rx = this.kick * 0.06, ry = 0, rz = 0;
    if (w.def.melee) { x -= 0.02; y += 0.07; z -= 0.02; rz += 0.1; } // knives sit higher in view

    if (p.reloading) {
      this.inspectT = 0;
      const k = 1 - (p.reloadEnd - t) / (p.reloadDur || w.def.reload);
      const dip = Math.sin(Math.min(1, Math.max(0, k)) * Math.PI);
      y -= dip * 0.12; rx -= dip * 0.45; rz += dip * 0.35;
    }
    if (t < p.deployUntil) {
      const k = (p.deployUntil - t) / (w.def.deploy || 0.5);
      y -= k * k * 0.3; rx -= k * 0.6;
    }
    if (this.swing > 0) {
      const s = Math.sin(this.swing * Math.PI);
      const big = this.key === 'knife_sword' ? 1.5 : 1;
      ry += s * 0.9 * big; rz -= s * 0.6 * big; x -= s * 0.08; z -= s * 0.06;
    }
    // inspect: turn the weapon to show it off
    if (this.inspectT > 0) {
      this.inspectT -= dt;
      const k = 1 - Math.max(0, this.inspectT) / 2.6;
      const e = Math.sin(Math.min(1, k * 1.15) * Math.PI);
      x -= e * 0.07; y += e * 0.04; z += e * 0.05;
      ry += e * 0.75; rz -= e * 0.55 + Math.sin(k * Math.PI * 2) * 0.15 * e; rx += e * 0.2;
    }
    // butterfly knife handle flips
    const knife = this.current?.userData.knife;
    if (knife?.userData.bfA) {
      const A = knife.userData.bfA, B = knife.userData.bfB;
      if (this.flipT > 0) {
        this.flipT -= dt;
        const a = this.flipT * 14;
        A.rotation.z = Math.PI * (0.5 - 0.5 * Math.cos(a));
        B.rotation.z = -Math.PI * (0.5 - 0.5 * Math.cos(a + 1.3));
        knife.rotation.x = Math.sin(this.flipT * 9) * 0.6;
      } else {
        A.rotation.z *= 0.6; B.rotation.z *= 0.6; knife.rotation.x *= 0.6;
      }
    }
    this.root.position.set(x, y, z);
    this.root.rotation.set(rx, ry, rz);
    this.root.visible = !p.scoped;

    this.flashT -= dt;
    const mz = this.current?.userData.muzzle;
    if (mz && this.flashT > 0 && !p.scoped) {
      this.root.updateMatrixWorld(true);
      mz.getWorldPosition(this.flash.position);
      this.flash.visible = true;
    } else this.flash.visible = false;
  }
}
