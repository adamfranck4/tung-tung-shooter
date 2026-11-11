// 5v5 online, on a joining player's browser. The host runs the match; this side moves its own
// player, reports shots, hits and purchases to the host, and draws everyone else from the
// host's snapshots (about 25 a second, shown a tenth of a second behind so motion is smooth).
import * as THREE from 'three';
import { Game, leftWhy } from './game.js';
import { Avatar, F, r1, r2, r3, packSlots, applyInventory, showShot } from './avatar.js';
import { seal } from './guard.js';

const _v = new THREE.Vector3();

export class ClassicClient extends Game {
  startNet({ net, roster, knife = 'knife', roundsToWin = 8 }) {
    this.stop();
    this.net = net; this.netDelay = 0.1;
    this.time = 0; this.synced = false;
    this.roundsToWin = roundsToWin;
    this.score = { T: 0, CT: 0 };
    this.round = 0;
    const me = roster.find((r) => r.pid === net.myId);
    this.setupPlayer(me, knife);
    for (const r of roster) {
      const friend = r.team === me.team;
      let c = this.player;
      if (r !== me) {
        c = new Avatar(this, r, friend ? 'friend' : 'enemy');
        if (friend) { if (r.kind === 'human') c.addNameTag(r.name); else c.addMarker('#7ddf5a'); }
        c.model.root.visible = false;   // until the first round places everyone
        this.avatars.push(c);
      }
      this.combatants.push(c);
      this.byNid.set(r.nid, c);
    }
    this.phase = 'freeze'; this.phaseEnd = 0; this.liveStart = 0; this.roundEnd = 0;
    Object.assign(this.bomb, { state: 'none', carrier: null, site: null });
    this.bombMesh.visible = false;
    this.matchOver = false;
    this.running = true;
    this.waiting = true;           // nothing to do until the host starts round 1
    this.spectating = null;
    this.shotEnds = [];
    this.hud.clearFeed();
  }

  // One physics tick: only your own player is simulated here.
  update(dt) {
    if (!this.running) return;
    this.time += dt;
    if (this.waiting) return;
    const p = this.player;
    p.prevPos.copy(p.body.pos);
    p.update(dt);
    for (const a of this.avatars) a.update(dt);
    this.separate();
    p.settle();
    this.bombBlink();
    this.updateSpectate();
    p.updateWeapon(dt);
  }

  // the host decides these
  emitNoise() {}
  buy(c, index) { if (c === this.player) this.net.emit({ e: 'buy', i: index }); }
  dealDamage(victim, attacker, dmg, def, headshot, dir) {
    if (!victim.alive || attacker !== this.player) return;
    this.net.emit({ e: 'hit', v: victim.nid, d: r1(dmg), h: headshot ? 1 : 0, w: def.key, dir: [r3(dir.x), r3(dir.y), r3(dir.z)] });
    this.hud.hit(headshot); this.sound.hit(headshot);
  }

  // ---------- network ----------
  netUpdate(dt) { this.net.update(dt, () => this.stateMsg()); }

  stateMsg() {
    const p = this.player;
    let f = 0;
    if (p.alive) f |= F.ALIVE;
    if (p.crouching) f |= F.CROUCH;
    if (p.body.onGround) f |= F.GROUND;
    if (p.wantsUse) f |= F.USE;
    if (p.scoped) f |= F.SCOPE;
    return {
      ep: p.spawnEpoch || 0, p: [r2(p.body.pos.x), r2(p.body.pos.y), r2(p.body.pos.z)], y: r3(p.yaw), pi: r3(p.pitch), f,
      iv: p.invVer || 0, cur: p.slot, s: packSlots(p),
    };
  }

  onNet(from, msg) {
    if (!this.running && !this.waiting) return;
    if (Array.isArray(msg.ev)) for (const ev of msg.ev) this.onHostEvent(ev);
    if (msg.s) this.applySnapshot(msg.s);
  }

  applySnapshot(s) {
    // follow the host's clock (gently, so weapon timings don't jump)
    if (!this.synced || Math.abs(s.T - this.time) > 0.5) { this.time = s.T; this.synced = true; }
    else this.time += (s.T - this.time) * 0.1;
    this.phase = s.ph; this.phaseEnd = s.pe; this.roundEnd = s.re; this.liveStart = s.ls;
    this.score.T = s.sc[0]; this.score.CT = s.sc[1];
    for (const e of s.c) {
      const c = this.byNid.get(e[0]);
      if (!c) continue;
      const f = e[6];
      c.health = e[7]; c.armor = e[8];
      c.hasBomb = !!(f & F.BOMB);
      c.useProgress = e[10];
      if (c === this.player) continue;
      // out of your sight: the host doesn't say where they are, so hide them until it does
      if (f & F.HIDE) {
        c.hidden = true; c.model.root.visible = false; c.spottedUntil = 0;
        c.body.vel.x = c.body.vel.z = 0;
        continue;
      }
      if (c.hidden) { c.hidden = false; c.interp.clear(); c.model.root.visible = true; }
      // a jump no one can run (the host moved where it shows them): go there, don't slide there
      const l = c.interp.latest;
      if (l && (l.x - e[1]) ** 2 + (l.y - e[2]) ** 2 + (l.z - e[3]) ** 2 > 9) c.interp.clear();
      c.interp.push(s.T, e[1], e[2], e[3], e[4], e[5]);
      c.netFlags = f;
      c.scoped = !!(f & F.SCOPE);
      c.spottedUntil = f & F.SPOT ? this.time + 0.3 : 0;
      c.show(e[9]);
      if (!(f & F.ALIVE) && c.alive) { c.alive = false; c.onDeath(); }
    }
    if (s.m) for (const [nid, money, kills, deaths] of s.m) {
      const c = this.byNid.get(nid);
      if (c) { c.money = money; c.kills = kills; c.deaths = deaths; }
    }
    // the bomb
    const [st, bx, by, bz, carrier, explodeAt] = s.b, b = this.bomb;
    if (st === 'planted' && b.state !== 'planted') { b.nextBeep = this.time; this.bombMesh.rotation.y = Math.random() * Math.PI; }
    b.state = st; b.pos.set(bx, by, bz); b.explodeAt = explodeAt;
    b.carrier = this.byNid.get(carrier) || null;
    this.bombMesh.visible = st === 'dropped' || st === 'planted' || st === 'defused';
    this.bombMesh.position.copy(b.pos);
  }

