// "Sahur Village": the Zombies map. A night-time village built on a grid of 2m cells.
// You start at the Gun Shop in the middle of the Courtyard. The other areas sit behind doors
// (some down winding corridors) that open by themselves as you survive rounds; zombies climb in
// through boarded windows (spawning in small pockets outside) or rise out of the ground. Three
// of the areas are upstairs, on a second floor over the solid block between the Courtyard and
// Sahur Hill (see UPSTAIRS). The props and decoration are built in zdecor.js.
import * as THREE from 'three';
import { BoxBuilder } from './map.js';
import { surfaceMaterial } from './textures.js';
import { solidDistance, mergeBands, blockHash, addEdgeTrims, buildContactShadows } from './mapkit.js';
import { WEAPONS, ZOMBIE_SHOP, ZOMBIE_PRICES } from './weapons.js';
import { displayGuns } from './viewmodel.js';
import { buildMound, buildTrees, buildLogs, buildStalls, buildBunting, buildWallDecor } from './zdecor.js';

const C = 2;                 // cell size in meters
const GW = 60, GH = 40;
export const ZW = GW * C, ZH = GH * C;   // 120 m x 80 m
export const ZWORLD = ZW;

// [x0, z0, x1, z1] in cells, end exclusive. floor: tint of the indoor tiles; paving / earth: an
// outdoor ground patch (stone paving or dark soil). after: how many rounds you have to survive
// before it opens (one more area per round, working outward from the Courtyard).
export const AREAS = {
  A: { name: 'Village Hall', rect: [15, 27, 25, 35], indoor: true, after: 1 },
  B: { name: 'Courtyard', rect: [10, 11, 30, 24], after: 0 },
  C: { name: 'Kitchen', rect: [27, 25, 37, 37], indoor: true, after: 2 },
  D: { name: 'Drum Tower', rect: [14, 2, 26, 8], indoor: true, after: 3 },
  E: { name: 'Garden', rect: [4, 13, 9, 27], after: 4 },
  F: { name: 'Sahur Hill', rect: [40, 4, 56, 22], after: 6 },
  G: { name: 'Night Market', rect: [46, 28, 58, 38], paving: [0.62, 0.58, 0.66], after: 9 },
  H: { name: 'Rice Barn', rect: [32, 3, 39, 10], indoor: true, floor: [0.78, 0.6, 0.42], after: 5 },
  I: { name: 'Dead Orchard', rect: [1, 33, 14, 39], earth: [0.5, 0.44, 0.38], after: 8 },
  // upstairs (upper: not carved out of the ground grid, the rooms sit on top of it)
  J: { name: 'Lantern Loft', rect: [30, 13, 33, 18], upper: true, after: 7 },
  K: { name: 'Sleeping Loft', rect: [33, 13, 37, 18], upper: true, after: 10 },
  L: { name: 'Lookout', rect: [37, 13, 40, 18], upper: true, after: 11 },
};
export const START_AREA = 'B';
// The second floor. Its rooms stand on the solid block of cells under them (nothing walks
// underneath), so the zombies' one-layer path grid still works: upstairs cells are just cells
// whose floor is FL high. Outdoor stairs climb to it from the Courtyard and from Sahur Hill.
export const FL = 4.4;                          // upstairs floor height
const UP_H = 4.8;                               // floor to roof; doorways are UP_H - 0.7 (the giant fits)
export const UPSTAIRS = [30, 13, 40, 18];       // the cells under the rooms
// Upstairs walls (thin, like the huts): a line at world x or z, the cells it runs along, and which
// of those cells are doorways (bought, see DOORS), windows or balconies (a waist-high railing).
const UP_WALLS = [
  { line: 'z', at: 26, cells: [30, 40], windows: [31, 34, 35, 38] },   // north, over the path to the Rice Barn
  { line: 'z', at: 36, cells: [30, 40], windows: [31, 33, 36] },       // south, over the path to Sahur Hill
  { line: 'x', at: 60, cells: [13, 18], doors: [13], balcony: [15, 16] }, // west: over the Courtyard
  { line: 'x', at: 80, cells: [13, 18], doors: [17], balcony: [14, 15] }, // east: over Sahur Hill
  { line: 'x', at: 66, cells: [13, 18], doors: [15] },                 // Lantern Loft | Sleeping Loft
  { line: 'x', at: 74, cells: [13, 18], doors: [15] },                 // Sleeping Loft | Lookout
];
// Outdoor stone stairs: the column of cells they climb, the landing at the top (at a door), and
// which way they come up from (+1: from higher z).
const UP_STAIRS = [
  { x: 29, landing: 13, from: 1 },    // Courtyard: up along its east wall to the Lantern Loft
  { x: 40, landing: 17, from: -1 },   // Sahur Hill: up along its west wall to the Lookout
];
const CORRIDORS = [[19, 24, 21, 27], [25, 30, 27, 32], [27, 24, 29, 25], [19, 8, 21, 11], [9, 17, 10, 19],
  [30, 18, 40, 20],                                       // Courtyard -> Sahur Hill
  [37, 33, 44, 35], [42, 22, 44, 35],                     // Kitchen -> Sahur Hill (alley)
  [44, 29, 46, 31],                                       // alley -> Night Market
  [54, 22, 56, 25], [54, 24, 58, 26], [56, 25, 58, 28],   // Sahur Hill -> Night Market (zig-zag)
  [30, 11, 38, 13], [36, 10, 38, 11],                     // Courtyard -> Rice Barn (bends north)
  [39, 5, 40, 7],                                         // Rice Barn -> Sahur Hill
  [1, 24, 4, 26], [1, 26, 3, 33],                         // Garden -> Dead Orchard (winding path)
  [14, 33, 15, 35],                                       // Village Hall -> Dead Orchard
];
// Doors between two areas. Nobody buys them: each one opens by itself at the end of the round
// that opens the second of its two areas (its `after`, worked out below).
const DOORS = [
  { id: 'd1', cells: [19, 25, 21, 26], areas: ['A', 'B'] },
  { id: 'd2', cells: [26, 30, 27, 32], areas: ['A', 'C'] },
  { id: 'd3', cells: [27, 24, 29, 25], areas: ['B', 'C'] },
  { id: 'd4', cells: [19, 9, 21, 10], areas: ['B', 'D'] },
  { id: 'd5', cells: [9, 17, 10, 19], areas: ['B', 'E'] },
  { id: 'd6', cells: [39, 18, 40, 20], areas: ['B', 'F'] },
  { id: 'd7', cells: [37, 33, 38, 35], areas: ['C', 'F'] },
  { id: 'd8', cells: [45, 29, 46, 31], areas: ['F', 'G'] },
  { id: 'd9', cells: [54, 22, 56, 23], areas: ['F', 'G'] },
  { id: 'd10', cells: [30, 11, 31, 13], areas: ['B', 'H'] },
  { id: 'd11', cells: [39, 5, 40, 7], areas: ['F', 'H'] },
  { id: 'd12', cells: [3, 24, 4, 26], areas: ['E', 'I'] },
  { id: 'd13', cells: [14, 33, 15, 35], areas: ['A', 'I'] },
  // upstairs: at the top of each staircase and between the rooms. edgeX: [x, z] = the doorway
  // between cell (x, z) and (x + 1, z), at floor height FL
  { id: 'u1', edgeX: [29, 13], areas: ['B', 'J'] },
  { id: 'u2', edgeX: [32, 15], areas: ['J', 'K'] },
  { id: 'u3', edgeX: [36, 15], areas: ['K', 'L'] },
  { id: 'u4', edgeX: [39, 17], areas: ['F', 'L'] },
];
for (const d of DOORS) d.after = Math.max(...d.areas.map((a) => AREAS[a].after));
// Smooth hills (cosine bumps): [x, z, radius, height] in meters
const HILLS = [[104, 15, 7.5, 2.6], [88, 39, 6, 1.8]];
// Flat-topped mounds with a ramp all the way round: [x, z, top radius, foot radius, height].
// The fountain sits on one, so zombies can walk up to anyone standing on it.
const MOUNDS = [[40, 34, 3.2, 6.4, 0.9]];
// Roofs over the indoor areas: high enough for the biggest zombies, under the lowest walls (5 m)
const ROOF_Y = 4.9;
// Walk-in huts with thin walls. rect = world meters on cell lines; `skip` = sides that already
// are map walls; doors/windows = [side, cell index along that side]. h: wall height (doorways are
// h - 0.7 tall, so even the rainbow giant fits); light: a lantern that lights the inside.
const HUTS = [
  { rect: [80, 8, 88, 16], skip: ['n', 'w'], doors: [['e', 6]], windows: [['s', 41]], h: 5, lantern: [84, 4.2, 12], light: true, roof: 0 },
  // the Gun Shop (see GUN_SHOP), walk-through; its north wall holds the gun rack
  { rect: [48, 36, 56, 44], skip: [], doors: [['w', 19], ['e', 20]], windows: [['s', 26]], h: 5, lantern: [52, 4.2, 38.8], light: true, roof: 1 },
  // Night Market shop ("warung"), walk-through
  { rect: [100, 62, 108, 70], skip: [], doors: [['w', 32], ['e', 33]], windows: [['n', 51], ['s', 52]], h: 5, lantern: [104, 4.2, 66], roof: 2, tiles: false },
  // Dead Orchard tool shed, walk-through
  { rect: [16, 70, 20, 74], skip: [], doors: [['n', 8], ['s', 9]], windows: [['w', 35], ['e', 36]], h: 4.8, lantern: [18, 4.0, 72], roof: 0 },
];
// tiered roof colors for the huts
const HUT_ROOFS = [[0.62, 0.3, 0.2], [0.36, 0.42, 0.5], [0.3, 0.45, 0.32]];
// Watchtower ("pos ronda") with a hanging kentongan: stairs on the west, ladder on the east.
const TOWER = {
  x0: 96, z0: 30, x1: 102, z1: 36, top: 4.0,
  stairs: { x0: 90, x1: 96, z0: 32, z1: 34, steps: 10 },
  ladder: { x0: 102, x1: 103, z0: 32.4, z1: 33.6, y0: -0.2, y1: 4.6, top: 4.0, out: [1, 0] },
};
// boarded windows: wall cell, outward direction, and the spawn pocket carved outside
const WINDOWS = [
  { cell: [14, 30], dir: [-1, 0], pocket: [11, 29, 14, 32], area: 'A' },
  { cell: [20, 35], dir: [0, 1], pocket: [19, 36, 22, 39], area: 'A' },
  { cell: [16, 26], dir: [0, -1], pocket: [15, 25, 18, 26], area: 'A' },
  { cell: [11, 10], dir: [0, -1], pocket: [10, 7, 13, 10], area: 'B' },
  { cell: [23, 24], dir: [0, 1], pocket: [22, 25, 25, 26], area: 'B' },
  { cell: [28, 10], dir: [0, -1], pocket: [27, 7, 30, 10], area: 'B' },
  { cell: [37, 30], dir: [1, 0], pocket: [38, 29, 39, 32], area: 'C' },
  { cell: [32, 37], dir: [0, 1], pocket: [31, 38, 34, 39], area: 'C' },
  { cell: [34, 24], dir: [0, -1], pocket: [33, 21, 36, 24], area: 'C' },
  { cell: [13, 4], dir: [-1, 0], pocket: [10, 3, 13, 6], area: 'D' },
  { cell: [26, 4], dir: [1, 0], pocket: [27, 3, 30, 6], area: 'D' },
  { cell: [3, 20], dir: [-1, 0], pocket: [1, 19, 3, 22], area: 'E' },
  { cell: [6, 27], dir: [0, 1], pocket: [5, 28, 8, 31], area: 'E' },
  { cell: [6, 12], dir: [0, -1], pocket: [5, 9, 8, 12], area: 'E' },
  { cell: [47, 3], dir: [0, -1], pocket: [46, 1, 49, 3], area: 'F' },
  { cell: [56, 12], dir: [1, 0], pocket: [57, 11, 59, 14], area: 'F' },
  { cell: [50, 22], dir: [0, 1], pocket: [49, 23, 52, 26], area: 'F' },
];
// world-space obstacles [x0, y0, z0, x1, y1, z1, look]. look: 'stone', 'crate' or 'none' (drawn elsewhere)
const OBSTACLES = [
  [39.1, 0, 33.1, 40.9, 3.2, 34.9, 'none'],     // fountain pillar (drawn with the mound)
  [27.2, 0, 25.2, 28.8, 1.2, 26.8, 'crate'],   // courtyard crates
  [51, 0, 29, 53, 1.2, 31, 'crate'],
  [10, 0, 40, 12, 0.8, 44, 'crate'],           // garden planter
  [62, 0, 62, 66, 0.9, 64, 'crate'],           // kitchen table
  [60, 0, 50.2, 66, 1.0, 51.4, 'crate'],       // kitchen counter
  [46, 0, 12, 48, 1.2, 14, 'crate'],           // tower crate
  // Rice Barn: wooden stall walls make a winding path through it
  [70.88, 0, 6, 71.12, 2.8, 14, 'stall'],
  [66.88, 0, 12, 67.12, 2.8, 20, 'stall'],
  [74.6, 0, 6.4, 77.4, 1.3, 8.6, 'crate'],     // feed crates by the back wall
  [64.1, 0, 15.6, 66.7, 1.05, 19.8, 'none'],   // log pile (drawn with the logs)
  // Dead Orchard: gravestones
  [22.6, 0, 70.85, 23.4, 1.0, 71.15, 'stone'], [26.6, 0, 76.85, 27.4, 0.9, 77.15, 'stone'],
  [3.6, 0, 70.85, 4.4, 0.95, 71.15, 'stone'], [8.6, 0, 76.85, 9.4, 0.85, 77.15, 'stone'],
];
// Night Market stalls against the north / south walls: a counter (the collider), posts and a striped
// canopy stretching back to the wall at z = back. Each counter covers exactly two grid cells, so
// there's always a way round to the back of the stall (no hiding spots zombies can't reach).
const STALLS = [
  { counter: [94.5, 72.5, 97.5, 73.2], back: 76, colors: [0xd8343a, 0xf2e6c8] },
  { counter: [102.5, 72.5, 105.5, 73.2], back: 76, colors: [0x2f6fd0, 0xf2e6c8] },
  { counter: [110.5, 72.5, 113.5, 73.2], back: 76, colors: [0x3aa45a, 0xf2c230] },
  { counter: [94.5, 58.8, 97.5, 59.5], back: 56, colors: [0xf07a2a, 0xf2e6c8] },
  { counter: [102.5, 58.8, 105.5, 59.5], back: 56, colors: [0xb04ac8, 0xf2c230] },
];
// dead trees [x, z, size]: a trunk collider stops you walking through them
const TREES = [
  [5, 69, 1.1], [11, 77, 0.95], [23, 67, 1.05], [25, 77, 0.85],   // Dead Orchard
  [23, 39, 1.0], [57, 45, 1.15],                                // Courtyard
  [11, 51, 0.9],                                                // Garden
  [85, 31, 1.1], [111, 27, 1.0],                                // Sahur Hill
  [115, 63, 0.8],                                               // Night Market
];
// fallen logs [x, z, length, radius, axis] (lying along x or z)
const LOGS = [
  [10, 68.6, 3.2, 0.32, 'x'], [25, 74.4, 2.4, 0.3, 'z'], [5, 74.6, 2.6, 0.28, 'z'],   // Dead Orchard
  [44.5, 45, 3, 0.32, 'x'], [23.2, 33.6, 2.6, 0.3, 'z'],                                 // Courtyard
  [5.6, 56, 2.6, 0.28, 'z'],                                                               // orchard path
  [96, 20.6, 3, 0.32, 'x'], [104.6, 40.4, 2.8, 0.3, 'z'],                                  // Sahur Hill
];
export const PERKS = [
  { id: 'quick', name: 'Quick Revive', short: 'QR', cost: 500, color: 0x3aa8ff, pos: [49.5, 0, 57], face: [-1, 0, 0], area: 'A' },
  { id: 'speed', name: 'Speed Cola', short: 'SC', cost: 3000, color: 0x3ad16b, pos: [58, 0, 73.5], face: [0, 0, -1], area: 'C' },
  { id: 'dtap', name: 'Double Tap', short: 'DT', cost: 2000, color: 0xf2c230, pos: [17.5, 0, 29], face: [-1, 0, 0], area: 'E' },
  { id: 'jugg', name: 'Juggernog', short: 'JN', cost: 2500, color: 0xe03a2a, pos: [28.5, 0, 13], face: [1, 0, 0], area: 'D' },
];
// Pack-a-Punch stations: each upgrades a gun one level further (I -> IV, in order), deeper into the map.
// The last one sits on top of the watchtower.
export const PAP_STATIONS = [
  { level: 1, pos: [44, 0, 4.7], face: [0, 0, 1], cost: 5000, area: 'D', color: 0xc070ff, ink: '#d9a6ff' },
  { level: 2, pos: [70.5, 0, 73.3], face: [0, 0, -1], cost: 10000, area: 'C', color: 0x4fe3ff, ink: '#a8f3ff' },
  { level: 3, pos: [8.7, 0, 31], face: [1, 0, 0], cost: 15000, area: 'E', color: 0xffc93a, ink: '#ffe49a' },
  { level: 4, pos: [99, 4, 30.75], face: [0, 0, 1], cost: 25000, area: 'F', color: 0xff3b3b, ink: '#ffa0a0' },
];
export const BOX = { pos: [24, 0, 45.5], cost: 950, area: 'B' };
// The Gun Shop: the walk-in hut in the middle of the Courtyard (the middle of the village), where
// everyone spawns and buys guns (E at the counter). The counter runs along the north wall, flush
// with it so there's nothing to hide behind; the guns hang on the wall above it and show up as
// they unlock. rack: rows of [y, keys] in the order they unlock.
export const GUN_SHOP = {
  rect: [48, 36, 56, 44],
  counter: [48.6, 36.15, 55.4, 37.0], counterH: 1.05,
  front: [49.2, 54.8, 37.5],          // the line in front of the counter you buy from (x0, x1, z)
  reach: 1.9,
  rack: [[1.9, ['deagle', 'smg', 'shotgun', 'm16', 'scout']], [3.1, ['ak', 'm4', 'sniper', 'lmg']]],
  area: 'B',
};
const GROUND_SPAWNS = [
  { pos: [26, 0, 29], area: 'B' }, { pos: [44, 0, 26], area: 'B' }, { pos: [30, 0, 41], area: 'B' },
  { pos: [34, 0, 8], area: 'D' }, { pos: [48, 0, 8], area: 'D' },
  { pos: [13, 0, 34], area: 'E' }, { pos: [66, 0, 70], area: 'C' }, { pos: [58, 0, 56], area: 'C' },
  { pos: [108, 0, 40], area: 'F' }, { pos: [93, 0, 24], area: 'F' }, { pos: [84, 0, 22], area: 'F' }, { pos: [104, 0, 15], area: 'F' },
  { pos: [97, 0, 65], area: 'G' }, { pos: [111, 0, 61], area: 'G' }, { pos: [111, 0, 69], area: 'G' },
  { pos: [65, 0, 7], area: 'H' }, { pos: [75, 0, 17], area: 'H' },
  { pos: [7, 0, 73], area: 'I' }, { pos: [25, 0, 71], area: 'I' }, { pos: [17, 0, 67], area: 'I' },   // the graves
  // upstairs: only flyers come in here (down from the rafters), the rest take the stairs
  { pos: [63, 0, 30], area: 'J', fly: true }, { pos: [70, 0, 31], area: 'K', fly: true }, { pos: [77, 0, 30], area: 'L', fly: true },
];
export const PLAYER_START = new THREE.Vector3(52, 0, 40.6);   // in the Gun Shop, facing the counter
// bunting strings with little flags (and paper lanterns): [x0, y0, z0, x1, y1, z1, lanterns]
const BUNTING = [
  [20.3, 4.6, 27, 59.8, 7.3, 27, false], [20.3, 4.4, 46.5, 59.7, 4.4, 46.5, false], [20.3, 4.8, 23, 44.6, 4.8, 47.7, false],   // Courtyard
  [60.6, FL + 3.7, 27.4, 65.4, FL + 3.5, 34.6, true], [60.6, FL + 3.6, 34.6, 65.4, FL + 3.7, 27.4, true],                    // Lantern Loft
  [30.3, 4.5, 58, 49.7, 4.5, 58, false], [30.3, 4.5, 66, 49.7, 4.5, 66, false],                                              // Village Hall
  [92.3, 4.7, 61.2, 115.7, 4.7, 61.2, true], [92.3, 4.7, 70.6, 115.7, 4.7, 70.6, true], [96, 4.9, 56.3, 96, 4.9, 75.7, true], // Night Market
  [112, 4.9, 56.3, 112, 4.9, 75.7, true],
];
const LIGHTS = [
  { pos: [40, 3.6, 62], color: 0xffb36b, intensity: 110, dist: 28 },
  { pos: [30, 3.4, 34], color: 0xffa860, intensity: 90, dist: 24, post: true },
  { pos: [52, 3.4, 25], color: 0xffa860, intensity: 90, dist: 24, post: true },
  { pos: [64, 3.6, 62], color: 0xffb36b, intensity: 110, dist: 28 },
  { pos: [36, 3.6, 10], color: 0xffb36b, intensity: 100, dist: 26 },
  { pos: [44, 1.8, 6.6], color: 0xb050ff, intensity: 30, dist: 9 },
  { pos: [13, 3.4, 39], color: 0xffa860, intensity: 90, dist: 24, post: true },
  { pos: [92, 3.4, 22], color: 0xffa860, intensity: 90, dist: 24, post: true },
  { pos: [99, 6.1, 33], color: 0xffb36b, intensity: 80, dist: 22 },          // tower lantern
  { pos: [104, 4.4, 59], color: 0xff9a6a, intensity: 95, dist: 26 },         // Night Market (hangs from the bunting)
  { pos: [74.5, 4.3, 12.5], color: 0xffb36b, intensity: 95, dist: 24 },     // Rice Barn
  { pos: [13, 3.4, 67], color: 0xb8d4ff, post: true, glowOnly: true },        // Dead Orchard: a cold lamp, moonlight does the rest
  // upstairs: two lights near the room walls, each lighting the rooms on both sides (lanterns: see buildUpstairs)
  { pos: [64.5, FL + 3.6, 31], color: 0xffb36b, intensity: 48, dist: 14, noLamp: true },
  { pos: [75.5, FL + 3.6, 31], color: 0xffb36b, intensity: 48, dist: 14, noLamp: true },
];
// Upstairs furniture: [x0, z0, x1, z1, height, look]. Colliders (bed mats are flat and have none).
const UP_PROPS = [
  [60.25, 34.3, 61.75, 35.75, 0.5, 'table'],      // Lantern Loft: low table in the corner
  [72.5, 26.2, 73.8, 27.1, 0.75, 'chest'],        // Sleeping Loft: a chest under the window
  [74.3, 26.3, 75.9, 27.9, 1.45, 'drum'],         // Lookout: a big bedug drum on its stand
];
const UP_MATS = [[66.4, 33.4, 68.4, 35.6], [71.6, 33.4, 73.6, 35.6]];   // sleeping mats along the south wall (Sleeping Loft)

