// Graphics quality (read once when the page loads) and the materials that depend on it.
// Ultra: High plus screen effects (glow and ambient occlusion, see postfx.js) and sharper
//        shadows/resolution. Costly: for strong graphics cards.
// High (default): physically based materials, which pick up the sky's soft light and show
//        highlights, photo textures and 3D gun models. No screen effects.
// Low (performance mode): the cheaper matte and shiny materials, drawn textures, hand-built guns.
import * as THREE from 'three';

let saved = null;
try { saved = localStorage.getItem('defuse.quality'); } catch (_) { /* storage unavailable */ }
const asked = new URLSearchParams(location.search).has('low') ? 'low' : saved;
export const QUALITY = asked === 'low' || asked === 'ultra' ? asked : 'high';
export const HIGH = QUALITY !== 'low';         // realistic materials, photo textures, 3D guns
export const EFFECTS = QUALITY === 'ultra';    // glow + ambient occlusion

// Matte surfaces: wood, skin, cloth, stone, painted things. Takes MeshLambertMaterial options;
// `pbr` overrides the High look (roughness, metalness).
export function matte(opts = {}, pbr = {}) {
  if (!HIGH) return new THREE.MeshLambertMaterial(opts);
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...opts, ...pbr });
}

// Shiny surfaces: metal, gold, lacquer. Takes MeshPhongMaterial options; on High the Phong-only
// ones are dropped and the shininess becomes a roughness, unless `pbr` sets one.
const PHONG_ONLY = ['shininess', 'specular', 'combine', 'reflectivity', 'refractionRatio'];
export function glossy(opts = {}, pbr = {}) {
  if (!HIGH) return new THREE.MeshPhongMaterial(opts);
  const o = { ...opts };
  const roughness = Math.min(1, 1.6 * Math.sqrt(2 / ((o.shininess ?? 30) + 2)));
  for (const k of PHONG_ONLY) delete o[k];
  return new THREE.MeshStandardMaterial({ roughness, metalness: 0, ...o, ...pbr });
}

// With the screen effects, see-through effects blend in linear light before the final color step,
// so pale mist and light beams over a dark night look brighter and heavier. These keep the usual look.
export const BEAM_OPACITY = EFFECTS ? 0.7 : 1;
export const MIST_OPACITY = EFFECTS ? 0.5 : 1;
export const beamColor = (hex) => (EFFECTS ? new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.3) : new THREE.Color(hex));

// Something that gives off light (fire, a lamp): with the screen effects it's brighter than white, so it glows.
export const glowColor = (hex, k) => new THREE.Color(hex).multiplyScalar(EFFECTS ? k : 1);

// Zombies map: how many of its lamps really light things up at once (the ones nearest to where
// you're looking; the rest just glow). Every real light costs on every pixel drawn.
export const LAMP_LIGHTS = EFFECTS ? 10 : 6;
