// Graphics quality (read once when the page loads) and the materials that depend on it.
// High: physically based materials, which pick up the sky's soft light and show highlights.
// Low (performance mode): the cheaper matte and shiny materials.
import * as THREE from 'three';

let saved = null;
try { saved = localStorage.getItem('defuse.quality'); } catch (_) { /* storage unavailable */ }
export const QUALITY = new URLSearchParams(location.search).has('low') || saved === 'low' ? 'low' : 'high';
export const HIGH = QUALITY === 'high';

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

// On High, see-through effects blend in linear light before the final color step, so pale mist
// and light beams over a dark night look brighter and heavier than on Low. These keep the Low look.
export const BEAM_OPACITY = HIGH ? 0.7 : 1;
export const MIST_OPACITY = HIGH ? 0.5 : 1;
export const beamColor = (hex) => (HIGH ? new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.3) : new THREE.Color(hex));

// Something that gives off light (fire, a lamp): on High it's brighter than white, so it glows.
export const glowColor = (hex, k) => new THREE.Color(hex).multiplyScalar(HIGH ? k : 1);
