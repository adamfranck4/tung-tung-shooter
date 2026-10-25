// The Golden Tung Tung: the round objective in Zombies. A gold statue on a stone plinth that moves
// to a different room before every round (newly opened rooms first, so every part of the village
// gets its turn). Zombies go for it as well as for you; if it breaks, the game is over.
import * as THREE from 'three';
import { buildTungModel } from './bots.js';
import { AREAS, GUN_SHOP } from './zmap.js';

export const STATUE_R = 0.6;          // half the plinth's width: what zombies bump into and hit
const PLINTH_H = 0.5, SCALE = 1.35;
export const STATUE_H = PLINTH_H + 1.85 * SCALE;
// Balance by team size. A bigger team gets more zombies (x1.5 / x2 / x2.5, see startRound) but
// also has more guns to defend with, and can leave someone on guard. So the statue's health grows
// a little slower than the horde (hp), while a few more zombies head for it (hunters), because a
// team spread round the map pulls the rest of the horde away from it.
//   players:  1      2      3      4
//   hp:       x1     x1.3   x1.55  x1.8
//   hunters:  +0     +4%    +7%    +10%   (on top of 30% on round 1, up to 50%)
const TEAM = [
  null,
  { hp: 1, hunters: 0 },
  { hp: 1.3, hunters: 0.04 },
  { hp: 1.55, hunters: 0.07 },
  { hp: 1.8, hunters: 0.1 },
];
const team = (players) => TEAM[Math.max(1, Math.min(4, players | 0))];
// health: more every round, scaled for the team
export const statueMaxHp = (r, players = 1) => Math.round((2000 + 220 * (Math.max(1, r) - 1)) * team(players).hp);
// share of the zombies that head straight for the statue instead of you
export const hunterChance = (r, players = 1) => Math.min(0.5, 0.3 + 0.015 * r) + team(players).hunters;

const GOLD = { color: 0xc8901c, emissive: 0x1c1000, specular: 0xffe7a0, shininess: 45 };
const gold = new THREE.MeshPhongMaterial(GOLD);
const stone = new THREE.MeshLambertMaterial({ color: 0x8a8278 });
const trim = new THREE.MeshPhongMaterial({ color: 0xd9a52a, emissive: 0x2a1a00, specular: 0xffe8a0, shininess: 50 });

function markerTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.translate(64, 56);
  ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(36, 0); ctx.lineTo(0, 46); ctx.lineTo(-36, 0); ctx.closePath();
  ctx.fillStyle = 'rgba(30,20,0,0.75)'; ctx.fill();
  ctx.lineWidth = 7; ctx.strokeStyle = '#ffd23a'; ctx.stroke();
  ctx.fillStyle = '#ffd23a'; ctx.font = '700 44px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, 3);
  ctx.font = '700 30px Rajdhani, sans-serif'; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText('DEFEND', 0, 80); ctx.fillText('DEFEND', 0, 80);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(0.45, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Statue {
  constructor(scene) {
    this.scene = scene;
    this.isStatue = true;
    this.alive = false; this.room = null; this.hp = 1; this.maxHp = 1; this.flashT = 0;
    this.body = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };   // (zombies aim at it like at a player)
    this.collider = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };
    const root = this.root = new THREE.Group();
    // stone plinth with a gold band
    const base = new THREE.Mesh(new THREE.BoxGeometry(STATUE_R * 2, PLINTH_H, STATUE_R * 2), stone);
    base.position.y = PLINTH_H / 2; base.castShadow = base.receiveShadow = true; root.add(base);
    const band = new THREE.Mesh(new THREE.BoxGeometry(STATUE_R * 2 + 0.04, 0.08, STATUE_R * 2 + 0.04), trim);
    band.position.y = PLINTH_H - 0.06; root.add(band);
    // the Tung Tung itself, in gold, bat raised over its shoulder
    const m = this.model = buildTungModel('Z', { zombie: true, variant: 'normal' });
    this.mats = [];
    m.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.transparent) {   // the painted face: keep it, tinted gold
        o.material = o.material.clone(); o.material.color.setHex(0xe0b050);
        this.mats.push(o.material);
      } else {
        o.material = o.material.map ? new THREE.MeshPhongMaterial({ ...GOLD, map: o.material.map }) : gold;
        if (o.material !== gold) this.mats.push(o.material);
      }
      o.castShadow = true;
    });
    this.mats.push(gold);
    m.arms.rotation.x = 0.9; m.bat.rotation.x = -2.25; m.torso.rotation.x = -0.08;
    m.legL.rotation.x = 0.25; m.legR.rotation.x = -0.2;
    m.root.scale.setScalar(SCALE); m.root.position.y = PLINTH_H; m.root.visible = true;
    root.add(m.root);
    // a soft glow round it and a beam of light so you can spot the room from a distance
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0xffc040, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.halo.scale.set(3, 3.6, 1); this.halo.position.y = PLINTH_H + 1.3; root.add(this.halo);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    root.add(this.beam);
    // a "DEFEND" marker you can see through walls
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(), depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.marker.scale.set(0.04, 0.05, 1); this.marker.renderOrder = 999;
    this.marker.position.y = STATUE_H + 0.9; root.add(this.marker);
    root.visible = false;
    scene.add(root);
  }

  // where its middle is (zombies throw coconuts at it)
  chestPos(out) { const p = this.body.pos; return out.set(p.x, p.y + PLINTH_H + 1.2, p.z); }
  headPos(out) { const p = this.body.pos; return out.set(p.x, p.y + STATUE_H - 0.3, p.z); }

  // put it in a room. ceil: how high the beam may go (the roof indoors)
  place(room, pos, ceil) {
    this.room = room; this.alive = true; this.flashT = 0;
    this.body.pos.copy(pos);
    this.root.position.copy(pos); this.root.visible = true;
    const c = this.collider;
    Object.assign(c, { x0: pos.x - STATUE_R, x1: pos.x + STATUE_R, z0: pos.z - STATUE_R, z1: pos.z + STATUE_R, y0: pos.y, y1: pos.y + STATUE_H });
    const h = Math.max(1, Math.min(40, ceil - pos.y - 0.05));
    this.beam.scale.set(1, h, 1); this.beam.position.y = h / 2;
    this.setFlash(0);
  }

  hide() { this.alive = false; this.root.visible = false; }

  hit() { this.flashT = 0.18; }
  setFlash(k) {
    for (const m of this.mats) if (m.emissive) m.emissive.setRGB(0.11 + 0.7 * k, 0.06 * (1 - k), 0);
  }

  // every frame: the glow pulses, red flash when hit, the marker shows when you're not right by it
  animate(dt, time, camPos) {
    if (!this.root.visible) return;
    const low = this.hp / this.maxHp < 0.3;
    this.halo.material.opacity = (low ? 0.4 : 0.22) + Math.sin(time * (low ? 9 : 2.5)) * 0.08;
    this.halo.material.color.setHex(low ? 0xff5030 : 0xffc040);
    this.beam.material.opacity = 0.13 + Math.sin(time * 2) * 0.04;
    if (this.flashT > 0) { this.flashT -= dt; this.setFlash(Math.max(0, this.flashT / 0.18)); }
    this.marker.visible = !camPos || camPos.distanceTo(this.body.pos) > 9;
  }
}

// Pick which room the statue goes to next: never the same one twice in a row; rooms it hasn't
// been to yet come first (the newest one, so each round shows off the area that just opened).
export function chooseRoom(open, last, visits) {
  let c = open.filter((id) => id !== last);
  if (!c.length) c = open;
  const n = (id) => visits[id] || 0, min = Math.min(...c.map(n));
  c = c.filter((id) => n(id) === min);
  if (min === 0) return c.sort((a, b) => AREAS[b].after - AREAS[a].after)[0];
  return c[Math.floor(Math.random() * c.length)];
}

// A good spot in a room: a floor cell you can reach, on flat ground with open floor all round it
// (so the statue doesn't plug a doorway), as close to the middle of the room as possible.
export function statueSpot(map, room) {
  const a = AREAS[room], GW = map.gw, C = map.cell, reach = map.reachable();
  const [x0, z0, x1, z1] = a.rect, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  const [sx0, sz0, sx1, sz1] = GUN_SHOP.rect.map((v) => v / C);
  let best = null, bs = Infinity;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const i = z * GW + x;
    if (!reach[i] || !map.walkable(x, z)) continue;
    if (x >= sx0 - 1 && x < sx1 + 1 && z >= sz0 - 1 && z < sz1 + 1) continue;   // not in (or in the door of) the Gun Shop
    let open = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = (z + dz) * GW + x + dx;
      if (map.walkable(x + dx, z + dz) && reach[n] && map.canStep(x, z, dx, dz) && Math.abs(map.navH[n] - map.navH[i]) < 0.3) open++;
    }
    const score = Math.hypot(x + 0.5 - mx, z + 0.5 - mz) + (8 - open) * 4;
    if (score < bs) { bs = score; best = [x, z]; }
  }
  if (!best) return null;
  const px = best[0] * C + C / 2, pz = best[1] * C + C / 2;
  return new THREE.Vector3(px, map.surfaceAt(px, pz), pz);
}
