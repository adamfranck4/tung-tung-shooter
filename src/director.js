// Team strategy for bots: how the Terrorists attack each round, where the Counter-Terrorists
// set up, rotations, and bomb reactions.
//
// Every round the Terrorists pick a plan, and avoid repeating the last few:
//   rush     - all together down one route, no stopping
//   execute  - quietly gather out of sight on one route, then hit the site at once
//   split    - half come from each route into the same site, timed to arrive together
//   default  - spread out for map control, then "call" a site (the one that looks weaker)
//   fake     - a couple of bots make noise at one site to pull rotations, the rest hit the other
// Executes, splits and defaults sometimes leave a lurker on the far side, who takes the other
// site once the hit starts and watches for rotating CTs. Bots also shift-walk (silently) on the
// last stretch of a quiet approach, and CTs can rotate back if they fall for a fake.
import * as THREE from 'three';
import { ENTRANCES, PLANT_SPOTS, CT_HOLDS, T_ROUTES, T_CONTROL } from './map.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rand = (a, b) => a + Math.random() * (b - a);
const otherSite = (s) => (s === 'A' ? 'B' : 'A');
function weighted(list) {
  let r = Math.random() * list.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of list) { r -= w; if (r <= 0) return v; }
  return list[0][0];
}
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// CT setups: [weight, roles]
const CT_SETUPS = [
  [4, ['A', 'B', 'A', 'B', 'MID']],   // 2-1-2
  [1, ['A', 'A', 'A', 'B', 'MID']],   // stack A
  [1, ['B', 'B', 'B', 'A', 'MID']],   // stack B
  [1, ['A', 'B', 'A', 'B', 'B']],     // no one mid
];

export class Director {
  constructor(game) {
    this.g = game;
    this.plan = null;
    this.history = [];           // last few plans, to avoid running the same one again
    this.sites = [];             // sites hit in recent rounds
    this.rotatedTo = null; this.rotatedAt = -99;
    this.seen = { A: new Set(), B: new Set() };
  }

  planRound() {
    const g = this.g;
    this.rotatedTo = null; this.rotatedAt = -99;
    this.seen = { A: new Set(), B: new Set() };
    this.planT(g.bots.filter((b) => b.team === 'T'));
    this.planCT(g.bots.filter((b) => b.team === 'CT'));
  }

  // ---------------------------------------------------------------- Counter-Terrorists
  planCT(cts) {
    const g = this.g;
    const roles = shuffle(weighted(CT_SETUPS.map(([w, r]) => [r, w])).slice());
    const used = new Set();
    cts.forEach((b, i) => {
      const r = roles[i % roles.length];
      const options = CT_HOLDS[r].filter((h) => !used.has(h));
      const h = pick(options.length ? options : CT_HOLDS[r]);
      used.add(h);
      b.role = r;
      b.setObjective({ pos: h.pos.clone(), look: h.look, kind: 'hold', site: r });
      b.waitUntil = g.phaseEnd + Math.random() * 1.5;
    });
  }

  // ---------------------------------------------------------------- Terrorists
  rollPlan(n) {
    const type = weighted([['rush', 1], ['execute', 1.3], ['split', n >= 2 ? 1 : 0], ['default', 1.2], ['fake', n >= 3 ? 0.9 : 0]]);
    let site = Math.random() < 0.5 ? 'A' : 'B';
    // three hits on the same site in a row gets predictable
    if (this.sites.length >= 2 && this.sites.slice(-2).every((s) => s === site) && Math.random() < 0.8) site = otherSite(site);
    const route = pick(Object.keys(T_ROUTES[site]));
    const sig = type === 'default' ? 'default' : type === 'split' ? `split:${site}` : `${type}:${site}:${route}`;
    return { type, site, route, sig };
  }

