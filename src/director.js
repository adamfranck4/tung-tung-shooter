// Team strategy for bots: where to go each round, rotations, and bomb reactions.
import { ENTRANCES, PLANT_SPOTS, CT_HOLDS } from './map.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Director {
  constructor(game) { this.g = game; this.rotated = false; this.tSite = 'A'; }

  planRound() {
    const g = this.g;
    this.rotated = false;
    const ts = g.bots.filter((b) => b.team === 'T');
    const cts = g.bots.filter((b) => b.team === 'CT');
    const site = Math.random() < 0.5 ? 'A' : 'B';
    const other = site === 'A' ? 'B' : 'A';
    const split = Math.random() < 0.3;
    this.tSite = site;
    ts.forEach((b, i) => {
      const s = b.hasBomb ? site : (split && i % 2 === 1 ? other : site);
      const pos = b.hasBomb ? pick(PLANT_SPOTS[s]).clone() : g.map.randomPointInSite(s);
      b.setObjective({ pos, look: pick(ENTRANCES[s]), kind: b.hasBomb ? 'plant' : 'hold', site: s });
      b.waitUntil = g.phaseEnd + Math.random() * 4;
    });
    const roles = shuffle(['A', 'B', 'A', 'B', 'MID']);
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

  onSpotted(observer, enemy) {
    const g = this.g;
    if (this.rotated || observer.team !== 'CT' || g.bomb.state === 'planted') return;
    const s = g.map.siteNear(enemy.body.pos, 14);
    if (!s) return;
    this.rotated = true;
    for (const b of g.bots) {
      if (b.team !== 'CT' || !b.alive || b.role === s) continue;
      if (Math.random() < 0.25) continue; // someone stays behind
      b.queueObjective({ pos: g.map.randomPointInSite(s), look: pick(ENTRANCES[s]), kind: 'hold', site: s }, 1 + Math.random() * 3);
      b.role = s;
    }
  }

  onPlanted(site, pos) {
    const g = this.g;
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
    const s = this.tSite;
    c.setObjective({ pos: pick(PLANT_SPOTS[s]).clone(), look: pick(ENTRANCES[s]), kind: 'plant', site: s });
  }
}
