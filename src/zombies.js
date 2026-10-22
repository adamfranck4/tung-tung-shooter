// Zombies mode: survive endless rounds of Tung Tung zombies in Sahur Village, alone or with up to
// three friends online. Online, the host's browser runs the zombies and the shared world (doors,
// box, power-ups); each player's points, perks and health live here too. See netzombies.js for
// the joining side.
import * as THREE from 'three';
import { Combatant, RUN_SPEED, dirFrom, chaseCamera } from './combatant.js';
import { Player } from './player.js';
import { buildTungModel, makeCoconut, tickRainbow } from './bots.js';
import { WEAPONS, papDef, MAX_PAP, ZOMBIE_SHOP, ZOMBIE_PRICES, ammoCost } from './weapons.js';
import { raycast, raySphere, rayBox, moveBody, wrapAngle } from './physics.js';
import { PLAYER_START, AREAS } from './zmap.js';
import { knifeName } from './viewmodel.js';
import { Avatar, Interp, F, r1, r2, r3, packSlots, showShot } from './avatar.js';
import { NET_SOUNDS } from './game.js';

const MAX_ALIVE = 24;
const BOX_WEAPONS = [['smg', 3], ['shotgun', 3], ['ak', 3], ['m4', 3], ['sniper', 2], ['lmg', 2], ['raygun', 1]];
export const POWERUPS = {
  maxammo: { label: 'MAX AMMO', short: 'AMMO', color: '#7dff6a' },
  instakill: { label: 'INSTA-KILL', short: 'KILL', color: '#ff5a5a' },
  double: { label: 'DOUBLE POINTS', short: 'x2', color: '#ffd84a' },
  nuke: { label: 'KABOOM', short: 'NUKE', color: '#ffa040' },
  carpenter: { label: 'CARPENTER', short: 'FIX', color: '#8ad0ff' },
};
export const BASE_HEALTH = 150;
const JUGG_HEALTH = 250;
export const BLEED_TIME = 30;     // co-op: seconds a downed player lasts without a revive
export const REVIVE_TIME = 3;     // holding E next to them (half with Quick Revive)
export const ZOMBIE_HP = 100;                            // regular zombies: same health as a player
export const bigZombieHealth = (r) => 400 + 80 * r;      // big zombies: a real bullet sponge
const BIG_SCALE = 1.7;
// chance that a spawn is a big zombie (from round 3, up to 1 in 4), max 3 alive at once
const bigChance = (r) => (r < 3 ? 0 : clamp(0.06 + (r - 3) * 0.02, 0, 0.25));
export const zombieCount = (r) => (r <= 5 ? [6, 8, 13, 18, 24][r - 1] : Math.floor(24 + (r - 5) * 4.5));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// share of spawns that ramps up from round `from`
const ramp = (r, from, start, step, cap) => (r < from ? 0 : Math.min(cap, start + (r - from) * step));

// The Tung Tung zombie types.
// hp(round), speed(round) (regular and big zombies roll their own); dmg / reach / hitReach / cd: the
// melee hit. from: first round it shows up, chance(round): share of the spawns, max(round): how many
// can be alive at once. ground: only rises out of the ground (too big for the windows). Kill points:
// `points`, or the usual 60 / 100 headshot / 130 knife plus `bonus`. pitch / tung: its voice.
export const VARIANTS = {
  normal:  { hp: () => ZOMBIE_HP, scale: 1, dmg: 50, reach: 1.3, hitReach: 1.8, cd: 1.1, pitch: 1 },
  big:     { hp: bigZombieHealth, scale: BIG_SCALE, dmg: 80, reach: 1.9, hitReach: 2.5, cd: 1.4, pitch: 0.55, tung: 0.7,
             ground: true, points: 250, rise: 2.2, from: 3, chance: bigChance, max: () => 3 },
  // yellow: faster than you, but fragile
  fast:    { hp: () => 70, scale: 0.92, speed: (r) => 6.7 + Math.min(0.5, (r - 2) * 0.05), dmg: 35, reach: 1.3, hitReach: 1.8, cd: 0.7,
             pitch: 1.5, bonus: 30, from: 2, chance: (r) => ramp(r, 2, 0.08, 0.01, 0.14), max: () => 4,
             intro: 'Yellow speedsters! They can outrun you' },
  // brown: crawls along the floor, low and hard to hit
  crawler: { hp: () => 90, scale: 1, speed: (r) => 3.2 + Math.min(1.2, (r - 2) * 0.1), dmg: 30, reach: 1.25, hitReach: 1.75, cd: 0.9,
             pitch: 0.8, bonus: 20, crawl: true, from: 2, chance: (r) => ramp(r, 2, 0.08, 0.008, 0.12), max: () => 5,
             intro: 'Brown crawlers! Aim low' },
  // pink: keeps its distance and throws coconuts
  thrower: { hp: () => 100, scale: 1, speed: (r) => 2.4 + Math.min(0.6, (r - 3) * 0.05), dmg: 35, reach: 1.3, hitReach: 1.8, cd: 1.0,
             throwDmg: 30, pitch: 1.15, bonus: 40, throws: true, from: 3, chance: (r) => ramp(r, 3, 0.06, 0.008, 0.1), max: () => 3,
             intro: 'Pink throwers! Dodge the coconuts' },
  // purple: flies in from the sky and swoops down on you
  flyer:   { hp: () => 80, scale: 0.95, speed: (r) => 4.4 + Math.min(1, (r - 4) * 0.1), dmg: 40, reach: 1.4, hitReach: 2.0, cd: 1.0,
             pitch: 1.3, bonus: 40, fly: true, from: 4, chance: (r) => ramp(r, 4, 0.06, 0.008, 0.1), max: () => 4,
             intro: 'Purple flyers! Look up' },
  // rainbow: a huge, slow boss that shrugs off Insta-Kill and Kaboom, and always drops a power-up
  giant:   { hp: (r) => 900 + 120 * r, scale: 2.2, speed: (r) => (r >= 10 ? 2.6 : 1.9), dmg: 100, reach: 2.7, hitReach: 3.4, cd: 1.8,
             pitch: 0.4, tung: 0.95, ground: true, points: 500, rise: 3.2, boss: true,
             from: 5, chance: (r) => ramp(r, 5, 0.025, 0.004, 0.04), max: (r) => (r >= 12 ? 2 : 1),
             intro: 'A RAINBOW GIANT is coming!' },
};
export const KINDS = Object.keys(VARIANTS);   // a type's index here is its id online
const modelOf = (kind) => (kind === 'big' ? 'normal' : kind);   // big zombies are a scaled-up regular one
const MAX_SPECIAL = 0.6;   // at most this share of the spawns are special types
const THROW_TIME = 0.9, THROW_RELEASE = 0.38;   // coconut throw: wind-up, then let go with this much left
const COCO_G = 15;         // coconut gravity (a bit heavy, for snappy lobs)
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
// "Pack-a-Punch II (Kitchen)"
const papName = (st, where = false) => `Pack-a-Punch${st.level > 1 ? ' ' + ROMAN[st.level] : ''}${where ? ` (${AREAS[st.area].name})` : ''}`;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// where each player starts in the spawn room
const START_OFFSETS = [[0, 0], [1.6, 0.8], [-1.6, 0.8], [0, -1.6]];
export const spawnPoint = (i) => new THREE.Vector3(PLAYER_START.x + START_OFFSETS[i % 4][0], 0, PLAYER_START.z + START_OFFSETS[i % 4][1]);

const _t = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3(), _end = new THREE.Vector3();
const _hit = {}, _s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

// ---------------------------------------------------------------- zombie
export class Zombie extends Combatant {
  constructor(game, kind = 'normal') {
    super(game, 'Zombie', 'Z');
    this.isZombie = true;
    this.active = false; this.alive = false;
    this.interp = new Interp();   // joining players: positions from the host
    this.setKind(kind);
  }

  // Pooled zombies can come back as another type: the model is swapped when its look changes.
  setKind(kind) {
    if (!VARIANTS[kind]) kind = 'normal';
    this.kind = kind; this.v = VARIANTS[kind];
    const look = modelOf(kind);
    if (this.model && this.modelKind === look) return;
    if (this.model) { this.game.scene.remove(this.model.root); this.model.flash.material.dispose(); }
    this.modelKind = look;
    this.model = buildTungModel('Z', { zombie: true, variant: look });
    this.model.root.visible = false;
    this.game.scene.add(this.model.root);
  }

  // a fresh life (host and joining players): type, size, body and timers
  reset(kind) {
    this.setKind(kind);
    const v = this.v, s = this.scale = v.scale, b = this.body;
    this.active = true; this.alive = true;
    this.tall = 1.8 * s;                                   // how tall it looks (the hitboxes)
    b.vel.set(0, 0, 0); b.onGround = true;
    b.height = v.crawl ? 0.8 : Math.min(this.tall, 2.2);   // tall ones duck their heads through doorways
    b.halfW = (v.crawl ? 0.38 : 0.3) * s;
    this.attackT = 0; this.attackCd = 0.6; this.stuckT = 0; this.deathT = 0; this.tearT = 0.8;
    this.throwT = 0; this.throwCd = 1 + Math.random(); this.losT = 0; this.los = false;
    this.lowT = 0; this.fallV = 0; this.thudded = false;
    this.soundT = 1 + Math.random() * 5; this.walkPhase = Math.random() * 6; this.lastStep = 0; this.lastBeat = 0;
    const m = this.model;
    m.root.visible = true;
    m.root.scale.setScalar(v.ground ? s : s * (0.95 + Math.random() * 0.1));
    if (m.coconut) m.coconut.visible = true;
  }

  spawn(sp, round, kind = 'normal') {
    this.reset(kind);
    const v = this.v, b = this.body, s = this.scale;
    this.health = this.maxHealth = v.hp(round);
    if (v.speed) this.speed = v.speed(round) * (0.95 + Math.random() * 0.1);
    else if (kind === 'big') this.speed = round >= 8 ? 3.4 : 1.8 + Math.random() * 0.3;
    else {
      // scaled to CS2 player speed (6.35 m/s with a knife): sprinters stay just slower than you
      const roll = Math.random();
      const sprint = clamp((round - 6) * 0.12, 0, 0.8), run = clamp((round - 2) * 0.2, 0, 0.95);
      this.speed = roll < sprint ? 5.9 : roll < run ? 4.25 : 1.55 + Math.random() * 0.45;
    }
    this.win = sp.win || null;
    if (this.win) {
      b.pos.copy(this.win.spawn);
      this.state = 'toWindow';
      this.yaw = Math.atan2(this.win.dir.x, this.win.dir.z); // face into the building
    } else if (v.fly) {
      // swoops down out of the sky (or from the rafters indoors)
      const map = this.game.map, surf = map.surfaceAt(sp.pos.x, sp.pos.z);
      b.pos.set(sp.pos.x, Math.max(surf + 1, Math.min(surf + 9, map.ceilAt(sp.pos.x, sp.pos.z) - b.height - 0.2)), sp.pos.z);
      b.onGround = false;
      this.state = 'chase';
      this.yaw = Math.random() * Math.PI * 2;
    } else {
      this.riseBase = this.game.map.groundAt(sp.pos.x, sp.pos.z); // rise out of hills too
      b.pos.set(sp.pos.x, this.riseBase - 1.9 * s, sp.pos.z);
      this.state = 'rise'; this.riseT = 0;
      this.yaw = Math.random() * Math.PI * 2;
    }
    this.prevPos.copy(b.pos);
    this.animate(0);
  }

