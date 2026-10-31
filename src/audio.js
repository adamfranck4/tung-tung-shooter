// All sounds are synthesized with the Web Audio API (no audio files).
const SHOTS = {
  pistol: { freq: 3200, decay: 0.13, vol: 0.55, thump: 140, thumpVol: 0.4 },
  smg:    { freq: 3600, decay: 0.09, vol: 0.45, thump: 120, thumpVol: 0.35 },
  rifle:  { freq: 2400, decay: 0.2,  vol: 0.7,  thump: 85,  thumpVol: 0.7 },
  rifle2: { freq: 3000, decay: 0.16, vol: 0.6,  thump: 100, thumpVol: 0.55 },
  sniper: { freq: 1800, decay: 0.55, vol: 0.95, thump: 55,  thumpVol: 1.0 },
  shotgun: { freq: 1500, decay: 0.32, vol: 0.95, thump: 65, thumpVol: 1.0 },
  deagle: { freq: 2100, decay: 0.26, vol: 0.85, thump: 78, thumpVol: 0.85 },
  m16:    { freq: 2800, decay: 0.15, vol: 0.62, thump: 95,  thumpVol: 0.6 },
  scout:  { freq: 2600, decay: 0.38, vol: 0.85, thump: 70,  thumpVol: 0.8 },
  // Zombies case guns
  revolver: { freq: 1900, decay: 0.3, vol: 0.85, thump: 72, thumpVol: 0.9 },
  micro:  { freq: 4200, decay: 0.07, vol: 0.4,  thump: 140, thumpVol: 0.3 },
  pdw:    { freq: 3800, decay: 0.08, vol: 0.42, thump: 125, thumpVol: 0.32 },
  autoshotgun: { freq: 1700, decay: 0.26, vol: 0.9, thump: 70, thumpVol: 0.95 },
  autosniper: { freq: 2200, decay: 0.32, vol: 0.85, thump: 66, thumpVol: 0.85 },
  minigun: { freq: 3100, decay: 0.07, vol: 0.4, thump: 95, thumpVol: 0.4 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.volume = 0.7;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setListener(pos, yaw) { this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z; this.listener.yaw = yaw; }

  // returns {node, dist} where node is the input of a gain+pan chain, or null if too far
  out(pos, vol, maxDist = 120) {
    const ctx = this.ctx;
    if (!ctx) return null;
    let gain = vol, pan = 0, dist = 0;
    if (pos) {
      const L = this.listener;
      const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
      dist = Math.hypot(dx, dy, dz);
      if (dist > maxDist) return null;
      gain = vol / (1 + dist * 0.07);
      const flat = Math.hypot(dx, dz);
      if (flat > 0.3) {
        const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
        pan = Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / flat));
      }
      if (!Number.isFinite(gain)) gain = 0;
    }
    const g = ctx.createGain(); g.gain.value = gain;
    let node = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return { node, dist };
  }

  noiseBurst(dest, { freq, q = 0.8, type = 'lowpass', decay, vol = 1, delay = 0, attack = 0.002 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + decay + 0.05);
  }

  tone(dest, { freq, end = freq, decay, vol = 1, type = 'sine', delay = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, end), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + decay + 0.05);
  }

  shot(kind, pos) {
    if (kind === 'raygun') return this.rayShot(pos);
    if (kind === 'thumper') return this.thumpShot(pos);
    if (kind === 'petir') return this.zapShot(pos);
    if (kind === 'rail') return this.railShot(pos);
    if (kind === 'torch') return this.flameShot(pos);
    const s = SHOTS[kind] || SHOTS.rifle;
    const o = this.out(pos, s.vol, 200);
    if (!o) return;
    const far = Math.min(1, o.dist / 60);
    this.noiseBurst(o.node, { freq: s.freq * (1 - far * 0.7), decay: s.decay * (1 + far * 0.8), vol: 1 });
    this.tone(o.node, { freq: s.thump, end: s.thump * 0.4, decay: s.decay * 0.9, vol: s.thumpVol });
    if (kind === 'sniper') this.noiseBurst(o.node, { freq: 600, decay: 0.9, vol: 0.4, delay: 0.05 });
    if (kind === 'scout') this.noiseBurst(o.node, { freq: 900, decay: 0.6, vol: 0.25, delay: 0.04 });
    if (kind === 'deagle') this.noiseBurst(o.node, { freq: 700, decay: 0.35, vol: 0.3, delay: 0.03 });
  }
  knife(pos) { const o = this.out(pos, 0.35, 20); if (o) this.noiseBurst(o.node, { freq: 2500, type: 'bandpass', q: 2, decay: 0.12, attack: 0.03 }); }
  step(pos, self) {
    const o = this.out(pos, self ? 0.12 : 0.35, 26);
    if (o) this.noiseBurst(o.node, { freq: 500 + Math.random() * 300, type: 'bandpass', q: 1.2, decay: 0.07 });
  }
  land() { const o = this.out(null, 0.25); if (o) this.noiseBurst(o.node, { freq: 300, decay: 0.12 }); }
  dryFire() { const o = this.out(null, 0.3); if (o) this.tone(o.node, { freq: 1800, end: 1200, decay: 0.03, type: 'square', vol: 0.3 }); }
  reload() {
    const o = this.out(null, 0.3); if (!o) return;
    this.noiseBurst(o.node, { freq: 2000, type: 'bandpass', q: 3, decay: 0.05, delay: 0.25 });
    this.noiseBurst(o.node, { freq: 1500, type: 'bandpass', q: 3, decay: 0.06, delay: 0.9 });
    this.tone(o.node, { freq: 900, end: 700, decay: 0.04, type: 'square', vol: 0.15, delay: 1.2 });
  }
  deploy() { const o = this.out(null, 0.2); if (o) this.noiseBurst(o.node, { freq: 2200, type: 'bandpass', q: 2, decay: 0.06 }); }
  // a long blade leaving its sheath: a rising scrape that ends in a metallic ring
  bladeDraw() {
    const o = this.out(null, 0.34); if (!o) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 5;
    f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(7800, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.75, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    src.connect(f); f.connect(g); g.connect(o.node);
    src.start(t, Math.random() * 1.5); src.stop(t + 0.32);
    for (const [fr, vol, decay] of [[3150, 0.22, 1.0], [4730, 0.14, 0.75], [6290, 0.09, 0.55]]) {
      this.tone(o.node, { freq: fr, end: fr * 0.996, decay, vol, delay: 0.15 });
    }
  }
  // a blade or latch snapping into place
  bladeClick() {
    const o = this.out(null, 0.26); if (!o) return;
    this.tone(o.node, { freq: 3900, end: 2700, decay: 0.03, type: 'square', vol: 0.25 });
    this.noiseBurst(o.node, { freq: 5200, type: 'highpass', decay: 0.035 });
  }
  // a chain rattling out (the Kuronami's kunai): a quick run of small metal clinks
  chain() {
    const o = this.out(null, 0.2); if (!o) return;
    for (let i = 0; i < 5; i++) {
      const d = i * 0.032 + Math.random() * 0.012;
      this.noiseBurst(o.node, { freq: 4200 + Math.random() * 1800, type: 'bandpass', q: 6, decay: 0.03, delay: d });
      this.tone(o.node, { freq: 2500 + Math.random() * 900, end: 2400, decay: 0.045, type: 'triangle', vol: 0.12, delay: d });
    }
  }
  // a knife cutting the air during tricks
  swish() { const o = this.out(null, 0.16); if (o) this.noiseBurst(o.node, { freq: 1500, type: 'bandpass', q: 1.4, decay: 0.15, attack: 0.05 }); }
  zoom() { const o = this.out(null, 0.2); if (o) this.tone(o.node, { freq: 2400, end: 1800, decay: 0.04, type: 'square', vol: 0.2 }); }
  hit(head) {
    const o = this.out(null, head ? 0.55 : 0.35); if (!o) return;
    if (head) this.tone(o.node, { freq: 2600, end: 2400, decay: 0.18, type: 'triangle', vol: 0.8 });
    else this.tone(o.node, { freq: 1100, end: 900, decay: 0.05, type: 'square', vol: 0.4 });
  }
  hurt() { const o = this.out(null, 0.5); if (o) this.noiseBurst(o.node, { freq: 400, decay: 0.15 }); }
  whiz(pos) { const o = this.out(pos, 0.25, 6); if (o) this.noiseBurst(o.node, { freq: 3000, type: 'bandpass', q: 4, decay: 0.12, attack: 0.04 }); }
  beep(pos) { const o = this.out(pos, 0.4, 60); if (o) this.tone(o.node, { freq: 2100, decay: 0.09, type: 'square', vol: 0.4 }); }
  plantTick() { const o = this.out(null, 0.2); if (o) this.tone(o.node, { freq: 1500, decay: 0.05, type: 'square', vol: 0.3 }); }
  explosion(pos) {
    const o = this.out(pos, 1.6, 400); if (!o) return;
    this.noiseBurst(o.node, { freq: 900, decay: 2.2, vol: 1, attack: 0.01 });
    this.tone(o.node, { freq: 70, end: 25, decay: 1.8, vol: 1 });
  }
  pickup() { const o = this.out(null, 0.3); if (o) { this.tone(o.node, { freq: 900, decay: 0.08, vol: 0.4 }); this.tone(o.node, { freq: 1300, decay: 0.1, vol: 0.4, delay: 0.07 }); } }
  buy() { const o = this.out(null, 0.3); if (o) { this.tone(o.node, { freq: 1400, decay: 0.07, type: 'triangle' }); this.tone(o.node, { freq: 2100, decay: 0.12, type: 'triangle', delay: 0.06 }); } }
  roundStart() { const o = this.out(null, 0.3); if (o) this.tone(o.node, { freq: 660, decay: 0.25, type: 'triangle' }); }
  // ----- Zombies mode -----
  rayShot(pos) {
    const o = this.out(pos, 0.5, 120); if (!o) return;
    this.tone(o.node, { freq: 1900, end: 280, decay: 0.25, type: 'square', vol: 0.35 });
    this.tone(o.node, { freq: 950, end: 140, decay: 0.3, type: 'sawtooth', vol: 0.3 });
  }
  // the Coconut Thumper: a hollow "thoonk"
  thumpShot(pos) {
    const o = this.out(pos, 0.6, 100); if (!o) return;
    this.tone(o.node, { freq: 210, end: 70, decay: 0.22, type: 'triangle', vol: 1 });
    this.noiseBurst(o.node, { freq: 600, decay: 0.16, vol: 0.6 });
  }
  // a boom when its round goes off
  thumpBoom(pos) {
    const o = this.out(pos, 0.55, 80); if (!o) return;
    this.noiseBurst(o.node, { freq: 420, decay: 0.5, vol: 1 });
    this.tone(o.node, { freq: 90, end: 38, decay: 0.45, vol: 0.9 });
  }
  // Petir Arc: a crackling electric zap
  zapShot(pos) {
    const o = this.out(pos, 0.45, 90); if (!o) return;
    this.tone(o.node, { freq: 2600, end: 900, decay: 0.12, type: 'sawtooth', vol: 0.3 });
    this.noiseBurst(o.node, { freq: 5200, type: 'highpass', decay: 0.1, vol: 0.5 });
    this.noiseBurst(o.node, { freq: 3000, type: 'bandpass', q: 2, decay: 0.06, vol: 0.5, delay: 0.05 });
  }
  // Tung Lance: a charged whip-crack with a falling hum
  railShot(pos) {
    const o = this.out(pos, 0.6, 130); if (!o) return;
    this.noiseBurst(o.node, { freq: 6000, type: 'highpass', decay: 0.18, vol: 0.7 });
    this.tone(o.node, { freq: 1400, end: 120, decay: 0.5, type: 'sawtooth', vol: 0.35 });
    this.tone(o.node, { freq: 60, end: 40, decay: 0.4, vol: 0.8 });
  }
  // Sambal Torch: a soft roar (it fires many times a second, so it's quiet and short)
  flameShot(pos) {
    const o = this.out(pos, 0.22, 50); if (!o) return;
    this.noiseBurst(o.node, { freq: 700 + Math.random() * 300, decay: 0.12, vol: 0.8, attack: 0.02 });
  }
  // ----- case opening -----
  // a click each time a gun goes past the line
  caseTick(k = 0) { const o = this.out(null, 0.18); if (o) this.tone(o.node, { freq: 2200 + k * 600, end: 1600, decay: 0.03, type: 'square', vol: 0.4 }); }
  // the case unlocking
  caseOpen() {
    const o = this.out(null, 0.4); if (!o) return;
    this.noiseBurst(o.node, { freq: 2600, type: 'bandpass', q: 3, decay: 0.08 });
    this.tone(o.node, { freq: 500, end: 900, decay: 0.25, type: 'triangle', vol: 0.5, delay: 0.06 });
  }
  // what you got: a fanfare that gets grander with the rarity (0..3)
  caseReveal(tier = 0) {
    const o = this.out(null, 0.45); if (!o) return;
    const notes = [[523, 659], [523, 659, 784], [523, 659, 784, 1046], [523, 659, 784, 1046, 1318, 1568]][tier] || [523, 659];
    notes.forEach((f, i) => this.tone(o.node, { freq: f, decay: 0.3 + tier * 0.08, type: 'triangle', vol: 0.55, delay: i * 0.08 }));
    if (tier >= 2) notes.forEach((f, i) => this.tone(o.node, { freq: f * 2, decay: 0.25, type: 'sine', vol: 0.18, delay: i * 0.08 + 0.02 }));
  }
  // the "tung tung tung" wooden drum knock
  tung(pos, vol = 0.6) {
    const o = this.out(pos, vol, 40); if (!o) return;
    for (let i = 0; i < 3; i++) {
      this.tone(o.node, { freq: 230, end: 150, decay: 0.16, vol: 1, delay: i * 0.21 });
      this.tone(o.node, { freq: 470, end: 330, decay: 0.07, type: 'triangle', vol: 0.5, delay: i * 0.21 });
      this.noiseBurst(o.node, { freq: 1400, type: 'bandpass', q: 3, decay: 0.03, vol: 0.7, delay: i * 0.21 });
    }
  }
  groan(pos, pitch = 1) {
    const o = this.out(pos, pitch < 1 ? 0.55 : 0.35, 30); if (!o) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const base = (70 + Math.random() * 40) * pitch;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 0.8, t + 0.9);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6 + Math.random() * 4;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 8;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    osc.connect(f); f.connect(g); g.connect(o.node);
    osc.start(t); lfo.start(t); osc.stop(t + 1.05); lfo.stop(t + 1.05);
  }
  swing(pos) { const o = this.out(pos, 0.4, 20); if (o) this.noiseBurst(o.node, { freq: 900, type: 'bandpass', q: 1.5, decay: 0.2, attack: 0.08 }); }
  // the rainbow giant's footsteps: a deep thud you feel more than hear
  stomp(pos, vol = 0.9) {
    const o = this.out(pos, vol, 60); if (!o) return;
    this.tone(o.node, { freq: 72, end: 34, decay: 0.42, vol: 1 });
    this.noiseBurst(o.node, { freq: 220, decay: 0.28, vol: 0.7, attack: 0.004 });
  }
  // a flyer's wing beat
  flap(pos) { const o = this.out(pos, 0.3, 18); if (o) this.noiseBurst(o.node, { freq: 520, q: 0.7, decay: 0.13, attack: 0.035 }); }
  // a coconut cracking against something
  coconut(pos) {
    const o = this.out(pos, 0.5, 40); if (!o) return;
    this.tone(o.node, { freq: 640, end: 380, decay: 0.09, type: 'triangle', vol: 0.8 });
    this.noiseBurst(o.node, { freq: 1700, type: 'bandpass', q: 1.5, decay: 0.07, vol: 0.6 });
  }
  batHit() { const o = this.out(null, 0.6); if (o) { this.tone(o.node, { freq: 160, end: 90, decay: 0.18, vol: 1 }); this.noiseBurst(o.node, { freq: 700, decay: 0.12, vol: 0.8 }); } }
  boardBreak(pos) { const o = this.out(pos, 0.5, 40); if (o) { this.noiseBurst(o.node, { freq: 1100, type: 'bandpass', q: 1, decay: 0.18 }); this.tone(o.node, { freq: 300, end: 120, decay: 0.1, type: 'triangle', vol: 0.5 }); } }
  boardFix() { const o = this.out(null, 0.35); if (o) for (let i = 0; i < 2; i++) this.tone(o.node, { freq: 900, end: 600, decay: 0.05, type: 'square', vol: 0.3, delay: i * 0.12 }); }
  purchase() { const o = this.out(null, 0.35); if (o) [880, 1320].forEach((f, i) => this.tone(o.node, { freq: f, decay: 0.12, type: 'triangle', delay: i * 0.08 })); }
  denied() { const o = this.out(null, 0.35); if (o) this.tone(o.node, { freq: 140, end: 110, decay: 0.3, type: 'square', vol: 0.4 }); }
  perk() { const o = this.out(null, 0.4); if (o) [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(o.node, { freq: f, decay: 0.16, type: 'square', vol: 0.3, delay: i * 0.09 })); }
  powerSpawn(pos) { const o = this.out(pos, 0.4, 60); if (o) [1200, 1500, 1800].forEach((f, i) => this.tone(o.node, { freq: f, decay: 0.2, type: 'sine', delay: i * 0.07 })); }
  powerGrab() { const o = this.out(null, 0.5); if (o) [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(o.node, { freq: f, decay: 0.25, type: 'triangle', vol: 0.6, delay: i * 0.06 })); }
  nuke() { this.explosion(null); }
  zRoundStart() { this.tung(null, 0.8); const o = this.out(null, 0.5); if (o) this.tone(o.node, { freq: 55, end: 45, decay: 2.5, type: 'sawtooth', vol: 0.4, delay: 0.7 }); }
  zRoundEnd() { const o = this.out(null, 0.4); if (o) [784, 659, 523, 392, 523].forEach((f, i) => this.tone(o.node, { freq: f, decay: 0.4, type: 'triangle', vol: 0.5, delay: i * 0.22 })); }

  roundEnd(win) {
    const o = this.out(null, 0.35); if (!o) return;
    const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone(o.node, { freq: f, decay: 0.35, type: 'triangle', vol: 0.6, delay: i * 0.13 }));
  }
}
