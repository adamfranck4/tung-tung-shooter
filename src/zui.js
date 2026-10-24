// Zombies menus that use the mouse: the Gun Shop (E at its counter), your inventory (I) and the
// CS-style case opening. Plain DOM over the game: main.js frees the mouse while one is open (a solo
// game pauses; online the match keeps running behind it). Everything you do here goes through
// game.invAct(), which the host checks.
import * as THREE from 'three';
import { WEAPONS, RARITIES, rarityOf, caseOdds, rollCase, ZOMBIE_SHOP, ZOMBIE_PRICES, ammoCost, STASH_SIZE, sellValue } from './weapons.js';
import { displayGuns } from './viewmodel.js';
import { stashDef } from './zombies.js';
import { esc } from './hud.js';

const $ = (id) => document.getElementById(id);
const TIER = { common: 0, rare: 1, epic: 2, legendary: 3 };
const CAT = { 1: 'Primary', 2: 'Secondary' };
// what kind of gun it is, for the cards
function kindOf(def) {
  const k = def.key;
  if (k === 'minigun') return 'Minigun';
  if (k === 'torch') return 'Flamethrower';
  if (k === 'thumper') return 'Launcher';
  if (k === 'rail') return 'Railgun';
  if (k === 'petir' || k === 'raygun') return 'Wonder weapon';
  if (def.scope) return 'Sniper';
  if (def.pellets) return 'Shotgun';
  if (def.slot === 2) return 'Pistol';
  if (k === 'lmg') return 'LMG';
  if (['smg', 'micro', 'pdw'].includes(k)) return 'SMG';
  return 'Rifle';
}
// one line about what makes it special
function perkOf(def) {
  if (def.spin) return 'Spins up as you hold the trigger';
  if (def.chain) return `Lightning jumps to ${def.chain.jumps} more zombies`;
  if (def.flame) return 'Short-range fire that burns through crowds';
  if (def.pierce) return 'Goes through every zombie in a line';
  if (def.splash) return 'Explodes on impact';
  if (def.burst) return '3-round burst';
  return '';
}

// ---------- pictures: each gun model rendered once, side on; a drawn case for each rarity ----------
let ICONS = null;
function buildIcons() {
  ICONS = {};
  const W = 300, H = 130;
  let r;
  try { r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); } catch (_) { return; }
  r.setPixelRatio(1); r.setSize(W, H, false);
  r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a74, 3.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(0.4, 1, 1.4); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.4); fill.position.set(-1, 0.2, 1); scene.add(fill);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 30);
  const models = displayGuns(), bb = new THREE.Box3(), size = new THREE.Vector3(), c = new THREE.Vector3();
  const done = {};
  for (const [key, def] of Object.entries(WEAPONS)) {
    if (def.melee) continue;
    if (done[def.vm]) { ICONS[key] = done[def.vm]; continue; }
    const g = models[def.vm];
    if (!g) continue;
    g.rotation.set(0, -Math.PI / 2, 0); g.position.set(0, 0, 0);   // barrel to the right, its right side to us
    scene.add(g); g.updateMatrixWorld(true);
    bb.setFromObject(g); bb.getSize(size); bb.getCenter(c);
    const hw = Math.max(size.x / 2, (size.y / 2) * (W / H)) * 1.08;
    cam.left = -hw; cam.right = hw; cam.top = hw * H / W; cam.bottom = -hw * H / W;
    cam.position.set(c.x, c.y, c.z + 10); cam.lookAt(c); cam.updateProjectionMatrix();
    r.render(scene, cam);
    ICONS[key] = done[def.vm] = r.domElement.toDataURL('image/png');
    scene.remove(g);
  }
  r.dispose(); r.forceContextLoss?.();
}
export function gunIcon(key) { if (!ICONS) buildIcons(); return ICONS[key] || ''; }
export function warmIcons() { if (!ICONS) buildIcons(); }