  deactivate() { this.active = false; this.alive = false; this.model.root.visible = false; }

  turnTo(yawT, dt, rate) { this.yaw += wrapAngle(yawT - this.yaw) * Math.min(1, dt * rate); }

  update(dt) {
    const g = this.game, b = this.body;
    if (!this.alive) { this.updateDead(dt); return; }
    this.soundT -= dt;
    if (this.soundT <= 0) { this.soundT = 3 + Math.random() * 5; g.zombieSound(this); }

    if (this.state === 'rise') {
      this.riseT += dt;
      const k = Math.min(1, this.riseT / (this.v.rise || 1.5));
      b.pos.y = this.riseBase - 1.9 * this.scale * (1 - k);
      const p = g.nearestPlayer(b.pos);
      if (p) this.turnTo(Math.atan2(-(p.body.pos.x - b.pos.x), -(p.body.pos.z - b.pos.z)), dt, 3);
      if (k >= 1) { b.pos.y = this.riseBase; this.state = 'chase'; }
      this.animate(dt, 0.6);
      return;
    }
    if (this.state === 'toWindow') {
      const w = this.win, dx = w.outside.x - b.pos.x, dz = w.outside.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.35) { this.state = w.boards > 0 ? 'tear' : 'climb'; this.climbT = 0; this.climbFrom = b.pos.clone(); }
      else this.applyMovement(dt, dx / d, dz / d, Math.min(this.speed, 2.6) / RUN_SPEED, false);
      this.turnTo(Math.atan2(w.dir.x, w.dir.z), dt, 6);
    } else if (this.state === 'tear') {
      const w = this.win;
      this.applyMovement(dt, 0, 0, 1, false);
      this.turnTo(Math.atan2(w.dir.x, w.dir.z), dt, 6);
      if (w.boards <= 0) { this.state = 'climb'; this.climbT = 0; this.climbFrom = b.pos.clone(); }
      else {
        this.tearT -= dt;
        if (this.tearT <= 0) { g.tearBoard(w); this.tearT = 1.0 + Math.random() * 0.5; }
      }
    } else if (this.state === 'climb') {
      this.climbT += dt / 0.9;
      const k = Math.min(1, this.climbT);
      b.pos.lerpVectors(this.climbFrom, this.win.inside, k);
      b.pos.y = Math.sin(k * Math.PI) * 1.0;
      if (k >= 1) { b.pos.y = 0; b.vel.set(0, 0, 0); this.state = 'chase'; }
      this.animate(dt, 1.5);
      return;
    } else {
      this.chase(dt);
    }
    this.animate(dt);
  }

  // go for the closest player who is still on their feet
  chase(dt) {
    const g = this.game, b = this.body, map = g.map, v = this.v;
    const p = g.nearestPlayer(b.pos, true);
    const canAttack = !!p && g.phase !== 'over';
    let dx = 0, dz = 0, dy = 0, dist = Infinity;
    if (p) { const tp = p.body.pos; dx = tp.x - b.pos.x; dz = tp.z - b.pos.z; dy = tp.y - b.pos.y; dist = Math.hypot(dx, dz); }
    // flyers hit from above; everyone else needs you on about their level
    const inReach = v.fly ? dy > -1.8 && dy < 1.0 : dy > -0.5 && dy < 1.4 * this.scale;
    if (this.attackT > 0) {
      const prev = this.attackT;
      this.attackT -= dt;
      if (prev > 0.32 && this.attackT <= 0.32 && canAttack && dist < v.hitReach && inReach) g.hurtPlayer(v.dmg, b.pos, p);
    } else {
      this.attackCd -= dt;
      if (canAttack && dist < v.reach && inReach && this.attackCd <= 0 && this.throwT <= 0) {
        this.attackT = 0.75; this.attackCd = v.cd; g.sound.swing(b.pos);
      }
    }
    // pink throwers stop at range with a clear view and lob coconuts
    if (!canAttack) this.throwT = 0;
    const hold = v.throws && canAttack && this.updateThrow(dt, p, dist);
    let wx = 0, wz = 0, jump = false;
    if (canAttack && dist > 0.85 * this.scale && !hold) {
      // run straight at you only when you're on the same level and nothing is in the way
      const level = v.fly ? p.body.pos.y - map.surfaceAt(b.pos.x, b.pos.z) : dy;
      if (dist < 14 && Math.abs(level) < 1.2 && map.clearLine(b.pos, p.body.pos, 0.3 * this.scale)) { wx = dx / dist; wz = dz / dist; }
      else {
        const t = map.flowTarget(b.pos, _t);
        if (t) { const tx = t.x - b.pos.x, tz = t.z - b.pos.z, l = Math.hypot(tx, tz) || 1; wx = tx / l; wz = tz / l; }
        else { wx = dx / dist; wz = dz / dist; }
      }
    }
    let speed = this.speed;
    if (this.attackT > 0) speed *= 0.35;
    if (v.fly) this.fly(dt, wx, wz, speed, p, dist);
    else {
      if (wx || wz) {
        if (this.horizSpeed() < speed * 0.25) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
        if (this.stuckT > 0.8 && b.onGround) { jump = true; this.stuckT = 0; }
      }
      this.applyMovement(dt, wx, wz, speed / RUN_SPEED, jump);
    }
    if (dist < 2.5 || hold) this.turnTo(Math.atan2(-dx, -dz), dt, 10);
    else if (wx || wz) this.turnTo(Math.atan2(-wx, -wz), dt, 7);
  }

  // Flying: steer along the same paths as the others, but cruise above the floor, weaving side to
  // side, then swoop down on the target. Ducks under roofs and doorways (and drops low when stuck).
  fly(dt, wx, wz, speed, p, dist) {
    const g = this.game, b = this.body, map = g.map;
    if ((wx || wz) && dist > 4) {
      const w = Math.sin(g.time * 1.8 + this.walkPhase) * 0.45;
      const nx = wx - wz * w, nz = wz + wx * w, l = Math.hypot(nx, nz);
      wx = nx / l; wz = nz / l;
    }
    const k = Math.min(1, dt * 2.5);
    b.vel.x += (wx * speed - b.vel.x) * k; b.vel.z += (wz * speed - b.vel.z) * k;
    let surf = map.surfaceAt(b.pos.x, b.pos.z), ceil = map.ceilAt(b.pos.x, b.pos.z);
    for (const a of [0.35, 0.7]) {   // look ahead for low ceilings and steps up
      const x = b.pos.x + b.vel.x * a, z = b.pos.z + b.vel.z * a;
      surf = Math.max(surf, map.surfaceAt(x, z)); ceil = Math.min(ceil, map.ceilAt(x, z));
    }
    let alt = surf + 1.8 + Math.sin(g.time * 2.3 + this.walkPhase) * 0.3;
    if (p && dist < 5) alt = Math.min(alt, Math.max(surf + 0.15, p.body.pos.y + 0.45));
    if (this.lowT > 0) { this.lowT -= dt; alt = surf + 0.15; }
    alt = Math.min(alt, ceil - b.height - 0.15);
    b.vel.y += (clamp((alt - b.pos.y) * 3, -6, 5) - b.vel.y) * Math.min(1, dt * 5);
    moveBody(b, dt, map.colliders, (x, z) => map.groundAt(x, z), true);
    if (wx || wz) {
      if (this.horizSpeed() < speed * 0.2) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.5) { this.lowT = 1.5; this.stuckT = 0; }
    }
  }

  // Throwers: wind up and let go of a coconut every few seconds while they can see you.
  // Returns true while it should stand still (throwing, or close enough to keep its distance).
  updateThrow(dt, p, dist) {
    const g = this.game;
    if (this.throwT > 0) {
      const prev = this.throwT;
      this.throwT -= dt;
      if (prev > THROW_RELEASE && this.throwT <= THROW_RELEASE) g.throwCoconut(this, p);
      return true;
    }
    this.throwCd -= dt;
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.25; this.los = dist < 22 && g.clearShot(this, p); }
    if (!this.los || dist < 3.5) return false;
    if (this.throwCd <= 0 && this.attackT <= 0) { this.throwT = THROW_TIME; this.throwCd = 2.0 + Math.random() * 1.2; }
    return dist < 10;
  }

  // where a thrown coconut leaves its hand (over the right shoulder)
  handPos(out) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), p = this.body.pos;
    return out.set(p.x + fx * 0.35 - fz * 0.15, p.y + 1.9 * this.scale, p.z + fz * 0.35 + fx * 0.15);
  }

  // Hitboxes. Upright zombies use how tall they look (their body for walls can be shorter);
  // the crawler is a low log with its head out in front.
  rayHit(o, d, maxT) {
    const p = this.body.pos, s = this.scale;
    let best = null;
    if (this.v.crawl) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const tHead = raySphere(o, d, p.x + fx * 0.6, p.y + 0.62, p.z + fz * 0.6, 0.27);
      if (tHead !== null && tHead < maxT) best = { t: tHead, part: 'head' };
      const cx = p.x + fx * 0.05, cz = p.z + fz * 0.05, w = 0.42;
      const tBody = rayBox(o, d, cx - w, p.y, cz - w, cx + w, p.y + 0.62, cz + w);
      if (tBody !== null && tBody < (best ? best.t : maxT)) best = { t: tBody, part: 'body' };
      return best;
    }
    const h = this.tall;
    const tHead = raySphere(o, d, p.x, p.y + h - 0.17 * s, p.z, 0.19 * s);
    if (tHead !== null && tHead < maxT) best = { t: tHead, part: 'head' };
    const w = 0.28 * s;
    const tBody = rayBox(o, d, p.x - w, p.y, p.z - w, p.x + w, p.y + h - 0.33 * s, p.z + w);
    if (tBody !== null && tBody < (best ? best.t : maxT)) {
      const y = o.y + d.y * tBody;
      best = { t: tBody, part: y < p.y + 0.62 * s ? 'leg' : 'body' };
    }
    return best;
  }
  headPos(out) {
    const p = this.body.pos;
    if (this.v.crawl) return out.set(p.x - Math.sin(this.yaw) * 0.6, p.y + 0.62, p.z - Math.cos(this.yaw) * 0.6);
    return out.set(p.x, p.y + this.tall - 0.17 * this.scale, p.z);
  }
  chestPos(out) {
    const p = this.body.pos;
    if (this.v.crawl) return out.set(p.x - Math.sin(this.yaw) * 0.2, p.y + 0.45, p.z - Math.cos(this.yaw) * 0.2);
    return out.set(p.x, p.y + this.tall * 0.68, p.z);
  }

  animate(dt, phaseSpeed) {
    const v = this.v;
    if (v.crawl) { this.animateCrawl(dt, phaseSpeed); return; }
    const m = this.model, b = this.body, g = this.game;
    m.root.position.copy(b.pos);
    m.root.rotation.set(0, this.yaw, 0);
    const sp = phaseSpeed ?? this.horizSpeed();
    this.walkPhase += dt * (sp * 1.9 + 0.8);
    const amp = Math.min(1, sp / 3.5) * 0.7 + 0.1;
    const flying = v.fly && this.state === 'chase';
    if (flying) {   // legs dangle and trail behind
      const dangle = Math.sin(g.time * 2.2 + this.walkPhase * 0.2) * 0.12;
      m.legL.rotation.x = -0.3 - Math.min(0.4, sp * 0.08) + dangle;
      m.legR.rotation.x = -0.3 - Math.min(0.4, sp * 0.08) - dangle;
    } else {
      m.legL.rotation.x = Math.sin(this.walkPhase) * amp;
      m.legR.rotation.x = -Math.sin(this.walkPhase) * amp;
    }
    m.torso.position.y = 0.6 + (flying ? 0 : Math.abs(Math.cos(this.walkPhase)) * 0.04 * amp);
    m.torso.rotation.z = Math.sin(this.walkPhase) * 0.07 * amp;
    m.torso.rotation.x = flying ? -0.32 : this.kind === 'fast' ? -0.42 : this.speed > 4.5 ? -0.3 : -0.14; // hunched forward
    // bat held low at the side while walking (like the reference), raised over the shoulder to swing
    let armX = -0.35 + Math.sin(this.walkPhase * 0.5) * 0.08, batX = 0.35 + Math.sin(this.walkPhase) * 0.12;
    if (this.attackT > 0) {
      const k = 1 - this.attackT / 0.75;
      if (k < 0.55) { const e = k / 0.55; armX = -0.35 + e * 1.25; batX = 0.35 - e * 2.6; }
      else { const e = (k - 0.55) / 0.45; armX = 0.9 - e * 1.35; batX = -2.25 + e * 3.2; }
    } else if (this.throwT > 0) {
      // coconut throw: lean back with it over the head, then whip it forward
      const k = 1 - this.throwT / THROW_TIME, rel = 1 - THROW_RELEASE / THROW_TIME;
      if (k < rel) { const e = k / rel; armX = -0.35 + e * e * 2.95; m.torso.rotation.x = -0.14 + e * 0.3; }
      else { const e = (k - rel) / (1 - rel); armX = 2.6 - Math.min(1, e * 3) * 3.1 + Math.max(0, e - 0.33) * 0.75; m.torso.rotation.x = -0.45 + e * 0.3; }
    } else if (this.state === 'tear') {
      armX = 0.5 + Math.sin(g.time * 9 + this.walkPhase) * 0.6;
      batX = -0.6 + Math.sin(g.time * 9 + this.walkPhase) * 0.9;
    } else if (this.kind === 'fast' && sp > 3) {
      armX = -1.3 + Math.sin(this.walkPhase) * 0.06; batX = 1.0;   // arms swept back, bat trailing
    }
    m.arms.rotation.x = armX;
    m.bat.rotation.x = batX;
    if (m.coconut) m.coconut.visible = this.throwT <= 0 || this.throwT > THROW_RELEASE;
    if (m.wingL) {
      // wings beat fast in the air; half folded while it walks to a window
      const ft = g.time * (flying ? 11 : 4) + this.walkPhase, beat = Math.sin(ft);
      const lift = flying ? 0.25 + beat * 0.7 : -0.45 + beat * 0.12, sweep = flying ? 0.2 + beat * 0.15 : 0.9;
      m.wingR.rotation.set(0, -sweep, lift); m.wingL.rotation.set(0, sweep, -lift);
      const n = Math.floor(ft / (Math.PI * 2));
      if (flying && n !== this.lastBeat) { this.lastBeat = n; g.flapSound?.(this); }
    }
    if (v.boss) {
      tickRainbow();
      const step = Math.floor(this.walkPhase / Math.PI);   // the ground shakes with each step
      if (step !== this.lastStep) { this.lastStep = step; if (this.alive && this.state === 'chase' && sp > 0.4) g.giantStep?.(this); }
    }
  }

  // the crawler drags itself along on its hands, swaying with each pull; it rears up to lunge
  animateCrawl(dt, phaseSpeed) {
    const m = this.model, b = this.body;
    m.root.position.copy(b.pos);
    const sp = phaseSpeed ?? this.horizSpeed();
    this.walkPhase += dt * (sp * 2.6 + 0.6);
    const ph = this.walkPhase, amp = Math.min(1, sp / 2.5) * 0.8 + 0.15;
    m.root.rotation.set(0, this.yaw + Math.sin(ph) * 0.12 * amp, Math.sin(ph) * 0.06 * amp);
    let lift = 0, reach = 0;
    if (this.attackT > 0) { const k = 1 - this.attackT / 0.75; lift = Math.sin(Math.min(1, k * 1.3) * Math.PI); reach = lift; }
    else if (this.state === 'tear') reach = 0.5 + Math.sin(this.game.time * 10 + ph) * 0.5;
    m.torso.position.set(0, 0.3 + lift * 0.12 + Math.abs(Math.sin(ph)) * 0.03 * amp, 0.45);
    m.torso.rotation.set(-1.25 + lift * 0.5, 0, 0);
    const pull = Math.sin(ph) * 0.5 * amp;
    m.armR.rotation.x = pull + reach;
    m.armL.rotation.x = -pull + reach;
    // legs drag behind, kicking a little
    m.legL.position.set(-0.11, 0.25, 0.5); m.legR.position.set(0.11, 0.25, 0.5);
    m.legL.rotation.x = -1.4 + Math.sin(ph) * 0.18 * amp;
    m.legR.rotation.x = -1.4 - Math.sin(ph) * 0.18 * amp;
  }

  die() {
    this.alive = false; this.state = 'dead'; this.deathT = 0; this.deathTilt = (Math.random() - 0.5) * 0.6;
    this.attackT = 0; this.throwT = 0; this.fallV = 0;
  }

  updateDead(dt) {
    const m = this.model, b = this.body, v = this.v;
    this.deathT += dt;
    if (v.fly) {   // drops out of the air with its wings folded
      const floor = this.game.map.surfaceAt(b.pos.x, b.pos.z);
      if (b.pos.y > floor) { this.fallV += 22 * dt; b.pos.y = Math.max(floor, b.pos.y - this.fallV * dt); }
      m.wingR.rotation.set(0, -1.0, -0.6); m.wingL.rotation.set(0, 1.0, 0.6);
    }
    const k = Math.min(1, this.deathT / (v.boss ? 0.8 : 0.45)), e = k * k;
    if (v.crawl) m.root.rotation.set(0, this.yaw, e * 1.5 * (this.deathTilt < 0 ? -1 : 1));   // rolls onto its side
    else m.root.rotation.set(e * Math.PI / 2 * 0.97, this.yaw, e * this.deathTilt);
    let y = b.pos.y + (v.crawl ? 0 : e * 0.15);
    if (this.deathT > 2.2) y -= (this.deathT - 2.2) * 0.7 * (v.boss ? 1.5 : 1); // sink into the ground
    m.root.position.set(b.pos.x, y, b.pos.z);
    if (v.boss && k >= 1 && !this.thudded) { this.thudded = true; this.game.giantStep?.(this, 1.6); }
    if (this.deathT > (v.boss ? 4.6 : 3.8)) this.deactivate();
  }

  // ----- joining players: a copy that follows the host's zombie -----
  // e: [id, x, y, z, yaw, state, flags (1 alive, 4 fast), attack time x100, type (KINDS index), throw time x100]
  netUpdate(T, e) {
    const alive = !!(e[6] & 1), kind = KINDS[e[8]] || 'normal';
    if (!this.active || (alive && (!this.alive || kind !== this.kind))) {
      if (!alive) return;                        // already gone here
      this.puppetSpawn(kind, !!(e[6] & 4));
    }
    if (!alive) { if (this.alive) this.die(); return; }
    this.interp.push(T, e[1], e[2], e[3], e[4]);
    this.state = e[5];
    const atk = e[7] / 100;
    if (atk > 0 && this.netAtk <= 0) { this.attackT = atk; this.game.sound.swing(this.body.pos); }
    this.netAtk = atk;
    const th = (e[9] || 0) / 100;
    if (th > 0 && this.netThrow <= 0) this.throwT = th;
    this.netThrow = th;
  }

  puppetSpawn(kind, fast) {
    this.reset(kind);
    const v = this.v;
    this.speed = v.speed ? v.speed(this.game.round || 1) : fast ? 5.9 : 2;   // only changes how it looks
    this.netAtk = 0; this.netThrow = 0; this.state = 'chase'; this.placed = false;
    this.interp.clear();
  }

  puppetUpdate(dt) {
    if (!this.alive) { this.updateDead(dt); return; }
    const g = this.game, b = this.body;
    _v.copy(b.pos);
    const fresh = !this.placed;
    if (this.interp.sample(g.time - g.netDelay, _s)) { b.pos.set(_s.x, _s.y, _s.z); this.yaw = _s.yaw; this.placed = true; }
    if (fresh) this.prevPos.copy(b.pos);
    if (dt > 0) { b.vel.x = (b.pos.x - _v.x) / dt; b.vel.z = (b.pos.z - _v.z) / dt; if (Math.hypot(b.vel.x, b.vel.z) > 15) b.vel.set(0, 0, 0); }
    if (this.attackT > 0) this.attackT = Math.max(0, this.attackT - dt);
    if (this.throwT > 0) this.throwT = Math.max(0, this.throwT - dt);
    this.soundT -= dt;
    if (this.soundT <= 0) { this.soundT = 3 + Math.random() * 5; g.zombieSound(this); }
    this.animate(dt, this.state === 'rise' ? 0.6 : this.state === 'climb' ? 1.5 : undefined);
  }
}

