# Tung Tung Shooter

A 5v5 Counter-Strike–style tactical shooter that runs entirely in the browser (Three.js + WebGL).
No build step, no server code, no assets to download — every texture, model and sound is generated in code.

- Original desert map with bomb sites A and B, mid, long and tunnels
- You + 4 bot teammates vs 5 bots, three difficulty levels — or play **online with friends** (see below)
- Buy menu and economy, recoil and spread, headshots, armor
- Bomb plant / defuse, round timer, radar, kill feed, scoreboard, spectating
- Every fighter is a "Tung Tung Tung Sahur" kentongan log: dome top, bulging eyes, toothy grin, bare feet,
  and a baseball bat (slung on the back, swung in melee). Team color is the hanging rope: orange = T, blue = CT.
- Knife skins picked in the menu: Knife, Karambit, Flip, Butterfly (with flips), Sword. Skins are cosmetic.
- 10 static crosshairs (no spread): Classic Green, s1mple, ZywOo, NiKo, donk, m0NESY, T-Shape, Dot Only,
  Cross + Dot, Circle + Dot. Pro presets use the most commonly reported 2026 settings; pros change them often.
  Add or edit presets in `src/crosshair.js`.

## Movement & feel (matched to CS2)

- CS2's real movement values, converted from Source units: 250 u/s with the knife (215 AK, 225 M4, 200 sniper),
  acceleration 5.5, friction 5.2, stop speed 80, air acceleration 12 with the 30 u/s air-strafe cap,
  gravity 800, 57-unit jump, 18-unit steps. Shift-walk is 52% speed and silent; crouch is 34%.
- Crates are CS2's 64-unit (1.6 m) boxes: you need a crouch-jump to get on top.
- Jump is press-to-jump (no auto-bhop when holding Space), with a short buffer for presses just before landing.
- Physics runs at a fixed 128 ticks per second and every frame is drawn between ticks, so movement is identical
  at 30, 60, 144 or 240 fps and stays smooth on high-refresh screens.
- Raw mouse input (no OS pointer acceleration) and CS2's sensitivity scale (0.022° × sensitivity per count),
  so you can type in your CS2 sensitivity.
- Graphics: **High quality** (detailed surfaces + soft sky lighting) or **Performance** for slower computers.

## Online play

Pick **Players: Online with friends** in the menu. One person clicks **HOST A ROOM** and gets a 5-letter room
code (and a **Copy invite link** button); everyone else types the code and clicks **JOIN**, or just opens the link.

- **5v5 Classic:** up to 10 players. Everyone picks a team in the lobby (5 per team); the host can fill the empty
  slots with bots (and pick their difficulty) and set the rounds to win.
- **Zombies Co-op:** up to 4 players. See *Co-op* below.
- The host's browser runs the match: keep that tab open. Switching tabs is fine (the match keeps ticking in the
  background), but if the host closes the tab or leaves, the room closes for everyone.
- Pressing Esc opens a menu but doesn't pause an online match. The host can end the match from there and
  everyone goes back to the lobby.
- Players connect to each other directly (WebRTC, via [PeerJS](https://peerjs.com)). PeerJS's free public server
  is only used to find each other, so there is still no server to deploy. Hosting a full 10-player room uses about
  1 Mbps of upload.
- Joining a match that has already started isn't supported: join in the lobby.
- Testing on one computer: open two tabs with `?net=local` added to the URL (they connect without the internet;
  `&lag=150` fakes a 150 ms round trip).

## Zombies mode

Pick **Zombies** in the menu for survival in **Sahur Village**, a night-time map built for this mode — alone or
online with up to 3 friends.

- Endless rounds of Tung Tung zombies with bats. They tear boards off the windows and climb in, or rise from
  the ground. Regular zombies have 100 HP (same as a player); each round brings more of them, and they get
  faster (walkers → runners → sprinters).
- **Big zombies** (from round 3): ~1.7x size, 400 + 80 × round HP, hit for 80, worth 250 points. They rise from
  the ground (max 3 at once).
- Between rounds, press **N** to start the next wave right away.
- **Sahur Hill** (doors from the Courtyard 1250 / Kitchen 1000): two hills, a walk-in hut, and a watchtower
  with a hanging kentongan, reached by stairs or a ladder (W climbs the way you look; S or look down to go down).
  Zombies take the stairs. The Courtyard also has a walk-in hut you can run through.
- Points: +10 per hit, +60 per kill, +100 headshot kill, +130 knife kill, +10 per board you rebuild (hold E).
- Spend points on (press E):
  - Doors: Courtyard 750, Kitchen 1000, Garden 1000, Drum Tower 1250, Sahur Hill 1250 / 1000
  - Wall guns: SMG 1000, Shotgun 1500, AK 1800, M4 1800, Sniper 2000, LMG 3000 (ammo = half price)
  - Perks: Quick Revive 500 (gets you back up once), Double Tap 2000, Juggernog 2500 (more health), Speed Cola 3000 (faster reloads)
  - Mystery Box 950: random gun, including the Drum LMG and the Tung Ray wonder weapon
  - Pack-a-Punch 5000 (Drum Tower): upgrades your gun (more damage, bigger mag)
- Power-ups drop from zombies: Max Ammo, Insta-Kill, Double Points, Kaboom (nuke), Carpenter.
- Health regenerates when you avoid hits for a few seconds. Without Quick Revive, going down ends the game.

### Co-op

- Zombies go for whoever is closest. Each round has more of them with more players (+50% per extra player).
- Doors, windows, the Mystery Box, Pack-a-Punch and power-ups are shared; points, perks and guns are your own.
  Only the player who paid for the Mystery Box can take its gun. Max Ammo refills everyone; Carpenter and
  Kaboom give every player their points.
- Going down doesn't end the game: you lose your perks and have 30 seconds. A teammate holds **E** next to you
  for 3 seconds to revive you (1.5 with Quick Revive). Downed teammates show a red cross you can see through walls.
- If nobody gets to you, you bleed out and watch your teammates until the next round, when you come back next
  to a teammate with a pistol (you keep your points).
- The game is over when everyone is down or out at the same time.

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
| E (hold) | Plant / defuse, rebuild boards, revive a teammate |
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
- `src/net.js` — online rooms, lobby and message batching (PeerJS)
- `src/avatar.js` — other players' fighters, moved by network updates
- `src/netclassic.js`, `src/netzombies.js` — 5v5 and Zombies on a joining player's browser (the host runs
  `game.js` / `zombies.js` for everyone)
- `src/viewmodel.js`, `src/effects.js`, `src/audio.js`, `src/hud.js`, `src/textures.js`