  planT(ts) {
    const g = this.g;
    if (!ts.length) { this.plan = null; return; }
    let roll = this.rollPlan(ts.length);
    for (let i = 0; i < 6 && this.history.includes(roll.sig); i++) roll = this.rollPlan(ts.length);
    this.history.push(roll.sig);
    if (this.history.length > 3) this.history.shift();

    const start = g.phaseEnd;
    const P = this.plan = {
      ...roll, phase: 'move', quiet: Math.random() < 0.55,
      deadline: start + rand(24, 34),   // a gathering group goes by now even if someone is late
      goAt: Infinity, callAt: Infinity, fakeAt: Infinity, lurkAt: Infinity,
      count: ts.length,
    };
    if (roll.type !== 'default') this.sites.push(roll.site);
    if (this.sites.length > 3) this.sites.shift();

    // roles: the bomb carrier is always with the main group
    const order = shuffle(ts.slice()).sort((a, b) => (b.hasBomb ? 1 : 0) - (a.hasBomb ? 1 : 0));
    for (const b of order) { b.tRole = 'main'; b.tRoute = null; b.lurkSite = null; }
    const spare = () => order.filter((b) => b.tRole === 'main' && !b.hasBomb).pop();
    // (fakes already send people to the far side, so they don't need a lurker)
    if (roll.type !== 'rush' && roll.type !== 'fake' && order.length >= 4 && Math.random() < 0.4) spare().tRole = 'lurk';
    if (roll.type === 'fake') {
      for (let i = order.length >= 5 ? 2 : 1; i > 0; i--) { const f = spare(); if (f) f.tRole = 'fake'; }
    }
    const mains = order.filter((b) => b.tRole === 'main');
    const stagger = (b, max) => { b.waitUntil = start + Math.random() * max; };

    switch (roll.type) {
      case 'rush': {
        const r = T_ROUTES[roll.site][roll.route];
        for (const b of mains) { b.tRoute = r; b.setObjective(this.hitObjective(b, roll.site, r, true)); stagger(b, 1.2); }
        P.phase = 'go';
        break;
      }
      case 'execute':
      case 'split': {
        const names = Object.keys(T_ROUTES[roll.site]);
        mains.forEach((b, i) => {
          const name = roll.type === 'split' ? names[i % names.length] : roll.route;
          b.tRoute = T_ROUTES[roll.site][name];
          b.setObjective(this.stageObjective(b.tRoute, P.quiet));
          stagger(b, 3);
        });
        P.phase = 'gather';
        break;
      }
      case 'default': {
        const spots = shuffle(T_CONTROL.slice());
        mains.forEach((b, i) => {
          const s = spots[i % spots.length];
          b.setObjective({ pos: this.jitter(s.pos, 1.5), look: s.look, kind: 'control', quiet: Math.random() < 0.5 ? 16 : 0 });
          stagger(b, 3);
        });
        P.phase = 'control';
        P.callAt = start + rand(18, 42);
        break;
      }
      case 'fake': {
        const fakeSite = otherSite(roll.site);
        P.fakeSite = fakeSite;
        for (const b of order.filter((x) => x.tRole === 'fake')) {
          b.tRoute = T_ROUTES[fakeSite][pick(Object.keys(T_ROUTES[fakeSite]))];
          b.setObjective(this.stageObjective(b.tRoute, false));   // fakers are meant to be heard
          stagger(b, 1);
        }
        const r = T_ROUTES[roll.site][roll.route];
        for (const b of mains) { b.tRoute = r; b.setObjective(this.stageObjective(r, true)); stagger(b, 3); }
        P.phase = 'fake';
        P.fakeAt = start + rand(10, 16);
        P.goAt = P.fakeAt + rand(4, 8);
        break;
      }
    }
    // the lurker waits quietly on the far side
    for (const b of order.filter((x) => x.tRole === 'lurk')) {
      const s = otherSite(roll.type === 'default' ? pick(['A', 'B']) : roll.site);
      b.lurkSite = s;
      b.tRoute = T_ROUTES[s][pick(Object.keys(T_ROUTES[s]))];
      b.setObjective(this.stageObjective(b.tRoute, true));
      stagger(b, 4);
    }
  }

  // a point near p that bots can stand on, so a group doesn't walk in single file
  jitter(p, r) {
    const map = this.g.map;
    for (let i = 0; i < 10; i++) {
      const x = p.x + (Math.random() * 2 - 1) * r, z = p.z + (Math.random() * 2 - 1) * r;
      if (map.walkablePoint(x, z)) return new THREE.Vector3(x, p.y, z);
    }
    return p.clone();
  }