// ---------------------------------------------------------------- game
export class ZombiesGame {
  constructor({ scene, camera, map, hud, sound, fx, input, vm, settings }) {
    Object.assign(this, { scene, camera, map, hud, sound, fx, input, vm, settings });
    this.mode = 'zombies';
    this.bleedTime = BLEED_TIME;
    this.time = 0; this.baseFov = 74; this.scopeFov = 22;
    this.zombies = []; this.combatants = []; this.powerups = []; this.projectiles = [];
    this.players = []; this.remotes = [];
    this.net = null; this.netDelay = 0.075; this.shotEnds = [];
    this.running = false; this.phase = 'live';
    this.bomb = { state: 'none' };
    this.lastZSound = 0; this.lastFlap = 0; this.pjId = 0;
    this.puTex = {};
    // one hidden zombie of each type, so their materials get compiled with the map
    // (no hitch the first time one shows up)
    if (!scene.userData.zombieWarmup) {
      scene.userData.zombieWarmup = true;
      for (const k of KINDS) {
        if (modelOf(k) !== k) continue;
        const m = buildTungModel('Z', { zombie: true, variant: k });
        m.root.visible = false; scene.add(m.root);
      }
      const c = makeCoconut(); c.visible = false; scene.add(c);
    }
  }

  // ----- lifecycle -----
  // roster (online): the players, see Session.roster(). net: the NetLink when hosting online.
  start({ knife = 'knife', net = null, roster = null } = {}) {
    this.stop();
    this.net = net; this.netDelay = 0.075;
    this.running = true; this.phase = 'live'; this.time = 0;
    this.map.resetDoors();
    this.activeAreas = new Set(['A']);
    this.round = 0;
    this.effects = { instakill: 0, double: 0 };
    this.powerupsThisRound = 0; this.killsSinceDrop = 0; this.puId = 0;
    this.seenKinds = new Set(); this.spawnedThisRound = 0;
    this.interaction = null; this.flowT = 0;
    this.setupPlayers(roster || [{ nid: 0, name: 'You', kind: 'local' }], net ? net.myId : null, knife);
    for (const a of this.remotes) a.spawnEpoch = 0;   // matches the joining player's first state
    this.resetBox();
    this.betweenRounds = true; this.nextRoundAt = 2.5; this.toSpawn = 0;
    this.hud.zReset(this);
    this.introBanner();
  }

