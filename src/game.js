// Match rules: rounds, economy, bomb, shooting resolution, spectating and camera.
// Online, the host's browser runs this for everyone: other people's fighters are Avatars that
// follow their position updates, their shots arrive as hit reports, and every change that
// players need to see is sent to them (see netclassic.js for the joining side).
import * as THREE from 'three';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { Director } from './director.js';
import { SPAWNS, SPAWN_CENTER } from './map.js';
import { WEAPONS, ARMOR_PRICE, BUY_ITEMS } from './weapons.js';
import { raycast } from './physics.js';
import { dirFrom, chaseCamera } from './combatant.js';
import { knifeName } from './viewmodel.js';
import { Avatar, F, r2, r3, packSlots, showShot } from './avatar.js';
import { BOT_NAMES } from './net.js';
import { matte } from './gfx.js';

const FREEZE_TIME = 5;
const ROUND_TIME = 115;
const BUY_TIME = 20;
const BOMB_TIME = 40;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;
const END_DELAY = 5;
// sounds a message from the host may ask a player's browser to play
export const NET_SOUNDS = new Set(['buy', 'pickup', 'plantTick', 'denied', 'purchase', 'perk', 'boardFix']);

const _hit = {}, _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _end = new THREE.Vector3(), _d = new THREE.Vector3();

// you + 4 bot teammates vs 5 bots
function soloRoster(team) {
  const roster = [{ nid: 0, name: 'You', team, kind: 'local' }];
  for (const t of ['T', 'CT']) {
    const count = t === team ? 4 : 5;
    for (let i = 0; i < count; i++) roster.push({ nid: roster.length, name: BOT_NAMES[t][i], team: t, kind: 'bot' });
  }
  return roster;
}

export class Game {
  constructor({ scene, camera, map, hud, sound, fx, input, vm, settings }) {
    Object.assign(this, { scene, camera, map, hud, sound, fx, input, vm, settings });
    this.time = 0;
    this.baseFov = 74; this.scopeFov = 22;
    this.combatants = []; this.bots = []; this.avatars = []; this.player = null;
    this.byNid = new Map();
    this.net = null; this.netDelay = 0.075; this.shotEnds = [];
    this.director = new Director(this);
    this.bomb = { state: 'none', carrier: null, pos: new THREE.Vector3(), explodeAt: 0, site: null, nextBeep: 0 };
    this.bombMesh = this.makeBombMesh();
    this.running = false;
    this.spectating = null;
  }

  makeBombMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.24), matte({ color: 0x3b3a30 }));
    body.position.y = 0.06; body.castShadow = true; g.add(body);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.1), matte({ color: 0x1a1a1a }));
    pad.position.set(-0.05, 0.13, 0); g.add(pad);
    this.bombLed = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2010 }));
    this.bombLed.position.set(0.1, 0.135, 0.05); g.add(this.bombLed);
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  // ---------- setup ----------
  // roster (online): every fighter, see Session.roster(). net: the NetLink when hosting online.
  start({ team = 'T', difficulty = 'normal', roundsToWin = 8, knife = 'knife', net = null, roster = null }) {
    this.stop();
    this.net = net; this.netDelay = 0.075;
    this.time = 0;
    this.roundsToWin = roundsToWin;
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.round = 0;
    roster = roster || soloRoster(team);
    const me = net ? roster.find((r) => r.pid === net.myId) : roster[0];
    this.setupPlayer(me, knife);
    for (const r of roster) {
      const friend = r.team === me.team;
      let c;
      if (r === me) c = this.player;
      else if (r.kind === 'human') {
        c = new Avatar(this, r, friend ? 'friend' : 'enemy');
        if (friend) c.addNameTag(r.name);
        this.avatars.push(c);
      } else {
        // your teammates are green, the enemy team is red
        c = new Bot(this, r.name, r.team, difficulty, friend ? 'friend' : 'enemy');
        c.nid = r.nid;
        if (friend) c.addMarker('#7ddf5a');
        this.bots.push(c);
      }
      this.combatants.push(c);
      this.byNid.set(r.nid, c);
    }
    this.matchOver = false;
    this.running = true;
    this.hud.clearFeed();
    this.startRound();
  }

  setupPlayer(me, knife) {
    const p = this.player = new Player(this, me.team);
    p.nid = me.nid;
    if (this.net) p.name = me.name;
    p.meleeName = knifeName(knife);
    this.vm.setKnife(knife);
    p.onFire = () => this.vm.fire(p.weapon.def.melee);
    p.onReload = () => this.sound.reload();
    p.onSwitch = () => this.sound.deploy();
    this.combatants = []; this.bots = []; this.avatars = [];
    this.byNid = new Map();
    this.vm.setTeam(me.team);
  }

  stop() {
    for (const b of this.bots) b.dispose();
    for (const a of this.avatars) a.dispose();
    this.bots = []; this.avatars = []; this.combatants = [];
    this.running = false;
    this.bombMesh.visible = false;
  }

  // Rounds played before the teams switch sides. A match is first to roundsToWin, so it lasts at
  // most 2 x roundsToWin - 1 rounds, and halftime comes after roundsToWin - 1 of them (CS2's MR24
  // works the same way: first to 13, switch after 12).
  halfRounds() { return this.roundsToWin - 1; }

  // Halftime: everyone plays the other side. Scores follow the players, and everyone starts over
  // with a pistol and $800, like the first round.
  swapSides() {
    const flip = (t) => (t === 'T' ? 'CT' : 'T');
    this.score = { T: this.score.CT, CT: this.score.T };
    this.lossStreak = { T: 0, CT: 0 };
    for (const c of this.combatants) {
      c.team = flip(c.team);
      c.money = 800; c.armor = 0; c.hasBomb = false;
      c.slots[1] = null; c.slots[2] = null;   // spawn() hands out a fresh pistol
    }
    this.vm.setTeam(this.player.team);
  }

  // the "Round N" banner, with halftime news when it applies
  roundBanner(hasBomb, halftime) {
    const p = this.player, side = p.team === 'CT' ? 'a Counter-Terrorist' : 'a Terrorist';
    if (halftime) {
      this.hud.banner('Halftime: switching sides', `You're now ${side}. Back to pistols, $800 each.`, p.team, 4.5);
      return;
    }
    const last = this.round === this.halfRounds() ? 'Last round before halftime. ' : '';
    this.hud.banner(`Round ${this.round}`, last + (hasBomb ? 'You have the bomb. Plant it at A or B.' : 'Buy time. Press B to buy.'), p.team, 2.5);
  }

  startRound() {
    const halftime = this.round > 0 && this.round === this.halfRounds();
    if (halftime) this.swapSides();
    this.round++;
    this.fx.clear();
    const spawnList = { T: SPAWNS.T.slice().sort(() => Math.random() - 0.5), CT: SPAWNS.CT.slice().sort(() => Math.random() - 0.5) };
    const idx = { T: 0, CT: 0 };
    for (const c of this.combatants) {
      const pos = spawnList[c.team][idx[c.team]++ % 5];
      c.spawn(pos, c.team === 'T' ? 0 : Math.PI);
    }
    // bot purchases
    for (const b of this.bots) this.botBuy(b);
    // bomb
    const ts = this.combatants.filter((c) => c.team === 'T');
    const carrier = ts[Math.floor(Math.random() * ts.length)] || null;
    if (carrier) carrier.hasBomb = true;
    Object.assign(this.bomb, { state: carrier ? 'carried' : 'none', carrier, site: null, defuser: null });
    this.bombMesh.visible = false;
    this.phase = 'freeze';
    this.phaseEnd = this.time + FREEZE_TIME;
    this.liveStart = this.phaseEnd;
    this.roundEnd = this.phaseEnd + ROUND_TIME;
    this.spectating = null;
    this.player.buyOpen = false;
    this.director.planRound();
    this.roundBanner(carrier === this.player, halftime);
    this.sound.roundStart();
    if (this.net) {
      // tm: everyone's side, so players' browsers pick up the halftime switch
      this.net.emit({
        e: 'round', r: this.round, ph: this.phaseEnd, ls: this.liveStart, re: this.roundEnd, c: carrier ? carrier.nid : -1,
        sp: this.combatants.map((c) => [c.nid, r2(c.body.pos.x), r2(c.body.pos.y), r2(c.body.pos.z), r3(c.yaw), c.spawnEpoch || 0]),
        tm: this.combatants.map((c) => [c.nid, c.team]), hf: halftime ? 1 : 0,
      });
      for (const a of this.avatars) this.syncInv(a, 'spawn');
    }
  }

  // Bots buy like players do: full buys when they can afford a rifle and armor, cheaper guns
  // (M16, Scout, shotgun, SMG) on force buys, and sometimes a Desert Eagle on eco rounds.
  botBuy(b) {
    const W = WEAPONS, rifle = b.team === 'T' ? 'ak' : 'm4';
    const taken = (k) => this.bots.some((o) => o !== b && o.team === b.team && o.slots[1]?.key === k);
    let m = b.money;
    const get = (k) => { b.give(k); m -= W[k].price; };
    if (!b.slots[1]) {
      const r = Math.random();
      const armored = (k) => m >= W[k].price + ARMOR_PRICE || (m >= W[k].price && b.armor > 0);
      if (armored('sniper') && !taken('sniper') && r < 0.25) get('sniper');
      else if (armored(rifle)) get(r < 0.1 && !taken('scout') ? 'scout' : rifle);
      else if (armored('m16') && r < 0.7) get('m16');
      else if (armored('scout') && !taken('scout') && r < 0.4) get('scout');
      else if (m >= 2000 && r < 0.65) get(Math.random() < 0.55 ? 'smg' : 'shotgun');
    }
    if (b.armor < 50 && m >= ARMOR_PRICE + 200) { b.armor = 100; m -= ARMOR_PRICE; }
    // pistol upgrade: with money to spare, or as an eco gamble
    if (b.slots[2]?.key !== 'deagle' && m >= W.deagle.price) {
      const eco = !b.slots[1];
      if ((m >= 2500 && Math.random() < 0.45) || (eco && Math.random() < 0.3)) get('deagle');
    }
    b.money = m;
    b.selectSlot(b.slots[1] ? 1 : 2, true);
  }

  canBuy(c) {
    if (!c.alive) return false;
    if (this.phase !== 'freeze' && !(this.phase === 'live' && this.time < this.buyEnd())) return false;
    return c.body.pos.distanceTo(SPAWN_CENTER[c.team]) < 18;
  }
  buyEnd() { return this.liveStart + BUY_TIME; }

  buy(c, index) {
    const item = BUY_ITEMS[index];
    if (!item || !this.canBuy(c)) return;
    const price = item.price(c.team);
    const broke = () => this.tell(c, { e: 'msg', s: 'Not enough money', d: 1 });
    if (item.armor) {
      if (c.armor >= 100) return;
      if (c.money < price) { broke(); return; }
      c.money -= price; c.armor = 100; this.tell(c, { e: 'snd', n: 'buy' }); return;
    }
    const key = item.key(c.team), slot = WEAPONS[key].slot;
    if (c.slots[slot]?.key === key) return;
    if (c.money < price) { broke(); return; }
    c.money -= price;
    c.give(key);
    // take the new gun out (if it replaced the one in your hands, draw it again)
    if (c.slot === slot) {
      c.reloading = false; c.burstLeft = 0; c.scoped = false; c.recoil = 0;
      c.deployUntil = this.time + (WEAPONS[key].deploy || 0.5);
      c.onSwitch?.();
    } else c.selectSlot(slot, false);
    this.tell(c, { e: 'snd', n: 'buy' });
    this.syncInv(c, 'switch');
  }

  aliveCount(team) { let n = 0; for (const c of this.combatants) if (c.alive && c.team === team) n++; return n; }

  // ---------- shooting ----------
  lineClear(a, b) {
    _d.subVectors(b, a);
    const len = _d.length();
    _d.divideScalar(len);
    return !raycast(a, _d, len, this.map.colliders, _hit);
  }

  fireBullet(shooter, origin, dir, def) {
    const range = 300;
    const wall = raycast(origin, dir, range, this.map.colliders, _hit);
    let hitT = wall ? wall.t : range;
    const wallInfo = wall ? { nx: wall.nx, ny: wall.ny, nz: wall.nz } : null;
    let victim = null, part = null;
    for (const c of this.combatants) {
      if (c === shooter || !c.alive || c.team === shooter.team) continue;
      const r = c.rayHit(origin, dir, hitT);
      if (r && r.t < hitT) { hitT = r.t; victim = c; part = r.part; }
    }
    _end.copy(origin).addScaledVector(dir, hitT);
    if (victim) {
      const mult = part === 'head' ? (def.headMult || 4) : part === 'leg' ? 0.75 : 1;
      const dmg = def.damage * mult * Math.pow(def.falloff || 1, hitT / 10);
      this.fx.blood(_end, dir);
      this.logShot(2);
      this.dealDamage(victim, shooter, dmg, def, part === 'head', dir);
    } else if (wallInfo) {
      this.fx.impact(_end, wallInfo);
      this.logShot(1, wallInfo);
    } else this.logShot(0);
    // tracer from roughly where the gun is
    if (shooter === this.player) {
      if (Math.random() < 0.4) {
        _v.set(0.18, -0.15, 0).applyEuler(this.camera.rotation).add(origin);
        this.fx.tracer(_v, _end);
      }
    } else {
      this.fx.tracer(origin, _end);
      // bullet passing close to the player's head
      const p = this.player;
      if (p.alive && shooter.team !== p.team && victim !== p) {
        p.eyePos(_v2);
        const t = _v.subVectors(_v2, origin).dot(dir);
        if (t > 0 && t < hitT) {
          const closest = _v.copy(origin).addScaledVector(dir, t);
          if (closest.distanceTo(_v2) < 1.2) this.sound.whiz(closest);
        }
      }
    }
  }

  // online: remember where each bullet ended so other players can draw it (sent by onShot)
  logShot(kind, n = null) {
    if (!this.net) return;
    this.shotEnds.push(n ? [r2(_end.x), r2(_end.y), r2(_end.z), kind, n.nx, n.ny, n.nz] : [r2(_end.x), r2(_end.y), r2(_end.z), kind]);
  }

  // a bullet or knife connected (a joining player reports it to the host instead)
  dealDamage(victim, attacker, dmg, def, headshot, dir) { this.applyDamage(victim, attacker, dmg, def, headshot, dir); }

  melee(att) {
    att.eyePos(_v);
    dirFrom(att.yaw, att.pitch, _d);
    this.sound.knife(att.body.pos);
    if (this.net) this.net.emit({ e: 'knife', n: att.nid });
    let best = null, bd = 2.3;
    for (const c of this.combatants) {
      if (!c.alive || c.team === att.team) continue;
      c.chestPos(_v2);
      const to = _v2.sub(_v);
      const d = to.length();
      if (d > bd) continue;
      if (to.normalize().dot(_d) < 0.75) continue;
      best = c; bd = d;
    }
    if (best) {
      // backstab if the attacker is behind the victim
      const fx = -Math.sin(best.yaw), fz = -Math.cos(best.yaw);
      const dx = best.body.pos.x - att.body.pos.x, dz = best.body.pos.z - att.body.pos.z;
      const behind = (fx * dx + fz * dz) / (Math.hypot(dx, dz) || 1) > 0.5;
      best.chestPos(_v2); this.fx.blood(_v2, _d);
      this.dealDamage(best, att, behind ? 180 : WEAPONS.knife.damage, WEAPONS.knife, false, _d);
    }
  }

  applyDamage(victim, attacker, raw, def, headshot, dir) {
    if (!victim.alive) return;
    let dmg = raw;
    if (victim.armor > 0 && !def.melee) {
      const pen = def.armorPen ?? 0.75;
      const absorbed = dmg * (1 - pen);
      victim.armor = Math.max(0, victim.armor - absorbed * 0.5);
      dmg -= absorbed;
    }
    dmg = Math.max(1, Math.round(dmg));
    victim.health -= dmg;
    victim.lastAttacker = attacker;
    victim.onDamaged?.(attacker, dmg, dir);
    if (attacker === this.player) { this.hud.hit(headshot); this.sound.hit(headshot); }
    if (victim === this.player) {
      this.hud.damage(); this.sound.hurt();
      victim.punch += 0.02; // aim punch
    } else if (victim.isAvatar) this.tell(victim, { e: 'hurt', d: dmg });
    // slow down on hit (tagging)
    victim.body.vel.x *= 0.5; victim.body.vel.z *= 0.5;
    if (victim.health <= 0) this.kill(victim, attacker, def, headshot);
  }

  kill(victim, attacker, def, headshot) {
    victim.health = 0; victim.alive = false; victim.deaths++;
    victim.useProgress = 0; victim.scoped = false;
    victim.onDeath?.();
    if (attacker && attacker !== victim) {
      attacker.kills++;
      attacker.money = Math.min(16000, attacker.money + (def.reward ?? 300));
    }
    if (victim.hasBomb) this.dropBomb(victim);
    const mine = attacker === this.player || victim === this.player;
    const wname = def.key === 'knife' && attacker ? attacker.meleeName : def.name;
    this.hud.killfeed(attacker, victim, wname, headshot, mine);
    if (this.net) this.net.emit({ e: 'kill', a: attacker ? attacker.nid : -1, v: victim.nid, w: wname, h: headshot ? 1 : 0 });
    if (victim === this.player) {
      this.hud.center(attacker ? `Killed by ${attacker.name}${headshot ? ' (headshot)' : ''}` : 'You died', 3);
      this.player.buyOpen = false;
      this.spectating = this.nextSpectate(null);
    } else if (this.spectating === victim) {
      this.spectateSwitchAt = this.time + 1.5;
    }
  }

  onShot(c, def) {
    this.sound.shot(def.sound, c === this.player ? null : c.body.pos);
    this.emitNoise(c.body.pos, 45, c);
    if (c === this.player) {
      this.camera.getWorldPosition(_v);
      this.fx.flash(_v);
    }
    if (this.net) {
      this.net.emit({ e: 'shot', n: c.nid, s: def.sound, d: this.shotEnds });
      this.shotEnds = [];
    }
  }

  emitNoise(pos, radius, src) {
    for (const b of this.bots) {
      if (b === src || !b.alive) continue;
      if (b.body.pos.distanceTo(pos) < radius) b.hear(pos, src);
    }
  }

  // ---------- bomb ----------
  dropBomb(c) {
    c.hasBomb = false;
    const b = this.bomb;
    b.state = 'dropped'; b.carrier = null;
    b.pos.set(c.body.pos.x, c.body.pos.y, c.body.pos.z);
    this.bombMesh.position.copy(b.pos);
    this.bombMesh.visible = true;
    this.director.onDropped(b.pos);
  }

  plant(c) {
    const b = this.bomb;
    c.hasBomb = false; c.useProgress = 0;
    b.state = 'planted'; b.carrier = null;
    b.pos.set(c.body.pos.x, c.body.pos.y, c.body.pos.z);
    b.site = this.map.inSite(b.pos);
    b.explodeAt = this.time + BOMB_TIME;
    b.nextBeep = this.time;
    this.bombMesh.position.copy(b.pos);
    this.bombMesh.rotation.y = Math.random() * Math.PI;
    this.bombMesh.visible = true;
    c.money = Math.min(16000, c.money + 300);
    this.hud.banner('The bomb has been planted', `Site ${b.site}`, 'T', 3);
    if (this.net) this.net.emit({ e: 'plant', s: b.site });
    this.director.onPlanted(b.site, b.pos);
  }

  defuse(c) {
    const b = this.bomb;
    b.state = 'defused';
    c.money = Math.min(16000, c.money + 300);
    this.endRound('CT', 'Bomb defused');
  }

  explode() {
    const b = this.bomb;
    b.state = 'exploded';
    this.bombMesh.visible = false;
    this.fx.explosion(_v.copy(b.pos).setY(b.pos.y + 0.5));
    this.sound.explosion(b.pos);
    if (this.net) this.net.emit({ e: 'boom', p: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z)] });
    for (const c of this.combatants) {
      if (!c.alive) continue;
      const d = c.body.pos.distanceTo(b.pos);
      if (d < 26) {
        const dmg = 500 * Math.pow(1 - d / 26, 1.6);
        if (dmg > 1) this.applyDamage(c, null, dmg, { name: 'Bomb', melee: true, reward: 0 }, false, _d.set(0, 1, 0));
      }
    }
    this.endRound('T', 'Target destroyed');
  }

  updateBomb(dt) {
    const b = this.bomb;
    if (b.state === 'dropped') {
      for (const c of this.combatants) {
        if (!c.alive || c.team !== 'T') continue;
        if (Math.hypot(c.body.pos.x - b.pos.x, c.body.pos.z - b.pos.z) < 1.0 && Math.abs(c.body.pos.y - b.pos.y) < 1.5) {
          c.hasBomb = true; b.state = 'carried'; b.carrier = c;
          this.bombMesh.visible = false;
          this.tell(c, { e: 'snd', n: 'pickup' });
          this.tell(c, { e: 'msg', s: 'You picked up the bomb', d: 2 });
          this.director.onPickedUp(c);
          break;
        }
      }
    }
    // plant / defuse progress
    for (const c of this.combatants) {
      if (!c.alive) { c.useProgress = 0; continue; }
      let ok = false;
      if (c.wantsUse && this.phase === 'live') {
        if (c.team === 'T' && c.hasBomb && c.body.onGround && this.map.inSite(c.body.pos)) ok = 'plant';
        else if (c.team === 'CT' && b.state === 'planted' && c.body.pos.distanceTo(b.pos) < 1.6) ok = 'defuse';
      }
      if (!ok) { c.useProgress = 0; continue; }
      const prev = c.useProgress;
      c.useProgress += dt;
      if ((c === this.player || c.isAvatar) && Math.floor(prev * 3) !== Math.floor(c.useProgress * 3)) this.tell(c, { e: 'snd', n: 'plantTick' });
      if (ok === 'plant' && c.useProgress >= PLANT_TIME) this.plant(c);
      if (ok === 'defuse' && c.useProgress >= DEFUSE_TIME) { c.useProgress = 0; this.defuse(c); }
    }
    this.bombBlink();
    if (b.state === 'planted' && b.explodeAt - this.time <= 0 && this.phase === 'live') this.explode();
  }

  // the planted bomb's blinking light and beeps
  bombBlink() {
    const b = this.bomb;
    if (b.state !== 'planted') return;
    const left = b.explodeAt - this.time;
    this.bombLed.visible = Math.floor(this.time * (left < 10 ? 6 : 2)) % 2 === 0;
    if (this.time >= b.nextBeep && this.phase === 'live') {
      this.sound.beep(b.pos);
      b.nextBeep = this.time + Math.max(0.12, Math.min(1, left / 30));
    }
  }

  useInfo() {
    const p = this.player;
    if (!p.alive || p.useProgress <= 0) return null;
    if (p.team === 'T') return { label: 'PLANTING', frac: p.useProgress / PLANT_TIME };
    return { label: 'DEFUSING', frac: p.useProgress / DEFUSE_TIME };
  }

  hintText() {
    const p = this.player, b = this.bomb;
    if (!p.alive) return '';
    if (p.team === 'T' && p.hasBomb && this.phase === 'live' && this.map.inSite(p.body.pos) && p.useProgress === 0) return 'Hold E to plant the bomb';
    if (p.team === 'CT' && b.state === 'planted' && p.body.pos.distanceTo(b.pos) < 1.6 && p.useProgress === 0) return 'Hold E to defuse';
    if (this.canBuy(p) && !p.buyOpen && this.phase === 'freeze') return 'Press B to buy';
    return '';
  }

  // ---------- rounds ----------
  endRound(winner, reason) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.phaseEnd = this.time + END_DELAY;
    this.score[winner]++;
    const loser = winner === 'T' ? 'CT' : 'T';
    const bonus = reason === 'Bomb defused' || reason === 'Target destroyed' ? 3500 : 3250;
    const lossBonus = Math.min(3400, 1400 + 500 * this.lossStreak[loser]);
    this.lossStreak[winner] = 0; this.lossStreak[loser]++;
    for (const c of this.combatants) {
      let add = c.team === winner ? bonus : lossBonus;
      if (c.team === 'T' && loser === 'T' && this.bomb.state === 'planted') add += 800;
      c.money = Math.min(16000, c.money + add);
    }
    this.showRoundEnd(winner, reason);
    if (this.net) this.net.emit({ e: 'end', w: winner, why: reason, sc: [this.score.T, this.score.CT] });
    if (this.score[winner] >= this.roundsToWin) this.matchOver = winner;
  }

  showRoundEnd(winner, reason) {
    const title = winner === 'CT' ? 'Counter-Terrorists Win' : 'Terrorists Win';
    this.hud.banner(title, reason, winner, END_DELAY);
    this.sound.roundEnd(winner === this.player.team);
    this.player.buyOpen = false;
  }

  checkWin() {
    if (this.phase !== 'live') return;
    const t = this.aliveCount('T'), ct = this.aliveCount('CT');
    const planted = this.bomb.state === 'planted';
    const hasT = this.combatants.some((c) => c.team === 'T'), hasCT = this.combatants.some((c) => c.team === 'CT');
    if (ct === 0 && hasCT) return this.endRound('T', 'All enemies eliminated');
    if (t === 0 && hasT && !planted) return this.endRound('CT', 'All enemies eliminated');
    if (!planted && this.time >= this.roundEnd) return this.endRound('CT', 'Time ran out');
  }

  // ---------- spectating & camera ----------
  nextSpectate(current) {
    const p = this.player;
    const mates = this.combatants.filter((c) => c.alive && c !== p && c.team === p.team);
    const pool = mates.length ? mates : this.combatants.filter((c) => c.alive && c !== p);
    if (!pool.length) return null;
    const i = pool.indexOf(current);
    return pool[(i + 1) % pool.length];
  }

  updateSpectate() {
    if (this.player.alive) return;
    if (this.input.mouseHit(0) || (this.spectateSwitchAt && this.time >= this.spectateSwitchAt) || (this.spectating && !this.spectating.alive && !this.spectateSwitchAt)) {
      this.spectating = this.nextSpectate(this.spectating);
      this.spectateSwitchAt = 0;
    }
  }

  // Per rendered frame: aim with the mouse.
  frame() { this.player?.look(); }

  // Per rendered frame: place the camera and models between the last two physics ticks.
  interpolate(alpha) {
    for (const b of this.bots) if (b.alive) b.renderPos(b.model.root.position, alpha);
    this.updateCamera(alpha);
    this.sound.setListener(this.camera.position, this.player.alive ? this.player.yaw : this.camera.rotation.y);
  }

  updateCamera(alpha = 1) {
    const p = this.player, cam = this.camera;
    if (p.alive) {
      p.renderEye(cam.position, alpha);
      cam.rotation.set(p.pitch + p.punch, p.yaw, 0);
      const fov = p.scoped ? (p.weapon?.def.zoomFov || this.scopeFov) : this.baseFov;
      if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
      return;
    }
    if (cam.fov !== this.baseFov) { cam.fov = this.baseFov; cam.updateProjectionMatrix(); }
    if (this.spectating) chaseCamera(cam, this.spectating, alpha, this.map.colliders);
  }

  // ---------- main update ----------
  // One physics tick.
  update(dt) {
    if (!this.running) return;
    this.time += dt;
    for (const c of this.combatants) c.prevPos.copy(c.body.pos);
    if (this.phase === 'freeze' && this.time >= this.phaseEnd) {
      this.phase = 'live';
      this.hud.center('GO GO GO', 1.2);
      if (this.net) this.net.emit({ e: 'live' });
    } else if (this.phase === 'end' && this.time >= this.phaseEnd) {
      if (this.matchOver) {
        this.running = false;
        if (this.net) this.net.emit({ e: 'over', w: this.matchOver, sc: [this.score.T, this.score.CT] });
        this.onMatchOver?.(this.matchOver);
        return;
      }
      this.startRound();
    }

    this.player.update(dt);
    for (const a of this.avatars) a.update(dt);
    for (const b of this.bots) b.update(dt);
    this.director.update();
    this.separate();
    this.updateBomb(dt);
    this.checkWin();
    this.updateSpectate();
    this.player.updateWeapon(dt);
  }

  // Push overlapping fighters apart. Network-driven fighters stay put (their own browser
  // keeps them clear), so only the other one moves.
  separate() {
    const cs = this.combatants;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]; if (!a.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j]; if (!b.alive) continue;
        const am = a.isAvatar ? 0 : 1, bm = b.isAvatar ? 0 : 1;
        if (!am && !bm) continue;
        const dx = b.body.pos.x - a.body.pos.x, dz = b.body.pos.z - a.body.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.7 && Math.abs(a.body.pos.y - b.body.pos.y) < 1.5) {
          const push = (0.7 - d) / (am + bm);
          const nx = dx / d, nz = dz / d;
          a.body.pos.x -= nx * push * am; a.body.pos.z -= nz * push * am;
          b.body.pos.x += nx * push * bm; b.body.pos.z += nz * push * bm;
        }
      }
    }
  }

  // ---------- online (host side) ----------
  // Feedback meant for one player: shown here for you, sent to their browser for others.
  tell(c, ev) {
    if (c === this.player) this.feedback(ev);
    else if (c.isAvatar && this.net) this.net.emitTo(c.pid, ev);
  }

  feedback(ev) {
    if (ev.e === 'msg') this.hud.center(String(ev.s), ev.d || 2);
    else if (ev.e === 'snd' && NET_SOUNDS.has(ev.n)) this.sound[ev.n]();
  }

  // the host changed what a player carries: send them the full list
  syncInv(c, hint) {
    if (!c.isAvatar || !this.net) return;
    c.invVer++;
    this.net.emitTo(c.pid, { e: 'inv', ver: c.invVer, cur: c.slot, s: packSlots(c), h: hint });
  }

  netUpdate(dt) { this.net?.update(dt, () => this.snapshot()); }

  // what every player's browser needs to draw the match
  snapshot() {
    const c = this.combatants.map((x) => {
      let f = 0;
      if (x.alive) f |= F.ALIVE;
      if (x.crouching) f |= F.CROUCH;
      if (x.body.onGround) f |= F.GROUND;
      if (x.hasBomb) f |= F.BOMB;
      if (x.scoped) f |= F.SCOPE;
      if (this.time < x.spottedUntil) f |= F.SPOT;
      // a remote player's newest position, so others see them with less delay
      const s = (x.isAvatar && x.interp.latest) || null;
      const pos = s || x.body.pos, w = x.weapon;
      return [x.nid, r2(pos.x), r2(pos.y), r2(pos.z), r3(s ? s.yaw : x.yaw), r3(s ? s.pitch : x.pitch), f,
        Math.max(0, Math.ceil(x.health)), Math.ceil(x.armor), w ? w.key : '', r2(x.useProgress)];
    });
    const b = this.bomb;
    const snap = {
      T: r3(this.time), ph: this.phase, pe: r2(this.phaseEnd), re: r2(this.roundEnd), ls: r2(this.liveStart),
      sc: [this.score.T, this.score.CT], c,
      b: [b.state, r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), b.carrier ? b.carrier.nid : -1, r2(b.explodeAt)],
    };
    this.snapN = (this.snapN || 0) + 1;
    if (this.snapN % 6 === 1) snap.m = this.combatants.map((x) => [x.nid, x.money, x.kills, x.deaths]);
    return snap;
  }

  // a message from a player's browser
  onNet(pid, msg) {
    const c = this.avatars.find((a) => a.pid === pid);
    if (!c || !this.running) return;
    if (msg.st) c.netState(msg.st, this.time);
    if (Array.isArray(msg.ev)) for (const ev of msg.ev) this.onPlayerEvent(c, ev);
  }

  onPlayerEvent(c, ev) {
    switch (ev?.e) {
      case 'shot':
        if (!c.alive) return;
        showShot(this, c, ev);
        this.emitNoise(c.body.pos, 45, c);
        this.net.emit({ e: 'shot', n: c.nid, s: ev.s, d: ev.d }, c.pid);
        break;
      case 'knife':
        if (!c.alive) return;
        this.sound.knife(c.body.pos);
        this.net.emit({ e: 'knife', n: c.nid }, c.pid);
        break;
      case 'hit': this.remoteHit(c, ev); break;
      case 'buy': this.buy(c, ev.i | 0); break;
    }
  }

  // a player says their shot hit someone: trust it (it's a game among friends), within limits
  remoteHit(att, ev) {
    const v = this.byNid.get(ev.v), def = WEAPONS[ev.w];
    if (!v || !def || !att.alive || !v.alive || v.team === att.team) return;
    const max = def.melee ? 180 : def.damage * (def.headMult || 4);
    const dmg = Math.min(max, Math.max(0, +ev.d || 0));
    if (!dmg) return;
    const dir = Array.isArray(ev.dir) ? _d.set(+ev.dir[0] || 0, +ev.dir[1] || 0, +ev.dir[2] || 0) : _d.set(0, 0, 0);
    if (dir.lengthSq() < 1e-6) dir.subVectors(v.body.pos, att.body.pos);
    dir.normalize();
    v.chestPos(_v2); this.fx.blood(_v2, dir);
    this.applyDamage(v, att, dmg, def, !!ev.h, dir);
  }

  // someone left mid-match
  removePlayer(pid) {
    const c = this.avatars.find((a) => a.pid === pid);
    if (!c) return;
    if (c.alive && c.hasBomb) this.dropBomb(c);
    c.alive = false;
    c.dispose();
    this.avatars = this.avatars.filter((a) => a !== c);
    this.combatants = this.combatants.filter((a) => a !== c);
    this.byNid.delete(c.nid);
    if (this.spectating === c) this.spectating = this.nextSpectate(null);
    this.hud.center(`${c.name} left the game`, 2.5);
    this.net?.emit({ e: 'left', n: c.nid });
  }
}
