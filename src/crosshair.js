// Static crosshair presets (no spread / no movement gap), using CS2-style settings:
// size = line length, gap (can be negative), thickness, dot, outline, T-style, color.
// Pro-inspired values are the ones most commonly reported in 2026 crosshair guides.
export const CROSSHAIRS = [
  { id: 'classic', name: 'Classic Green', size: 5, gap: 1, thickness: 0.5, outline: true, color: '#32fa32' },
  { id: 's1mple', name: 's1mple', size: 2, gap: -2, thickness: 0, outline: false, color: '#32fa32' },
  { id: 'zywoo', name: 'ZywOo', size: 1, gap: -4, thickness: 1, outline: false, color: '#00ffff' },
  { id: 'niko', name: 'NiKo', size: 1.5, gap: -3, thickness: 0, outline: false, color: '#00ffff' },
  { id: 'donk', name: 'donk', size: 1, gap: -3, thickness: 1, outline: false, color: '#32fa32' },
  { id: 'monesy', name: 'm0NESY', size: 1, gap: -4, thickness: 0, outline: false, color: '#00ffff' },
  { id: 'tshape', name: 'T-Shape', size: 3, gap: -1, thickness: 1, outline: true, color: '#32fa32', tStyle: true },
  { id: 'dot', name: 'Dot Only', size: 0, gap: 0, thickness: 1.5, outline: true, color: '#ffffff', dot: true },
  { id: 'crossdot', name: 'Cross + Dot', size: 3, gap: 0, thickness: 1, outline: true, color: '#ffff00', dot: true },
  { id: 'circle', name: 'Circle + Dot', size: 0, gap: 0, thickness: 1, outline: true, color: '#ff4fd8', dot: true, circle: 7 },
];

export function getCrosshair(id) { return CROSSHAIRS.find((c) => c.id === id) || CROSSHAIRS[0]; }

// Draws the crosshair centered on a canvas. `scale` = CSS pixels per CS2 pixel.
// cssW / cssH = the canvas' size on screen in CSS pixels.
export function drawCrosshair(canvas, preset, scale, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = scale * dpr;
  const cx = Math.floor(canvas.width / 2), cy = Math.floor(canvas.height / 2);
  const t = Math.max(1, Math.round(Math.max(1, preset.thickness * 2) * k));      // line thickness
  const len = Math.round(preset.size * 2.6 * k);                                  // line length
  const gap = Math.round(Math.max(0, preset.gap + 4) * k);                        // distance from center
  const half = Math.floor(t / 2);
  const o = preset.outline ? Math.max(1, Math.round(k)) : 0;

  const rects = [];
  if (len > 0) {
    rects.push([cx + half + gap + (t % 2), cy - half, len, t]);       // right
    rects.push([cx - half - gap - len, cy - half, len, t]);           // left
    rects.push([cx - half, cy + half + gap + (t % 2), t, len]);       // bottom
    if (!preset.tStyle) rects.push([cx - half, cy - half - gap - len, t, len]); // top
  }
  if (preset.dot) rects.push([cx - half, cy - half, t, t]);

  if (o) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    for (const [x, y, w, h] of rects) ctx.fillRect(x - o, y - o, w + o * 2, h + o * 2);
  }
  ctx.fillStyle = preset.color;
  for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);

  if (preset.circle) {
    const r = preset.circle * k;
    ctx.lineWidth = Math.max(1, Math.round(k));
    if (o) {
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth += o * 2;
      ctx.beginPath(); ctx.arc(cx + 0.5, cy + 0.5, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(1, Math.round(k));
    }
    ctx.strokeStyle = preset.color;
    ctx.beginPath(); ctx.arc(cx + 0.5, cy + 0.5, r, 0, Math.PI * 2); ctx.stroke();
  }
}

// In-game scale: grows a little on big screens so tiny pro crosshairs stay visible.
export function crosshairScale() { return Math.max(1, Math.min(2, innerHeight / 900)); }
