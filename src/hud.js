// DOM-based heads-up display: vitals, ammo, radar, kill feed, menus.
import { WORLD } from './map.js';
import { BUY_ITEMS, WEAPONS, ZOMBIE_SHOP, ZOMBIE_PRICES, ammoCost } from './weapons.js';
import { drawCrosshair, crosshairScale } from './crosshair.js';
import { PERKS, AREAS, ZW, FL, GUN_SHOP } from './zmap.js';

// Zombies map (M): marker colors for you and up to three teammates
const MAP_COLORS = ['#ffd36a', '#7fd4ff', '#a6ff8a', '#ff9ad8'];
const ROMAN = ['', 'I', 'II', 'III', 'IV'];

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

    // (aiming down sights in Zombies: the gun's own sights take over)
    this.toggle('crosshair', !!(p.alive && !p.scoped && w && p.adsK() < 0.5));
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
    // the boss's health bar, across the top of the screen
    const bz = g.phase !== 'over' && g.zombies.find((z) => z.active && z.alive && z.kind === 'boss');
    this.zBoss(bz ? { name: bz.bossName || 'BOSS', color: bz.bossColor || '#ff5a1a',
      frac: Math.max(0, Math.min(1, bz.puppet ? bz.hpFrac ?? 1 : bz.health / bz.maxHealth)) } : null);
    const spec = !p.alive && g.phase !== 'over' && g.spectating;
    this.spectate(spec ? `Spectating <b>${esc(spec.name)}</b><small>You'll be back next round &middot; click to switch player</small>` : null);
    const shop = !!p.buyOpen && g.canBuy(p);
    this.toggle('buymenu', shop);
    if (shop) this.renderZShop(g);
    this.zMap(g);
  }

  // b: { name, color, frac } or null (hidden)
  zBoss(b) {
    let e = this.bossEl;
    if (!e) {
      if (!b) return;
      e = this.bossEl = document.createElement('div');
      e.id = 'z-boss'; e.innerHTML = '<b></b><div class="bar"><i></i></div>';
      this.el.appendChild(e);
    }
    e.style.display = b ? '' : 'none';
    if (!b) return;
    if (this.cache.bossName !== b.name) { this.cache.bossName = b.name; e.firstChild.textContent = b.name; e.style.setProperty('--boss', b.color); }
    const w = (b.frac * 100).toFixed(1) + '%';
    if (this.cache.bossW !== w) { this.cache.bossW = w; e.querySelector('i').style.width = w; }
  }

  // ---------- Zombies map (M): rooms you've opened, doors and their prices, and where everyone is ----------
  zMap(g) {
    const open = !!g.mapOpen;
    this.toggle('zmap', open);
    if (!open) return;
    const cv = $('zmap-canvas'), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, devicePixelRatio || 1), pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    // the rooms and doors only change when a door opens: drawn once, then copied every frame
    const key = `${g.map.doors.map((d) => (d.open ? 1 : 0)).join('')}|${pw}x${ph}`;
    if (this.zmapKey !== key) { this.zmapKey = key; this.zmapBase = this.drawMapBase(g, W, H, dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(this.zmapBase, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = W / ZW;
    // everyone still in the game: an arrow the way they face, or a red cross when they're down
    const list = [];
    g.players.forEach((q, i) => {
      const color = MAP_COLORS[i % MAP_COLORS.length], me = q === g.player;
      const where = !q.alive ? 'out until next round' : (g.map.areaAt(q.body.pos) || 'on the path') + (q.body.pos.y > FL - 1 ? ' (upstairs)' : '');
      list.push(`<span class="zm-p${me ? ' me' : ''}${q.downed ? ' down' : ''}"><i style="background:${color}"></i>${esc(me ? 'You' : q.name)}`
        + `<small>${esc(where)}${q.downed ? ' · DOWN' : ''}</small></span>`);
      if (!q.alive) return;
      const x = q.body.pos.x * k, z = q.body.pos.z * k;
      ctx.save(); ctx.translate(x, z);
      if (me) {   // a pulsing ring so you find yourself straight away
        const t = (performance.now() / 900) % 1;
        ctx.strokeStyle = `rgba(255,211,106,${(1 - t) * 0.9})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 8 + t * 14, 0, 7); ctx.stroke();
      }
      if (q.downed) {
        ctx.fillStyle = '#e8261a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(-7, -2.5, 14, 5); ctx.rect(-2.5, -7, 5, 14); ctx.fill();
        ctx.strokeRect(-7.5, -7.5, 15, 15);
      } else {
        ctx.rotate(-q.yaw);
        ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
        const s = me ? 1.25 : 1;
        ctx.beginPath(); ctx.moveTo(0, -9 * s); ctx.lineTo(6.5 * s, 7 * s); ctx.lineTo(0, 3.5 * s); ctx.lineTo(-6.5 * s, 7 * s); ctx.closePath();
        ctx.stroke(); ctx.fill();
      }
      ctx.restore();
      if (g.players.length > 1) {
        ctx.font = '700 13px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = color;
        const name = me ? 'YOU' : q.name;
        ctx.strokeText(name, x, z + 11); ctx.fillText(name, x, z + 11);
      }
    });
    const html = list.join('');
    if (this.cache.zmapList !== html) { this.cache.zmapList = html; $('zmap-list').innerHTML = html; }
  }

  // The static part of the map: every floor cell (lit up where you can get to, hatched where you
  // can't yet), walls inside the open areas, stairs, closed doors with the round they open after,
  // room names, the Gun Shop and the machines.
  drawMapBase(g, W, H, dpr) {
    const map = g.map, GW = map.gw, GH = map.gh, k = W / ZW, s = map.cell * k;
    const c = document.createElement('canvas'); c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reach = map.reachable();
    const locked = new Path2D();
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      const i = z * GW + x;
      if (!map.floorCell(i)) continue;
      const up = map.upper[i] === 1;
      ctx.fillStyle = reach[i] ? (up ? '#5c7f9c' : '#8a7550') : (up ? '#2c3540' : '#33302c');
      ctx.fillRect(x * s, z * s, s + 0.6, s + 0.6);
      if (!reach[i]) locked.rect(x * s, z * s, s, s);
    }
    // locked: diagonal hatching
    ctx.save(); ctx.clip(locked);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    for (let d = -H; d < W; d += 7) { ctx.beginPath(); ctx.moveTo(d, H); ctx.lineTo(d + H, 0); ctx.stroke(); }
    ctx.restore();
    // thin walls between floor cells (huts, the watchtower, the upstairs rooms)
    ctx.strokeStyle = 'rgba(20,16,12,0.95)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      const i = z * GW + x;
      if (!map.floorCell(i)) continue;
      if (x + 1 < GW && map.edgeX[i] && map.floorCell(i + 1)) { ctx.moveTo((x + 1) * s, z * s); ctx.lineTo((x + 1) * s, (z + 1) * s); }
      if (z + 1 < GH && map.edgeZ[i] && map.floorCell(i + GW)) { ctx.moveTo(x * s, (z + 1) * s); ctx.lineTo((x + 1) * s, (z + 1) * s); }
    }
    ctx.stroke();
    // stairs: treads across the way up, and an arrow pointing up them
    for (const st of map.stairs) {
      const x0 = st.x0 * k, z0 = st.z0 * k, x1 = st.x1 * k, z1 = st.z1 * k, [ux, uz] = st.up;
      ctx.fillStyle = 'rgba(230,220,200,0.35)'; ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
      ctx.strokeStyle = 'rgba(30,24,18,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath();
      const n = 7;
      for (let j = 1; j < n; j++) {
        if (ux) { const x = x0 + (x1 - x0) * j / n; ctx.moveTo(x, z0); ctx.lineTo(x, z1); }
        else { const z = z0 + (z1 - z0) * j / n; ctx.moveTo(x0, z); ctx.lineTo(x1, z); }
      }
      ctx.stroke();
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, a = 0.32 * Math.max(x1 - x0, z1 - z0);
      ctx.strokeStyle = '#fff3d6'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - ux * a, cz - uz * a); ctx.lineTo(cx + ux * a, cz + uz * a);
      ctx.lineTo(cx + ux * a * 0.55 - uz * 4, cz + uz * a * 0.55 + ux * 4);
      ctx.moveTo(cx + ux * a, cz + uz * a); ctx.lineTo(cx + ux * a * 0.55 + uz * 4, cz + uz * a * 0.55 - ux * 4);
      ctx.stroke();
    }
    // room outlines and names. The upstairs rooms are small on the map: smaller names near the top
    // of each room (clear of the doors in the middle), and one "UPSTAIRS" tag over all three.
    const wrap = (text, size, maxW) => {
      ctx.font = `700 ${size}px Rajdhani, sans-serif`;
      const lines = [];
      for (const w of text.split(' ')) {
        const last = lines[lines.length - 1];
        if (last && ctx.measureText(last + ' ' + w).width <= maxW) lines[lines.length - 1] = last + ' ' + w; else lines.push(w);
      }
      return lines;
    };
    const label = (lines, x, y, size, color) => {   // y: middle of the first line
      ctx.font = `700 ${size}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = color;
      lines.forEach((l, j) => { const ly = y + j * size * 0.95; ctx.strokeText(l, x, ly); ctx.fillText(l, x, ly); });
    };
    let upBox = null;
    for (const [id, a] of Object.entries(AREAS)) {
      const [x0, z0, x1, z1] = a.rect, on = g.activeAreas?.has(id), w = (x1 - x0) * s;
      ctx.strokeStyle = on ? (a.upper ? 'rgba(170,215,255,0.8)' : 'rgba(255,214,140,0.65)') : 'rgba(150,150,160,0.35)';
      ctx.lineWidth = 1.5; ctx.setLineDash(a.upper ? [5, 3] : []);
      ctx.strokeRect(x0 * s + 0.75, z0 * s + 0.75, w - 1.5, (z1 - z0) * s - 1.5);
      ctx.setLineDash([]);
      const cx = (x0 + x1) / 2 * s, color = on ? '#fff3d6' : 'rgba(210,205,195,0.6)';
      if (a.upper) {
        upBox = upBox ? [Math.min(upBox[0], x0), z0, Math.max(upBox[2], x1)] : [x0, z0, x1];
        const size = Math.max(9, Math.min(12, s * 0.6)), lines = wrap(a.name, size, w - 4), top = z0 * s + size * 0.5 + 3;
        label(lines, cx, top, size, color);
        if (!on) label([`AFTER R${a.after}`], cx, top + lines.length * size * 0.95 + 1, 9, 'rgba(255,150,120,0.8)');
      } else {
        const size = Math.max(11, Math.min(17, s * 0.85)), lines = wrap(a.name, size, w - 6);
        const top = (z0 + z1) / 2 * s - (lines.length - 1) * size * 0.475;
        label(lines, cx, top, size, color);
        if (!on) label([`AFTER ROUND ${a.after}`], cx, top + lines.length * size * 0.95 + 4, 11, 'rgba(255,150,120,0.75)');
      }
    }
    if (upBox) {   // a blue tag over the upstairs rooms
      const t = 'UPSTAIRS · 2F', cx = (upBox[0] + upBox[2]) / 2 * s, cz = upBox[1] * s - 9;
      ctx.font = '700 11px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(t).width + 10;
      ctx.fillStyle = 'rgba(20,34,48,0.92)'; ctx.fillRect(cx - w / 2, cz - 7, w, 14);
      ctx.strokeStyle = 'rgba(170,215,255,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(cx - w / 2, cz - 7, w, 14);
      ctx.fillStyle = '#bfe2ff'; ctx.fillText(t, cx, cz + 0.5);
    }
    // machines: Mystery Box, Pack-a-Punch (by level), perks
    const dot = (x, z, r, fill, text, ink = '#111') => {
      ctx.beginPath(); ctx.arc(x * k, z * k, r, 0, 7); ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.stroke();
      ctx.font = `700 ${Math.round(r * 1.05)}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = ink; ctx.fillText(text, x * k, z * k + 0.5);
    };
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    for (const pm of map.perkMachines) dot(pm.pos[0], pm.pos[2], 7.5, hex(pm.color), pm.short);
    for (const st of map.papStations) {
      const x = st.pos[0] * k, z = st.pos[2] * k;
      ctx.save(); ctx.translate(x, z); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = hex(st.color); ctx.fillRect(-6.5, -6.5, 13, 13);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeRect(-6.5, -6.5, 13, 13);
      ctx.restore();
      ctx.font = '700 10px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#111';
      ctx.fillText(ROMAN[st.level], x, z + 0.5);
    }
    {
      const bx = map.box.pos[0] * k, bz = map.box.pos[2] * k;
      ctx.fillStyle = '#66b8ff'; ctx.fillRect(bx - 8, bz - 6, 16, 12);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeRect(bx - 8, bz - 6, 16, 12);
      ctx.font = '700 12px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#0b1a2a';
      ctx.fillText('?', bx, bz + 0.5);
    }
    {   // the Gun Shop (where you spawn): a gold block over the hut
      const [x0, z0, x1, z1] = GUN_SHOP.rect.map((v) => v * k);
      ctx.fillStyle = 'rgba(255,198,92,0.85)'; ctx.fillRect(x0 + 1, z0 + 1, x1 - x0 - 2, z1 - z0 - 2);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeRect(x0 + 1, z0 + 1, x1 - x0 - 2, z1 - z0 - 2);
      const size = Math.max(9, Math.min(12, (x1 - x0) * 0.22));
      ctx.font = `700 ${size}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1a1209';
      ctx.fillText('GUN', (x0 + x1) / 2, (z0 + z1) / 2 - size * 0.48);
      ctx.fillText('SHOP', (x0 + x1) / 2, (z0 + z1) / 2 + size * 0.52);
    }
    // closed doors: a plank bar across the way, and the round they open after
    for (const d of map.doors) {
      if (d.open) continue;
      let x0, z0, x1, z1;
      if (d.edgeX) { const x = (d.edgeX[0] + 1) * s, z = d.edgeX[1] * s; [x0, z0, x1, z1] = [x - 2.5, z + 1, x + 2.5, z + s - 1]; }
      else {
        const [cx0, cz0, cx1, cz1] = d.cells, spanX = (cx1 - cx0) >= (cz1 - cz0), m = spanX ? d.center.z * k : d.center.x * k;
        [x0, z0, x1, z1] = spanX ? [cx0 * s + 1, m - 2.5, cx1 * s - 1, m + 2.5] : [m - 2.5, cz0 * s + 1, m + 2.5, cz1 * s - 1];
      }
      ctx.fillStyle = '#c8783a'; ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeRect(x0, z0, x1 - x0, z1 - z0);
      ctx.font = '700 11px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const t = `R${d.after}`, w = ctx.measureText(t).width + 8, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      ctx.fillStyle = 'rgba(24,14,6,0.92)'; ctx.fillRect(cx - w / 2, cz - 7, w, 14);
      ctx.strokeStyle = '#c8783a'; ctx.strokeRect(cx - w / 2, cz - 7, w, 14);
      ctx.fillStyle = '#ffd9a0'; ctx.fillText(t, cx, cz + 0.5);
    }
    return c;
  }

  // Zombies: the Gun Shop menu (guns, keys 1-9, one more unlocked every round you survive) or the
  // B menu (ammo for the guns you carry, keys 1-2 like their slots)
  renderZShop(g) {
    const p = g.player;
    const row = (k, name, cat, right, cls) => `<div class="buy-row ${cls}"><span class="k">${k}</span><span class="n">${name}</span>`
      + `<span class="c">${cat}</span><span class="p">${right}</span></div>`;
    let html;
    if (p.gunShop) {
      const cleared = g.cleared();
      const rows = ZOMBIE_SHOP.map((it, i) => {
        const locked = cleared < it.after, s = locked ? 0 : g.ownedSlot(p, it.key);
        if (locked) return row(i + 1, WEAPONS[it.key].name, it.cat, `AFTER ROUND ${it.after}`, 'lock');
        if (s) {   // already carried: buying it again refills its ammo
          const w = p.slots[s], full = w.reserve >= w.def.reserve, cost = ammoCost(w);
          return row(i + 1, esc(w.def.name), 'Owned', full ? 'FULL' : `AMMO ${cost}`, full || p.points >= cost ? 'own' : 'no');
        }
        const price = ZOMBIE_PRICES[it.key];
        return row(i + 1, WEAPONS[it.key].name, it.cat, price, p.points < price ? 'no' : '');
      }).join('');
      const next = ZOMBIE_SHOP.find((it) => it.after > cleared);
      html = `<h3>GUN SHOP <span class="z">${p.points}</span></h3>${rows}<div class="buy-foot">1-9 buy &middot; E or B to close`
        + `${next ? ` &middot; next gun after round ${next.after}` : ''}<br>B anywhere buys ammo</div>`;
    } else {
      let rows = '';
      for (const s of [1, 2]) {
        const w = p.slots[s];
        if (!w || w.def.melee) continue;
        const full = w.reserve >= w.def.reserve, cost = ammoCost(w);
        rows += row(s, esc(w.def.name), w === p.weapon ? 'In hand' : '', full ? 'FULL' : cost, full ? 'own' : p.points < cost ? 'no' : '');
      }
      if (!rows) rows = '<div class="buy-row lock"><span class="n">No guns to refill</span></div>';
      html = `<h3>AMMO <span class="z">${p.points}</span></h3>${rows}<div class="buy-foot">1-2 refill that gun &middot; B to close`
        + '<br>Buy guns at the Gun Shop in the Courtyard</div>';
    }
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