  introBanner() {
    this.hud.banner('TUNG TUNG ZOMBIES', this.coop
      ? 'Survive the night together. Revive downed teammates with E.'
      : 'Survive the night. Board the windows. Spend points to open doors.', 'T', 4);
  }

  setupPlayers(roster, myId, knife) {
    this.players = []; this.remotes = [];
    this.coop = roster.length > 1;
    roster.forEach((r, i) => {
      const local = myId ? r.pid === myId : i === 0;
      let p;
      if (local) {
        p = this.player = new Player(this, 'P');
        p.colliders = this.map.playerColliders;
        p.meleeName = knifeName(knife);
        if (myId) p.name = r.name;
        p.onFire = () => this.vm.fire(p.weapon.def.melee);
        p.onReload = () => this.sound.reload();
        p.onSwitch = () => this.sound.deploy();
      } else {
        p = new Avatar(this, { ...r, team: 'P' }, 'friend');
        p.addNameTag(r.name);
        p.addDownIcon();
        this.remotes.push(p);
      }
      p.nid = r.nid; p.pid = r.pid || null;
      p.spawn(spawnPoint(i), 0);
      p.slots[2].reserve = 84;
      this.resetPlayer(p);
      this.players.push(p);
    });
    this.combatants = this.players.slice();
    this.vm.setTeam('P'); this.vm.setKnife(knife);
  }

  resetPlayer(p) {
    Object.assign(p, {
      points: 500, kills: 0, headshots: 0, downs: 0, perks: new Set(), maxHealth: BASE_HEALTH, health: BASE_HEALTH,
      lastHurt: -10, downed: false, downT: 0, reviveT: 0, reviveFrac: 0, reviver: null, rebuildT: 0, reloadMul: 1, rateMul: 1,
    });
  }

  resetBox() {
    const box = this.map.box;
    Object.assign(box, { state: 'idle', t: 0, open: 0, weapon: null, owner: null });
    box.label.visible = false;
  }

  stop() {
    this.running = false;
    for (const z of this.zombies) z.deactivate();
    this.clearProjectiles();
    for (const pu of this.powerups) this.scene.remove(pu.sprite, pu.glow);
    this.powerups = [];
    for (const a of this.remotes) a.dispose();
    this.remotes = [];
  }

  // ----- interface used by Player / Combatant / HUD -----
  // ----- shop (B): guns unlock every couple of rounds, plus ammo for the gun in your hands -----
  canBuy(p) { return !!p && p.alive && !p.downed && this.phase !== 'over'; }
  buyCount() { return ZOMBIE_SHOP.length + 1; }   // keys 1-9 guns, 0 ammo
  // the gun a shop ammo refill is for: the one in your hands, or your first gun while holding the knife
  ammoTarget(p) {
    const w = p.weapon;
    return w && !w.def.melee ? w : p.slots[1] || p.slots[2] || null;
  }
  buy(p, index) {
    if (!this.canBuy(p)) return;
    if (index === ZOMBIE_SHOP.length) {
      const w = this.ammoTarget(p);
      if (!w) return;
      if (w.reserve >= w.def.reserve) { this.tell(p, { e: 'msg', s: 'Ammo is already full', d: 1 }); return; }
      if (!this.spend(p, ammoCost(w))) return;
      w.reserve = w.def.reserve;
      this.syncInv(p, 'ammo');
      this.tell(p, { e: 'snd', n: 'purchase' });
      return;
    }
    const it = ZOMBIE_SHOP[index];
    if (!it) return;
    if (Math.max(1, this.round) < it.round) {
      this.tell(p, { e: 'snd', n: 'denied' }); this.tell(p, { e: 'msg', s: `Unlocks at round ${it.round}`, d: 1.2 });
      return;
    }
    if (this.ownedSlot(p, it.key)) { this.tell(p, { e: 'msg', s: 'You already have it (0 buys ammo)', d: 1.2 }); return; }
    if (!this.spend(p, ZOMBIE_PRICES[it.key])) return;
    this.givePlayerWeapon(p, it.key);
    this.tell(p, { e: 'snd', n: 'purchase' });
  }
  emitNoise() {}
  useInfo() { return null; }
  aliveZombies() { let n = 0; for (const z of this.zombies) if (z.active && z.alive) n++; return n; }
  byNid(nid) { return this.players.find((p) => p.nid === nid) || null; }