  onHostEvent(ev) {
    const c = this.byNid.get(ev.n);
    switch (ev.e) {
      case 'round': this.onRound(ev); break;
      case 'live': this.phase = 'live'; this.hud.center('GO GO GO', 1.2); break;
      case 'end':
        this.phase = 'end';
        if (ev.sc) { this.score.T = ev.sc[0]; this.score.CT = ev.sc[1]; }
        this.showRoundEnd(ev.w, ev.why);
        break;
      case 'kill': this.onKill(ev); break;
      case 'shot': if (c && c !== this.player) showShot(this, c, ev); break;
      case 'knife': if (c && c !== this.player) this.sound.knife(Array.isArray(ev.o) ? _v.set(+ev.o[0] || 0, +ev.o[1] || 0, +ev.o[2] || 0) : c.body.pos); break;
      case 'plant': this.hud.banner('The bomb has been planted', `Site ${ev.s}`, 'T', 3); break;
      case 'boom':
        _v.set(ev.p[0], ev.p[1] + 0.5, ev.p[2]);
        this.fx.explosion(_v); this.sound.explosion(_v);
        this.bombMesh.visible = false;
        break;
      case 'over':
        if (ev.sc) { this.score.T = ev.sc[0]; this.score.CT = ev.sc[1]; }
        this.running = false;
        this.onMatchOver?.(ev.w);
        break;
      case 'left': this.removeAvatar(ev.n, ev.k | 0); break;
      case 'inv': applyInventory(this.player, ev); break;
      default: this.feedback(ev);
    }
  }

  feedback(ev) {
    if (ev.e === 'hurt') {
      const p = this.player;
      this.hud.damage(); this.sound.hurt();
      p.punch += 0.02;
      p.body.vel.x *= 0.5; p.body.vel.z *= 0.5; p.settle();
      return;
    }
    super.feedback(ev);
  }

  onRound(ev) {
    this.waiting = false;
    this.round = ev.r;
    this.fx.clear();
    this.phase = 'freeze'; this.phaseEnd = ev.ph; this.liveStart = ev.ls; this.roundEnd = ev.re;
    this.spectating = null; this.spectateSwitchAt = 0;
    this.player.buyOpen = false;
    // sides (they switch at halftime)
    if (Array.isArray(ev.tm)) {
      for (const [nid, team] of ev.tm) {
        const c = this.byNid.get(nid);
        if (c && (team === 'T' || team === 'CT')) c.team = team;
      }
      this.vm.setTeam(this.player.team);
    }
    if (ev.hf) { const p = this.player; p.slots[1] = null; p.slots[2] = null; p.armor = 0; }   // the host sends the new kit right after
    // hid: an enemy out of your sight (no position until the host sends one)
    for (const [nid, x, y, z, yaw, ep, hid] of ev.sp) {
      const c = this.byNid.get(nid);
      if (!c) continue;
      c.spawn(_v.set(x, y, z), yaw);
      if (c === this.player) { c.spawnEpoch = ep; continue; }
      c.hidden = !!hid; c.model.root.visible = !hid;
    }
    for (const c of this.combatants) c.hasBomb = c.nid === ev.c;
    Object.assign(this.bomb, { state: ev.c >= 0 ? 'carried' : 'none', carrier: this.byNid.get(ev.c) || null });
    this.bombMesh.visible = false;
    this.roundBanner(ev.c === this.player.nid, !!ev.hf);
    this.sound.roundStart();
  }

  onKill(ev) {
    const v = this.byNid.get(ev.v), a = this.byNid.get(ev.a) || null;
    if (!v) return;
    v.health = 0; v.alive = false; v.useProgress = 0; v.scoped = false;
    v.onDeath?.();
    this.hud.killfeed(a, v, ev.w, !!ev.h, a === this.player || v === this.player);
    if (v === this.player) {
      this.hud.center(a ? `Killed by ${a.name}${ev.h ? ' (headshot)' : ''}` : 'You died', 3);
      this.player.buyOpen = false;
      this.spectating = this.nextSpectate(null);
    } else if (this.spectating === v) this.spectateSwitchAt = this.time + 1.5;
  }

  removeAvatar(nid, k = 0) {
    const c = this.byNid.get(nid);
    if (!c || c === this.player) return;
    c.dispose();
    this.avatars = this.avatars.filter((a) => a !== c);
    this.combatants = this.combatants.filter((a) => a !== c);
    this.byNid.delete(nid);
    if (this.spectating === c) this.spectating = this.nextSpectate(null);
    this.hud.center(`${c.name} ${leftWhy(k)}`, 3);
  }
}
seal(ClassicClient);
