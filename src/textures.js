// Procedural textures drawn on canvases, so the game needs no image files.
import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function noise(ctx, w, h, amount, r) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n; d[i + 1] += n * 0.95; d[i + 2] += n * 0.85;
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, w, h, count, rgb, alpha, maxR, r) {
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = r() * h, rad = maxR * (0.3 + r() * 0.7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${alpha * (0.4 + r() * 0.6)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    // draw wrapped so the texture tiles
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); ctx.restore();
    }
  }
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Turns a grayscale height canvas into a tileable tangent-space normal map.
function normalFromHeight(hc, strength, repeat = true) {
  const W = hc.width, H = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, W, H).data;
  const [c, ctx] = makeCanvas(W, H);
  const out = ctx.createImageData(W, H), d = out.data;
  const h = (x, y) => src[((((y % H) + H) % H) * W + (((x % W) + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = -(h(x + 1, y) - h(x - 1, y)) * strength;
    const ny = (h(x, y + 1) - h(x, y - 1)) * strength; // canvas y points down, texture v points up
    const l = Math.hypot(nx, ny, 1);
    const i = (y * W + x) * 4;
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function blurInPlace(c, px) {
  const [t, tctx] = makeCanvas(c.width, c.height);
  tctx.filter = `blur(${px}px)`;
  // draw a 3x3 tiling so the blur wraps around the edges
  for (const ox of [-c.width, 0, c.width]) for (const oy of [-c.height, 0, c.height]) tctx.drawImage(c, ox, oy);
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(t, 0, 0);
}

// Sandstone blocks. One tile = 4m x 4m. Returns { map, normal }.
function wallTexture(withNormal) {
  const S = 512, r = rng(11);
  const [c, ctx] = makeCanvas(S);
  const [hc, hctx] = makeCanvas(S);
  ctx.fillStyle = '#b89668'; ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#3a3a3a'; hctx.fillRect(0, 0, S, S);       // mortar sits low
  const rows = 8, rh = S / rows;
  for (let y = 0; y < rows; y++) {
    let x = -(y % 2) * 60 - r() * 30;
    while (x < S) {
      const w = 90 + r() * 80;
      const v = 0.88 + r() * 0.2;
      ctx.fillStyle = `rgb(${210 * v | 0},${178 * v | 0},${126 * v | 0})`;
      const hv = 170 + (r() * 40 | 0);
      hctx.fillStyle = `rgb(${hv},${hv},${hv})`;
      for (const ox of [0, -S]) {
        if (ox && x + w <= S) continue;
        ctx.fillRect(x + 2 + ox, y * rh + 2, w - 4, rh - 4);
        hctx.fillRect(x + 3 + ox, y * rh + 3, w - 6, rh - 6);
      }
      x += w;
    }
  }
  blotches(ctx, S, S, 30, '120,90,50', 0.25, 90, r);
  blotches(ctx, S, S, 20, '255,240,210', 0.18, 70, r);
  noise(ctx, S, S, 34, r);
  let normal = null;
  if (withNormal) {
    blurInPlace(hc, 1.5);
    blotches(hctx, S, S, 40, '0,0,0', 0.12, 40, r);   // pitted, worn stone
    noise(hctx, S, S, 26, r);
    normal = normalFromHeight(hc, 3.2);
  }
  return { map: toTexture(c), normal };
}

// Sand / packed dirt floor. One tile = 8m.
function sandTexture(withNormal) {
  const S = 512, r = rng(23);
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = '#cdb184'; ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, 50, '150,115,70', 0.22, 110, r);
  blotches(ctx, S, S, 40, '240,220,180', 0.2, 80, r);
  const pebbles = [];
  for (let i = 0; i < 500; i++) {
    const v = r() < 0.5 ? 'rgba(90,70,45,0.35)' : 'rgba(255,245,220,0.3)';
    ctx.fillStyle = v; const s = 1 + r() * 3, x = r() * S, y = r() * S;
    ctx.fillRect(x, y, s, s);
    pebbles.push([x, y, s]);
  }
  noise(ctx, S, S, 40, r);
  let normal = null;
  if (withNormal) {
    const [hc, hctx] = makeCanvas(S);
    hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, S, S);
    blotches(hctx, S, S, 60, '255,255,255', 0.18, 90, r);
    blotches(hctx, S, S, 60, '0,0,0', 0.18, 90, r);
    hctx.fillStyle = '#d0d0d0';
    for (const [x, y, s] of pebbles) hctx.fillRect(x, y, s + 1, s + 1);
    noise(hctx, S, S, 30, r);
    blurInPlace(hc, 1);
    normal = normalFromHeight(hc, 2.2);
  }
  return { map: toTexture(c), normal };
}

// Stone floor tiles. One tile = 4m (4x4 tiles).
function tileTexture(withNormal) {
  const S = 512, r = rng(37);
  const [c, ctx] = makeCanvas(S);
  const [hc, hctx] = makeCanvas(S);
  ctx.fillStyle = '#7d6c55'; ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#303030'; hctx.fillRect(0, 0, S, S);
  const n = 4, ts = S / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = 0.85 + r() * 0.22;
    ctx.fillStyle = `rgb(${196 * v | 0},${178 * v | 0},${146 * v | 0})`;
    ctx.fillRect(x * ts + 3, y * ts + 3, ts - 6, ts - 6);
    const hv = 175 + (r() * 30 | 0);
    hctx.fillStyle = `rgb(${hv},${hv},${hv})`;
    hctx.fillRect(x * ts + 4, y * ts + 4, ts - 8, ts - 8);
  }
  blotches(ctx, S, S, 25, '90,70,45', 0.25, 80, r);
  noise(ctx, S, S, 30, r);
  let normal = null;
  if (withNormal) { blurInPlace(hc, 1.5); noise(hctx, S, S, 14, r); normal = normalFromHeight(hc, 3); }
  return { map: toTexture(c), normal };
}

// Wooden crate face (whole texture per face).
function crateTexture(withNormal) {
  const S = 256, r = rng(51);
  const [c, ctx] = makeCanvas(S);
  const [hc, hctx] = makeCanvas(S);
  ctx.fillStyle = '#9c6d3c'; ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#404040'; hctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 6; i++) {
    const v = 0.85 + r() * 0.25;
    ctx.fillStyle = `rgb(${160 * v | 0},${112 * v | 0},${62 * v | 0})`;
    ctx.fillRect(0, i * S / 6 + 1, S, S / 6 - 2);
    hctx.fillStyle = '#909090'; hctx.fillRect(0, i * S / 6 + 2, S, S / 6 - 4); // plank seams
  }
  ctx.strokeStyle = 'rgba(60,35,15,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) { const y = r() * S; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y + (r() - 0.5) * 6); ctx.stroke(); }
  const b = 24;
  for (const [g, color] of [[ctx, '#6e4723'], [hctx, '#e0e0e0']]) {   // raised frame + cross brace
    g.fillStyle = color;
    g.fillRect(0, 0, S, b); g.fillRect(0, S - b, S, b); g.fillRect(0, 0, b, S); g.fillRect(S - b, 0, b, S);
    g.save(); g.translate(S / 2, S / 2); g.rotate(Math.PI / 4);
    g.fillRect(-S * 0.68, -b / 2, S * 1.36, b); g.restore();
  }
  ctx.fillStyle = '#3b2a1a'; hctx.fillStyle = '#ffffff';
  for (const [x, y] of [[12, 12], [S - 12, 12], [12, S - 12], [S - 12, S - 12]]) {
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
    hctx.beginPath(); hctx.arc(x, y, 4, 0, 7); hctx.fill();
  }
  noise(ctx, S, S, 28, r);
  let normal = null;
  if (withNormal) { blurInPlace(hc, 1.2); noise(hctx, S, S, 18, r); normal = normalFromHeight(hc, 3, false); }
  return { map: toTexture(c, false), normal };
}