  // the closest living player (upOnly: skip downed players)
  nearestPlayer(pos, upOnly = false) {
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (!p.alive || (upOnly && p.downed)) continue;
      const d = flat(p.body.pos, pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ----- rounds -----
  startRound(r) {
    this.respawnPlayers();
    this.round = r;
    this.betweenRounds = false;
    // more players, more zombies
    this.toSpawn = Math.round(zombieCount(r) * (1 + 0.5 * (this.players.length - 1)));
    this.spawnT = 1.5;
    this.powerupsThisRound = 0; this.spawnedThisRound = 0;
    this.hud.zRound(r, true);
    this.sound.zRoundStart();
    this.net?.emit({ e: 'round', r });
    // new guns in the shop
    const fresh = ZOMBIE_SHOP.filter((it) => it.round === r).map((it) => WEAPONS[it.key].name);
    if (fresh.length) this.announce(null, r === 1 ? 'Press B to open the shop: guns and ammo' : `New in the shop (B): ${fresh.join(', ')}`);
  }

  endRound() {
    this.betweenRounds = true;
    this.nextRoundAt = this.time + 10;
    this.sound.zRoundEnd();
    this.hud.zRound(this.round, true);
    this.hud.center(`Round ${this.round} survived`, 3);
    this.net?.emit({ e: 'rend', r: this.round });
  }

  // co-op: players who bled out come back at the start of the next round, next to a teammate
  respawnPlayers() {
    for (const p of this.players) {
      if (p.alive) continue;
      const mate = this.players.find((o) => o.alive && !o.downed) || this.players.find((o) => o.alive);
      const pos = mate ? mate.body.pos.clone() : spawnPoint(0);
      p.slots[2] = null;                    // fresh pistol: the guns were lost
      p.spawn(pos, mate ? mate.yaw : 0);
      Object.assign(p, { health: BASE_HEALTH, maxHealth: BASE_HEALTH, downed: false, lastHurt: -10, reviveT: 0, reviveFrac: 0 });
      if (p === this.player) { p.eyeH = 1.65; this.spectating = null; }
      this.tell(p, { e: 'msg', s: "You're back in!", d: 2 });
      this.net?.emit({ e: 'spawn', n: p.nid, x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), yaw: r3(p.yaw), ep: p.spawnEpoch || 0 });
      this.syncInv(p, 'spawn');
    }
  }

  // groundOnly: only spots out in the open (rising out of the ground, or flying in), no windows
  pickSpawn(groundOnly = false) {
    // distance to the closest living player
    const near = (pos) => { let d = Infinity; for (const p of this.players) if (p.alive) d = Math.min(d, flat(pos, p.body.pos)); return d; };
    const all = [];
    if (!groundOnly) for (const w of this.map.windows) if (this.activeAreas.has(w.area)) all.push({ win: w, pos: w.spawn, weight: 2 });
    if (this.round >= 2 || groundOnly) for (const s of this.map.groundSpawns) if (this.activeAreas.has(s.area)) all.push({ pos: s.pos, weight: 1 });
    if (!all.length) return null;
    let pool = all.filter((s) => { const d = near(s.pos); return d > 7 && d < 42; });
    if (!pool.length) pool = all.filter((s) => near(s.pos) > 5);
    if (!pool.length) pool = all;
    const total = pool.reduce((a, s) => a + s.weight, 0);
    let r = Math.random() * total;
    for (const s of pool) { r -= s.weight; if (r <= 0) return s; }
    return pool[0];
  }

  // which type the next zombie is
  pickKind() {
    const r = this.round;
    // the first time a type is due, send one in early in the round so it gets noticed
    if (this.spawnedThisRound % 3 === 2) {
      const k = KINDS.find((q) => VARIANTS[q].intro && r >= VARIANTS[q].from && !this.seenKinds.has(q));
      if (k) return k;
    }
    const opts = [];
    let total = 0;
    for (const k of KINDS) {
      const v = VARIANTS[k];
      if (!v.chance || r < v.from || this.countAlive(k) >= v.max(r)) continue;
      const c = v.chance(r);
      if (c > 0) { opts.push([k, c]); total += c; }
    }
    const scale = total > MAX_SPECIAL ? MAX_SPECIAL / total : 1;   // regular ones stay the most common
    let x = Math.random();
    for (const [k, c] of opts) { x -= c * scale; if (x < 0) return k; }
    return 'normal';
  }

  countAlive(kind) { let n = 0; for (const z of this.zombies) if (z.active && z.alive && z.kind === kind) n++; return n; }

  spawnNext() {
    let kind = this.pickKind();
    const v = VARIANTS[kind];
    // flyers would rather swoop in from the sky; the biggest ones can only rise out of the ground
    let sp = this.pickSpawn(v.ground || v.fly) || (v.ground ? null : this.pickSpawn(false));
    if (!sp) { kind = 'normal'; sp = this.pickSpawn(false); }   // no open ground yet: a regular one through a window
    if (!sp) return false;
    this.getZombie(kind).spawn(sp, this.round, kind);
    this.spawnedThisRound++;
    if (!this.seenKinds.has(kind)) {
      this.seenKinds.add(kind);
      if (VARIANTS[kind].intro) this.announce(null, VARIANTS[kind].intro);
    }
    return true;
  }

  // a free zombie from the pool, preferably one that already has this type's model
  getZombie(kind = 'normal') {
    const look = modelOf(kind);
    let z = this.zombies.find((q) => !q.active && q.modelKind === look) || this.zombies.find((q) => !q.active);
    if (!z) { z = new Zombie(this, kind); z.netId = this.zombies.length; this.zombies.push(z); }
    return z;
  }

  // ----- combat -----
  fireBullet(shooter, origin, dir, def, extraPellet) {
    const range = 250;
    const wall = raycast(origin, dir, range, this.map.colliders, _hit);
    let hitT = wall ? wall.t : range;
    let wallInfo = wall ? { nx: wall.nx, ny: wall.ny, nz: wall.nz } : null;
    const gt = this.map.rayGround(origin, dir, hitT);
    if (gt !== null && gt < hitT) { hitT = gt; wallInfo = { nx: 0, ny: 1, nz: 0 }; }
    let victim = null, part = null;
    for (const z of this.zombies) {
      if (!z.active || !z.alive) continue;
      const r = z.rayHit(origin, dir, hitT);
      if (r && r.t < hitT) { hitT = r.t; victim = z; part = r.part; }
    }
    _end.copy(origin).addScaledVector(dir, hitT);
    const end = _v2.copy(_end);
    if (victim) {
      const mult = part === 'head' ? (def.headMult || 4) : part === 'leg' ? 0.75 : 1;
      let dmg = def.damage * mult * Math.pow(def.falloff || 1, hitT / 10);
      if (shooter.perks?.has('dtap')) dmg *= 1.33;
      this.fx.burst(end, 0xc9a06a, 5, 3); // wood splinters
      this.logShot(end, 3);
      this.hitZombie(victim, dmg, part === 'head', false, extraPellet, shooter);
    } else if (wallInfo) {
      this.fx.impact(end, wallInfo);
      this.logShot(end, 1, wallInfo);
    } else this.logShot(end, 0);
    if (def.splash) {
      for (const z of this.zombies) {
        if (!z.active || !z.alive || z === victim) continue;
        z.chestPos(_v);
        const d = _v.distanceTo(end);
        if (d < def.splash.radius) this.hitZombie(z, def.splash.damage * (1 - d / def.splash.radius * 0.6), false, false, true, shooter);
      }
      this.fx.burst(end, def.pap ? 0xff60ff : 0x50ff70, 22, 6);
    }
    _v.set(0.18, -0.15, 0).applyEuler(this.camera.rotation).add(origin);
    if (def.tracer) this.fx.tracer(_v, end, def.tracer);
    else if (!extraPellet && Math.random() < 0.35) this.fx.tracer(_v, end);
  }

  // online: remember where each bullet ended so the other players can draw it
  logShot(end, kind, n = null) {
    if (!this.net) return;
    this.shotEnds.push(n ? [r2(end.x), r2(end.y), r2(end.z), kind, n.nx, n.ny, n.nz] : [r2(end.x), r2(end.y), r2(end.z), kind]);
  }

  melee(att) {
    att.eyePos(_v);
    dirFrom(att.yaw, att.pitch, _d);
    this.sound.knife(att.body.pos);
    this.net?.emit({ e: 'knife', n: att.nid });
    let best = null, bd = 2.4;
    for (const z of this.zombies) {
      if (!z.active || !z.alive) continue;
      z.chestPos(_v2);
      const to = _v2.sub(_v), d = to.length();
      if (d > bd || to.normalize().dot(_d) < 0.65) continue;
      best = z; bd = d;
    }
    if (best) {
      best.chestPos(_v2); this.fx.burst(_v2, 0xc9a06a, 10, 4);
      this.hitZombie(best, 150, false, true, false, att, _d.setY(0).normalize());
    }
  }

  onShot(c, def) {
    this.sound.shot(def.sound, null);
    this.camera.getWorldPosition(_v);
    this.fx.flash(_v);
    if (this.net) {
      const ev = { e: 'shot', n: c.nid, s: def.sound, d: this.shotEnds };
      if (def.tracer) ev.tc = def.tracer;
      if (def.splash) ev.sp = def.pap ? 0xff60ff : 0x50ff70;
      this.net.emit(ev);
      this.shotEnds = [];
    }
  }

  // a bullet or knife connected (a joining player reports it to the host instead)
  hitZombie(z, dmg, head, melee, quiet, attacker, knock) {
    if (melee && knock) z.body.vel.addScaledVector(knock, 4);
    this.damageZombie(z, dmg, head, melee, quiet, attacker);
  }

  damageZombie(z, dmg, head, melee, quiet, attacker = this.player) {
    if (!z.alive) return;
    if (this.effects.instakill > 0 && !z.v.boss) dmg = z.health + 1;   // the rainbow giant shrugs it off
    z.health -= dmg;
    if (attacker === this.player && (!quiet || z.health <= 0)) { this.hud.hit(head); this.sound.hit(head); }
    if (z.health <= 0) this.killZombie(z, head, melee, false, attacker);
    else if (!quiet) this.addPoints(attacker, 10);
  }

  killZombie(z, head, melee, nuked, attacker) {
    z.die();
    if (attacker) { attacker.kills++; if (head) attacker.headshots++; }
    if (!nuked) {
      const v = z.v, b = z.body.pos;
      this.addPoints(attacker, v.points ?? ((melee ? 130 : head ? 100 : 60) + (v.bonus || 0)));
      // power-ups land on the floor, even when a flyer drops them
      const at = _v.set(b.x, v.fly ? this.map.surfaceAt(b.x, b.z) : b.y, b.z);
      if (v.boss) this.dropPowerup(at); else this.maybeDropPowerup(at);
    }
  }

  addPoints(p, n) {
    if (!p) return;
    const v = n * (this.effects.double > 0 ? 2 : 1);
    p.points += v;
    this.tell(p, { e: 'pts', n: v });
  }
  spend(p, cost) {
    if (p.points < cost) { this.tell(p, { e: 'snd', n: 'denied' }); this.tell(p, { e: 'msg', s: 'Not enough points', d: 1.2 }); return false; }
    p.points -= cost;
    this.tell(p, { e: 'pts', n: -cost });
    return true;
  }

  // from: where the hit came from (the zombie, or a coconut)
  hurtPlayer(dmg, from, p) {
    if (!p || !p.alive || p.downed || this.phase === 'over') return;
    p.health -= dmg;
    p.lastHurt = this.time;
    _d.set(p.body.pos.x - from.x, 0, p.body.pos.z - from.z).normalize();
    this.tell(p, { e: 'hurt', x: r2(_d.x), z: r2(_d.z) });
    if (p.health <= 0) {
      if (this.coop || p.perks.has('quick')) this.goDown(p);
      else this.gameOver();
    }
  }

  goDown(p) {
    p.downed = true; p.health = 1; p.scoped = false; p.reloading = false; p.buyOpen = false;
    p.downs++; p.reviveT = 0; p.reviveFrac = 0; p.reviver = null;
    this.clearPerks(p);
    if (!this.coop) {   // solo: Quick Revive gets you back up
      p.downT = 4.5;
      this.tell(p, { e: 'msg', s: 'DOWNED! Quick Revive is getting you up...', d: 4 });
      return;
    }
    p.downT = BLEED_TIME;
    this.tell(p, { e: 'msg', s: "You're down! Hang on until a teammate revives you", d: 4 });
    this.announce(p, `${p.name} is down! Hold E next to them to revive`);
    this.checkWipe();
  }

  revive(p, by) {
    p.downed = false; p.reviveT = 0; p.reviveFrac = 0; p.reviver = null;
    p.health = p.maxHealth; p.lastHurt = this.time;
    if (p === this.player) p.eyeH = 1.65;
    this.tell(p, { e: 'msg', s: by ? `Revived by ${by.name}!` : 'Revived!', d: 1.5 });
    if (by) this.tell(by, { e: 'msg', s: `You revived ${p.name}`, d: 1.5 });
  }

  bleedOut(p) {
    p.downed = false; p.alive = false; p.health = 0; p.scoped = false; p.reviveT = 0; p.reviveFrac = 0;
    p.onDeath?.();
    this.tell(p, { e: 'msg', s: "You bled out. You'll be back next round.", d: 4 });
    this.announce(p, `${p.name} bled out`);
    if (p === this.player) this.spectating = this.nextSpectate(null);
    this.checkWipe();
  }

  // everyone is down or out: game over
  checkWipe() {
    if (this.phase !== 'over' && !this.players.some((o) => o.alive && !o.downed)) this.gameOver();
  }

  gameOver() {
    this.phase = 'over'; this.overT = 3.5;
    for (const p of this.players) { if (p.isAvatar && p.alive) p.onDeath(); p.health = 0; p.alive = false; p.scoped = false; p.downed = false; }
    this.hud.center('GAME OVER', 3.5);
    this.sound.roundEnd(false);
    this.net?.emit({ e: 'over', r: this.round, st: this.stats() });
  }

  stats() { return this.players.map((p) => [p.nid, p.kills, p.headshots, p.points, p.downs]); }
  finalStats() {
    const p = this.player;
    return {
      round: this.round, kills: p.kills, headshots: p.headshots, points: p.points, coop: this.coop,
      players: this.players.map((q) => ({ name: q.name, kills: q.kills, headshots: q.headshots, points: q.points, downs: q.downs, me: q === p })),
    };
  }

  clearPerks(p) {
    p.perks.clear();
    p.maxHealth = BASE_HEALTH; p.health = Math.min(p.health, BASE_HEALTH);
    p.reloadMul = 1; p.rateMul = 1;
  }

  applyPerk(p, id) {
    p.perks.add(id);
    if (id === 'jugg') { p.maxHealth = JUGG_HEALTH; p.health = JUGG_HEALTH; }
    if (id === 'speed') p.reloadMul = 0.5;
    if (id === 'dtap') p.rateMul = 0.75;
  }

  // ----- weapons -----
  ownedSlot(p, key) {
    for (const s of [1, 2]) if (p.slots[s] && p.slots[s].key === key) return s;
    return 0;
  }

  givePlayerWeapon(p, key) {
    let slot = [1, 2].find((s) => !p.slots[s]);
    if (!slot) slot = (p.slot === 1 || p.slot === 2) ? p.slot : 1;
    p.give(key, slot);
    if (p.slot === slot) { p.reloading = false; p.recoil = 0; p.deployUntil = this.time + (WEAPONS[key].deploy || 0.5); p.onSwitch?.(); }
    else p.selectSlot(slot);
    this.syncInv(p, 'switch');
  }

  // ----- windows & doors -----
  tearBoard(w) {
    if (w.boards <= 0) return;
    const m = w.boardMeshes[w.boards - 1];
    this.map.setBoards(w, w.boards - 1);
    this.sound.boardBreak(w.center);
    this.fx.burst(m.position, 0xa47a4c, 8, 3);
  }

  openDoor(d) {
    if (d.open) return;
    this.map.openDoor(d);
    for (const a of d.areas) this.activeAreas.add(a);
    this.sound.boardBreak(d.center);
    this.flowT = 0;
    this.net?.emit({ e: 'door', id: d.id });
  }

  // ----- interactions: doors, windows, wall buys, perks, box, Pack-a-Punch, reviving -----
  findInteraction(p) {
    if (!p.alive || p.downed) return null;
    const pos = p.body.pos, map = this.map;
    let best = null, bd = Infinity;
    // a downed teammate right next to you comes first
    for (const o of this.players) {
      if (o === p || !o.alive || !o.downed || Math.abs(o.body.pos.y - pos.y) > 1.5) continue;
      const d = flat(pos, o.body.pos);
      if (d < 1.9 && d < bd) { bd = d; best = { type: 'revive', who: o }; }
    }
    if (best) return best;
    const consider = (d, max, obj) => { if (d < max && d < bd) { bd = d; best = obj; } };
    for (const d of map.doors) if (!d.open) consider(flat(pos, d.center), 2.8, { type: 'door', d });
    for (const w of map.windows) if (w.boards < w.max && this.activeAreas.has(w.area)) consider(flat(pos, w.inside), 2.2, { type: 'window', w });
    for (const wb of map.wallBuys) consider(flat(pos, wb.at), 1.7, { type: 'wallbuy', wb });
    for (const pm of map.perkMachines) if (!p.perks.has(pm.id)) consider(flat(pos, pm.at), 1.7, { type: 'perk', pm });
    for (const st of map.papStations) if (Math.abs(st.at.y - pos.y) < 1.5) consider(flat(pos, st.at), 1.9, { type: 'pap', st });
    consider(flat(pos, map.box.at), 2.0, { type: 'box' });
    return best;
  }

  hintText() {
    const it = this.interaction, p = this.player;
    if (!it) {
      if (this.betweenRounds && this.phase !== 'over') {
        const left = Math.max(0, Math.ceil(this.nextRoundAt - this.time));
        return `Next wave in ${left}s — press N to start it now`;
      }
      return '';
    }
    switch (it.type) {
      case 'revive': return `Hold E to revive ${it.who.name}`;
      case 'door': return `Press E to open the door [${it.d.cost}]`;
      case 'window': return 'Hold E to rebuild the barrier';
      case 'wallbuy': {
        const s = this.ownedSlot(p, it.wb.weapon);
        if (s) return `Press E to buy ammo [${ammoCost(p.slots[s])}]`;
        return `Press E to buy ${it.wb.def.name} [${it.wb.cost}]`;
      }
      case 'perk': return `Press E to drink ${it.pm.name} [${it.pm.cost}]`;
      case 'pap': {
        // each station upgrades one level, in order: point the way to the right one
        const w = p.weapon, st = it.st, lv = w?.def.pap || 0, stations = this.map.papStations;
        if (!w || w.def.melee) return `${papName(st)}: hold a gun to upgrade it`;
        if (lv >= MAX_PAP) return 'This weapon is fully upgraded';
        if (lv !== st.level - 1) return `This gun's next upgrade is at ${papName(stations[lv], true)}`;
        return `Press E to upgrade to ${papDef(w.def, st.level).name} [${st.cost}]`;
      }
      case 'box': {
        const b = this.map.box;
        if (b.state === 'idle') return `Press E for the Mystery Box [${b.cost}]`;
        if (b.state === 'ready') return b.owner === p ? `Press E to take ${WEAPONS[b.weapon].name}` : `${b.owner?.name || 'Someone'}'s Mystery Box weapon`;
        return '';
      }
    }
    return '';
  }

  use(it, p) {
    const map = this.map;
    switch (it.type) {
      case 'door':
        if (it.d.open || !this.spend(p, it.d.cost)) return;
        this.openDoor(it.d);
        this.tell(p, { e: 'snd', n: 'purchase' });
        break;
      case 'wallbuy': {
        const wb = it.wb, s = this.ownedSlot(p, wb.weapon);
        if (s) {
          const w = p.slots[s];
          if (w.reserve >= w.def.reserve) { this.tell(p, { e: 'msg', s: 'Ammo is already full', d: 1 }); return; }
          if (!this.spend(p, ammoCost(w))) return;
          w.reserve = w.def.reserve;
          this.syncInv(p, 'ammo');
        } else {
          if (!this.spend(p, wb.cost)) return;
          this.givePlayerWeapon(p, wb.weapon);
        }
        this.tell(p, { e: 'snd', n: 'purchase' });
        break;
      }
      case 'perk':
        if (p.perks.has(it.pm.id) || !this.spend(p, it.pm.cost)) return;
        this.applyPerk(p, it.pm.id);
        this.tell(p, { e: 'snd', n: 'perk' });
        this.tell(p, { e: 'msg', s: `${it.pm.name}!`, d: 2 });
        break;
      case 'pap': {
        const w = p.weapon, st = it.st;
        if (!w || w.def.melee || (w.def.pap || 0) !== st.level - 1) { this.tell(p, { e: 'snd', n: 'denied' }); return; }
        if (!this.spend(p, st.cost)) return;
        w.def = papDef(w.def, st.level); w.mag = w.def.mag; w.reserve = w.def.reserve;
        p.deployUntil = this.time + 1.0; p.reloading = false;
        this.syncInv(p, 'pap');
        this.tell(p, { e: 'snd', n: 'perk' });
        this.tell(p, { e: 'msg', s: `${w.def.name}!`, d: 2.5 });
        break;
      }
      case 'box': {
        const b = map.box;
        if (b.state === 'idle') {
          if (!this.spend(p, b.cost)) return;
          Object.assign(b, { state: 'rolling', t: 0, nextSwap: 0, owner: p });
          b.label.visible = true;
          this.tell(p, { e: 'snd', n: 'boxRoll' });
        } else if (b.state === 'ready' && b.owner === p) {
          this.givePlayerWeapon(p, b.weapon);
          this.tell(p, { e: 'snd', n: 'purchase' });
          b.state = 'idle'; b.label.visible = false; b.owner = null;
        }
        break;
      }
    }
  }

  updateInteract(dt) {
    for (const p of this.players) {
      const local = p === this.player;
      const it = this.findInteraction(p);
      if (local) this.interaction = it;
      if (!it) { p.rebuildT = 0; continue; }
      const hold = local ? this.input.down('KeyE') : p.wantsUse;
      if (it.type === 'window') {
        if (hold) {
          p.rebuildT += dt;
          if (p.rebuildT >= 0.55) {
            p.rebuildT = 0;
            this.map.setBoards(it.w, it.w.boards + 1);
            this.addPoints(p, 10);
            this.tell(p, { e: 'snd', n: 'boardFix' });
          }
        } else p.rebuildT = 0;
      } else if (it.type === 'revive') {
        const o = it.who;
        if (hold && (!o.reviver || o.reviver === p)) {
          const need = p.perks.has('quick') ? REVIVE_TIME / 2 : REVIVE_TIME;
          o.reviver = p; o.reviveT += dt; o.reviving = true;
          o.reviveFrac = Math.min(1, o.reviveT / need);
          if (o.reviveT >= need) this.revive(o, p);
        }
      } else if (local && this.input.pressed('KeyE')) this.use(it, p);
    }
    // nobody holding E next to them: the revive starts over
    for (const p of this.players) {
      if (p.downed && !p.reviving) { p.reviveT = 0; p.reviveFrac = 0; p.reviver = null; }
      p.reviving = false;
    }
  }

  // down timers: solo Quick Revive gets you up; in co-op you bleed out unless revived
  updateDowned(dt) {
    for (const p of this.players) {
      if (!p.alive || !p.downed) continue;
      if (p === this.player) { p.eyeH += (0.55 - p.eyeH) * Math.min(1, dt * 6); p.applyMovement(dt, 0, 0, 1, false); }
      if (this.coop && p.reviveT > 0) continue;   // the clock stops while someone is reviving you
      p.downT -= dt;
      if (p.downT <= 0) { if (this.coop) this.bleedOut(p); else this.revive(p, null); }
    }
  }

  updateBox(dt) {
    this.animateBox(dt);
    const b = this.map.box;
    if (b.state === 'rolling' && b.t >= 3.6) {
      const owner = b.owner;
      let pool = BOX_WEAPONS.filter(([k]) => !owner || !this.ownedSlot(owner, k));
      if (!pool.length) pool = BOX_WEAPONS;
      const total = pool.reduce((a, [, w]) => a + w, 0);
      let r = Math.random() * total;
      b.weapon = pool[0][0];
      for (const [k, w] of pool) { r -= w; if (r <= 0) { b.weapon = k; break; } }
      this.map.setBoxLabel(WEAPONS[b.weapon].name, b.weapon === 'raygun' ? '#7dff8a' : '#ffd36a');
      b.state = 'ready'; b.t = 0;
    } else if (b.state === 'ready' && b.t > 9) { b.state = 'idle'; b.label.visible = false; b.owner = null; }
  }

  // lid, light beam and the floating label (the label cycles through guns while rolling)
  animateBox(dt) {
    const b = this.map.box;
    const target = b.state === 'idle' ? 0 : 1;
    b.open += (target - b.open) * Math.min(1, dt * 6);
    b.lid.rotation.x = -b.open * 1.7;
    b.beam.material.opacity = 0.12 + Math.sin(this.time * 3) * 0.05;
    if (b.state === 'rolling') {
      b.t += dt;
      b.label.position.y = 1.0 + Math.min(1, b.t / 1.5) * 0.9;
      if (this.time >= (b.nextSwap || 0)) {
        const k = BOX_WEAPONS[Math.floor(Math.random() * BOX_WEAPONS.length)][0];
        this.map.setBoxLabel(WEAPONS[k].name);
        b.nextSwap = this.time + 0.07 + b.t * 0.05;
      }
    } else if (b.state === 'ready') {
      b.t += dt;
      b.label.position.y = 1.9 + Math.sin(this.time * 3) * 0.05;
    }
  }

  // ----- power-ups -----
  powerTexture(type) {
    if (this.puTex[type]) return this.puTex[type];
    const info = POWERUPS[type];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#16210f'; ctx.strokeStyle = info.color; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(64, 64, 52, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = info.color; ctx.font = '700 34px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(info.short, 64, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (this.puTex[type] = t);
  }

  glowTex() {
    if (this._glow) return this._glow;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d'), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return (this._glow = new THREE.CanvasTexture(c));
  }

  maybeDropPowerup(pos) {
    this.killsSinceDrop++;
    const chance = 0.02 + Math.min(0.06, this.killsSinceDrop * 0.0015);
    if (this.powerupsThisRound >= 4 || Math.random() > chance) return;
    this.dropPowerup(pos);
  }

  dropPowerup(pos) {
    this.killsSinceDrop = 0; this.powerupsThisRound++;
    const types = Object.keys(POWERUPS);
    const type = types[Math.floor(Math.random() * types.length)];
    this.addPowerup(++this.puId, type, new THREE.Vector3(pos.x, pos.y + 1.1, pos.z));
  }

  addPowerup(id, type, p) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.powerTexture(type), transparent: true, depthWrite: false }));
    sprite.scale.set(0.9, 0.9, 1);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: POWERUPS[type].color, map: this.glowTex(), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(1.8, 1.8, 1);
    sprite.position.copy(p); glow.position.copy(p);
    this.scene.add(glow, sprite);
    const pu = { id, type, pos: p, sprite, glow, t: 0 };
    this.powerups.push(pu);
    this.sound.powerSpawn(p);
    return pu;
  }

  // the banner and sound everyone gets when a power-up is grabbed
  powerupFx(type) {
    const info = POWERUPS[type];
    if (!info) return;
    this.sound.powerGrab();
    this.hud.banner(info.label, '', 'T', 2);
    if (type === 'nuke') { this.sound.nuke(); this.hud.flash(); }
  }

  applyPowerup(type, taker) {
    this.powerupFx(type);
    this.net?.emit({ e: 'pu', ty: type });
    if (type === 'maxammo') {
      for (const p of this.players) {
        if (!p.alive) continue;
        for (const s of [1, 2]) { const w = p.slots[s]; if (w) w.reserve = w.def.reserve; }
        this.syncInv(p, 'ammo');
      }
    }
    if (type === 'instakill') this.effects.instakill = 30;
    if (type === 'double') this.effects.double = 30;
    if (type === 'carpenter') { for (const w of this.map.windows) this.map.setBoards(w, w.max); for (const p of this.players) this.addPoints(p, 200); }
    if (type === 'nuke') {
      for (const z of this.zombies) if (z.active && z.alive && !z.v.boss) this.killZombie(z, false, false, true, taker);
      for (const p of this.players) this.addPoints(p, 400);
    }
  }

  // bobbing and blinking (shared by host and joining players)
  animatePowerups(dt) {
    for (const pu of this.powerups) {
      pu.t += dt;
      const y = pu.pos.y + Math.sin(pu.t * 3) * 0.12;
      pu.sprite.position.y = y; pu.glow.position.y = y;
      const blink = pu.t > 20 && Math.floor(pu.t * 6) % 2 === 0;
      pu.sprite.visible = pu.glow.visible = !blink;
    }
  }

  removePowerup(pu) {
    this.scene.remove(pu.sprite, pu.glow);
    pu.sprite.material.dispose(); pu.glow.material.dispose();
    this.powerups.splice(this.powerups.indexOf(pu), 1);
  }

  updatePowerups(dt) {
    this.animatePowerups(dt);
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      const taker = this.players.find((p) => p.alive && !p.downed && flat(pu.pos, p.body.pos) < 1.4 && Math.abs(pu.pos.y - 1.1 - p.body.pos.y) < 2);
      if (taker || pu.t > 27) {
        if (taker) this.applyPowerup(pu.type, taker);
        this.removePowerup(pu);
      }
    }
    for (const k of ['instakill', 'double']) this.effects[k] = Math.max(0, this.effects[k] - dt);
  }

  zombieSound(z) {
    if (this.time - this.lastZSound < 0.35) return;
    if (flat(z.body.pos, this.player.body.pos) > 32) return;
    this.lastZSound = this.time;
    if (Math.random() < 0.35) this.sound.tung(z.body.pos, z.v.tung || 0.45); else this.sound.groan(z.body.pos, z.v.pitch);
  }

  flapSound(z) {
    if (this.time - this.lastFlap < 0.12 || flat(z.body.pos, this.player.body.pos) > 18) return;
    this.lastFlap = this.time;
    this.sound.flap(z.body.pos);
  }

  // the ground shakes when the rainbow giant walks (or falls) nearby
  giantStep(z, k = 1) {
    this.sound.stomp(z.body.pos, Math.min(1, 0.8 * k));
    const p = this.player, d = flat(z.body.pos, p.body.pos);
    if (p.alive && d < 18) p.punch += 0.02 * k * (1 - d / 18);
  }

  // ----- coconuts (thrown by the pink zombies) -----
  // can zombie z see player p well enough to throw at them?
  clearShot(z, p) {
    const o = z.handPos(_v), t = p.chestPos(_v2);
    _d.copy(t).sub(o);
    const len = _d.length();
    if (len < 0.1) return true;
    _d.divideScalar(len);
    return !raycast(o, _d, len, this.map.colliders, _hit) && this.map.rayGround(o, _d, len) === null;
  }

  throwCoconut(z, p) {
    const o = z.handPos(new THREE.Vector3()), t = p.chestPos(new THREE.Vector3());
    // a flatter, faster throw the further away you are; leads a moving target a little, and misses a little
    const hs = clamp(9 + flat(o, t) * 0.5, 10, 19), lead = flat(o, t) / hs * 0.6;
    t.x += p.body.vel.x * lead + (Math.random() - 0.5) * 0.6;
    t.z += p.body.vel.z * lead + (Math.random() - 0.5) * 0.6;
    const dx = t.x - o.x, dz = t.z - o.z, d = Math.hypot(dx, dz) || 1, T = d / hs;
    const vel = new THREE.Vector3(dx / d * hs, (t.y - o.y + 0.5 * COCO_G * T * T) / T, dz / d * hs);
    const pj = this.addProjectile(++this.pjId, o, vel, z.v.throwDmg);
    this.sound.swing(o);
    this.net?.emit({ e: 'zt', i: pj.id, p: [r2(o.x), r2(o.y), r2(o.z)], v: [r2(vel.x), r2(vel.y), r2(vel.z)] });
  }

  addProjectile(id, pos, vel, dmg = 0) {
    const mesh = makeCoconut();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const pj = { id, pos: mesh.position, vel: vel.clone(), t: 0, dmg, mesh };
    this.projectiles.push(pj);
    return pj;
  }

  // Coconuts fly in an arc and crack on whatever they hit. hits: decide who gets hit (the host);
  // joining players only draw them.
  updateProjectiles(dt, hits = true) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pj = this.projectiles[i], pos = pj.pos;
      pj.t += dt;
      _v.copy(pos);
      pj.vel.y -= COCO_G * dt;
      pos.addScaledVector(pj.vel, dt);
      pj.mesh.rotation.x += dt * 11; pj.mesh.rotation.y += dt * 7;
      let victim = null, done = pj.t > 5;
      if (hits && this.phase !== 'over') {
        for (const p of this.players) {
          if (!p.alive || p.downed) continue;
          const pp = p.body.pos, cy = clamp(pos.y, pp.y + 0.2, pp.y + (p.crouching ? 1.15 : 1.65));
          if ((pos.x - pp.x) ** 2 + (pos.z - pp.z) ** 2 + (pos.y - cy) ** 2 < 0.45 * 0.45) { victim = p; break; }
        }
      }
      if (!victim && !done) {
        _d.copy(pos).sub(_v);
        const len = _d.length();
        if (len > 1e-6) {
          _d.divideScalar(len);
          const w = raycast(_v, _d, len, this.map.colliders, _hit);
          if (w) { pos.copy(_v).addScaledVector(_d, Math.max(0, w.t - 0.05)); done = true; }
        }
        if (pos.y <= this.map.groundAt(pos.x, pos.z)) done = true;
      }
      if (victim) this.hurtPlayer(pj.dmg, _v, victim);
      if (victim || done) this.popProjectile(pj, hits);
    }
  }

  popProjectile(pj, tell) {
    this.scene.remove(pj.mesh);
    this.projectiles.splice(this.projectiles.indexOf(pj), 1);
    this.fx.burst(pj.pos, 0x5e3b1e, 8, 4);
    this.fx.burst(pj.pos, 0xf2eee2, 6, 3);   // coconut milk
    this.sound.coconut(pj.pos);
    if (tell) this.net?.emit({ e: 'zx', i: pj.id, p: [r2(pj.pos.x), r2(pj.pos.y), r2(pj.pos.z)] });
  }

  clearProjectiles() {
    for (const pj of this.projectiles) this.scene.remove(pj.mesh);
    this.projectiles = [];
  }

  separate() {
    const zs = this.zombies.filter((z) => z.active && z.alive && z.state === 'chase');
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i].body.pos;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j].body.pos;
        if (Math.abs(a.y - b.y) > 1.2) continue;   // a flyer passing over
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        const minD = 0.33 * (zs[i].scale + zs[j].scale);
        if (d > 0.001 && d < minD) {
          const push = (minD - d) / 2, nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        }
      }
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const pp = p.body.pos, movePlayer = p === this.player && !p.downed;   // other players keep themselves clear
      for (const z of zs) {
        const zp = z.body.pos;
        const dx = zp.x - pp.x, dz = zp.z - pp.z, d = Math.hypot(dx, dz);
        const minD = 0.4 + 0.35 * z.scale;
        if (d > 0.001 && d < minD && Math.abs(zp.y - pp.y) < 1.5) {
          const push = minD - d, nx = dx / d, nz = dz / d;
          zp.x += nx * push * 0.7; zp.z += nz * push * 0.7;
          if (movePlayer) { pp.x -= nx * push * 0.3; pp.z -= nz * push * 0.3; }
        }
      }
    }
  }

  // ----- spectating (co-op, after bleeding out) -----
  nextSpectate(current) {
    const pool = this.players.filter((o) => o.alive && o !== this.player);
    if (!pool.length) return null;
    return pool[(pool.indexOf(current) + 1) % pool.length];
  }
  updateSpectate() {
    const p = this.player;
    if (p.alive || this.phase === 'over') return;
    if (this.input.mouseHit(0) || !this.spectating || !this.spectating.alive) this.spectating = this.nextSpectate(this.spectating);
  }

  // Per rendered frame: aim with the mouse (also while downed).
  frame() { if (this.player && this.phase !== 'over' && this.player.alive) this.player.look(); }

  // Per rendered frame: place the camera and zombie models between the last two physics ticks.
  interpolate(alpha) {
    for (const z of this.zombies) if (z.active && z.alive) z.renderPos(z.model.root.position, alpha);
    this.updateCamera(alpha);
    this.sound.setListener(this.camera.position, this.player.alive ? this.player.yaw : this.camera.rotation.y);
  }

  updateCamera(alpha = 1) {
    const p = this.player, cam = this.camera;
    if (!p.alive && this.phase !== 'over' && this.spectating) {
      if (cam.fov !== this.baseFov) { cam.fov = this.baseFov; cam.updateProjectionMatrix(); }
      chaseCamera(cam, this.spectating, alpha, this.map.colliders);
      return;
    }
    p.renderEye(cam.position, alpha);
    let roll = 0;
    if (this.phase === 'over') { cam.position.y = p.body.pos.y + 0.4; roll = 0.5; }
    cam.rotation.set(p.pitch + p.punch, p.yaw, roll);
    const fov = p.scoped && p.alive ? this.scopeFov : this.baseFov;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  // ----- main update -----
  // One physics tick.
  update(dt) {
    if (!this.running) return;
    this.time += dt;
    const p = this.player;
    p.prevPos.copy(p.body.pos);
    for (const z of this.zombies) if (z.active) z.prevPos.copy(z.body.pos);
    for (const a of this.remotes) a.update(dt);   // other players: follow their position updates

    if (this.phase === 'over') {
      this.overT -= dt;
      for (const z of this.zombies) if (z.active) { if (z.alive) z.animate(dt, 0.4); else z.updateDead(dt); }
      this.updateProjectiles(dt, false);
      if (this.overT <= 0) {
        this.running = false;
        this.onGameOver?.(this.finalStats());
      }
      return;
    }

    if (this.betweenRounds && this.input.pressed('KeyN') && this.time < this.nextRoundAt) this.nextRoundAt = this.time;
    if (this.betweenRounds && this.time >= this.nextRoundAt) this.startRound(this.round + 1);
    if (!this.betweenRounds) {
      this.spawnT -= dt;
      if (this.toSpawn > 0 && this.spawnT <= 0 && this.aliveZombies() < MAX_ALIVE) {
        if (this.spawnNext()) this.toSpawn--;
        this.spawnT = Math.max(0.35, 2.0 - this.round * 0.12) * (0.6 + Math.random() * 0.8);
      }
    }

    if (p.alive) {
      if (!p.downed) p.update(dt);
      p.updateWeapon(dt);
    }
    this.updateDowned(dt);
    for (const q of this.players) {
      if (q.alive && !q.downed && q.health < q.maxHealth && this.time - q.lastHurt > 3.5) q.health = Math.min(q.maxHealth, q.health + 80 * dt);
    }

    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.25;
      const targets = this.players.filter((q) => q.alive && !q.downed).map((q) => q.body.pos);
      if (targets.length) this.map.computeFlow(targets);
    }
    for (const z of this.zombies) if (z.active) z.update(dt);
    this.separate();
    this.updateProjectiles(dt);
    if (this.phase === 'over') return;
    this.updateInteract(dt);
    this.updatePowerups(dt);
    this.updateBox(dt);
    this.map.updateDoors(dt);
    this.updateSpectate();

    if (!this.betweenRounds && this.toSpawn === 0 && this.aliveZombies() === 0) this.endRound();
  }

  // ---------- online (host side) ----------
  // Feedback meant for one player: shown here for you, sent to their browser for others.
  tell(p, ev) {
    if (p === this.player) this.feedback(ev);
    else if (p?.isAvatar && this.net) this.net.emitTo(p.pid, ev);
  }

  feedback(ev) {
    const p = this.player;
    switch (ev.e) {
      case 'msg': this.hud.center(String(ev.s), ev.d || 2); break;
      case 'snd': if (NET_SOUNDS.has(ev.n)) this.sound[ev.n](); break;
      case 'pts': this.hud.zPoints(ev.n | 0); break;
      case 'hurt':
        p.punch += 0.05;
        p.body.vel.x += (+ev.x || 0) * 3; p.body.vel.z += (+ev.z || 0) * 3;
        this.hud.damage(); this.sound.batHit();
        break;
    }
  }

  announce(except, text) {
    for (const o of this.players) if (o !== except) this.tell(o, { e: 'msg', s: text, d: 3 });
  }

  // the host changed what a player carries: send them the full list
  syncInv(p, hint) {
    if (!p.isAvatar || !this.net) return;
    p.invVer++;
    this.net.emitTo(p.pid, { e: 'inv', ver: p.invVer, cur: p.slot, s: packSlots(p), h: hint });
  }

  netUpdate(dt) { this.net?.update(dt, () => this.snapshot()); }

  snapshot() {
    const p = this.players.map((q) => {
      let f = 0;
      if (q.alive) f |= F.ALIVE;
      if (q.downed) f |= F.DOWN;
      if (q.crouching) f |= F.CROUCH;
      if (q.body.onGround) f |= F.GROUND;
      const s = (q.isAvatar && q.interp.latest) || null;
      const pos = s || q.body.pos, w = q.weapon;
      return [q.nid, r2(pos.x), r2(pos.y), r2(pos.z), r3(s ? s.yaw : q.yaw), r3(s ? s.pitch : q.pitch), f,
        Math.max(0, Math.ceil(q.health)), q.maxHealth, q.points, [...q.perks].join(','), q.kills,
        r1(q.downT), r2(q.reviveFrac || 0), w ? w.key : '', w?.def.pap || 0];
    });
    const z = [];
    for (const zb of this.zombies) {
      if (!zb.active) continue;
      const b = zb.body.pos;
      z.push([zb.netId, r2(b.x), r2(b.y), r2(b.z), r2(zb.yaw), zb.state, (zb.alive ? 1 : 0) | (zb.speed > 4.5 ? 4 : 0),
        Math.round(zb.attackT * 100), KINDS.indexOf(zb.kind), Math.round(zb.throwT * 100)]);
    }
    const box = this.map.box;
    return {
      T: r3(this.time), r: this.round, br: this.betweenRounds ? 1 : 0, nr: r2(this.nextRoundAt), p, z,
      wb: this.map.windows.map((w) => w.boards).join(''),
      bx: [box.state, box.weapon || '', box.owner ? box.owner.nid : -1],
      ef: [r1(this.effects.instakill), r1(this.effects.double)],
      pu: this.powerups.map((q) => [q.id, q.type, r2(q.pos.x), r2(q.pos.y), r2(q.pos.z), r1(q.t)]),
    };
  }

  onNet(pid, msg) {
    const p = this.remotes.find((a) => a.pid === pid);
    if (!p || !this.running) return;
    if (msg.st) p.netState(msg.st, this.time);
    if (Array.isArray(msg.ev)) for (const ev of msg.ev) this.onPlayerEvent(p, ev);
  }

  onPlayerEvent(p, ev) {
    if (this.phase === 'over') return;
    switch (ev?.e) {
      case 'zh': {   // "my bullet hit zombie #n"
        const z = this.zombies[ev.z];
        if (!z || !z.active || !z.alive || !p.alive || p.downed) return;
        const knock = Array.isArray(ev.k) ? _d.set(+ev.k[0] || 0, 0, +ev.k[1] || 0) : null;
        this.hitZombie(z, Math.min(3000, Math.max(0, +ev.d || 0)), !!ev.h, !!ev.m, !!ev.q, p, knock);
        break;
      }
      case 'shot':
        if (!p.alive || p.downed) return;
        showShot(this, p, ev);
        this.net.emit({ e: 'shot', n: p.nid, s: ev.s, d: ev.d, tc: ev.tc, sp: ev.sp }, p.pid);
        break;
      case 'knife':
        if (!p.alive) return;
        this.sound.knife(p.body.pos);
        this.net.emit({ e: 'knife', n: p.nid }, p.pid);
        break;
      case 'use': {   // pressed E on something
        if (!p.alive || p.downed) return;
        const it = this.resolveUse(p, ev);
        if (it) this.use(it, p);
        break;
      }
      case 'next':
        if (this.betweenRounds && this.time < this.nextRoundAt) this.nextRoundAt = this.time;
        break;
      case 'shop':   // bought something from the shop (B)
        this.buy(p, ev.i | 0);
        break;
    }
  }

  // find what a player pressed E on (a little extra reach: their position here is slightly behind)
  resolveUse(p, ev) {
    const pos = p.body.pos, map = this.map, near = (at, r) => flat(pos, at) < r + 1.2;
    switch (ev.k) {
      case 'door': { const d = map.doors.find((x) => x.id === ev.id); return d && !d.open && near(d.center, 2.8) ? { type: 'door', d } : null; }
      case 'wallbuy': { const wb = map.wallBuys[ev.id]; return wb && near(wb.at, 1.7) ? { type: 'wallbuy', wb } : null; }
      case 'perk': { const pm = map.perkMachines.find((x) => x.id === ev.id); return pm && near(pm.at, 1.7) ? { type: 'perk', pm } : null; }
      case 'pap': { const st = map.papStations[ev.id]; return st && near(st.at, 1.9) && Math.abs(st.at.y - pos.y) < 2 ? { type: 'pap', st } : null; }
      case 'box': return near(map.box.at, 2.0) ? { type: 'box' } : null;
    }
    return null;
  }

  // someone left mid-game
  removePlayer(pid) {
    const p = this.remotes.find((a) => a.pid === pid);
    if (!p) return;
    p.dispose();
    this.remotes = this.remotes.filter((a) => a !== p);
    this.players = this.players.filter((a) => a !== p);
    this.combatants = this.players.slice();
    if (this.map.box.owner === p) this.map.box.owner = null;
    if (this.spectating === p) this.spectating = this.nextSpectate(null);
    this.hud.center(`${p.name} left the game`, 2.5);
    this.net?.emit({ e: 'left', n: p.nid });
    this.checkWipe();
  }
}
