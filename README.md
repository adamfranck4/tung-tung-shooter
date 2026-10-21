# Tung Tung Shooter

A 5v5 Counter-Strike–style tactical shooter that runs entirely in the browser (Three.js + WebGL).
No build step, no server code, no assets to download — every texture, model and sound is generated in code.

- Original desert map with bomb sites A and B, mid, long and tunnels
- You + 4 bot teammates vs 5 bots, three difficulty levels
- Buy menu and economy, recoil and spread, headshots, armor
- Bomb plant / defuse, round timer, radar, kill feed, scoreboard, spectating
- Every fighter is a "Tung Tung Tung Sahur" kentongan log: dome top, bulging eyes, toothy grin, bare feet,
  and a baseball bat (slung on the back, swung in melee). Team color is the hanging rope: orange = T, blue = CT.
- Knife skins picked in the menu: Knife, Karambit, Flip, Butterfly (with flips), Sword. Skins are cosmetic.
- 10 static crosshairs (no spread): Classic Green, s1mple, ZywOo, NiKo, donk, m0NESY, T-Shape, Dot Only,
  Cross + Dot, Circle + Dot. Pro presets use the most commonly reported 2026 settings; pros change them often.
  Add or edit presets in `src/crosshair.js`.

## Zombies mode

Pick **Zombies** in the menu for solo survival in **Sahur Village**, a night-time map built for this mode.

- Endless rounds of Tung Tung zombies with bats. They tear boards off the windows and climb in, or rise from
  the ground. Each round has more of them, and they get tougher and faster (walkers → runners → sprinters).
- Points: +10 per hit, +60 per kill, +100 headshot kill, +130 knife kill, +10 per board you rebuild (hold E).
- Spend points on (press E):
  - Doors: Courtyard 750, Kitchen 1000, Garden 1000, Drum Tower 1250
  - Wall guns: SMG 1000, Shotgun 1500, AK 1800, M4 1800, Sniper 2000 (ammo = half price)
  - Perks: Quick Revive 500 (gets you back up once), Double Tap 2000, Juggernog 2500 (more health), Speed Cola 3000 (faster reloads)
  - Mystery Box 950: random gun, including the Drum LMG and the Tung Ray wonder weapon
  - Pack-a-Punch 5000 (Drum Tower): upgrades your gun (more damage, bigger mag)
- Power-ups drop from zombies: Max Ammo, Insta-Kill, Double Points, Kaboom (nuke), Carpenter.
- Health regenerates when you avoid hits for a few seconds. Without Quick Revive, going down ends the game.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim / shoot (right click scopes the sniper) |
| Space | Jump |
| C or Ctrl | Crouch |
| Shift | Walk (quiet, more accurate) |
| 1 / 2 / 3, Q, wheel | Switch weapons |
| R | Reload |
| B | Buy menu (in spawn during buy time) |
| E (hold) | Plant / defuse |
| Tab | Scoreboard |
| F | Inspect weapon |

## Run locally

Any static file server works. With Python:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

Add `?low` to the URL for lower-quality shadows on slow machines.

## Deploy to Vercel (Hobby plan)

It's a plain static site, so it fits the free Hobby plan.

**Option A — GitHub**
1. Push this folder to a GitHub repo.
2. In Vercel: *Add New → Project*, import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty. Deploy.

**Option B — Vercel CLI**
```bash
npm i -g vercel
vercel --prod
```
(run inside this folder)

## Files

- `index.html`, `style.css` — page, menus, HUD layout
- `src/main.js` — renderer, lighting, sky, menu, game loop
- `src/map.js` — map layout, geometry, collision boxes, A* pathfinding
- `src/game.js` — rounds, economy, bomb, bullets, damage, spectating
- `src/combatant.js` — shared movement, weapons, recoil, hitboxes
- `src/player.js` — keyboard/mouse control
- `src/bots.js`, `src/director.js` — bot AI and team strategy (and the Tung Tung model)
- `src/zmap.js`, `src/zombies.js` — Zombies map (Sahur Village) and Zombies rules / zombie AI
- `src/viewmodel.js`, `src/effects.js`, `src/audio.js`, `src/hud.js`, `src/textures.js`
