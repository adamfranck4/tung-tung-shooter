// Zombies mode: survive endless rounds of Tung Tung zombies in Sahur Village, alone or with up to
// three friends online. Online, the host's browser runs the zombies and the shared world (doors,
// box, power-ups); each player's points, perks and health live here too. See netzombies.js for
// the joining side.
import * as THREE from 'three';
import { Combatant, RUN_SPEED, dirFrom, chaseCamera } from './combatant.js';
import { Player } from './player.js';
import { buildTungModel } from './bots.js';
import { WEAPONS, papDef } from './weapons.js';
import { raycast, wrapAngle } from './physics.js';
import { PLAYER_START } from './zmap.js';
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
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// where each player starts in the spawn room
const START_OFFSETS = [[0, 0], [1.6, 0.8], [-1.6, 0.8], [0, -1.6]];
export const spawnPoint = (i) => new THREE.Vector3(PLAYER_START.x + START_OFFSETS[i % 4][0], 0, PLAYER_START.z + START_OFFSETS[i % 4][1]);

const _t = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3(), _end = new THREE.Vector3();
const _hit = {}, _s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

// ---------------------------------------------------------------- zombie
export class Zombie extends Combatant {
  constructor(game) {
    super(game, 'Zombie', 'Z');
    this.isZombie = true;
    this.model = buildTungModel('Z', { zombie: true });
    this.model.root.visible = false;
    game.scene.add(this.model.root);
    this.active = false; this.alive = false;
    this.body.halfW = 0.3;
    this.interp = new Interp();   // joining players: positions from the host
  }