  // walk the route to its staging spot and wait there
  stageObjective(r, quiet) {
    return { pos: this.jitter(r.stage, 2.2), via: r.via.map((p) => this.jitter(p, 1.2)), look: r.look, kind: 'stage', quiet: quiet ? 24 : 0 };
  }

  // into the site through the route's entry: the bomb carrier to a plant spot, the rest to cover
  hitObjective(b, site, r, fromSpawn = false) {
    const via = [...(fromSpawn ? [...r.via, r.stage] : []), r.entry].map((p) => this.jitter(p, 1.2));
    if (b.hasBomb) return { pos: pick(PLANT_SPOTS[site]).clone(), via, look: pick(ENTRANCES[site]), kind: 'plant', site };
    return { pos: this.g.map.randomPointInSite(site), via, look: pick(ENTRANCES[site]), kind: 'hold', site };
  }

  // the route into `site` that starts closest to where b is now
  nearestRoute(b, site) {
    let best = null, bd = Infinity;
    for (const r of Object.values(T_ROUTES[site])) {
      const d = flat(b.body.pos, r.stage);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  aliveT() { return this.g.bots.filter((b) => b.team === 'T' && b.alive); }

  // Called every tick on the host: moves the plan along.
  update() {
    const g = this.g, P = this.plan;
    if (!P || g.phase !== 'live' || g.bomb.state === 'planted') return;
    const t = g.time, ts = this.aliveT();
    const late = g.roundEnd - t < 32;   // running out of time: go now
    const mains = ts.filter((b) => b.tRole === 'main' || b.hasBomb);

    if (P.phase === 'control') {
      // losing someone early speeds up the call
      if (ts.length < P.count && P.callAt > t + 5) P.callAt = t + rand(2, 5);
      if (t >= P.callAt || late) this.call();
    } else if (P.phase === 'gather') {
      const ready = mains.every((b) => b.objective?.kind === 'stage' && b.arrived);
      if (ready && P.goAt === Infinity) P.goAt = t + rand(0.8, 3.5);   // a short pause, then go
      if (t >= P.goAt || t >= P.deadline || late) this.release();
    } else if (P.phase === 'fake') {
      if (t >= P.fakeAt) this.pushFake();
      if (t >= P.goAt || late) this.release();
    }
    if (t >= P.lurkAt) { P.lurkAt = Infinity; this.lurkersGo(); }
  }

  // default round: pick the site, gather on the nearest route to it, then hit
  call() {
    const g = this.g, P = this.plan;
    const a = this.seen.A.size, b = this.seen.B.size;
    // go where fewer CTs have been seen, most of the time
    P.site = a !== b && Math.random() < 0.7 ? (a < b ? 'A' : 'B') : pick(['A', 'B']);
    this.sites.push(P.site);
    if (this.sites.length > 3) this.sites.shift();
    for (const bot of this.aliveT()) {
      if (bot.tRole === 'lurk' && !bot.hasBomb) {
        if (bot.lurkSite === P.site) { bot.lurkSite = otherSite(P.site); bot.tRoute = this.nearestRoute(bot, bot.lurkSite); bot.setObjective(this.stageObjective(bot.tRoute, true)); }
        continue;
      }
      bot.tRole = 'main';
      bot.tRoute = this.nearestRoute(bot, P.site);
      bot.setObjective(this.stageObjective(bot.tRoute, Math.random() < 0.5));
    }
    P.phase = 'gather';
    P.goAt = Infinity;
    P.deadline = g.time + rand(10, 15);
  }

  // the fakers show themselves at the fake site
  pushFake() {
    const P = this.plan;
    P.fakeAt = Infinity;
    for (const b of this.aliveT()) {
      if (b.tRole !== 'fake' || b.hasBomb) continue;
      const r = b.tRoute || this.nearestRoute(b, P.fakeSite);
      b.setObjective({ pos: this.jitter(r.entry, 2), via: [], look: pick(ENTRANCES[P.fakeSite]), kind: 'hold', site: P.fakeSite });
    }
  }

  // the hit: everyone in the main group goes into the site together
  release() {
    const g = this.g, P = this.plan;
    if (P.phase === 'go') return;
    P.phase = 'go';
    for (const b of this.aliveT()) {
      if (b.tRole === 'lurk' && !b.hasBomb) continue;
      if (b.tRole === 'fake' && !b.hasBomb) {
        // fakers either join the real hit or stay to keep the other site busy
        if (Math.random() < 0.5) b.queueObjective({ pos: g.map.randomPointInSite(P.site), look: pick(ENTRANCES[P.site]), kind: 'hold', site: P.site }, rand(0, 2));
        else b.queueObjective({ pos: g.map.randomPointInSite(P.fakeSite), look: pick(ENTRANCES[P.fakeSite]), kind: 'hold', site: P.fakeSite }, rand(0, 2));
        continue;
      }
      const r = b.tRoute && Object.values(T_ROUTES[P.site]).includes(b.tRoute) ? b.tRoute : this.nearestRoute(b, P.site);
      b.queueObjective(this.hitObjective(b, P.site, r), rand(0, 0.7));
    }
    P.lurkAt = g.time + rand(4, 10);
  }

  // once the hit is on, the lurker takes the other site and watches the CT rotation door
  lurkersGo() {
    const g = this.g;
    for (const b of this.aliveT()) {
      if (b.tRole !== 'lurk' || b.hasBomb || !b.lurkSite) continue;
      const s = b.lurkSite, r = b.tRoute || this.nearestRoute(b, s);
      b.setObjective({ pos: g.map.randomPointInSite(s), via: [this.jitter(r.entry, 1.2)], look: ENTRANCES[s][0], kind: 'hold', site: s });
    }
  }

  // ---------------------------------------------------------------- events
  onSpotted(observer, enemy) {
    const g = this.g;
    if (observer.team === 'T') {
      // remember which site the CTs seem to be guarding (used to call a site on default rounds)
      const s = g.map.siteNear(enemy.body.pos, 24);
      if (s) this.seen[s].add(enemy);
      return;
    }
    if (g.bomb.state === 'planted') return;
    const s = g.map.siteNear(enemy.body.pos, 14);
    if (!s || s === this.rotatedTo) return;
    // CTs can rotate back if they fell for a fake, but not every few seconds
    if (this.rotatedTo && g.time - this.rotatedAt < 5) return;
    this.rotatedTo = s; this.rotatedAt = g.time;
    for (const b of g.bots) {
      if (b.team !== 'CT' || !b.alive || b.role === s) continue;
      if (Math.random() < 0.25) continue; // someone stays behind
      b.queueObjective({ pos: g.map.randomPointInSite(s), look: pick(ENTRANCES[s]), kind: 'hold', site: s }, 1 + Math.random() * 3);
      b.role = s;
    }
  }

  onPlanted(site, pos) {
    const g = this.g;
    if (this.plan) this.plan.phase = 'post';
    for (const b of g.bots) {
      if (!b.alive) continue;
      if (b.team === 'T') {
        b.setObjective({ pos: g.map.randomPointInSite(site, pos, 10), look: pick(ENTRANCES[site]), kind: 'hold', site });
      } else {
        b.queueObjective({ pos: pos.clone(), look: pos.clone().setY(0.5), kind: 'defuse', site }, Math.random() * 1.5);
      }
    }
  }

  onDropped(pos) {
    const g = this.g;
    let best = null, bd = Infinity;
    for (const b of g.bots) {
      if (b.team !== 'T' || !b.alive) continue;
      const d = b.body.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) best.setObjective({ pos: pos.clone(), look: null, kind: 'pickup' });
  }

  onPickedUp(c) {
    if (!c.isBot) return;
    const P = this.plan;
    c.tRole = 'main';
    if (!P || !P.site || P.phase === 'control') {
      // no site called yet: wait at the nearest map-control spot until the call
      let best = T_CONTROL[0], bd = Infinity;
      for (const s of T_CONTROL) { const d = flat(c.body.pos, s.pos); if (d < bd) { bd = d; best = s; } }
      c.setObjective({ pos: this.jitter(best.pos, 1.5), look: best.look, kind: 'control' });
      return;
    }
    if (P.phase === 'gather' || P.phase === 'fake') {
      c.tRoute = this.nearestRoute(c, P.site);
      c.setObjective(this.stageObjective(c.tRoute, false));
      return;
    }
    const s = P.site;
    c.setObjective({ pos: pick(PLANT_SPOTS[s]).clone(), look: pick(ENTRANCES[s]), kind: 'plant', site: s });
  }
}
