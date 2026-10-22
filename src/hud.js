// DOM-based heads-up display: vitals, ammo, radar, kill feed, menus.
import { WORLD } from './map.js';
import { BUY_ITEMS, WEAPONS, ZOMBIE_SHOP, ZOMBIE_PRICES, ammoCost } from './weapons.js';
import { drawCrosshair, crosshairScale } from './crosshair.js';
import { PERKS } from './zmap.js';

const $ = (id) => document.getElementById(id);
// player names come from other people online: never put them in HTML unescaped
export const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export class Hud {
  constructor() {
    this.el = $('hud');
    this.radar = $('radar'); this.rctx = this.radar.getContext('2d');
    this.cache = {};
    this.centerT = 0; this.bannerT = 0; this.hitT = 0; this.dmgT = 0;
    this.crossPreset = null;
    addEventListener('resize', () => this.drawCross());
  }

  // static crosshair: drawn once, never moves with spread
  setCrosshair(preset) { this.crossPreset = preset; this.drawCross(); }
  drawCross() { if (this.crossPreset) drawCrosshair($('crosshair'), this.crossPreset, crosshairScale(), 96, 96); }

  set(id, text) {
    if (this.cache[id] === text) return;
    this.cache[id] = text;
    $(id).textContent = text;
  }
  toggle(id, show) {
    const k = id + ':v';
    if (this.cache[k] === show) return;
    this.cache[k] = show;
    $(id).classList.toggle('hidden', !show);
  }
  show(on) { this.el.classList.toggle('hidden', !on); }

  center(text, dur = 2) { const e = $('center-msg'); e.textContent = text; e.style.opacity = 1; this.centerT = dur; }
  banner(title, sub, team, dur = 4) {
    const e = $('banner');
    e.className = team === 'CT' ? 'ct' : 't';
    $('banner-title').textContent = title; $('banner-sub').textContent = sub || '';
    e.style.opacity = 1; this.bannerT = dur;
  }
  hit(head) { const e = $('hitmarker'); e.classList.toggle('head', !!head); e.style.opacity = 1; this.hitT = 0.18; }
  damage() { $('damage-flash').style.opacity = 1; this.dmgT = 0.25; }

  killfeed(att, vic, weapon, head, mine) {
    const feed = $('killfeed');
    const d = document.createElement('div');
    d.className = 'kf' + (mine ? ' mine' : '');
    const sp = (cls, txt) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; return s; };
    if (att && att !== vic) d.appendChild(sp(att.team.toLowerCase(), att.name));
    d.appendChild(sp('w', weapon));
    d.appendChild(sp(vic.team.toLowerCase(), vic.name));
    if (head) d.appendChild(sp('hs', 'HS'));
    feed.appendChild(d);
    while (feed.children.length > 6) feed.removeChild(feed.firstChild);
    setTimeout(() => d.remove(), 7000);
  }
  clearFeed() { $('killfeed').innerHTML = ''; }

  update(dt, g) {
    const p = g.player;
    const zm = g.mode === 'zombies';
    if (this.cache.mode !== zm) { this.cache.mode = zm; this.el.classList.toggle('zombies', zm); }
    const fade = (key, id, prop = 'opacity') => {
      if (this[key] > 0) { this[key] -= dt; if (this[key] <= 0) $(id).style[prop] = 0; }
    };
    fade('centerT', 'center-msg'); fade('bannerT', 'banner'); fade('hitT', 'hitmarker');
    if (!zm) fade('dmgT', 'damage-flash');
    fade('flashT', 'white-flash');

    if (!zm) {
      // top bar
      const left = g.phase === 'freeze' ? g.phaseEnd - g.time
        : g.bomb.state === 'planted' ? g.bomb.explodeAt - g.time
        : g.phase === 'live' ? g.roundEnd - g.time : 0;
      const s = Math.max(0, Math.ceil(left));
      this.set('timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      const bombTimer = g.bomb.state === 'planted';
      if (this.cache.bombTimer !== bombTimer) { this.cache.bombTimer = bombTimer; $('timer').classList.toggle('bomb', bombTimer); }
      this.set('score-ct', String(g.score.CT)); this.set('score-t', String(g.score.T));
      this.set('alive-ct', g.aliveCount('CT') + ' alive'); this.set('alive-t', g.aliveCount('T') + ' alive');
      this.set('armor', String(Math.ceil(p.armor)));
      this.set('money', '$' + p.money);
      this.toggle('bomb-icon', p.hasBomb && p.alive);
    }

    // vitals + ammo
    this.set('hp', String(Math.max(0, Math.ceil(p.health))));
    this.toggle('ammo', p.alive);
    const w = p.weapon;
    if (w) {
      this.set('weapon-name', w.def.melee ? p.meleeName : w.def.name);
      this.set('ammo-mag', w.def.melee ? '—' : String(w.mag));
      this.set('ammo-res', w.def.melee ? '' : ' / ' + w.reserve);
      const empty = !w.def.melee && w.mag === 0;
      if (this.cache.empty !== empty) { this.cache.empty = empty; $('ammo').classList.toggle('empty', empty); }
    }
    const low = p.health <= 25;
    if (this.cache.low !== low) { this.cache.low = low; $('hp').parentElement.classList.toggle('low', low); }

    this.toggle('crosshair', !!(p.alive && !p.scoped && w));
    this.toggle('scope', p.alive && p.scoped);

    if (zm) { this.set('hint', g.hintText()); this.updateZombies(dt, g); return; }

    // plant / defuse progress
    this.progress(g.useInfo());
    this.set('hint', g.hintText());

    // spectating
    const spec = !p.alive && g.spectating;
    this.spectate(spec ? `Spectating <b>${esc(spec.name)}</b><small>Click to switch player</small>` : null);

    this.toggle('buymenu', p.buyOpen);
    if (p.buyOpen) this.renderBuy(g);
    this.toggle('scoreboard', g.input.down('Tab'));
    if (g.input.down('Tab')) this.renderScoreboard(g);
    this.drawRadar(g);
  }

  // progress bar: { label, frac } or null
  progress(prog) {
    this.toggle('progress', !!prog);
    if (!prog) return;
    this.set('progress-label', prog.label);
    $('progress-fill').style.width = (Math.max(0, Math.min(1, prog.frac)) * 100).toFixed(1) + '%';
    const warn = !!prog.warn;
    if (this.cache.pwarn !== warn) { this.cache.pwarn = warn; $('progress').classList.toggle('warn', warn); }
  }

  spectate(html) {
    this.toggle('spectate', !!html);
    if (html && this.cache.spec !== html) { this.cache.spec = html; $('spectate').innerHTML = html; }
  }

  // ---------- Zombies mode ----------
  updateZombies(dt, g) {
    const p = g.player;
    this.set('z-points', String(p.points));
    const perkKey = [...p.perks].join(',');
    if (this.cache.perks !== perkKey) {
      this.cache.perks = perkKey;
      $('z-perks').innerHTML = [...p.perks].map((id) => {
        const pm = PERKS.find((x) => x.id === id);
        return `<span class="perk" style="background:#${pm.color.toString(16).padStart(6, '0')}" title="${pm.name}">${pm.short}</span>`;
      }).join('');
    }
    const pu = ['instakill', 'double'].filter((k) => g.effects[k] > 0)
      .map((k) => `<span class="pu ${k}">${k === 'instakill' ? 'INSTA-KILL' : 'DOUBLE POINTS'} ${Math.ceil(g.effects[k])}</span>`).join('');
    if (this.cache.pu !== pu) { this.cache.pu = pu; $('z-powerups').innerHTML = pu; }
    // red vignette: recent hit, plus a steady glow when health is low
    if (this.dmgT > 0) this.dmgT -= dt;
    const missing = p.alive ? 1 - p.health / p.maxHealth : 1;
    const op = Math.max(this.dmgT > 0 ? this.dmgT / 0.25 : 0, Math.min(0.9, missing * 1.2 - 0.2), p.downed ? 0.8 : 0);
    const ops = op.toFixed(2);
    if (this.cache.vig !== ops) { this.cache.vig = ops; $('damage-flash').style.opacity = ops; }

    // co-op: teammates' points and status, revive / bleed-out bar, spectating
    let team = '';
    if (g.players.length > 1) {
      team = g.players.map((q) => {
        const st = !q.alive ? 'out' : q.downed ? 'down' : '';
        return `<div class="zt ${q === p ? 'me' : ''} ${st}"><span class="n">${esc(q.name)}</span>`
          + `<span class="s">${st === 'out' ? 'OUT' : st === 'down' ? 'DOWN' : ''}</span><span class="pts">${q.points}</span></div>`;
      }).join('');
    }
    if (this.cache.team !== team) { this.cache.team = team; $('z-team').innerHTML = team; }
    let prog = null;
    const it = g.interaction;
    if (g.phase !== 'over' && p.alive && p.downed && g.coop) {
      prog = p.reviveFrac > 0 ? { label: 'BEING REVIVED', frac: p.reviveFrac } : { label: 'BLEEDING OUT', frac: p.downT / g.bleedTime, warn: true };
    } else if (it?.type === 'revive' && it.who.reviveFrac > 0 && g.input.down('KeyE')) {
      prog = { label: `REVIVING ${it.who.name.toUpperCase()}`, frac: it.who.reviveFrac };
    }
    this.progress(prog);
    const spec = !p.alive && g.phase !== 'over' && g.spectating;
    this.spectate(spec ? `Spectating <b>${esc(spec.name)}</b><small>You'll be back next round &middot; click to switch player</small>` : null);
    const shop = !!p.buyOpen && g.canBuy(p);
    this.toggle('buymenu', shop);
    if (shop) this.renderZShop(g);
  }

  // Zombies shop: guns (keys 1-9) unlock as the rounds go by; 0 refills the gun in your hands
  renderZShop(g) {
    const p = g.player, r = Math.max(1, g.round);
    const row = (k, name, cat, right, cls) => `<div class="buy-row ${cls}"><span class="k">${k}</span><span class="n">${name}</span>`
      + `<span class="c">${cat}</span><span class="p">${right}</span></div>`;
    let rows = ZOMBIE_SHOP.map((it, i) => {
      const price = ZOMBIE_PRICES[it.key], locked = r < it.round, owned = !locked && !!g.ownedSlot(p, it.key);
      const cls = locked ? 'lock' : owned ? 'own' : p.points < price ? 'no' : '';
      return row(i + 1, WEAPONS[it.key].name, it.cat, locked ? `ROUND ${it.round}` : owned ? 'OWNED' : price, cls);
    }).join('');
    const w = g.ammoTarget(p);
    if (w) {
      const full = w.reserve >= w.def.reserve, cost = ammoCost(w);
      rows += row(0, `Ammo: ${esc(w.def.name)}`, 'Ammo', full ? 'FULL' : cost, full ? 'own' : p.points < cost ? 'no' : '');
    }
    const next = ZOMBIE_SHOP.find((it) => it.round > r);
    const html = `<h3>SHOP <span class="z">${p.points}</span></h3>${rows}<div class="buy-foot">1-9 buy a gun &middot; 0 ammo &middot; B to close`
      + `${next ? ` &middot; more guns at round ${next.round}` : ''}</div>`;
    if (this.cache.buy !== html) { this.cache.buy = html; $('buymenu').innerHTML = html; }
  }

  zReset(g) {
    this.cache = {};
    this.centerT = 0; $('center-msg').style.opacity = 0;
    $('z-round').textContent = '';
    $('z-pop').innerHTML = '';
    $('z-points').textContent = String(g.player.points);
    $('z-team').innerHTML = '';
  }

  zRound(r, pulse) {
    const e = $('z-round');
    e.textContent = r;
    if (pulse) { e.classList.remove('pulse'); void e.offsetWidth; e.classList.add('pulse'); }
  }

  zPoints(n) {
    const box = $('z-pop');
    const d = document.createElement('div');
    d.className = 'pop' + (n < 0 ? ' neg' : '');
    d.textContent = (n > 0 ? '+' : '') + n;
    d.style.bottom = (Math.random() * 16) + 'px';
    box.appendChild(d);
    while (box.children.length > 8) box.removeChild(box.firstChild);
    setTimeout(() => d.remove(), 900);
  }

  flash() { $('white-flash').style.opacity = 0.9; this.flashT = 0.15; }

  renderBuy(g) {
    const p = g.player;
    const rows = BUY_ITEMS.map((it, i) => {
      const price = it.price(p.team);
      const key = it.key?.(p.team);
      const owned = it.armor ? p.armor >= 100 : p.slots[WEAPONS[key].slot]?.key === key;
      const cls = owned ? 'own' : p.money < price ? 'no' : '';
      return `<div class="buy-row ${cls}"><span class="k">${i + 1}</span><span class="n">${it.label(p.team)}</span>`
        + `<span class="c">${it.cat}</span><span class="p">${owned ? 'OWNED' : '$' + price}</span></div>`;
    }).join('');
    const left = Math.max(0, Math.ceil(g.buyEnd() - g.time));
    const html = `<h3>BUY <span>$${p.money}</span></h3>${rows}<div class="buy-foot">Press 1-${BUY_ITEMS.length} to buy &middot; B to close &middot; ${left}s left</div>`;
    if (this.cache.buy !== html) { this.cache.buy = html; $('buymenu').innerHTML = html; }
  }

  renderScoreboard(g) {
    const team = (t) => {
      const list = g.combatants.filter((c) => c.team === t).sort((a, b) => b.kills - a.kills);
      const rows = list.map((c) => `<tr class="${t.toLowerCase()} ${c.alive ? '' : 'dead'} ${c === g.player ? 'me' : ''}">
        <td>${esc(c.name)}${g.net && (c.isBot || c.botSeat) ? ' <small>BOT</small>' : ''}${c.hasBomb && g.player.team === 'T' ? ' &middot; C4' : ''}</td>
        <td class="num">${c.team === g.player.team ? '$' + c.money : ''}</td>
        <td class="num">${c.kills}</td><td class="num">${c.deaths}</td></tr>`).join('');
      return `<div class="head ${t.toLowerCase()}">${t === 'CT' ? 'Counter-Terrorists' : 'Terrorists'} &mdash; ${g.score[t]}</div>
        <table><tr><th>Player</th><th class="num">Money</th><th class="num">K</th><th class="num">D</th></tr>${rows}</table>`;
    };
    const html = team('CT') + team('T');
    if (this.cache.sb !== html) { this.cache.sb = html; $('scoreboard').innerHTML = html; }
  }

  drawRadar(g) {
    const ctx = this.rctx, S = this.radar.width, k = S / WORLD;
    const p = g.player;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(g.map.radarImage, 0, 0, S, S);
    for (const c of g.combatants) {
      if (!c.alive || c === p) continue;
      const mate = c.team === p.team;
      if (!mate && g.time > c.spottedUntil) continue;
      ctx.fillStyle = mate ? (c.team === 'CT' ? '#7fb2ff' : '#ffc45e') : '#ff4a3a';
      ctx.beginPath(); ctx.arc(c.body.pos.x * k, c.body.pos.z * k, 3.6, 0, 7); ctx.fill();
      if (c === g.spectating) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    const b = g.bomb;
    if ((b.state === 'dropped' && p.team === 'T') || b.state === 'planted') {
      ctx.fillStyle = (b.state === 'planted' && Math.floor(g.time * 3) % 2) ? '#ff2a1a' : '#ff9e3d';
      ctx.fillRect(b.pos.x * k - 3.5, b.pos.z * k - 3.5, 7, 7);
    }
    if (p.alive) {
      const x = p.body.pos.x * k, z = p.body.pos.z * k;
      ctx.save(); ctx.translate(x, z); ctx.rotate(-p.yaw);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}