const CASE_ICONS = {};
export function caseIcon(rarity) {
  if (CASE_ICONS[rarity]) return CASE_ICONS[rarity];
  const R = RARITIES[rarity], W = 300, H = 130, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  // handle
  ctx.strokeStyle = '#2a2c33'; ctx.lineWidth = 9; rr(118, 10, 64, 30, 10); ctx.stroke();
  // body with a rim
  const body = ctx.createLinearGradient(0, 30, 0, 124);
  body.addColorStop(0, '#4a4d57'); body.addColorStop(1, '#22242b');
  ctx.fillStyle = body; rr(46, 30, 208, 92, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3; ctx.stroke();
  // the rarity's color across the front, with a soft shine
  const band = ctx.createLinearGradient(0, 46, 0, 106);
  band.addColorStop(0, R.color); band.addColorStop(1, shade(R.color, 0.55));
  ctx.fillStyle = band; rr(60, 46, 180, 60, 8); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(64, 49, 172, 18, 6); ctx.fill();
  // latches
  ctx.fillStyle = '#c8ccd4';
  for (const x of [70, 214]) { rr(x, 24, 16, 16, 3); ctx.fill(); }
  // a big question mark
  ctx.fillStyle = 'rgba(10,10,14,0.75)'; ctx.font = '700 52px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('?', 150, 79);
  return (CASE_ICONS[rarity] = cv.toDataURL('image/png'));
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = (v) => Math.round(v * k).toString(16).padStart(2, '0');
  return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
}

// ---------- the case opening reel ----------
const STEP = 156;        // card width + gap, px
const CARDS = 48;        // cards on the strip
const WIN_AT = 40;       // the card it stops on
const SPIN_TIME = 5.6;   // seconds
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

export class ZMenu {
  constructor({ sound, onClose }) {
    this.sound = sound; this.onClose = onClose;
    this.el = $('zmenu'); this.box = $('zm-panel'); this.cs = $('zcase');
    this.game = null; this.tab = 'inv'; this.visible = false; this.sig = '';
    this.kase = null;    // the case screen: { id, rarity, state: 'preview' | 'wait' | 'spin' | 'done', ... }
    this.raf = 0;
    this.el.addEventListener('click', (e) => this.onClick(e));
    addEventListener('keydown', (e) => this.onKey(e));
  }

  get player() { return this.game?.player; }

  open(game, tab, online = false) {
    this.game = game; this.tab = tab; this.online = online;
    this.visible = true; this.sig = ''; this.kase = null; this.sellArm = 0;
    this.el.classList.remove('hidden'); this.cs.classList.add('hidden');
    warmIcons();
    this.render();
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const loop = () => {
      if (!this.visible) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  hide() {
    if (!this.visible) return;
    this.visible = false; this.kase = null;
    cancelAnimationFrame(this.raf);
    this.el.classList.add('hidden'); this.cs.classList.add('hidden');
  }

  close() { this.onClose?.(); }

  tick(dt) {
    const g = this.game, p = this.player;
    // you went down, the game ended...: the menu closes by itself
    if (!g?.running || g.phase === 'over' || !p?.alive || p.downed) { this.close(); return; }
    if (this.tab === 'shop' && !g.nearGunShop(p)) this.tab = 'inv';
    if (this.sellArm && performance.now() - this.sellArmT > 2500) this.sellArm = 0;   // a SELL click waits this long for its confirm
    this.render();
    this.updateCase(dt);
  }

  // ---------- the panel ----------
  render() {
    const g = this.game, p = this.player;
    if (!g || !p) return;
    const near = g.nearGunShop(p);
    const slots = [1, 2].map((s) => { const w = p.slots[s]; return w ? [w.key, w.def.pap || 0, w.mag, w.reserve] : 0; });
    const sig = JSON.stringify([this.tab, p.points, g.cleared(), near, slots, p.slot, p.stash, this.sellArm]);
    if (sig === this.sig) return;
    this.sig = sig;
    const tabs = `<button class="zm-tab${this.tab === 'shop' ? ' on' : ''}" data-act="tab" data-tab="shop"${near ? '' : ' disabled title="Go to the Gun Shop counter"'}>GUN SHOP</button>`
      + `<button class="zm-tab${this.tab === 'inv' ? ' on' : ''}" data-act="tab" data-tab="inv">INVENTORY <small>${p.stash.length}/${STASH_SIZE}</small></button>`;
    const foot = this.tab === 'shop'
      ? '1-9, 0 buy a gun &middot; E or Esc to close'
      : 'I or Esc to close';
    this.box.innerHTML = `<div class="zm-head"><div class="zm-tabs">${tabs}</div><div class="zm-pts">${p.points}<small>points</small></div>`
      + '<button class="zm-x" data-act="close" title="Close">&times;</button></div>'
      + `<div class="zm-body">${this.tab === 'shop' ? this.shopHTML(g, p) : this.invHTML(g, p)}</div>`
      + `<div class="zm-foot">${foot}${this.online ? ' &middot; the match keeps running while this is open' : ''}</div>`;
  }

  card({ rarity, img, name, sub, extra = '', buttons = '', cls = '', key = '' }) {
    const R = RARITIES[rarity];
    return `<div class="zc ${cls}" style="--rc:${R ? R.color : '#8a8a8a'}">${key ? `<span class="zc-k">${key}</span>` : ''}`
      + `<div class="zc-img">${img ? `<img src="${img}" alt="">` : ''}</div>`
      + `<div class="zc-n">${name}</div><div class="zc-c">${sub}</div>${extra}`
      + `${buttons ? `<div class="zc-b">${buttons}</div>` : ''}</div>`;
  }

  shopHTML(g, p) {
    const cleared = g.cleared();
    const gunCard = (it, i) => {
      const def = WEAPONS[it.key], rarity = rarityOf(it.key), locked = cleared < it.after, s = locked ? 0 : g.ownedSlot(p, it.key);
      let btn, cls = '';
      if (locked) { btn = `<button disabled>AFTER ROUND ${it.after}</button>`; cls = 'lock'; }
      else if (s) {   // already carried: buying it again refills its ammo
        const w = p.slots[s], full = w.reserve >= w.def.reserve, cost = ammoCost(w);
        btn = full ? '<button disabled>OWNED &middot; FULL</button>' : `<button data-act="gun" data-k="${it.key}"${p.points < cost ? ' class="poor"' : ''}>AMMO ${cost}</button>`;
      } else {
        const price = ZOMBIE_PRICES[it.key];
        btn = `<button data-act="gun" data-k="${it.key}"${p.points < price ? ' class="poor"' : ''}>BUY ${price}</button>`;
      }
      return this.card({ rarity, img: gunIcon(it.key), name: def.name, sub: `${RARITIES[rarity].name} &middot; ${it.cat}`, buttons: btn, cls, key: String((i + 1) % 10) });
    };
    const section = (rarity) => {
      const items = ZOMBIE_SHOP.map((it, i) => [it, i]).filter(([it]) => rarityOf(it.key) === rarity);
      return `<div class="zm-sec"><h4 style="--rc:${RARITIES[rarity].color}">${RARITIES[rarity].name.toUpperCase()} GUNS</h4>`
        + `<div class="zm-grid">${items.map(([it, i]) => gunCard(it, i)).join('')}</div></div>`;
    };
    let ammo = '';
    for (const s of [1, 2]) {
      const w = p.slots[s];
      if (!w || w.def.melee) { ammo += this.card({ img: '', name: 'Empty', sub: `Slot ${s}`, cls: 'empty' }); continue; }
      const full = w.reserve >= w.def.reserve, cost = ammoCost(w);
      ammo += this.card({
        rarity: rarityOf(w.key), img: gunIcon(w.key), name: esc(w.def.name), sub: `Slot ${s} &middot; ${w.mag} / ${w.reserve}`,
        buttons: full ? '<button disabled>FULL</button>' : `<button data-act="ammo" data-s="${s}"${p.points < cost ? ' class="poor"' : ''}>REFILL ${cost}</button>`,
      });
    }
    const next = ZOMBIE_SHOP.find((it) => it.after > cleared);
    return section('common') + section('rare')
      + `<div class="zm-sec"><h4>AMMO FOR YOUR GUNS</h4><div class="zm-grid two">${ammo}</div></div>`
      + `<p class="zm-note">${next ? `Next gun after round ${next.after}. ` : ''}Epic and legendary guns only come out of cases: buy them from the vending machines by the north door.</p>`;
  }

  invHTML(g, p) {
    const slotCard = (s) => {
      const w = p.slots[s];
      if (!w || w.def.melee) return this.card({ img: '', name: 'Empty', sub: `Slot ${s} &middot; equip a gun from your inventory`, cls: 'wide empty', key: String(s) });
      const rarity = rarityOf(w.key), R = RARITIES[rarity];
      return this.card({
        rarity, img: gunIcon(w.key), name: esc(w.def.name), cls: 'wide' + (p.slot === s ? ' held' : ''), key: String(s),
        sub: `${R ? R.name : 'Starter'} &middot; ${kindOf(w.def)} &middot; ${w.mag} / ${w.reserve}`,
        buttons: `<button data-act="store" data-s="${s}"${p.stash.length >= STASH_SIZE ? ' disabled' : ''}>PUT AWAY</button>`,
      });
    };
    const knife = this.card({ img: '', name: esc(p.meleeName || 'Knife'), sub: 'Slot 3 &middot; melee', cls: 'wide knife', key: '3' });
    const items = p.stash.map((it) => {
      if (it.t === 'case') {
        const R = RARITIES[it.rarity];
        return this.card({ rarity: it.rarity, img: caseIcon(it.rarity), name: `${R.name} Case`, sub: 'One of 5 guns', cls: 'case',
          buttons: `<button data-act="open" data-id="${it.id}" class="go">OPEN</button>` });
      }
      const def = stashDef(it), rarity = rarityOf(it.key), R = RARITIES[rarity], perk = perkOf(def);
      return this.card({
        rarity, img: gunIcon(it.key), name: esc(def.name), sub: `${R ? R.name : 'Starter'} &middot; ${kindOf(def)} &middot; ${it.mag} / ${it.reserve}`,
        extra: perk ? `<div class="zc-p">${perk}</div>` : '',
        buttons: `<button data-act="equip" data-id="${it.id}" data-s="1" title="Equip to slot 1">SLOT 1</button>`
          + `<button data-act="equip" data-id="${it.id}" data-s="2" title="Equip to slot 2">SLOT 2</button>`
          + (this.sellArm === it.id ? `<button data-act="sell" data-id="${it.id}" class="sell sure" title="Click again to sell it">SURE?</button>`
            : `<button data-act="sell" data-id="${it.id}" class="sell" title="Sell it (click twice)">SELL ${sellValue(it.key, it.pap)}</button>`),
      });
    }).join('');
    const empty = '<p class="zm-empty">Nothing stored yet. Buy cases from the vending machines by the north door of the Courtyard, '
      + 'or put a gun away here to carry another one.</p>';
    return `<div class="zm-inv"><div class="zm-load"><h4>LOADOUT</h4>${slotCard(1)}${slotCard(2)}${knife}</div>`
      + `<div class="zm-stash"><h4>STORED <span>${p.stash.length} / ${STASH_SIZE}</span></h4>`
      + `${items ? `<div class="zm-grid">${items}</div>` : empty}</div></div>`;
  }

  // ---------- input ----------
  onClick(e) {
    if (!this.visible) return;
    const b = e.target.closest('[data-act]');
    if (this.kase?.state === 'spin' && !b) { this.kase.t = SPIN_TIME; return; }   // click to skip the spin
    if (!b || b.disabled) return;
    const g = this.game, act = b.dataset.act, id = +b.dataset.id, s = +b.dataset.s;
    switch (act) {
      case 'close': this.close(); break;
      case 'tab': this.tab = b.dataset.tab; this.sig = ''; this.render(); break;
      case 'gun': g.invAct({ a: 'gun', k: b.dataset.k }); break;
      case 'ammo': g.invAct({ a: 'ammo', s }); break;
      case 'store': g.invAct({ a: 'store', s }); break;
      case 'equip': g.invAct({ a: 'equip', id, s }); break;
      case 'sell':   // two clicks: the first one asks "SURE?"
        if (this.sellArm === id) { g.invAct({ a: 'sell', id }); this.sellArm = 0; }
        else { this.sellArm = id; this.sellArmT = performance.now(); }
        break;
      case 'open': this.showCase(id); break;
      // the case screen
      case 'unlock': this.unlock(); break;
      case 'back': this.closeCase(); break;
      case 'skip': if (this.kase) this.kase.t = SPIN_TIME; break;
      case 'again': this.showCase(id); break;
      case 'eq': g.invAct({ a: 'equip', id, s }); this.closeCase(); break;
    }
    this.sig = '';
  }

  onKey(e) {
    if (!this.visible || e.repeat) return;
    const k = this.kase;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (k?.state === 'spin') k.t = SPIN_TIME;
      else if (k && k.state !== 'wait') this.closeCase();
      else if (!k) this.close();
      return;
    }
    if (k) {
      if ((e.code === 'Enter' || e.code === 'Space') && k.state === 'preview') { e.preventDefault(); this.unlock(); }
      else if ((e.code === 'Enter' || e.code === 'Space') && k.state === 'spin') { e.preventDefault(); k.t = SPIN_TIME; }
      return;
    }
    if (e.code === 'KeyI' || (e.code === 'KeyE' && this.tab === 'shop')) { e.preventDefault(); this.close(); return; }
    if (this.tab === 'shop' && /^Digit\d$/.test(e.code)) {
      const n = +e.code.slice(5), it = ZOMBIE_SHOP[(n + 9) % 10];
      if (it) { e.preventDefault(); this.game.invAct({ a: 'gun', k: it.key }); this.sig = ''; }
    }
  }

  // ---------- the case screen ----------
  showCase(id) {
    const it = this.player.stash.find((x) => x.id === id && x.t === 'case');
    if (!it) { this.closeCase(); return; }
    this.kase = { id, rarity: it.rarity, state: 'preview' };
    const R = RARITIES[it.rarity];
    const odds = caseOdds(it.rarity).map(([key, pct]) => this.card({
      rarity: it.rarity, img: gunIcon(key), name: WEAPONS[key].name, sub: `${pct}%`, extra: perkOf(WEAPONS[key]) ? `<div class="zc-p">${perkOf(WEAPONS[key])}</div>` : '',
    })).join('');
    this.cs.style.setProperty('--rc', R.color);
    this.cs.innerHTML = `<div class="zx-box"><div class="zx-title">${R.name.toUpperCase()} CASE</div>`
      + `<img class="zx-case" src="${caseIcon(it.rarity)}" alt="">`
      + '<div class="zx-sub">Holds one of these guns:</div>'
      + `<div class="zx-odds">${odds}</div>`
      + '<div class="zx-btns"><button data-act="unlock" class="go">UNLOCK CASE</button><button data-act="back">BACK</button></div>'
      + '<div class="zx-msg"></div></div>';
    this.cs.classList.remove('hidden');
  }

  closeCase() { this.kase = null; this.cs.classList.add('hidden'); this.cs.innerHTML = ''; this.sig = ''; }

  unlock() {
    const k = this.kase;
    if (!k || k.state !== 'preview') return;
    k.state = 'wait'; k.waitT = 0;
    this.sound.caseOpen();
    this.game.invAct({ a: 'open', id: k.id });   // the answer comes back through caseResult()
  }

  // the host rolled the case (ev: { id, r: rarity, k: gun, g: its id in the inventory })
  caseResult(ev) {
    const k = this.kase;
    if (!this.visible || !k || k.state !== 'wait' || ev.id !== k.id || !WEAPONS[ev.k]) return;
    Object.assign(k, { state: 'spin', key: ev.k, gid: ev.g, t: 0, lastCard: -1 });
    // the strip: random guns from the same case (as often as their odds say), the winner near the end
    const keys = [];
    for (let i = 0; i < CARDS; i++) keys.push(i === WIN_AT ? ev.k : rollCase(k.rarity));
    const R = RARITIES[k.rarity];
    const cards = keys.map((key, i) => `<div class="zr-card${i === WIN_AT ? ' win' : ''}"><img src="${gunIcon(key)}" alt=""><span>${WEAPONS[key].name}</span></div>`).join('');
    this.cs.innerHTML = `<div class="zx-box spin"><div class="zx-title">UNLOCKING ${R.name.toUpperCase()} CASE</div>`
      + `<div class="zx-reel"><div class="zx-strip">${cards}</div><div class="zx-line"></div></div>`
      + '<div class="zx-result"></div><div class="zx-hint">Click or press Esc to skip</div></div>';
    const reel = this.cs.querySelector('.zx-reel');
    k.strip = this.cs.querySelector('.zx-strip');
    k.half = reel.clientWidth / 2;
    // stop somewhere inside the winning card, not always dead center (like CS)
    k.dist = WIN_AT * STEP + STEP / 2 - k.half + (Math.random() - 0.5) * STEP * 0.7;
  }

  updateCase(dt) {
    const k = this.kase;
    if (!k) return;
    if (k.state === 'wait') {
      k.waitT += dt;
      if (k.waitT > 4) {   // no answer (online): back to the preview
        k.state = 'preview';
        const m = this.cs.querySelector('.zx-msg'); if (m) m.textContent = "Couldn't open the case. Try again.";
      }
      return;
    }
    if (k.state !== 'spin') return;
    k.t = Math.min(SPIN_TIME, k.t + dt);
    const x = k.dist * easeOut(k.t / SPIN_TIME);
    k.strip.style.transform = `translateX(${-x}px)`;
    const card = Math.floor((x + k.half) / STEP);   // the card under the line
    if (card !== k.lastCard) { if (k.lastCard >= 0) this.sound.caseTick(TIER[k.rarity] * 0.15); k.lastCard = card; }
    if (k.t >= SPIN_TIME) this.finishCase();
  }

  finishCase() {
    const k = this.kase, def = WEAPONS[k.key], R = RARITIES[k.rarity];
    k.state = 'done';
    this.sound.caseReveal(TIER[k.rarity]);
    this.cs.querySelector('.zr-card.win')?.classList.add('shine');
    const box = this.cs.querySelector('.zx-box'); box.classList.remove('spin'); box.classList.add('done');
    this.cs.querySelector('.zx-title').textContent = `${R.name.toUpperCase()} CASE UNLOCKED`;
    const again = this.player.stash.find((x) => x.t === 'case' && x.rarity === k.rarity);
    const perk = perkOf(def);
    this.cs.querySelector('.zx-hint').textContent = '';
    this.cs.querySelector('.zx-result').innerHTML = `<div class="zx-got"><img src="${gunIcon(k.key)}" alt="">`
      + `<div><div class="zx-name">${def.name}</div><div class="zx-rar">${R.name} &middot; ${kindOf(def)}</div>`
      + `${perk ? `<div class="zx-perk">${perk}</div>` : ''}<div class="zx-in">Added to your inventory</div></div></div>`
      + `<div class="zx-btns"><button data-act="eq" data-id="${k.gid}" data-s="1" class="go">EQUIP TO SLOT 1</button>`
      + `<button data-act="eq" data-id="${k.gid}" data-s="2" class="go">EQUIP TO SLOT 2</button>`
      + `${again ? `<button data-act="again" data-id="${again.id}">OPEN ANOTHER</button>` : ''}`
      + '<button data-act="back">KEEP IT STORED</button></div>';
  }
}