// High graphics, once the plank photo is in: repaint the crate face from it (same frame, cross
// brace and nails as above, at twice the resolution). The bump map stays the drawn one.
function paintCratePhoto(c, photo) {
  const S = 512, b = 48, r = rng(52);
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  // a crate face is about 1.2 m, the photo about 1.9 m: use a crop so the planks keep their size
  const crop = (x0, y0) => ctx.drawImage(photo, photo.width * x0, photo.height * y0, photo.width * 0.63, photo.height * 0.63, 0, 0, S, S);
  const tint = (color) => { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = color; ctx.fillRect(0, 0, S, S); ctx.globalCompositeOperation = 'source-over'; };
  crop(0, 0); tint('rgb(228,204,176)');                     // the boards, toward the old crate color
  ctx.save();                                              // the frame and brace: other boards, darker
  ctx.beginPath();
  ctx.rect(0, 0, S, b); ctx.rect(0, S - b, S, b); ctx.rect(0, 0, b, S); ctx.rect(S - b, 0, b, S);
  ctx.translate(S / 2, S / 2); ctx.rotate(Math.PI / 4); ctx.rect(-S * 0.68, -b / 2, S * 1.36, b);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clip(); crop(0.3, 0.37); tint('rgb(150,112,80)');
  ctx.restore();
  ctx.strokeStyle = 'rgba(40,22,8,0.45)'; ctx.lineWidth = 3;   // a dark line where the frame meets the boards
  ctx.strokeRect(b, b, S - 2 * b, S - 2 * b);
  ctx.fillStyle = '#3b2a1a';
  for (const [x, y] of [[24, 24], [S - 24, 24], [24, S - 24], [S - 24, S - 24]]) { ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); }
  noise(ctx, S, S, 12, r);
}