  spawn(sp, round, big = false) {
    this.active = true; this.alive = true; this.big = big;
    const s = this.scale = big ? BIG_SCALE : 1;
    this.health = big ? bigZombieHealth(round) : ZOMBIE_HP;
    const roll = Math.random();
    const sprint = clamp((round - 6) * 0.12, 0, 0.8), run = clamp((round - 2) * 0.2, 0, 0.95);
    // scaled to CS2 player speed (6.35 m/s with a knife): sprinters stay just slower than you
    if (big) this.speed = round >= 8 ? 3.4 : 1.8 + Math.random() * 0.3;
    else this.speed = roll < sprint ? 5.9 : roll < run ? 4.25 : 1.55 + Math.random() * 0.45;
    const b = this.body;
    b.vel.set(0, 0, 0); b.height = 1.8 * s; b.halfW = 0.3 * s; b.onGround = true;
    this.attackT = 0; this.attackCd = 0.6; this.stuckT = 0; this.deathT = 0; this.tearT = 0.8;
    this.soundT = 1 + Math.random() * 5; this.walkPhase = Math.random() * 6;
    this.win = sp.win || null;
    if (this.win) {
      b.pos.copy(this.win.spawn);
      this.prevPos.copy(b.pos);
      this.state = 'toWindow';
      this.yaw = Math.atan2(this.win.dir.x, this.win.dir.z); // face into the building
    } else {
      this.riseBase = this.game.map.groundAt(sp.pos.x, sp.pos.z); // rise out of hills too
      b.pos.set(sp.pos.x, this.riseBase - 1.9 * s, sp.pos.z);
      this.prevPos.copy(b.pos);
      this.state = 'rise'; this.riseT = 0;
      this.yaw = Math.random() * Math.PI * 2;
    }
    const m = this.model;
    m.root.visible = true;
    m.root.scale.setScalar(big ? BIG_SCALE : 0.95 + Math.random() * 0.1);
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
      const k = Math.min(1, this.riseT / (this.big ? 2.2 : 1.5));
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
    const g = this.game, b = this.body, map = g.map;
    const p = g.nearestPlayer(b.pos, true);
    const canAttack = !!p && g.phase !== 'over';
    let dx = 0, dz = 0, dy = 0, dist = Infinity;
    if (p) { const tp = p.body.pos; dx = tp.x - b.pos.x; dz = tp.z - b.pos.z; dy = tp.y - b.pos.y; dist = Math.hypot(dx, dz); }
    // big zombies reach further and hit harder
    const reach = this.big ? 1.9 : 1.3, hitReach = this.big ? 2.5 : 1.8, dmg = this.big ? 80 : 50;
    if (this.attackT > 0) {
      const prev = this.attackT;
      this.attackT -= dt;
      if (prev > 0.32 && this.attackT <= 0.32 && canAttack && dist < hitReach && dy > -0.5 && dy < 1.4 * this.scale) g.hurtPlayer(dmg, this, p);
    } else {
      this.attackCd -= dt;
      if (canAttack && dist < reach && dy > -0.5 && dy < 1.4 * this.scale && this.attackCd <= 0) {
        this.attackT = 0.75; this.attackCd = this.big ? 1.4 : 1.1; g.sound.swing(b.pos);
      }
    }
    let wx = 0, wz = 0, jump = false;
    if (canAttack && dist > 0.85 * this.scale) {
      // run straight at you only when you're on the same level and nothing is in the way
      if (dist < 14 && Math.abs(dy) < 1.2 && map.clearLine(b.pos, p.body.pos, 0.3 * this.scale)) { wx = dx / dist; wz = dz / dist; }
      else {
        const t = map.flowTarget(b.pos, _t);
        if (t) { const tx = t.x - b.pos.x, tz = t.z - b.pos.z, l = Math.hypot(tx, tz) || 1; wx = tx / l; wz = tz / l; }
        else { wx = dx / dist; wz = dz / dist; }
      }
    }
    let speed = this.speed;
    if (this.attackT > 0) speed *= 0.35;
    if (wx || wz) {
      if (this.horizSpeed() < speed * 0.25) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.8 && b.onGround) { jump = true; this.stuckT = 0; }
    }
    this.applyMovement(dt, wx, wz, speed / RUN_SPEED, jump);
    if (dist < 2.5) this.turnTo(Math.atan2(-dx, -dz), dt, 10);
    else if (wx || wz) this.turnTo(Math.atan2(-wx, -wz), dt, 7);
  }

  animate(dt, phaseSpeed) {
    const m = this.model, b = this.body;
    m.root.position.copy(b.pos);
    m.root.rotation.set(0, this.yaw, 0);
    const sp = phaseSpeed ?? this.horizSpeed();
    this.walkPhase += dt * (sp * 1.9 + 0.8);
    const amp = Math.min(1, sp / 3.5) * 0.7 + 0.1;
    m.legL.rotation.x = Math.sin(this.walkPhase) * amp;
    m.legR.rotation.x = -Math.sin(this.walkPhase) * amp;
    m.torso.position.y = 0.6 + Math.abs(Math.cos(this.walkPhase)) * 0.04 * amp;
    m.torso.rotation.z = Math.sin(this.walkPhase) * 0.07 * amp;
    m.torso.rotation.x = this.speed > 4.5 ? -0.3 : -0.14; // hunched forward
    // bat held low at the side while walking (like the reference), raised over the shoulder to swing
    let armX = -0.35 + Math.sin(this.walkPhase * 0.5) * 0.08, batX = 0.35 + Math.sin(this.walkPhase) * 0.12;
    if (this.attackT > 0) {
      const k = 1 - this.attackT / 0.75;
      if (k < 0.55) { const e = k / 0.55; armX = -0.35 + e * 1.25; batX = 0.35 - e * 2.6; }
      else { const e = (k - 0.55) / 0.45; armX = 0.9 - e * 1.35; batX = -2.25 + e * 3.2; }
    } else if (this.state === 'tear') {
      armX = 0.5 + Math.sin(this.game.time * 9 + this.walkPhase) * 0.6;
      batX = -0.6 + Math.sin(this.game.time * 9 + this.walkPhase) * 0.9;
    }
    m.arms.rotation.x = armX;
    m.bat.rotation.x = batX;
  }

  die() {
    this.alive = false; this.state = 'dead'; this.deathT = 0; this.deathTilt = (Math.random() - 0.5) * 0.6;
    this.attackT = 0;
  }

  updateDead(dt) {
    const m = this.model;
    this.deathT += dt;
    const k = Math.min(1, this.deathT / 0.45), e = k * k;
    m.root.rotation.set(e * Math.PI / 2 * 0.97, this.yaw, e * this.deathTilt);
    let y = this.body.pos.y + e * 0.15;
    if (this.deathT > 2.2) y -= (this.deathT - 2.2) * 0.7; // sink into the ground
    m.root.position.set(this.body.pos.x, y, this.body.pos.z);
    if (this.deathT > 3.8) this.deactivate();
  }

  // ----- joining players: a copy that follows the host's zombie -----
  // e: [id, x, y, z, yaw, state, flags (1 alive, 2 big, 4 fast), attack time x100]
  netUpdate(T, e) {
    const alive = !!(e[6] & 1);
    if (!this.active || (alive && !this.alive)) {
      if (!alive) return;                        // already gone here
      this.puppetSpawn(!!(e[6] & 2), !!(e[6] & 4));
    }
    if (!alive) { if (this.alive) this.die(); return; }
    this.interp.push(T, e[1], e[2], e[3], e[4]);
    this.state = e[5];
    const atk = e[7] / 100;
    if (atk > 0 && this.netAtk <= 0) { this.attackT = atk; this.game.sound.swing(this.body.pos); }
    this.netAtk = atk;
  }

  puppetSpawn(big, fast) {
    this.active = true; this.alive = true; this.big = big;
    const s = this.scale = big ? BIG_SCALE : 1;
    this.speed = fast ? 5.9 : 2;   // only changes how hunched it looks
    const b = this.body;
    b.height = 1.8 * s; b.halfW = 0.3 * s; b.vel.set(0, 0, 0);
    this.attackT = 0; this.netAtk = 0; this.deathT = 0; this.state = 'chase'; this.placed = false;
    this.soundT = 1 + Math.random() * 5; this.walkPhase = Math.random() * 6;
    this.interp.clear();
    const m = this.model;
    m.root.visible = true;
    m.root.scale.setScalar(big ? BIG_SCALE : 0.95 + Math.random() * 0.1);
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
    this.zombies = []; this.combatants = []; this.powerups = [];
    this.players = []; this.remotes = [];
    this.net = null; this.netDelay = 0.075; this.shotEnds = [];
    this.running = false; this.phase = 'live';
    this.bomb = { state: 'none' };
    this.lastZSound = 0;
    this.puTex = {};
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
    for (const pu of this.powerups) this.scene.remove(pu.sprite, pu.glow);
    this.powerups = [];
    for (const a of this.remotes) a.dispose();
    this.remotes = [];
  }

  // ----- interface used by Player / Combatant / HUD -----
  canBuy() { return false; }
  buy() {}
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
    this.powerupsThisRound = 0;
    this.hud.zRound(r, true);
    this.sound.zRoundStart();
    this.net?.emit({ e: 'round', r });
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

  pickSpawn(big = false) {
    // distance to the closest living player
    const near = (pos) => { let d = Infinity; for (const p of this.players) if (p.alive) d = Math.min(d, flat(pos, p.body.pos)); return d; };
    const all = [];
    if (!big) for (const w of this.map.windows) if (this.activeAreas.has(w.area)) all.push({ win: w, pos: w.spawn, weight: 2 });
    if (this.round >= 2 || big) for (const s of this.map.groundSpawns) if (this.activeAreas.has(s.area)) all.push({ pos: s.pos, weight: 1 });
    if (!all.length) return null;
    let pool = all.filter((s) => { const d = near(s.pos); return d > 7 && d < 42; });
    if (!pool.length) pool = all.filter((s) => near(s.pos) > 5);
    if (!pool.length) pool = all;
    const total = pool.reduce((a, s) => a + s.weight, 0);
    let r = Math.random() * total;
    for (const s of pool) { r -= s.weight; if (r <= 0) return s; }
    return pool[0];
  }

  getZombie() {
    let z = this.zombies.find((q) => !q.active);
    if (!z) { z = new Zombie(this); z.netId = this.zombies.length; this.zombies.push(z); }
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
    if (this.effects.instakill > 0) dmg = z.health + 1;
    z.health -= dmg;
    if (attacker === this.player && (!quiet || z.health <= 0)) { this.hud.hit(head); this.sound.hit(head); }
    if (z.health <= 0) this.killZombie(z, head, melee, false, attacker);
    else if (!quiet) this.addPoints(attacker, 10);
  }

  killZombie(z, head, melee, nuked, attacker) {
    z.die();
    if (attacker) { attacker.kills++; if (head) attacker.headshots++; }
    if (!nuked) {
      this.addPoints(attacker, z.big ? 250 : melee ? 130 : head ? 100 : 60);
      this.maybeDropPowerup(z.body.pos);
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

  hurtPlayer(dmg, z, p) {
    if (!p || !p.alive || p.downed || this.phase === 'over') return;
    p.health -= dmg;
    p.lastHurt = this.time;
    _d.set(p.body.pos.x - z.body.pos.x, 0, p.body.pos.z - z.body.pos.z).normalize();
    this.tell(p, { e: 'hurt', x: r2(_d.x), z: r2(_d.z) });
    if (p.health <= 0) {
      if (this.coop || p.perks.has('quick')) this.goDown(p);
      else this.gameOver();
    }
  }

  goDown(p) {
    p.downed = true; p.health = 1; p.scoped = false; p.reloading = false;
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
    consider(flat(pos, map.pap.at), 1.9, { type: 'pap' });
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
        if (s) return `Press E to buy ammo [${p.slots[s].def.pap ? 4500 : it.wb.cost / 2}]`;
        return `Press E to buy ${it.wb.def.name} [${it.wb.cost}]`;
      }
      case 'perk': return `Press E to drink ${it.pm.name} [${it.pm.cost}]`;
      case 'pap': {
        const w = p.weapon;
        if (!w || w.def.melee) return 'Pack-a-Punch: hold a gun to upgrade it';
        if (w.def.pap) return 'This weapon is already upgraded';
        return `Press E to Pack-a-Punch ${w.def.name} [${this.map.pap.cost}]`;
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
          if (!this.spend(p, w.def.pap ? 4500 : wb.cost / 2)) return;
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
        const w = p.weapon;
        if (!w || w.def.melee || w.def.pap) { this.tell(p, { e: 'snd', n: 'denied' }); return; }
        if (!this.spend(p, map.pap.cost)) return;
        w.def = papDef(w.def); w.mag = w.def.mag; w.reserve = w.def.reserve;
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
      for (const z of this.zombies) if (z.active && z.alive) this.killZombie(z, false, false, true, taker);
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
    if (Math.random() < 0.35) this.sound.tung(z.body.pos, z.big ? 0.7 : 0.45); else this.sound.groan(z.body.pos, z.big ? 0.55 : 1);
  }

  separate() {
    const zs = this.zombies.filter((z) => z.active && z.alive && z.state === 'chase');
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i].body.pos;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j].body.pos;
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
        const bigAlive = this.zombies.reduce((n, z) => n + (z.active && z.alive && z.big ? 1 : 0), 0);
        const big = bigAlive < 3 && Math.random() < bigChance(this.round);
        const sp = this.pickSpawn(big) || this.pickSpawn(false);
        if (sp) { this.getZombie().spawn(sp, this.round, big && !sp.win); this.toSpawn--; }
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
        r1(q.downT), r2(q.reviveFrac || 0), w ? w.key : '', w?.def.pap ? 1 : 0];
    });
    const z = [];
    for (const zb of this.zombies) {
      if (!zb.active) continue;
      const b = zb.body.pos;
      z.push([zb.netId, r2(b.x), r2(b.y), r2(b.z), r2(zb.yaw), zb.state, (zb.alive ? 1 : 0) | (zb.big ? 2 : 0) | (zb.speed > 4.5 ? 4 : 0), Math.round(zb.attackT * 100)]);
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
    }
  }

  // find what a player pressed E on (a little extra reach: their position here is slightly behind)
  resolveUse(p, ev) {
    const pos = p.body.pos, map = this.map, near = (at, r) => flat(pos, at) < r + 1.2;
    switch (ev.k) {
      case 'door': { const d = map.doors.find((x) => x.id === ev.id); return d && !d.open && near(d.center, 2.8) ? { type: 'door', d } : null; }
      case 'wallbuy': { const wb = map.wallBuys[ev.id]; return wb && near(wb.at, 1.7) ? { type: 'wallbuy', wb } : null; }
      case 'perk': { const pm = map.perkMachines.find((x) => x.id === ev.id); return pm && near(pm.at, 1.7) ? { type: 'perk', pm } : null; }
      case 'pap': return near(map.pap.at, 1.9) ? { type: 'pap' } : null;
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
