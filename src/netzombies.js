// Zombies co-op on a joining player's browser. The host runs the zombies, doors, box and
// power-ups; this side moves its own player, reports hits and button presses, and draws the
// shared world from the host's snapshots.
import * as THREE from 'three';
import { ZombiesGame, Zombie } from './zombies.js';
import { WEAPONS } from './weapons.js';
import { F, r1, r2, r3, packSlots, applyInventory, showShot } from './avatar.js';

const _v = new THREE.Vector3();
const PERK_IDS = new Set(['quick', 'speed', 'dtap', 'jugg']);

export class ZombiesClient extends ZombiesGame {
  startNet({ knife = 'knife', net, roster }) {
    this.stop();
    this.net = net; this.netDelay = 0.1;
    this.running = true; this.phase = 'live'; this.time = 0; this.synced = false;
    this.map.resetDoors();
    this.activeAreas = new Set(['A']);
    this.round = 0;
    this.effects = { instakill: 0, double: 0 };
    this.interaction = null; this.spectating = null;
    this.setupPlayers(roster, net.myId, knife);
    this.player.spawnEpoch = 0; this.player.invVer = 0;
    this.resetBox();
    this.betweenRounds = true; this.nextRoundAt = 2.5;
    this.hud.zReset(this);
    this.introBanner();
  }

  // One physics tick: only your own player is simulated here.
  update(dt) {
    if (!this.running) return;
    this.time += dt;
    const p = this.player;
    p.prevPos.copy(p.body.pos);
    for (const z of this.zombies) if (z.active) z.prevPos.copy(z.body.pos);
    for (const a of this.remotes) a.update(dt);
    for (const z of this.zombies) if (z.active) z.puppetUpdate(dt);
    if (this.phase === 'over') {
      this.overT -= dt;
      if (this.overT <= 0) { this.running = false; this.onGameOver?.(this.finalStats()); }
      return;
    }
    if (this.betweenRounds && this.input.pressed('KeyN') && this.time < this.nextRoundAt) this.net.emit({ e: 'next' });
    if (p.alive) {
      if (p.downed) { p.eyeH += (0.55 - p.eyeH) * Math.min(1, dt * 6); p.applyMovement(dt, 0, 0, 1, false); }
      else p.update(dt);
      p.updateWeapon(dt);
    }
    this.separate();
    this.updateInteract();
    this.animatePowerups(dt);
    this.animateBox(dt);
    this.map.updateDoors(dt);
    this.updateSpectate();
  }

  // keep yourself out of the zombies (they are placed by the host)
  separate() {
    const p = this.player;
    if (!p.alive || p.downed) return;
    const pp = p.body.pos;
    for (const z of this.zombies) {
      if (!z.active || !z.alive) continue;
      const zp = z.body.pos;
      const dx = zp.x - pp.x, dz = zp.z - pp.z, d = Math.hypot(dx, dz);
      const minD = 0.4 + 0.35 * z.scale;
      if (d > 0.001 && d < minD && Math.abs(zp.y - pp.y) < 1.5) {
        const push = (minD - d) * 0.5;
        pp.x -= dx / d * push; pp.z -= dz / d * push;
      }
    }
  }

  // Pressing E asks the host; holding E (boards, reviving) is sent with every state update.
  updateInteract() {
    const p = this.player;
    this.interaction = this.findInteraction(p);
    const it = this.interaction;
    if (!it || !this.input.pressed('KeyE') || it.type === 'window' || it.type === 'revive') return;
    const req = { e: 'use', k: it.type };
    if (it.type === 'door') req.id = it.d.id;
    else if (it.type === 'wallbuy') req.id = this.map.wallBuys.indexOf(it.wb);
    else if (it.type === 'perk') req.id = it.pm.id;
    this.net.emit(req);
  }

  hitZombie(z, dmg, head, melee, quiet, attacker, knock) {
    if (attacker !== this.player) return;
    const ev = { e: 'zh', z: z.netId, d: r1(dmg), h: head ? 1 : 0, m: melee ? 1 : 0, q: quiet ? 1 : 0 };
    if (melee && knock) ev.k = [r2(knock.x), r2(knock.z)];
    this.net.emit(ev);
    if (!quiet) { this.hud.hit(head); this.sound.hit(head); }
  }

  // ---------- network ----------
  netUpdate(dt) { this.net.update(dt, () => this.stateMsg()); }

  stateMsg() {
    const p = this.player;
    let f = 0;
    if (p.alive) f |= F.ALIVE;
    if (p.crouching) f |= F.CROUCH;
    if (p.body.onGround) f |= F.GROUND;
    if (this.input.down('KeyE')) f |= F.USE;
    if (p.scoped) f |= F.SCOPE;
    return {
      ep: p.spawnEpoch || 0, p: [r2(p.body.pos.x), r2(p.body.pos.y), r2(p.body.pos.z)], y: r3(p.yaw), pi: r3(p.pitch), f,
      iv: p.invVer || 0, cur: p.slot, s: packSlots(p),
    };
  }

  onNet(from, msg) {
    if (!this.running) return;
    if (Array.isArray(msg.ev)) for (const ev of msg.ev) this.onHostEvent(ev);
    if (msg.s && this.running) this.applySnapshot(msg.s);
  }

  puppet(id) {
    while (this.zombies.length <= id) { const z = new Zombie(this); z.netId = this.zombies.length; this.zombies.push(z); }
    return this.zombies[id];
  }