// Spray-painted site letter.
export function letterTexture(letter) {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  ctx.clearRect(0, 0, S, S);
  ctx.font = '700 210px Rajdhani, Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(200,40,20,0.8)'; ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(205,48,28,0.85)';
  ctx.fillText(letter, S / 2, S / 2 + 10);
  const t = toTexture(c, false);
  return t;
}

export function bulletHoleTexture() {
  const S = 64;
  const [c, ctx] = makeCanvas(S);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(10,8,6,1)');
  g.addColorStop(0.25, 'rgba(25,20,15,0.95)');
  g.addColorStop(0.5, 'rgba(60,45,30,0.5)');
  g.addColorStop(1, 'rgba(60,45,30,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return toTexture(c, false);
}

export function flashTexture() {
  const S = 128;
  const [c, ctx] = makeCanvas(S);
  ctx.translate(S / 2, S / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.2, 'rgba(255,210,120,0.9)');
  g.addColorStop(0.5, 'rgba(255,140,40,0.35)');
  g.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  const spikes = 7;
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? S / 2 : S / 6;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function markerTexture(color) {
  const S = 64;
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(10, 14); ctx.lineTo(54, 14); ctx.lineTo(32, 50); ctx.closePath();
  ctx.stroke(); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Light wood grain running lengthwise (for the log characters' bodies).
export function woodGrainTexture() {
  const W = 256, H = 512, r = rng(77);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#c99d68'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x0 = r() * W, w = 1 + r() * 3, wob = 2 + r() * 6, ph = r() * 6;
    ctx.strokeStyle = r() < 0.7 ? `rgba(120,78,38,${0.12 + r() * 0.25})` : `rgba(255,230,190,${0.12 + r() * 0.2})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let y = 0; y <= H; y += 8) {
      const x = x0 + Math.sin(y / 60 + ph) * wob;
      if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) { // knots
    const x = r() * W, y = r() * H;
    for (let k = 4; k > 0; k--) {
      ctx.strokeStyle = `rgba(95,58,25,${0.25 + k * 0.08})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, k * 4, k * 9, 0, 0, 7); ctx.stroke();
    }
  }
  noise(ctx, W, H, 18, r);
  const t = toTexture(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Tree rings for the top of the log.
export function treeRingsTexture() {
  const S = 256, r = rng(91);
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = '#e2bf88'; ctx.fillRect(0, 0, S, S);
  for (let k = 1; k < 16; k++) {
    ctx.strokeStyle = `rgba(150,100,50,${0.25 + r() * 0.3})`;
    ctx.lineWidth = 1 + r() * 2.5;
    ctx.beginPath(); ctx.arc(S / 2 + (r() - 0.5) * 4, S / 2 + (r() - 0.5) * 4, k * 8, 0, 7); ctx.stroke();
  }
  ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 5, 0, 7); ctx.stroke();
  noise(ctx, S, S, 16, r);
  return toTexture(c, false);
}

// Smooth, polished wood for the Tung Tung body (light; tinted per team by the material color).
// Darker toward the bottom like the reference character.
// base: the wood color under the tint (a pale base lets strong tints like purple show through)
export function tungSkinTexture(base = '#f4d08a') {
  const W = 256, H = 512, r = rng(131);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,245,215,0.25)');
  g.addColorStop(0.45, 'rgba(255,240,200,0)');
  g.addColorStop(1, 'rgba(90,45,10,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {   // faint grain
    const x0 = r() * W, wob = 2 + r() * 5, ph = r() * 6;
    ctx.strokeStyle = `rgba(140,85,30,${0.04 + r() * 0.07})`; ctx.lineWidth = 1 + r() * 2;
    ctx.beginPath();
    for (let y = 0; y <= H; y += 8) { const x = x0 + Math.sin(y / 70 + ph) * wob; if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  blotches(ctx, W, H, 14, '150,90,30', 0.08, 70, r);
  noise(ctx, W, H, 8, r);
  const t = toTexture(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Rainbow skin for the giant zombie: bands of color up the log, shaded with faint wood grain.
// heightAt(v) maps the texture's v (0 bottom .. 1 top) to the height up the log (0..1), so the
// bands come out evenly spaced. Call draw(shift) to slide the colors up the body.
export function rainbowSkin(heightAt) {
  const W = 128, H = 512, r = rng(77);
  const [grain, gctx] = makeCanvas(W, H);
  gctx.fillStyle = '#fff'; gctx.fillRect(0, 0, W, H);
  const g = gctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(70,40,30,0.45)');
  gctx.fillStyle = g; gctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 24; i++) {
    const x0 = r() * W, wob = 2 + r() * 4, ph = r() * 6;
    gctx.strokeStyle = `rgba(110,80,60,${0.06 + r() * 0.08})`; gctx.lineWidth = 1 + r() * 2;
    gctx.beginPath();
    for (let y = 0; y <= H; y += 8) { const x = x0 + Math.sin(y / 70 + ph) * wob; if (y === 0) gctx.moveTo(x, y); else gctx.lineTo(x, y); }
    gctx.stroke();
  }
  const [c, ctx] = makeCanvas(W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const heights = [];
  for (let y = 0; y < H; y += 2) heights.push(heightAt(1 - (y + 1) / H));
  const draw = (shift) => {
    ctx.globalCompositeOperation = 'source-over';
    heights.forEach((h, i) => {
      const hue = (((h * 0.85 - shift) % 1) + 1) % 1 * 360;   // red at the feet up to violet at the top
      ctx.fillStyle = `hsl(${hue.toFixed(1)},88%,58%)`;
      ctx.fillRect(0, i * 2, W, 2);
    });
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(grain, 0, 0);
    tex.needsUpdate = true;
  };
  draw(0);
  return { tex, draw };
}

// Painted details for the face (the eyes, brow ridges and nose are 3D on top of this):
// soft eye sockets, a shadow under the nose and a small closed smile.
// Covers the front of the log from 0.62 m to 1.08 m above the hips.
export function tungFaceTexture() {
  const W = 512, H = 384;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const ex = [161, 351], ey = 75;
  for (const x of ex) {               // eye sockets
    const g = ctx.createRadialGradient(x, ey, 30, x, ey, 72);
    g.addColorStop(0, 'rgba(70,35,10,0.42)'); g.addColorStop(1, 'rgba(70,35,10,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 80, ey - 80, 160, 160);
  }
  const ns = ctx.createRadialGradient(256, 250, 4, 256, 250, 46);  // shadow under the nose
  ns.addColorStop(0, 'rgba(60,28,8,0.5)'); ns.addColorStop(1, 'rgba(60,28,8,0)');
  ctx.fillStyle = ns; ctx.fillRect(200, 210, 112, 80);
  for (const x of [150, 362]) {       // a little warmth in the cheeks
    const g = ctx.createRadialGradient(x, 215, 5, x, 215, 55);
    g.addColorStop(0, 'rgba(190,70,40,0.18)'); g.addColorStop(1, 'rgba(190,70,40,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 60, 160, 120, 110);
  }
  // small closed smile
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,230,190,0.35)'; ctx.lineWidth = 10;   // lower lip highlight
  ctx.beginPath(); ctx.moveTo(206, 292); ctx.quadraticCurveTo(256, 322, 306, 292); ctx.stroke();
  ctx.strokeStyle = '#3a1806'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(200, 280); ctx.quadraticCurveTo(256, 314, 312, 280); ctx.stroke();
  ctx.lineWidth = 5;                                                     // dimples
  ctx.beginPath(); ctx.moveTo(194, 272); ctx.quadraticCurveTo(190, 282, 198, 290); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(318, 272); ctx.quadraticCurveTo(322, 282, 314, 290); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function makeTextures(quality = 'high') {
  const hi = quality === 'high';
  const wall = wallTexture(hi), sand = sandTexture(hi), tile = tileTexture(hi), crate = crateTexture(hi);
  const tex = {
    quality,
    wall: wall.map, wallN: wall.normal,
    sand: sand.map, sandN: sand.normal,
    tile: tile.map, tileN: tile.normal,
    crate: crate.map, crateN: crate.normal,
    // roofs and plank walls: the crate's wood (on High, plank photos replace it once they load)
    wood: hi ? copyOf(crate.map) : crate.map, woodN: hi ? copyOf(crate.normal) : null,
    photo: {}, mats: {},
  };
  if (hi) loadPhotos(tex);
  return tex;
}

// a texture of its own (so its picture can be swapped) showing the same canvas
function copyOf(t) {
  const c = new THREE.CanvasTexture(t.image);
  c.colorSpace = t.colorSpace; c.anisotropy = t.anisotropy; c.wrapS = t.wrapS; c.wrapT = t.wrapT;
  return c;
}

// ---------- photo textures (High graphics) ----------
// Free CC0 textures from Poly Haven (polyhaven.com), in assets/textures (1.5 MB in all). Each
// surface starts with its drawn texture and switches to the photo once it has loaded, so a slow
// or failed download just leaves the drawn one.
//  design: meters one repeat of the drawn texture covers (the maps' texture coordinates assume it)
//  meters: the real size of one repeat of the photo, so it's repeated design / meters times
//  gain:   matches the photo's brightness to the drawn texture's, which the lighting and each
//          area's tint were tuned for
//  bump:   strength of its bump map (the sandstone's mortar is shallow, so it gets more)
const PHOTOS = {
  wall: { design: 4, meters: 3, gain: 1.35, bump: 2 },     // Sandstone Blocks 08
  sand: { design: 8, meters: 15, gain: 1.9, bump: 1 },     // Coast Sand 01
  tile: { design: 4, meters: 4, gain: 1.05, bump: 3 },     // Floor Tiles 04 (its grout is shallow too)
  wood: { design: 2, meters: 1.9, gain: 0.3, bump: 1 },    // Raw Plank Wall (roofs were the crate's dark frame color)
};
const usePhoto = (m, P) => { m.color.multiplyScalar(P.gain); m.normalScale.setScalar(P.bump); };

// (onload rather than decode(): decode() waits while the tab is in the background)
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img); img.onerror = reject;
    img.src = url;
  });
}

function loadPhotos(tex) {
  for (const [name, P] of Object.entries(PHOTOS)) {
    const url = (kind) => new URL(`../assets/textures/${name}_${kind}.jpg`, import.meta.url).href;
    const apply = ([color, normal]) => {
      const k = P.design / P.meters;
      for (const [t, img] of [[tex[name], color], [tex[name + 'N'], normal]]) {
        t.image = img; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(k, k); t.needsUpdate = true;
      }
      tex.photo[name] = P;
      for (const m of tex.mats[name] || []) usePhoto(m, P);
      if (name === 'wood') { paintCratePhoto(tex.crate.image, color); tex.crate.needsUpdate = true; }
    };
    Promise.all([loadImage(url('color')), loadImage(url('normal'))])
      .then(apply, () => { /* offline or missing: keep the drawn texture */ });
  }
}

// Map surface material. High quality: physically based with surface detail (normal map).
// Performance: cheap matte shading.
export function surfaceMaterial(tex, name, extra = {}) {
  if (tex.quality !== 'high' || !tex[name + 'N']) {
    const { roughness, metalness, ...lambert } = extra;   // (physically based options only)
    return new THREE.MeshLambertMaterial({ map: tex[name], vertexColors: true, ...lambert });
  }
  const m = new THREE.MeshStandardMaterial({
    map: tex[name], normalMap: tex[name + 'N'], normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.95, metalness: 0, vertexColors: true, ...extra,
  });
  // the photo's brightness match: now if it's in, or when it arrives
  if (tex.photo[name]) usePhoto(m, tex.photo[name]);
  else (tex.mats[name] ||= []).push(m);
  return m;
}