// ---------- small canvas helpers for signs ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function signTex(lines, bg, fg = '#fff', w = 256, h = 96) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = `700 ${i === 0 ? 34 : 24}px Rajdhani, sans-serif`;
      ctx.fillText(l, w / 2, h / (lines.length + 1) * (i + 1) + (i === 0 ? 2 : 0));
    });
  });
}

// Gun Shop price tag: the gun's name, and its price (or when it unlocks) underneath
function tagTex(name, line2, color) {
  return canvasTex(256, 82, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(20,14,9,0.92)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,214,140,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 30px Rajdhani, sans-serif'; ctx.fillStyle = '#f4e2b0'; ctx.fillText(name, w / 2, 27);
    ctx.font = '700 25px Rajdhani, sans-serif'; ctx.fillStyle = color; ctx.fillText(line2, w / 2, 60);
  });
}
// a glowing shop sign (no lighting needed: it's for MeshBasicMaterial)
function neonTex(title, sub, w = 512, h = 150) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#160e07'; ctx.fillRect(0, 0, w, h);
    ctx.shadowColor = '#ffae3a'; ctx.shadowBlur = 16;
    ctx.strokeStyle = '#ffb648'; ctx.lineWidth = 6; ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffe6a8';
    ctx.font = `700 ${sub ? 66 : 84}px Rajdhani, sans-serif`;
    ctx.fillText(title, w / 2, sub ? h * 0.4 : h / 2 + 4);
    if (sub) { ctx.shadowBlur = 6; ctx.font = '600 27px Rajdhani, sans-serif'; ctx.fillStyle = '#ffc870'; ctx.fillText(sub, w / 2, h * 0.75); }
  });
}