  applySnapshot(s) {
    if (!this.synced || Math.abs(s.T - this.time) > 0.5) { this.time = s.T; this.synced = true; }
    else this.time += (s.T - this.time) * 0.1;
    if (this.phase === 'over') return;
    this.round = s.r; this.betweenRounds = !!s.br; this.nextRoundAt = s.nr;
    this.effects.instakill = s.ef[0]; this.effects.double = s.ef[1];
    // players
    for (const e of s.p) {
      const q = this.byNid(e[0]);
      if (!q) continue;
      const f = e[6], wasDown = q.downed;
      q.health = e[7]; q.maxHealth = e[8]; q.points = e[9]; q.kills = e[11];
      q.downT = e[12]; q.reviveFrac = e[13];
      q.downed = !!(f & F.DOWN);
      q.perks = new Set(String(e[10]).split(',').filter((x) => PERK_IDS.has(x)));
      if (q === this.player) {
        q.reloadMul = q.perks.has('speed') ? 0.5 : 1;
        q.rateMul = q.perks.has('dtap') ? 0.75 : 1;
        if (!wasDown && q.downed) { q.scoped = false; q.reloading = false; }
        if (wasDown && !q.downed && q.alive) q.eyeH = 1.65;
        if (q.alive && !(f & F.ALIVE)) { q.alive = false; q.downed = false; this.spectating = this.nextSpectate(null); }
        continue;
      }
      q.interp.push(s.T, e[1], e[2], e[3], e[4], e[5]);
      q.netFlags = f;
      q.show(e[14], e[15]);
      if (q.alive && !(f & F.ALIVE)) { q.alive = false; q.downed = false; q.onDeath(); }
    }
    // zombies
    const seen = new Set();
    for (const e of s.z) {
      const z = this.puppet(e[0]);
      seen.add(z);
      z.netUpdate(s.T, e);
    }
    for (const z of this.zombies) if (z.active && !seen.has(z)) z.deactivate();
    // window boards (a lost board breaks with a crack)
    for (let i = 0; i < this.map.windows.length; i++) {
      const w = this.map.windows[i], n = +s.wb[i];
      if (!Number.isFinite(n) || n === w.boards) continue;
      if (n < w.boards) { this.sound.boardBreak(w.center); this.fx.burst(w.boardMeshes[w.boards - 1].position, 0xa47a4c, 8, 3); }
      this.map.setBoards(w, n);
    }
    // mystery box
    const [bst, bw, bown] = s.bx, b = this.map.box;
    if (bst !== b.state) {
      b.t = 0; b.nextSwap = 0;
      if (bst === 'ready' && WEAPONS[bw]) { b.weapon = bw; this.map.setBoxLabel(WEAPONS[bw].name, bw === 'raygun' ? '#7dff8a' : '#ffd36a'); }
      b.label.visible = bst !== 'idle';
      b.state = bst;
    }
    b.owner = this.byNid(bown);
    // power-ups
    const keep = new Set();
    for (const [id, type, x, y, z, t] of s.pu) {
      let pu = this.powerups.find((q) => q.id === id);
      if (!pu) { pu = this.addPowerup(id, type, new THREE.Vector3(x, y, z)); pu.t = t; }
      keep.add(pu);
    }
    for (const pu of this.powerups.slice()) if (!keep.has(pu)) this.removePowerup(pu);
  }

  onHostEvent(ev) {
    const c = this.byNid(ev.n);
    switch (ev.e) {
      case 'round':
        this.round = ev.r; this.betweenRounds = false;
        this.hud.zRound(ev.r, true); this.sound.zRoundStart();
        break;
      case 'rend':
        this.betweenRounds = true;
        this.sound.zRoundEnd(); this.hud.zRound(ev.r, true);
        this.hud.center(`Round ${ev.r} survived`, 3);
        break;
      case 'door': {
        const d = this.map.doors.find((x) => x.id === ev.id);
        if (d && !d.open) { this.map.openDoor(d); for (const a of d.areas) this.activeAreas.add(a); this.sound.boardBreak(d.center); }
        break;
      }
      case 'pu': this.powerupFx(ev.ty); break;
      case 'shot': if (c && c !== this.player) showShot(this, c, ev); break;
      case 'knife': if (c && c !== this.player) this.sound.knife(c.body.pos); break;
      case 'spawn':
        if (!c) break;
        _v.set(ev.x, ev.y, ev.z);
        if (c === this.player) {
          c.slots[2] = null;
          c.spawn(_v, ev.yaw);
          Object.assign(c, { spawnEpoch: ev.ep, eyeH: 1.65, downed: false });
          this.spectating = null;
        } else c.spawn(_v, ev.yaw);
        break;
      case 'over': this.onOver(ev); break;
      case 'left': this.removeRemote(ev.n); break;
      case 'inv': applyInventory(this.player, ev); break;
      default: this.feedback(ev);
    }
  }

  onOver(ev) {
    this.phase = 'over'; this.overT = 3.5;
    if (ev.r) this.round = ev.r;
    for (const [nid, kills, headshots, points, downs] of ev.st || []) {
      const q = this.byNid(nid);
      if (q) Object.assign(q, { kills, headshots, points, downs });
    }
    for (const q of this.players) { if (q.isAvatar && q.alive) q.onDeath(); q.alive = false; q.downed = false; q.scoped = false; q.health = 0; }
    this.hud.center('GAME OVER', 3.5);
    this.sound.roundEnd(false);
  }

  removeRemote(nid) {
    const q = this.byNid(nid);
    if (!q || q === this.player) return;
    q.dispose();
    this.remotes = this.remotes.filter((a) => a !== q);
    this.players = this.players.filter((a) => a !== q);
    this.combatants = this.players.slice();
    if (this.spectating === q) this.spectating = this.nextSpectate(null);
    this.hud.center(`${q.name} left the game`, 2.5);
  }
}