class Heap {
  constructor() { this.ids = []; this.f = []; }
  get size() { return this.ids.length; }
  push(id, f) {
    const a = this.ids, fs = this.f; a.push(id); fs.push(f);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (fs[p] <= fs[i]) break; [a[p], a[i]] = [a[i], a[p]]; [fs[p], fs[i]] = [fs[i], fs[p]]; i = p; }
  }
  pop() {
    const a = this.ids, fs = this.f, top = a[0], li = a.pop(), lf = fs.pop();
    if (a.length) {
      a[0] = li; fs[0] = lf; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && fs[l] < fs[m]) m = l;
        if (r < a.length && fs[r] < fs[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [fs[m], fs[i]] = [fs[i], fs[m]]; i = m;
      }
    }
    return top;
  }
}

const box = new THREE.BoxGeometry(1, 1, 1);
const _lines = new Int32Array(6);   // clearLine: the cell each of its three lines is in
function mesh(geo, material, x, y, z, sx = 1, sy = 1, sz = 1, parent = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export class ZMap {
  constructor(scene, tex) {
    this.scene = scene;
    this.grid = new Uint8Array(GW * GH).fill(1);
    this.navBlock = new Uint8Array(GW * GH);
    const carve = (r, block) => {
      for (let z = r[1]; z < r[3]; z++) for (let x = r[0]; x < r[2]; x++) {
        this.grid[z * GW + x] = 0;
        if (block) this.navBlock[z * GW + x] = 1;
      }
    };
    for (const a of Object.values(AREAS)) if (!a.upper) carve(a.rect, false);
    for (const r of CORRIDORS) carve(r, false);
    // cells with an upstairs floor on top (still solid at ground level)
    this.upper = new Uint8Array(GW * GH);
    for (let z = UPSTAIRS[1]; z < UPSTAIRS[3]; z++) for (let x = UPSTAIRS[0]; x < UPSTAIRS[2]; x++) this.upper[z * GW + x] = 1;
    for (const w of WINDOWS) { carve(w.pocket, true); carve([w.cell[0], w.cell[1], w.cell[0] + 1, w.cell[1] + 1], true); }

    this.obstacles = OBSTACLES.map(([x0, y0, z0, x1, y1, z1]) => ({ x0, y0, z0, x1, y1, z1 }));
    // trees: the trunk; logs: the whole log; stalls: the counter along the open side
    for (const [x, z, s] of TREES) this.obstacles.push({ x0: x - 0.3 * s, y0: 0, z0: z - 0.3 * s, x1: x + 0.3 * s, y1: 3, z1: z + 0.3 * s });
    for (const [x, z, len, r, axis] of LOGS) {
      const hx = axis === 'x' ? len / 2 : r, hz = axis === 'x' ? r : len / 2;
      this.obstacles.push({ x0: x - hx, y0: 0, z0: z - hz, x1: x + hx, y1: 2 * r, z1: z + hz });
    }
    for (const { counter: [x0, z0, x1, z1] } of STALLS) this.obstacles.push({ x0, y0: 0, z0, x1, y1: 0.95, z1 });
    for (const [x0, z0, x1, z1, h] of UP_PROPS) this.obstacles.push({ x0, y0: FL, z0, x1, y1: FL + h, z1 });
    for (const p of PERKS) this.obstacles.push(this.machineBox(p.pos, p.face, 1.1, 0.9, 2.1));
    for (const st of PAP_STATIONS) this.obstacles.push(this.machineBox(st.pos, st.face, 1.6, 1.2, 1.9));
    this.obstacles.push({ x0: BOX.pos[0] - 0.9, y0: 0, z0: BOX.pos[2] - 0.4, x1: BOX.pos[0] + 0.9, y1: 0.9, z1: BOX.pos[2] + 0.4 });
    { const [x0, z0, x1, z1] = GUN_SHOP.counter; this.obstacles.push({ x0, y0: 0, z0, x1, y1: GUN_SHOP.counterH, z1 }); }
    for (const l of LIGHTS) if (l.post) this.obstacles.push({ x0: l.pos[0] - 0.15, y0: 0, z0: l.pos[2] - 0.15, x1: l.pos[0] + 0.15, y1: 3.3, z1: l.pos[2] + 0.15 });

    // walls: layered heights (street walls share a height per block, taller buildings behind)
    const isSolid = (x, z) => this.solid(x, z);
    const dist = solidDistance(isSolid, GW, GH);
    // (band 9: the ground floor under the upstairs rooms, as high as their floor)
    const rects = mergeBands(isSolid, (x, z) => (this.upper[z * GW + x] ? 9 : Math.min(3, dist[z * GW + x])), GW, GH, 10);
    const bandH = [0, 5, 6.5, 8];
    // painted plaster: mostly creams, with some pastel houses (pink, mint, sky blue, butter, lilac)
    const tints = [[0.95, 0.93, 0.88], [0.88, 0.86, 0.82], [0.93, 0.89, 0.82], [0.96, 0.82, 0.76],
      [0.8, 0.9, 0.8], [0.8, 0.86, 0.96], [0.98, 0.92, 0.7], [0.88, 0.82, 0.94], [0.94, 0.9, 0.86]];
    this.cellH = new Float32Array(GW * GH);
    this.staticColliders = [];
    for (const rc of rects) {
      const cx = rc.x + rc.w / 2, cz = rc.z + rc.d / 2;
      rc.y = rc.band === 9 ? FL : bandH[rc.band] + Math.floor(blockHash(cx, cz, 5) * 3) * 0.5;
      rc.tint = rc.band === 9 ? [0.93, 0.87, 0.78] : tints[Math.floor(blockHash(cx + 50, cz, 7) * tints.length)];
      for (let z = rc.z; z < rc.z + rc.d; z++) for (let x = rc.x; x < rc.x + rc.w; x++) this.cellH[z * GW + x] = rc.y;
      this.staticColliders.push({ x0: rc.x * C, z0: rc.z * C, x1: (rc.x + rc.w) * C, z1: (rc.z + rc.d) * C, y0: 0, y1: rc.y });
    }
    for (const o of this.obstacles) this.staticColliders.push(o);
    // roofs over the indoor areas
    this.roofs = [];
    for (const a of Object.values(AREAS)) {
      if (!a.indoor) continue;
      const [x0, z0, x1, z1] = a.rect;
      const roof = { x0: (x0 - 1) * C, z0: (z0 - 1) * C, x1: (x1 + 1) * C, z1: (z1 + 1) * C, y0: ROOF_Y, y1: ROOF_Y + 0.3 };
      this.roofs.push(roof); this.staticColliders.push(roof);
    }

    // elevation + walk-in buildings
    this.hills = HILLS; this.mounds = MOUNDS;
    this.hillTop = Math.max(...HILLS.map((h) => h[3]), ...MOUNDS.map((m) => m[4]));
    this.edgeX = new Uint8Array(GW * GH);   // wall between cell (x,z) and (x+1,z)
    this.edgeZ = new Uint8Array(GW * GH);   // wall between cell (x,z) and (x,z+1)
    this.navHOverride = new Map();          // cells whose walkable surface isn't the ground (tower, stairs, upstairs)
    this.ladders = [];
    this.stairs = [];                       // for the map: { x0, z0, x1, z1, up: [dx, dz] the way up }
    this.gw = GW; this.gh = GH; this.cell = C;
    this.struct = { walls: [], wood: [], stone: [], roofs: [], hutRoofs: [], tiles: [], shadow: [], lanterns: [],
      upWalls: [], planks: [], rails: [], upTrim: [] };
    for (const h of HUTS) this.buildHut(h);
    this.buildTower(TOWER);
    this.buildUpstairs();

    this.buildWindows(tex);
    this.buildDoors();
    this.colliders = [...this.staticColliders, ...this.windowFrames, ...this.doors.map((d) => d.collider)];
    this.playerColliders = [...this.colliders, ...this.windows.map((w) => w.blocker)];
    this.buildMeshes(tex, rects);
    this.buildStructureMeshes(tex);
    this.buildHillMeshes(tex);
    this.buildProps();
    this.buildNav();
    this.buildCeilings();
    this.dist = new Float32Array(GW * GH).fill(Infinity);
    this.groundSpawns = GROUND_SPAWNS.map((s) => ({ pos: new THREE.Vector3(s.pos[0], this.surfaceAt(s.pos[0], s.pos[2]), s.pos[2]), area: s.area, fly: !!s.fly }));
  }

  // ---------- terrain ----------
  groundAt(x, z) {
    let h = 0;
    for (const [hx, hz, r, height] of this.hills) {
      const dx = x - hx, dz = z - hz;
      if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
      const d = Math.hypot(dx, dz) / r;
      if (d < 1) h += height * (0.5 + 0.5 * Math.cos(Math.PI * d));
    }
    for (const [mx, mz, rTop, rFoot, height] of this.mounds) {
      const dx = x - mx, dz = z - mz;
      if (Math.abs(dx) > rFoot || Math.abs(dz) > rFoot) continue;
      const d = Math.hypot(dx, dz);
      if (d <= rTop) h += height;
      else if (d < rFoot) h += height * (0.5 + 0.5 * Math.cos(Math.PI * (d - rTop) / (rFoot - rTop)));   // the ramp
    }
    return h;
  }

  // Ray vs the hills (bullets). Returns distance or null.
  rayGround(o, d, maxT) {
    const stepLen = 0.35;
    let prevT = 0;
    for (let t = stepLen; t <= maxT + stepLen; t += stepLen) {
      const tt = Math.min(t, maxT);
      const y = o.y + d.y * tt;
      if (y > this.hillTop + 0.1 && d.y >= 0) return null;
      if (y < this.groundAt(o.x + d.x * tt, o.z + d.z * tt)) {
        let lo = prevT, hi = tt;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (o.y + d.y * mid < this.groundAt(o.x + d.x * mid, o.z + d.z * mid)) hi = mid; else lo = mid;
        }
        return hi > 0.05 ? hi : null;
      }
      prevT = tt;
      if (tt >= maxT) break;
    }
    return null;
  }

  ladderAt(p) {
    for (const l of this.ladders) {
      if (p.x >= l.x0 && p.x <= l.x1 && p.z >= l.z0 && p.z <= l.z1 && p.y >= l.y0 && p.y <= l.y1) return l;
    }
    return null;
  }

  // ---------- walk-in huts ----------
  buildHut(h) {
    const [x0, z0, x1, z1] = h.rect, T = 0.3, H = h.h;
    const S = this.struct;
    const add = (list, b, shadow) => { list.push(b); this.staticColliders.push(b); if (shadow) S.shadow.push(b); };
    const isDoor = (side, i) => h.doors.some(([s, c]) => s === side && c === i);
    const isWin = (side, i) => h.windows.some(([s, c]) => s === side && c === i);
    for (const side of ['n', 's', 'w', 'e']) {
      if (h.skip.includes(side)) continue;
      const horiz = side === 'n' || side === 's';
      const line = side === 'n' ? z0 : side === 's' ? z1 : side === 'w' ? x0 : x1;
      const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
      for (let i = a0 / C; i < a1 / C; i++) {
        const s0 = i * C - (i * C === a0 ? T / 2 : 0), s1 = (i + 1) * C + ((i + 1) * C === a1 ? T / 2 : 0);
        const box = (y0, y1) => (horiz
          ? { x0: s0, y0, z0: line - T / 2, x1: s1, y1, z1: line + T / 2 }
          : { x0: line - T / 2, y0, z0: s0, x1: line + T / 2, y1, z1: s1 });
        if (isDoor(side, i)) add(S.walls, box(H - 0.7, H), false);   // tall doorways: the giant fits
        else if (isWin(side, i)) { add(S.walls, box(0, 1.0), true); add(S.walls, box(2.6, H), false); }
        else add(S.walls, box(0, H), true);
        // block zombie pathing through this wall (doorways stay open)
        if (!isDoor(side, i)) {
          const l = line / C;
          if (horiz) this.edgeZ[(l - 1) * GW + i] = 1;
          else this.edgeX[i * GW + (l - 1)] = 1;
        }
      }
    }
    // tiered roof (like a joglo house): only the bottom tier is solid
    const tint = HUT_ROOFS[h.roof || 0];
    const tier = (inset, y0, y1, dark) => ({ x0: x0 - 0.45 + inset, y0, z0: z0 - 0.45 + inset, x1: x1 + 0.45 - inset, y1, z1: z1 + 0.45 - inset,
      tint: tint.map((c) => c * dark) });
    const base = tier(0, H, H + 0.25, 1);
    S.hutRoofs.push(base); this.staticColliders.push(base);
    S.hutRoofs.push(tier(0.9, H + 0.25, H + 0.5, 0.88), tier(1.8, H + 0.5, H + 0.72, 0.78));
    if (Math.min(x1 - x0, z1 - z0) > 6) S.hutRoofs.push(tier(2.7, H + 0.72, H + 0.86, 0.7));
    if (h.tiles !== false) S.tiles.push({ x0, y0: 0, z0, x1, y1: 0.02, z1 });   // (not on top of paving)
    if (h.lantern) S.lanterns.push({ pos: h.lantern, light: !!h.light });
  }

  // ---------- watchtower with stairs and a ladder ----------
  buildTower(t) {
    const S = this.struct;
    const add = (list, b, shadow) => { list.push(b); this.staticColliders.push(b); if (shadow) S.shadow.push(b); };
    const { x0, z0, x1, z1, top } = t;
    add(S.stone, { x0, y0: 0, z0, x1, y1: top - 0.15, z1 }, true);
    add(S.wood, { x0, y0: top - 0.15, z0, x1, y1: top, z1 }, false); // flush deck: nothing to bump your head on from the ladder
    // railings with gaps for the stairs (west) and the ladder (east)
    const R = 0.12, RH = 1.0;
    const rail = (ax0, az0, ax1, az1) => add(S.wood, { x0: ax0, y0: top, z0: az0, x1: ax1, y1: top + RH, z1: az1 }, false);
    rail(x0, z0, x1, z0 + R); rail(x0, z1 - R, x1, z1);
    rail(x0, z0, x0 + R, t.stairs.z0); rail(x0, t.stairs.z1, x0 + R, z1);
    rail(x1 - R, z0, x1, t.ladder.z0 - 0.1); rail(x1 - R, t.ladder.z1 + 0.1, x1, z1);
    // corner posts + roof
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      add(S.wood, { x0: px - 0.14, y0: top, z0: pz - 0.14, x1: px + 0.14, y1: top + 2.6, z1: pz + 0.14 }, false);
    }
    add(S.roofs, { x0: x0 - 0.6, y0: top + 2.6, z0: z0 - 0.6, x1: x1 + 0.6, y1: top + 2.9, z1: z1 + 0.6 }, false);
    S.kentongan = [(x0 + x1) / 2, top + 1.7, (z0 + z1) / 2];
    // stairs: solid steps rising toward the tower
    const st = t.stairs, tread = (st.x1 - st.x0) / st.steps, rise = top / st.steps;
    for (let i = 0; i < st.steps; i++) add(S.stone, { x0: st.x0 + i * tread, y0: 0, z0: st.z0, x1: st.x1, y1: (i + 1) * rise, z1: st.z1 }, i === 0);
    this.stairs.push({ x0: st.x0, z0: st.z0, x1: st.x1, z1: st.z1, up: [1, 0] });
    // pathing: tower cells sit at the top height; stair cells step up 1 m each; no stepping off the stair sides
    for (let cz = z0 / C; cz < z1 / C; cz++) for (let cx = x0 / C; cx < x1 / C; cx++) this.navHOverride.set(cz * GW + cx, top);
    const scz = st.z0 / C, n = (st.x1 - st.x0) / C;
    for (let k = 0; k < n; k++) {
      const cx = st.x0 / C + k;
      this.navHOverride.set(scz * GW + cx, top * (k + 1) / (n + 1));
      this.edgeZ[(scz - 1) * GW + cx] = 1; this.edgeZ[scz * GW + cx] = 1;
    }
    this.ladders.push({ ...t.ladder });
  }

  // ---------- the second floor: three rooms over the block between the Courtyard and Sahur Hill ----------
  buildUpstairs() {
    const S = this.struct, T = 0.3, top = FL + UP_H;
    const add = (list, b, shadow) => { list.push(b); this.staticColliders.push(b); if (shadow) S.shadow.push(b); };
    const [ux0, uz0, ux1, uz1] = UPSTAIRS.map((v) => v * C);
    // the floor: every cell under the rooms is walkable at FL (the solid block below holds it up)
    for (let z = UPSTAIRS[1]; z < UPSTAIRS[3]; z++) for (let x = UPSTAIRS[0]; x < UPSTAIRS[2]; x++) this.navHOverride.set(z * GW + x, FL);
    S.planks.push({ x0: ux0, y0: FL, z0: uz0, x1: ux1, y1: FL + 0.03, z1: uz1 });
    // thin walls with doorways, windows and balconies
    for (const w of UP_WALLS) {
      const [c0, c1] = w.cells;
      for (let i = c0; i < c1; i++) {
        const s0 = i * C - (i === c0 ? T / 2 : 0), s1 = (i + 1) * C + (i === c1 - 1 ? T / 2 : 0);
        const box = (y0, y1, t = T) => (w.line === 'z'
          ? { x0: s0, y0, z0: w.at - t / 2, x1: s1, y1, z1: w.at + t / 2 }
          : { x0: w.at - t / 2, y0, z0: s0, x1: w.at + t / 2, y1, z1: s1 });
        const door = !!w.doors?.includes(i);
        if (door) add(S.upWalls, box(top - 0.7, top), false);
        else if (w.windows?.includes(i)) { add(S.upWalls, box(FL, FL + 1.0), false); add(S.upWalls, box(FL + 2.6, top), false); }
        else if (w.balcony?.includes(i)) {
          // a wooden railing (plinth + top rail; the posts between are only looks) under a high lintel
          add(S.rails, box(FL, FL + 0.12, 0.2), false); add(S.rails, box(FL + 0.92, FL + 1.06, 0.2), false);
          add(S.upWalls, box(FL + 3.1, top), false);
          for (let k = 0; k < 6; k++) {
            const m = i * C + (k + 0.5) * C / 6, p = w.line === 'z' ? { x0: m - 0.03, x1: m + 0.03, z0: w.at - 0.03, z1: w.at + 0.03 }
              : { x0: w.at - 0.03, x1: w.at + 0.03, z0: m - 0.03, z1: m + 0.03 };
            S.upTrim.push({ ...p, y0: FL + 0.12, y1: FL + 0.92 });
          }
        } else add(S.upWalls, box(FL, top), false);
        // zombies can't walk through walls (doorways stay shut until their door is bought)
        if (!door) {
          const l = w.at / C;
          if (w.line === 'z') this.edgeZ[(l - 1) * GW + i] = 1;
          else this.edgeX[i * GW + (l - 1)] = 1;
        }
      }
    }
    // timber posts at the corners and a beam along the floor line, outside
    for (const [px, pz] of [[ux0, uz0], [ux1, uz0], [ux0, uz1], [ux1, uz1]]) {
      S.upTrim.push({ x0: px - 0.22, y0: FL - 0.3, z0: pz - 0.22, x1: px + 0.22, y1: top, z1: pz + 0.22 });
    }
    const o = T / 2, b0 = FL - 0.32, b1 = FL - 0.02;   // (just under the floor, so it doesn't stick up across the landings)
    S.upTrim.push({ x0: ux0 - o - 0.1, y0: b0, z0: uz0 - o - 0.1, x1: ux1 + o + 0.1, y1: b1, z1: uz0 - o },
      { x0: ux0 - o - 0.1, y0: b0, z0: uz1 + o, x1: ux1 + o + 0.1, y1: b1, z1: uz1 + o + 0.1 },
      { x0: ux0 - o - 0.1, y0: b0, z0: uz0 - o, x1: ux0 - o, y1: b1, z1: uz1 + o },
      { x0: ux1 + o, y0: b0, z0: uz0 - o, x1: ux1 + o + 0.1, y1: b1, z1: uz1 + o });
    // tiered roof like the huts (only the bottom tier is solid)
    const tint = HUT_ROOFS[0];
    const tier = (inset, y0, y1, dark) => ({ x0: ux0 - 0.55 + inset, y0, z0: uz0 - 0.55 + inset, x1: ux1 + 0.55 - inset, y1, z1: uz1 + 0.55 - inset,
      tint: tint.map((c) => c * dark) });
    const roof = tier(0, top, top + 0.25, 1);
    S.hutRoofs.push(roof); this.staticColliders.push(roof);
    S.hutRoofs.push(tier(1.0, top + 0.25, top + 0.5, 0.88), tier(2.0, top + 0.5, top + 0.74, 0.78), tier(3.0, top + 0.74, top + 0.9, 0.7));
    S.lanterns.push({ pos: [70, FL + 3.8, 31], light: false }, { pos: [77, FL + 3.8, 31], light: false });

    // outdoor stone stairs up to a landing at each end
    const n = 3, steps = 11, rise = FL / steps, run = n * C, tread = run / steps;
    for (const st of UP_STAIRS) {
      const x0 = st.x * C, x1 = x0 + C, lz0 = st.landing * C, lz1 = lz0 + C;
      add(S.stone, { x0, y0: 0, z0: lz0, x1, y1: FL, z1: lz1 }, true);
      for (let i = 0; i < steps; i++) {
        const z0 = st.from > 0 ? lz1 : lz0 - run + i * tread, z1 = st.from > 0 ? lz1 + run - i * tread : lz0;
        add(S.stone, { x0, y0: 0, z0, x1, y1: (i + 1) * rise, z1 }, i === 0);
      }
      // pathing: the landing at the top, each stair cell a step down; no stepping off the open
      // side or the far end of the landing
      const away = st.x < UPSTAIRS[0] ? -1 : 1;
      for (let k = 0; k <= n; k++) {
        const cz = st.landing + k * st.from;
        this.navHOverride.set(cz * GW + st.x, FL * (n + 1 - k) / (n + 1));
        this.edgeX[cz * GW + (away < 0 ? st.x - 1 : st.x)] = 1;
      }
      this.edgeZ[(st.from > 0 ? st.landing - 1 : st.landing) * GW + st.x] = 1;
      this.stairs.push({ x0, x1, z0: st.from > 0 ? lz1 : lz0 - run, z1: st.from > 0 ? lz1 + run : lz0, up: [0, -st.from] });
      // a railing round the landing's open sides (you can still jump it)
      const far = st.from > 0 ? lz0 : lz1 - 0.2, side = away < 0 ? x0 : x1 - 0.2;
      this.railing(x0, far, x1, far + 0.2);
      this.railing(side, lz0, side + 0.2, lz1);
    }
  }

  // a waist-high wooden railing along a thin box at floor height FL: plinth and top rail are solid,
  // the posts between are only looks (bullets go through the gaps)
  railing(x0, z0, x1, z1) {
    const S = this.struct;
    for (const [y0, y1] of [[FL, FL + 0.12], [FL + 0.92, FL + 1.06]]) {
      const b = { x0, y0, z0, x1, y1, z1 };
      S.rails.push(b); this.staticColliders.push(b);
    }
    const alongX = x1 - x0 > z1 - z0, len = alongX ? x1 - x0 : z1 - z0, n = Math.round(len / 0.33);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    for (let k = 0; k < n; k++) {
      const m = (alongX ? x0 : z0) + (k + 0.5) * len / n;
      S.upTrim.push(alongX ? { x0: m - 0.03, x1: m + 0.03, z0: mz - 0.03, z1: mz + 0.03, y0: FL + 0.12, y1: FL + 0.92 }
        : { x0: mx - 0.03, x1: mx + 0.03, z0: m - 0.03, z1: m + 0.03, y0: FL + 0.12, y1: FL + 0.92 });
    }
  }

  machineBox(pos, face, width, depth, height) {
    const alongX = face[2] !== 0; // machine faces along z, so its width runs along x
    const hw = (alongX ? width : depth) / 2, hd = (alongX ? depth : width) / 2;
    return { x0: pos[0] - hw, y0: pos[1], z0: pos[2] - hd, x1: pos[0] + hw, y1: pos[1] + height, z1: pos[2] + hd };
  }

  solid(x, z) { return x < 0 || z < 0 || x >= GW || z >= GH || this.grid[z * GW + x] === 1; }

  // ---------- windows ----------
  buildWindows() {
    this.windows = []; this.windowFrames = [];
    const frameMat = lambert(0x4a3220), boardMat = lambert(0xa47a4c);
    this.boardMat = boardMat;
    for (const def of WINDOWS) {
      const [cx, cz] = def.cell, [dx, dz] = def.dir;
      const x0 = cx * C, z0 = cz * C, x1 = x0 + C, z1 = z0 + C;
      const center = new THREE.Vector3(x0 + C / 2, 0, z0 + C / 2);
      // lintel reaches the height of the wall on either side of the window
      const sideH = dx !== 0
        ? Math.max(this.cellH[(cz - 1) * GW + cx] || 5, this.cellH[(cz + 1) * GW + cx] || 5)
        : Math.max(this.cellH[cz * GW + cx - 1] || 5, this.cellH[cz * GW + cx + 1] || 5);
      const sill = { x0, z0, x1, z1, y0: 0, y1: 0.9 };
      const lintel = { x0, z0, x1, z1, y0: 2.3, y1: sideH };
      this.windowFrames.push(sill, lintel);
      const blocker = { x0, z0, x1, z1, y0: 0, y1: sideH };
      const w = {
        def, area: def.area, center, dir: new THREE.Vector3(dx, 0, dz),
        inside: center.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), -1.7),
        outside: center.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), 1.25),
        spawn: center.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), 2.1),
        boards: 6, max: 6, boardMeshes: [], blocker, sill, lintel, sideH,
      };
      // boards nailed across the inside face of the opening
      const g = new THREE.Group();
      const faceOff = -C / 2 + 0.06; // toward the inside
      for (let i = 0; i < 6; i++) {
        const y = 1.0 + i * 0.24;
        const m = new THREE.Mesh(box, boardMat);
        m.castShadow = true;
        if (dx !== 0) { m.scale.set(0.06, 0.17, 2.15); m.position.set(center.x + dx * faceOff, y, center.z); m.rotation.x = (Math.random() - 0.5) * 0.4; }
        else { m.scale.set(2.15, 0.17, 0.06); m.position.set(center.x, y, center.z + dz * faceOff); m.rotation.z = (Math.random() - 0.5) * 0.4; }
        m.userData.home = { p: m.position.clone(), r: m.rotation.clone() };
        g.add(m); w.boardMeshes.push(m);
      }
      // dark wood frame on the inside
      const fo = -C / 2 + 0.02;
      if (dx !== 0) {
        mesh(box, frameMat, center.x + dx * fo, 1.6, z0 + 0.06, 0.14, 1.5, 0.12, g);
        mesh(box, frameMat, center.x + dx * fo, 1.6, z1 - 0.06, 0.14, 1.5, 0.12, g);
      } else {
        mesh(box, frameMat, x0 + 0.06, 1.6, center.z + dz * fo, 0.12, 1.5, 0.14, g);
        mesh(box, frameMat, x1 - 0.06, 1.6, center.z + dz * fo, 0.12, 1.5, 0.14, g);
      }
      this.scene.add(g);
      w.group = g;
      this.windows.push(w);
    }
  }

  setBoards(w, n) {
    w.boards = Math.max(0, Math.min(w.max, n));
    w.boardMeshes.forEach((m, i) => {
      m.visible = i < w.boards;
      if (m.visible) { m.position.copy(m.userData.home.p); m.rotation.copy(m.userData.home.r); }
    });
  }

  // ---------- doors ----------
  buildDoors() {
    this.doors = [];
    const plank = lambert(0x6b4a2c), brace = lambert(0x3f2a18);
    for (const def of DOORS) {
      // a door filling corridor cells, or (upstairs) one in a thin wall's doorway at floor height
      let center, spanX, span, collider;
      if (def.edgeX) {
        const [ex, ez] = def.edgeX, x = (ex + 1) * C, z0 = ez * C;
        center = new THREE.Vector3(x, FL, z0 + C / 2); spanX = false; span = C;
        collider = { x0: x - 0.15, z0, x1: x + 0.15, z1: z0 + C, y0: FL, y1: FL + 3.4 };
        this.edgeX[ez * GW + ex] = 1;
      } else {
        const [x0, z0, x1, z1] = def.cells;
        const wx0 = x0 * C, wz0 = z0 * C, wx1 = x1 * C, wz1 = z1 * C;
        center = new THREE.Vector3((wx0 + wx1) / 2, 0, (wz0 + wz1) / 2);
        spanX = (x1 - x0) >= (z1 - z0);
        span = spanX ? wx1 - wx0 : wz1 - wz0;
        collider = { x0: wx0, z0: wz0, x1: wx1, z1: wz1, y0: 0, y1: 3.4 };
        for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.navBlock[z * GW + x] = 1;
      }
      const g = new THREE.Group(); g.position.copy(center);
      const n = Math.round(span / 0.32);
      for (let i = 0; i < n; i++) {
        const off = -span / 2 + (i + 0.5) * (span / n);
        const h = 3.0 + (i % 3) * 0.12;
        if (spanX) mesh(box, plank, off, h / 2, 0, span / n - 0.03, h, 0.12, g);
        else mesh(box, plank, 0, h / 2, off, 0.12, h, span / n - 0.03, g);
      }
      for (const y of [0.8, 2.3]) {
        if (spanX) mesh(box, brace, 0, y, 0.1, span, 0.18, 0.06, g).rotation.z = 0.12;
        else mesh(box, brace, 0.1, y, 0, 0.06, 0.18, span, g).rotation.x = 0.12;
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), new THREE.MeshLambertMaterial({ map: signTex(['LOCKED', `AFTER ROUND ${def.after}`], '#2a1b10', '#f4e2b0') }));
      const sign2 = sign.clone();
      if (spanX) { sign.position.set(0, 1.6, 0.14); sign2.position.set(0, 1.6, -0.14); sign2.rotation.y = Math.PI; }
      else { sign.position.set(0.14, 1.6, 0); sign.rotation.y = Math.PI / 2; sign2.position.set(-0.14, 1.6, 0); sign2.rotation.y = -Math.PI / 2; }
      g.add(sign, sign2);
      this.scene.add(g);
      this.doors.push({ ...def, center, group: g, open: false, anim: 0, collider });
    }
  }

  // the door's way through, for pathing: open (true) or shut
  setDoorPath(d, open) {
    if (d.edgeX) { this.edgeX[d.edgeX[1] * GW + d.edgeX[0]] = open ? 0 : 1; return; }
    const [x0, z0, x1, z1] = d.cells;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { this.navBlock[z * GW + x] = open ? 0 : 1; this.walk[z * GW + x] = open ? 1 : 0; }
  }

  openDoor(d) {
    if (d.open) return;
    d.open = true;
    for (const list of [this.colliders, this.playerColliders]) {
      const i = list.indexOf(d.collider); if (i >= 0) list.splice(i, 1);
    }
    this.setDoorPath(d, true);
  }

  resetDoors() {
    for (const d of this.doors) {
      if (d.open) {
        d.open = false; d.anim = 0;
        d.group.visible = true; d.group.position.y = d.center.y; d.group.rotation.y = 0;
        this.colliders.push(d.collider); this.playerColliders.push(d.collider);
        this.setDoorPath(d, false);
      }
    }
    for (const w of this.windows) this.setBoards(w, w.max);
  }

  updateDoors(dt) {
    for (const d of this.doors) {
      if (!d.open || !d.group.visible) continue;
      d.anim += dt;
      d.group.position.y = d.center.y + d.anim * d.anim * 6;
      d.group.rotation.y = d.anim * 0.4;
      if (d.anim > 1.2) d.group.visible = false;
    }
  }

  // ---------- meshes ----------
  buildMeshes(tex, rects) {
    const walls = new BoxBuilder(), trims = new BoxBuilder(), bases = new BoxBuilder();
    for (const rc of rects) {
      const x0 = rc.x * C, z0 = rc.z * C, x1 = (rc.x + rc.w) * C, z1 = (rc.z + rc.d) * C;
      walls.box(x0, 0, z0, x1, rc.y, z1, { uvScale: 4, tint: rc.tint, ao: true, noBottom: true });
    }
    for (const w of this.windows) {
      const s = w.sill, l = w.lintel;
      walls.box(s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, { uvScale: 4, tint: [0.88, 0.85, 0.8], ao: true });
      walls.box(l.x0, l.y0, l.z0, l.x1, l.y1, l.z1, { uvScale: 4, tint: [0.88, 0.85, 0.8] });
    }
    // dark-wood cornice + baseboard along walls facing walkable ground (not inside window openings)
    const windowCells = new Set(this.windows.map((w) => w.def.cell[1] * GW + w.def.cell[0]));
    addEdgeTrims(trims, bases, {
      isSolid: (x, z) => this.solid(x, z),
      isOpen: (x, z) => !this.solid(x, z) && !windowCells.has(z * GW + x),
      cellH: this.cellH, gw: GW, gh: GH, cell: C, topTint: [0.5, 0.38, 0.28], baseTint: [0.45, 0.36, 0.3],
    });
    const wallMat = surfaceMaterial(tex, 'wall');
    for (const b of [walls, trims, bases]) {
      const m = new THREE.Mesh(b.geometry(), wallMat);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
    const roofs = new BoxBuilder();
    for (const r of this.roofs) roofs.box(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1, { uvScale: 3, tint: [0.42, 0.32, 0.26] });
    const roofMesh = new THREE.Mesh(roofs.geometry(), surfaceMaterial(tex, 'crate'));
    roofMesh.castShadow = roofMesh.receiveShadow = true;
    this.scene.add(roofMesh);

    const floor = new BoxBuilder();
    floor.box(-40, -1, -40, ZW + 40, 0, ZH + 40, { uvScale: 8, noBottom: true, tint: [0.75, 0.72, 0.68] });
    const floorMesh = new THREE.Mesh(floor.geometry(), surfaceMaterial(tex, 'sand', { roughness: 0.97 }));
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
    // indoor tiles and outdoor paving (both tile), dark soil patches (sand texture)
    const tiles = new BoxBuilder(), soil = new BoxBuilder();
    for (const a of Object.values(AREAS)) {
      const [x0, z0, x1, z1] = a.rect;
      if (a.indoor || a.paving) tiles.box(x0 * C, 0, z0 * C, x1 * C, 0.02, z1 * C, { uvScale: a.paving ? 3 : 4, noBottom: true, tint: a.floor || a.paving });
      if (a.earth) soil.box(x0 * C, 0, z0 * C, x1 * C, 0.015, z1 * C, { uvScale: 6, noBottom: true, tint: a.earth });
    }
    const tileMesh = new THREE.Mesh(tiles.geometry(), surfaceMaterial(tex, 'tile', { roughness: 0.9 }));
    tileMesh.receiveShadow = true;
    this.scene.add(tileMesh);
    const soilMesh = new THREE.Mesh(soil.geometry(), surfaceMaterial(tex, 'sand', { roughness: 0.98 }));
    soilMesh.receiveShadow = true;
    this.scene.add(soilMesh);
    buildContactShadows(this.scene, {
      isSolid: (x, z) => this.solid(x, z) || windowCells.has(z * GW + x), gw: GW, gh: GH, cell: C,
      boxes: [...this.obstacles, ...this.struct.shadow], strength: 0.5,
    });

    // obstacles: crates / tables / gravestones / stall walls
    const crates = new BoxBuilder(), stone = new BoxBuilder(), planks = new BoxBuilder();
    for (const [x0, y0, z0, x1, y1, z1, look] of OBSTACLES) {
      if (look === 'stone') {   // gravestone with a rounded-off top
        stone.box(x0, y0, z0, x1, y1 - 0.12, z1, { uvScale: 1, tint: [0.55, 0.56, 0.6], ao: true });
        stone.box(x0 + 0.1, y1 - 0.12, z0, x1 - 0.1, y1, z1, { uvScale: 1, tint: [0.55, 0.56, 0.6] });
      } else if (look === 'crate') crates.box(x0, y0, z0, x1, y1, z1, { faceUV: true, noBottom: true });
      else if (look === 'stall') {   // plank wall with a darker top rail
        planks.box(x0, y0, z0, x1, y1 - 0.12, z1, { uvScale: 1.5, tint: [0.62, 0.44, 0.28] });
        planks.box(x0 - 0.05, y1 - 0.12, z0, x1 + 0.05, y1, z1, { uvScale: 1.5, tint: [0.4, 0.28, 0.18] });
      }
    }
    const cm = new THREE.Mesh(crates.geometry(), surfaceMaterial(tex, 'crate', { roughness: 0.9 }));
    cm.castShadow = cm.receiveShadow = true; this.scene.add(cm);
    const sm = new THREE.Mesh(stone.geometry(), wallMat);
    sm.castShadow = sm.receiveShadow = true; this.scene.add(sm);
    const pm = new THREE.Mesh(planks.geometry(), surfaceMaterial(tex, 'crate', { roughness: 0.9 }));
    pm.castShadow = pm.receiveShadow = true; this.scene.add(pm);
    // the fountain on its ramped mound, then all the props (see zdecor.js)
    for (const m of MOUNDS) buildMound(this.scene, tex, this, m);
    buildTrees(this.scene, TREES.map(([x, z, s]) => [x, this.groundAt(x, z), z, s]));
    buildLogs(this.scene, LOGS.map(([x, z, len, r, axis]) => [x, this.groundAt(x, z), z, len, r, axis]), [[64.1, 15.6, 66.7, 19.8]]);
    buildStalls(this.scene, STALLS);
    buildBunting(this.scene, BUNTING);
    buildWallDecor(this.scene, this.decorFaces());
  }

  // Wall faces that look onto walkable ground, for painted shutters and boarded-up doors.
  // Skips faces next to anything you interact with, doors and windows.
  decorFaces() {
    const busy = [
      ...PERKS.map((p) => [p.pos[0], p.pos[2]]),
      ...PAP_STATIONS.map((p) => [p.pos[0], p.pos[2]]), [BOX.pos[0], BOX.pos[2]],
      ...this.windows.map((w) => [w.center.x, w.center.z]), ...this.doors.map((d) => [d.center.x, d.center.z]),
      ...STALLS.map((s) => [(s.counter[0] + s.counter[2]) / 2, s.back]),
    ];
    const isBusy = (x, z) => busy.some(([bx, bz]) => Math.abs(bx - x) < 2.6 && Math.abs(bz - z) < 2.6);
    const open = (x, z) => x >= 0 && z >= 0 && x < GW && z < GH && !this.solid(x, z) && !this.navBlock[z * GW + x];
    const faces = [];
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      if (!this.solid(x, z) || this.cellH[z * GW + x] < 4.5) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!open(x + dx, z + dz)) continue;
        // the face's center, on the wall surface
        const fx = x * C + C / 2 + dx * C / 2, fz = z * C + C / 2 + dz * C / 2;
        if (isBusy(fx, fz)) continue;
        const indoor = Object.values(AREAS).some((a) => a.indoor && x + dx >= a.rect[0] && x + dx < a.rect[2] && z + dz >= a.rect[1] && z + dz < a.rect[3]);
        faces.push({ x: fx, z: fz, nx: dx, nz: dz, h: this.cellH[z * GW + x], seed: blockHash(x * 3 + dx + 7, z * 3 + dz + 11, 1), indoor });
      }
    }
    return faces;
  }

  buildStructureMeshes(tex) {
    const S = this.struct;
    const mk = (boxes, material, opt = {}) => {
      if (!boxes.length) return;
      const b = new BoxBuilder();
      for (const x of boxes) b.box(x.x0, x.y0, x.z0, x.x1, x.y1, x.z1, opt);
      const m = new THREE.Mesh(b.geometry(), material);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    };
    mk(S.walls, surfaceMaterial(tex, 'wall'), { uvScale: 4, tint: [0.97, 0.94, 0.88], ao: true });
    mk(S.stone, surfaceMaterial(tex, 'wall'), { uvScale: 3, tint: [0.72, 0.7, 0.68], ao: true });
    const plain = (color) => (tex.quality === 'high'
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, envMapIntensity: 0.45, vertexColors: true })
      : new THREE.MeshLambertMaterial({ color, vertexColors: true }));
    mk(S.wood, plain(0x7a5434), { uvScale: 2 });
    mk(S.roofs, plain(0x4e3627), { uvScale: 2 });
    if (S.hutRoofs.length) {   // tiered hut roofs, each tier its own shade
      const b = new BoxBuilder();
      for (const r of S.hutRoofs) b.box(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1, { uvScale: 2, tint: r.tint });
      const m = new THREE.Mesh(b.geometry(), plain(0xffffff));
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
    mk(S.tiles, surfaceMaterial(tex, 'tile', { roughness: 0.9 }), { uvScale: 4, noBottom: true });
    // upstairs: a wooden storey on the plaster ground floor: plank walls and floor, wooden
    // railings and timber trim, furniture
    mk(S.upWalls, surfaceMaterial(tex, 'crate', { roughness: 0.9 }), { uvScale: 2.5, tint: [1, 0.82, 0.62] });
    mk(S.planks, surfaceMaterial(tex, 'crate', { roughness: 0.9 }), { uvScale: 2, tint: [0.66, 0.5, 0.36], noBottom: true });
    mk(S.rails, plain(0x8a5e38), { uvScale: 2 });
    mk(S.upTrim, plain(0x5a3c24), { uvScale: 2 });
    this.buildUpstairsProps(plain);
    // ladder: two rails and rungs on the tower's east face
    for (const l of this.ladders) {
      const lb = new BoxBuilder(), x = l.x0 + 0.06;
      lb.box(x - 0.04, 0, l.z0 + 0.06, x + 0.04, TOWER.top + 1.1, l.z0 + 0.14, { uvScale: 1 });
      lb.box(x - 0.04, 0, l.z1 - 0.14, x + 0.04, TOWER.top + 1.1, l.z1 - 0.06, { uvScale: 1 });
      for (let y = 0.3; y < TOWER.top + 1; y += 0.34) lb.box(x - 0.03, y, l.z0 + 0.1, x + 0.03, y + 0.05, l.z1 - 0.1, { uvScale: 1 });
      const m = new THREE.Mesh(lb.geometry(), plain(0x9a6a3c));
      m.castShadow = true; this.scene.add(m);
    }
    // the kentongan drum hanging under the watchtower roof
    if (S.kentongan) {
      const [kx, ky, kz] = S.kentongan;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.3, 16), lambert(0x8a5a30));
      drum.position.set(kx, ky, kz); drum.castShadow = true; this.scene.add(drum);
      const slit = new THREE.Mesh(box, lambert(0x24140a)); slit.scale.set(0.06, 0.8, 0.02); slit.position.set(kx, ky, kz + 0.3); this.scene.add(slit);
      const rope = new THREE.Mesh(box, lambert(0x3a2a1a)); rope.scale.set(0.04, 0.6, 0.04); rope.position.set(kx, ky + 0.95, kz); this.scene.add(rope);
    }
    // hut lanterns: a small warm light so you can see zombies that follow you inside
    const glow = new THREE.MeshBasicMaterial({ color: 0xffc77a });
    for (const { pos: [lx, ly, lz], light } of S.lanterns) {
      mesh(box, glow, lx, ly, lz, 0.22, 0.3, 0.22, this.scene).castShadow = false;
      mesh(box, lambert(0x2a2622), lx, ly + 0.35, lz, 0.03, 0.4, 0.03, this.scene).castShadow = false;   // hanging cord
      if (!light) continue;   // (point lights are costly: only the huts that need one)
      const l = new THREE.PointLight(0xffb36b, 22, 11, 2);
      l.position.set(lx, ly - 0.2, lz);
      this.scene.add(l);
    }
  }

  // upstairs furniture (looks only: the colliders are in UP_PROPS)
  buildUpstairsProps(plain) {
    const b = new BoxBuilder(), wood = [0.6, 0.42, 0.27], dark = [0.36, 0.24, 0.15];
    for (const [x0, z0, x1, z1, h, look] of UP_PROPS) {
      if (look === 'table') {
        b.box(x0, FL + h - 0.07, z0, x1, FL + h, z1, { uvScale: 1, tint: wood });
        for (const [lx, lz] of [[x0 + 0.08, z0 + 0.08], [x1 - 0.16, z0 + 0.08], [x0 + 0.08, z1 - 0.16], [x1 - 0.16, z1 - 0.16]]) {
          b.box(lx, FL, lz, lx + 0.08, FL + h - 0.07, lz + 0.08, { uvScale: 1, tint: dark });
        }
        b.box(x0 + 0.4, FL + h, z0 + 0.4, x0 + 0.62, FL + h + 0.16, z0 + 0.62, { uvScale: 1, tint: [0.8, 0.78, 0.7] });   // a cup
      } else if (look === 'chest') {
        b.box(x0, FL, z0, x1, FL + h - 0.14, z1, { uvScale: 1, tint: [0.5, 0.3, 0.18], ao: true });
        b.box(x0 - 0.03, FL + h - 0.14, z0 - 0.03, x1 + 0.03, FL + h, z1 + 0.03, { uvScale: 1, tint: dark });
        b.box((x0 + x1) / 2 - 0.08, FL + h - 0.3, z1, (x0 + x1) / 2 + 0.08, FL + h - 0.1, z1 + 0.04, { uvScale: 1, tint: [0.8, 0.62, 0.24] });
      } else if (look === 'drum') {
        // the stand: four legs and two cradle beams; the drum itself is added below
        for (const [lx, lz] of [[x0 + 0.1, z0 + 0.15], [x1 - 0.2, z0 + 0.15], [x0 + 0.1, z1 - 0.25], [x1 - 0.2, z1 - 0.25]]) {
          b.box(lx, FL, lz, lx + 0.1, FL + 0.62, lz + 0.1, { uvScale: 1, tint: dark });
        }
        b.box(x0 + 0.1, FL + 0.5, z0 + 0.15, x1 - 0.1, FL + 0.62, z0 + 0.25, { uvScale: 1, tint: dark });
        b.box(x0 + 0.1, FL + 0.5, z1 - 0.25, x1 - 0.1, FL + 0.62, z1 - 0.15, { uvScale: 1, tint: dark });
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, x1 - x0 - 0.3, 20), [lambert(0x8a4a24), lambert(0xd8c49a), lambert(0xd8c49a)]);
        drum.rotation.z = Math.PI / 2;
        drum.position.set((x0 + x1) / 2, FL + 1.02, (z0 + z1) / 2);
        drum.castShadow = drum.receiveShadow = true;
        this.scene.add(drum);
      }
    }
    // sleeping mats with a pillow at the wall end
    for (const [x0, z0, x1, z1] of UP_MATS) {
      b.box(x0, FL, z0, x1, FL + 0.07, z1, { uvScale: 1, tint: [0.72, 0.28, 0.22] });
      b.box(x0 + 0.12, FL + 0.07, z0 + 0.12, x1 - 0.12, FL + 0.08, z1 - 0.12, { uvScale: 1, tint: [0.92, 0.84, 0.66] });
      b.box(x0 + 0.25, FL + 0.08, z1 - 0.5, x1 - 0.25, FL + 0.2, z1 - 0.12, { uvScale: 1, tint: [0.95, 0.93, 0.88] });
    }
    const m = new THREE.Mesh(b.geometry(), plain(0xffffff));
    m.castShadow = m.receiveShadow = true;
    this.scene.add(m);
  }

  buildHillMeshes(tex) {
    const mat = surfaceMaterial(tex, 'sand', { roughness: 0.97, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const [hx, hz, r] of this.hills) {
      const step = 0.5, n = Math.ceil((r * 2) / step) + 1, x0 = hx - r, z0 = hz - r;
      const pos = [], uv = [], col = [], idx = [];
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
        const x = x0 + ix * step, z = z0 + iz * step, h = this.groundAt(x, z);
        pos.push(x, h + 0.01, z);
        uv.push(x / 8, -z / 8);
        const k = Math.min(1, h / 2.5);                    // a little greener toward the top
        col.push(0.75 - 0.12 * k, 0.72 - 0.02 * k, 0.68 - 0.2 * k);
      }
      for (let iz = 0; iz < n - 1; iz++) for (let ix = 0; ix < n - 1; ix++) {
        const a = iz * n + ix, b = a + n, c = a + 1, d = b + 1;
        idx.push(a, b, c, c, b, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  buildProps() {
    // lights + lanterns + lamp posts
    const lantern = new THREE.MeshBasicMaterial({ color: 0xffc77a });
    const pole = lambert(0x2a2622);
    for (const l of LIGHTS) {
      if (!l.glowOnly) {   // (every point light costs on every pixel: glowOnly lamps just glow)
        const light = new THREE.PointLight(l.color, l.intensity, l.dist, 2);
        light.position.set(...l.pos);
        this.scene.add(light);
      }
      if (l.color === 0xb050ff || l.noLamp) continue;
      mesh(box, l.glowOnly ? new THREE.MeshBasicMaterial({ color: l.color }) : lantern, l.pos[0], l.pos[1] + 0.05, l.pos[2], 0.28, 0.36, 0.28, this.scene).castShadow = false;
      if (l.post) mesh(box, pole, l.pos[0], 1.6, l.pos[2], 0.14, 3.2, 0.14, this.scene);
    }
    // perk machines
    this.perkMachines = PERKS.map((p) => {
      const g = new THREE.Group();
      g.position.set(...p.pos);
      g.rotation.y = Math.atan2(p.face[0], p.face[2]);
      const dark = new THREE.Color(p.color).multiplyScalar(0.45).getHex();
      mesh(box, lambert(dark), 0, 1.05, 0, 1.1, 2.1, 0.9, g);
      mesh(box, new THREE.MeshBasicMaterial({ color: p.color }), 0, 1.15, 0.46, 0.8, 1.1, 0.02, g).castShadow = false;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.36),
        new THREE.MeshBasicMaterial({ map: signTex([p.name, String(p.cost)], '#111', '#' + p.color.toString(16).padStart(6, '0')) }));
      sign.position.set(0, 1.9, 0.461); g.add(sign);
      this.scene.add(g);
      return { ...p, at: new THREE.Vector3(p.pos[0] + p.face[0] * 1.0, 0, p.pos[2] + p.face[2] * 1.0) };
    });
    // Pack-a-Punch stations (one per upgrade level), each glowing its level's color
    const rollGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.9, 12);
    const haloTex = canvasTex(64, 64, (ctx) => {
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
    });
    this.papStations = PAP_STATIONS.map((st) => {
      const g = new THREE.Group(); g.position.set(...st.pos);
      g.rotation.y = Math.atan2(st.face[0], st.face[2]);   // front (sign side) toward the room
      const body = new THREE.Color(st.color).multiplyScalar(0.18).add(new THREE.Color(0x24222e)).getHex();
      mesh(box, lambert(body), 0, 0.6, 0, 1.6, 1.2, 1.2, g);
      mesh(box, lambert(new THREE.Color(st.color).multiplyScalar(0.35).getHex()), 0, 1.45, 0, 1.3, 0.5, 1.0, g);
      const glow = new THREE.MeshBasicMaterial({ color: st.color });
      mesh(box, glow, 0, 0.9, 0.61, 1.3, 0.12, 0.02, g).castShadow = false;
      for (const x of [-0.4, 0, 0.4]) {
        const roll = new THREE.Mesh(rollGeo, glow);
        roll.rotation.x = Math.PI / 2; roll.position.set(x, 1.75, 0); g.add(roll);
      }
      const name = st.level === 1 ? 'PACK-A-PUNCH' : `PACK-A-PUNCH ${['', 'I', 'II', 'III', 'IV'][st.level]}`;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.4),
        new THREE.MeshBasicMaterial({ map: signTex([name, String(st.cost)], '#16121f', st.ink, 352, 100) }));
      sign.position.set(0, 0.45, 0.61); g.add(sign);
      // soft halo over the rollers so it can be spotted from across the area
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: st.color, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.set(2.6, 2.6, 1); halo.position.set(0, 1.8, 0); g.add(halo);
      this.scene.add(g);
      return { ...st, at: new THREE.Vector3(st.pos[0] + st.face[0] * 1.4, st.pos[1], st.pos[2] + st.face[2] * 1.4) };
    });
    // Mystery box with a light beam
    {
      const g = new THREE.Group(); g.position.set(...BOX.pos);
      const wood = new THREE.MeshLambertMaterial({ map: signTex(['?', ''], '#5a3b20', '#ffe08a', 128, 96) });
      mesh(box, wood, 0, 0.35, 0, 1.8, 0.7, 0.8, g);
      const lid = new THREE.Group(); lid.position.set(0, 0.7, -0.4); g.add(lid);
      mesh(box, lambert(0x4a2f18), 0, 0.08, 0.4, 1.84, 0.16, 0.84, lid);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 14, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x66b8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 7; g.add(beam);
      this.scene.add(g);
      // floating label that shows the cycling weapon
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const labelTex = new THREE.CanvasTexture(c); labelTex.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false }));
      label.scale.set(2.4, 0.6, 1); label.position.set(BOX.pos[0], 1.9, BOX.pos[2]); label.visible = false;
      this.scene.add(label);
      this.box = { ...BOX, group: g, lid, beam, label, labelCanvas: c, labelTex, at: new THREE.Vector3(BOX.pos[0], 0, BOX.pos[2] + 1.3) };
    }
    this.buildGunShop();
  }

  // ---------- the Gun Shop: counter, a wall of guns (each one shows up when it unlocks), signs ----------
  buildGunShop() {
    const S = GUN_SHOP, [cx0, cz0, cx1, cz1] = S.counter, h = S.counterH, cx = (cx0 + cx1) / 2, w = cx1 - cx0;
    const sc = this.scene;
    // the counter: plank front, a dark kick strip, a top that overhangs a little; ammo crates and a cash box on it
    mesh(box, lambert(0x6a4428), cx, (h - 0.06) / 2, (cz0 + cz1) / 2, w, h - 0.06, cz1 - cz0, sc);
    mesh(box, lambert(0x9a6a3e), cx, h - 0.03, (cz0 + cz1) / 2 + 0.03, w + 0.08, 0.06, cz1 - cz0 + 0.06, sc);
    mesh(box, lambert(0x2a1c12), cx, 0.07, cz1 + 0.01, w, 0.14, 0.02, sc);
    for (const x of [cx0 + 0.45, cx1 - 0.45]) {
      mesh(box, lambert(0x3e5a2a), x, h + 0.16, cz0 + 0.4, 0.55, 0.32, 0.38, sc);
      mesh(box, lambert(0xc8b060), x, h + 0.16, cz0 + 0.4 + 0.195, 0.2, 0.08, 0.01, sc).castShadow = false;   // stencilled label
    }
    mesh(box, lambert(0x34363a), cx, h + 0.12, cz0 + 0.42, 0.46, 0.24, 0.34, sc);
    mesh(box, new THREE.MeshBasicMaterial({ color: 0x7dff8a }), cx, h + 0.2, cz0 + 0.595, 0.3, 0.06, 0.01, sc).castShadow = false;
    // the rack: a dark board on the wall above the counter, the guns hung on it, a price tag under each
    const wallZ = cz0, boardZ = wallZ + 0.04;
    // (light wood, so the dark guns and the black outlines of the locked ones stand out)
    mesh(box, lambert(0xc49a68), cx, 2.55, wallZ + 0.02, w, 2.6, 0.04, sc).castShadow = false;
    for (const y of [1.28, 3.82]) mesh(box, lambert(0x5a3c24), cx, y, wallZ + 0.05, w + 0.08, 0.08, 0.06, sc).castShadow = false;
    const guns = displayGuns(), dark = new THREE.MeshBasicMaterial({ color: 0x15100c, transparent: true, opacity: 0.4, depthWrite: false });
    const after = Object.fromEntries(ZOMBIE_SHOP.map((it) => [it.key, it.after]));
    const x0 = cx0 + 0.15, x1 = cx1 - 0.15, TAG = 0.85;
    this.shopSlots = [];
    for (const [y, keys] of S.rack) {
      const items = keys.map((key) => {
        const g = guns[key];
        g.rotation.y = -Math.PI / 2;   // barrel to the right, its right side facing out
        g.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(g);
        return { key, g, bb, len: bb.max.x - bb.min.x };
      });
      // as big as fits, leaving every gun room for its tag
      const room = (s) => items.reduce((a, it) => a + Math.max(TAG, it.len * s), 0) + 0.2 * (items.length - 1);
      let s = 1.15;
      while (s > 0.6 && room(s) > x1 - x0) s -= 0.05;
      const gap = (x1 - x0 - room(s) + 0.2 * (items.length - 1)) / items.length;
      let x = x0 + gap / 2;
      for (const it of items) {
        const slot = Math.max(TAG, it.len * s), mid = x + slot / 2, c = it.bb.getCenter(new THREE.Vector3());
        it.g.scale.setScalar(s);
        it.g.position.set(mid - c.x * s, y - c.y * s, boardZ + 0.03 + (it.bb.max.z - it.bb.min.z) * s / 2 - c.z * s);
        it.g.traverse((m) => { if (m.isMesh) { m.userData.lit = m.material; m.castShadow = false; } });
        sc.add(it.g);
        const def = WEAPONS[it.key], due = after[it.key] ?? 0;
        const on = new THREE.MeshBasicMaterial({ map: tagTex(def.name, String(ZOMBIE_PRICES[it.key]), '#9be07a'), transparent: true });
        const off = new THREE.MeshBasicMaterial({ map: tagTex(def.name, `AFTER ROUND ${due}`, '#ff9a6a'), transparent: true });
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(TAG - 0.06, (TAG - 0.06) * 0.32), off);
        tag.position.set(mid, y - 0.48, boardZ + 0.012);
        sc.add(tag);
        this.shopSlots.push({ key: it.key, after: due, gun: it.g, tag, on, off, dark, shown: null });
        x += slot + gap;
      }
    }
    // glowing signs: over the rack inside, and on all four outside walls (over the doors on the
    // west and east, where you walk in)
    const [rx0, rz0, rx1, rz1] = S.rect, T = 0.17;
    const inner = new THREE.MeshBasicMaterial({ map: neonTex('GUN SHOP', 'A new gun every round you survive') });
    const outer = new THREE.MeshBasicMaterial({ map: neonTex('GUN SHOP', '') });
    const plane = (mat, sw, sh, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat); m.position.set(x, y, z); m.rotation.y = ry; sc.add(m); };
    plane(inner, 2.9, 0.9, cx, 4.35, wallZ + 0.02, 0);
    plane(outer, 2.2, 0.6, rx0 - T, 4.63, 39, -Math.PI / 2);
    plane(outer, 2.2, 0.6, rx1 + T, 4.63, 41, Math.PI / 2);
    plane(outer, 3.2, 0.87, (rx0 + rx1) / 2, 3.7, rz0 - T, Math.PI);
    plane(outer, 3.2, 0.87, (rx0 + rx1) / 2, 3.7, rz1 + T, 0);
    // ...and a big one up on the roof (two-sided, facing west and east), seen from across the Courtyard
    const mx = (rx0 + rx1) / 2, mz = (rz0 + rz1) / 2, roofTop = 5.86, sy = roofTop + 0.95;
    for (const dz of [-1.5, 1.5]) mesh(box, lambert(0x2a1c12), mx, roofTop + 0.3, mz + dz, 0.12, 0.7, 0.12, sc);
    mesh(box, lambert(0x2a1c12), mx, sy, mz, 0.08, 1.32, 4.5, sc);
    plane(outer, 4.3, 1.2, mx - 0.05, sy, mz, -Math.PI / 2);
    plane(outer, 4.3, 1.2, mx + 0.05, sy, mz, Math.PI / 2);
    this.setShopRound(0);
  }

  // Show the guns that are on sale after `cleared` rounds (the rest are dark outlines with the
  // round they unlock after).
  setShopRound(cleared) {
    for (const s of this.shopSlots || []) {
      const on = s.after <= cleared;
      if (s.shown === on) continue;
      s.shown = on;
      s.tag.material = on ? s.on : s.off;
      s.gun.traverse((m) => { if (m.isMesh) m.material = on ? m.userData.lit : s.dark; });
    }
  }

  // close enough to the Gun Shop counter to buy (slack: a little extra reach)
  atGunShop(pos, slack = 0) {
    const [fx0, fx1, fz] = GUN_SHOP.front;
    const d = Math.hypot(pos.x - Math.max(fx0, Math.min(fx1, pos.x)), pos.z - fz);
    return d < GUN_SHOP.reach + slack && pos.y < 1.5 + slack;
  }

  setBoxLabel(text, color = '#ffe9a8') {
    const b = this.box, ctx = b.labelCanvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = '700 64px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10; ctx.fillStyle = color;
    ctx.fillText(text, 256, 64);
    b.labelTex.needsUpdate = true;
  }

  // ---------- navigation (flow field toward the player) ----------
  buildNav() {
    this.walk = new Uint8Array(GW * GH);
    this.navH = new Float32Array(GW * GH);   // height of the walkable surface in each cell
    for (let z = 0; z < GH; z++) for (let x = 0; x < GW; x++) {
      const i = z * GW + x, up = this.upper[i] === 1;
      const h = this.navH[i] = this.navHOverride.has(i) ? this.navHOverride.get(i) : this.groundAt(x * C + 1, z * C + 1);
      if ((this.grid[i] === 1 && !up) || this.navBlock[i]) continue;
      const cx0 = x * C + 0.4, cx1 = x * C + 1.6, cz0 = z * C + 0.4, cz1 = z * C + 1.6;
      let blocked = false;
      for (const o of this.obstacles) {
        if (o.y0 > h + 0.5 || (up && o.y1 < h + 0.2)) continue;   // (upstairs: only furniture up there)
        if (o.x1 + 0.4 > cx0 && o.x0 - 0.4 < cx1 && o.z1 + 0.4 > cz0 && o.z0 - 0.4 < cz1) { blocked = true; break; }
      }
      this.walk[i] = blocked ? 0 : 1;
    }
  }
  // Lowest thing overhead in each cell (roofs, hut doorways, window lintels), for flying zombies.
  buildCeilings() {
    this.ceil = new Float32Array(GW * GH).fill(99);
    for (const c of [...this.staticColliders, ...this.windowFrames]) {
      const x0 = Math.max(0, Math.floor(c.x0 / C)), x1 = Math.min(GW - 1, Math.floor((c.x1 - 0.001) / C));
      const z0 = Math.max(0, Math.floor(c.z0 / C)), z1 = Math.min(GH - 1, Math.floor((c.z1 - 0.001) / C));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const i = z * GW + x;
        if (c.y0 > this.navH[i] + 0.3 && c.y0 < this.ceil[i]) this.ceil[i] = c.y0;
      }
    }
  }
  ceilAt(x, z) {
    const cx = Math.floor(x / C), cz = Math.floor(z / C);
    return cx >= 0 && cz >= 0 && cx < GW && cz < GH ? this.ceil[cz * GW + cx] : 99;
  }
  // height of the floor under a point: the ground, or the tower deck / stairs
  surfaceAt(x, z) {
    const cx = Math.floor(x / C), cz = Math.floor(z / C), i = cz * GW + cx;
    return cx >= 0 && cz >= 0 && cx < GW && cz < GH && this.navHOverride.has(i) ? this.navH[i] : this.groundAt(x, z);
  }

  // a floor players can stand on (ground or upstairs), not a closed door, window or spawn pocket
  floorCell(i) { return (this.grid[i] === 0 || this.upper[i] === 1) && !this.navBlock[i]; }

  // For the map: every cell the players can get to from the Gun Shop through the doors opened so
  // far (walls, closed doors and drops of more than a step block the way, like the zombies' paths).
  reachable(out = new Uint8Array(GW * GH)) {
    out.fill(0);
    const s = Math.floor(PLAYER_START.z / C) * GW + Math.floor(PLAYER_START.x / C), q = [s];
    out[s] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % GW, z = (i / GW) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, n = nz * GW + nx;
        if (nx < 0 || nz < 0 || nx >= GW || nz >= GH || out[n] || !this.floorCell(n)) continue;
        if (dz === 0 ? this.edgeX[z * GW + Math.min(x, nx)] : this.edgeZ[Math.min(z, nz) * GW + x]) continue;
        if (Math.abs(this.navH[i] - this.navH[n]) > 1.5) continue;
        out[n] = 1; q.push(n);
      }
    }
    return out;
  }

  // name of the area a point is in ('' on the paths between them)
  areaAt(pos) {
    const [sx0, sz0, sx1, sz1] = GUN_SHOP.rect;
    if (pos.x > sx0 && pos.x < sx1 && pos.z > sz0 && pos.z < sz1 && pos.y < 2) return 'Gun Shop';
    const cx = Math.floor(pos.x / C), cz = Math.floor(pos.z / C);
    for (const a of Object.values(AREAS)) {
      const [x0, z0, x1, z1] = a.rect;
      if (cx >= x0 && cx < x1 && cz >= z0 && cz < z1) return a.name;
    }
    return '';
  }

  walkable(x, z) { return x >= 0 && z >= 0 && x < GW && z < GH && this.walk[z * GW + x] === 1; }
  walkablePoint(x, z) { return this.walkable(Math.floor(x / C), Math.floor(z / C)); }
  heightAtCell(x, z) { return this.navH[z * GW + x]; }
  nearestWalkable(cx, cz) {
    if (this.walkable(cx, cz)) return [cx, cz];
    for (let r = 1; r < 6; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !this.walkable(cx + dx, cz + dz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = [cx + dx, cz + dz]; }
      }
      if (best) return best;
    }
    return null;
  }

  // Can a zombie walk from cell a to its 4-neighbour b? (no wall between, small height change)
  passOrth(ax, az, bx, bz) {
    if (!this.walkable(bx, bz)) return false;
    if (az === bz) { if (this.edgeX[az * GW + Math.min(ax, bx)]) return false; }
    else if (this.edgeZ[Math.min(az, bz) * GW + ax]) return false;
    return Math.abs(this.navH[az * GW + ax] - this.navH[bz * GW + bx]) <= 1.5;
  }
  // Any of the 8 neighbours; diagonals need both L-shaped routes to be open.
  canStep(x, z, dx, dz) {
    if (!dx || !dz) return this.passOrth(x, z, x + dx, z + dz);
    return this.passOrth(x, z, x + dx, z) && this.passOrth(x + dx, z, x + dx, z + dz)
      && this.passOrth(x, z, x, z + dz) && this.passOrth(x, z + dz, x + dx, z + dz);
  }

  // Distance field spreading out from the target(s): one position, or a list (co-op), in which
  // case each zombie ends up heading for whichever player is closest along the paths.
  computeFlow(targets) {
    const dist = this.dist; dist.fill(Infinity);
    const heap = new Heap();
    for (const target of Array.isArray(targets) ? targets : [targets]) {
      const s = this.nearestWalkable(Math.floor(target.x / C), Math.floor(target.z / C));
      if (!s) continue;
      const start = s[1] * GW + s[0];
      if (dist[start] === 0) continue;
      dist[start] = 0;
      heap.push(start, 0);
    }
    while (heap.size) {
      const cur = heap.pop();
      const cd = dist[cur], cx = cur % GW, cz = (cur / GW) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        // the field spreads outward from the player, so check the step a zombie would take (back toward cur)
        if (!this.walkable(cx + dx, cz + dz) || !this.canStep(cx + dx, cz + dz, -dx, -dz)) continue;
        const n = (cz + dz) * GW + cx + dx, nd = cd + (dx && dz ? 1.414 : 1);
        if (nd < dist[n]) { dist[n] = nd; heap.push(n, nd); }
      }
    }
  }

  // Next point to walk to from `pos` following the flow field (or null if lost). rad: how wide the
  // walker is, for cutting corners.
  flowTarget(pos, out, rad = 0.35) {
    const cx = Math.floor(pos.x / C), cz = Math.floor(pos.z / C);
    if (!this.walkable(cx, cz)) {
      const n = this.nearestWalkable(cx, cz);
      if (!n) return null;
      // right next to the target (you're hugging a pillar, a perk machine...): no path step, head
      // straight for you instead of dithering back and forth at the edge of the blocked cell
      if (this.dist[n[1] * GW + n[0]] === 0) return null;
      return out.set(n[0] * C + 1, 0, n[1] * C + 1);
    }
    const step = (x, z) => {
      let best = null, bd = this.dist[z * GW + x];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (!this.canStep(x, z, dx, dz)) continue;
        const d = this.dist[(z + dz) * GW + x + dx];
        if (d < bd) { bd = d; best = [x + dx, z + dz]; }
      }
      return best;
    };
    const a = step(cx, cz);
    if (!a) return null;
    out.set(a[0] * C + 1, 0, a[1] * C + 1);
    const b = step(a[0], a[1]);
    if (b) {
      const bx = b[0] * C + 1, bz = b[1] * C + 1;
      if (this.clearLine(pos, { x: bx, z: bz }, rad)) out.set(bx, 0, bz);
    }
    return out;
  }

  // Straight walkable line from a to b for a body `rad` wide: no blocked cells, no walls crossed
  // (by its middle or either side, so wide zombies don't cut the corner of a doorway), no big
  // height jumps.
  clearLine(a, b, rad = 0.4) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const px = -dz / len * rad, pz = dx / len * rad;
    const steps = Math.ceil(len / 0.4);
    const prev = _lines;
    for (let s = 0; s < 3; s++) { const o = s === 0 ? 0 : s === 1 ? 1 : -1; prev[s * 2] = Math.floor((a.x + px * o) / C); prev[s * 2 + 1] = Math.floor((a.z + pz * o) / C); }
    for (let i = 0; i <= steps; i++) {
      for (let s = 0; s < 3; s++) {
        const o = s === 0 ? 0 : s === 1 ? 1 : -1;
        const x = a.x + dx * i / steps + px * o, z = a.z + dz * i / steps + pz * o;
        if (!this.walkablePoint(x, z)) return false;
        const cx = Math.floor(x / C), cz = Math.floor(z / C), pcx = prev[s * 2], pcz = prev[s * 2 + 1];
        if (cx !== pcx || cz !== pcz) {
          if (Math.abs(cx - pcx) > 1 || Math.abs(cz - pcz) > 1) return false;
          if (!this.canStep(pcx, pcz, cx - pcx, cz - pcz)) return false;
          if (Math.abs(this.navH[cz * GW + cx] - this.navH[pcz * GW + pcx]) > 1.0) return false;
          prev[s * 2] = cx; prev[s * 2 + 1] = cz;
        }
      }
    }
    return true;
  }
}
