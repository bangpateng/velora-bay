# VELORA BAY — Sun-Soaked Open-World Crime

[![make.fun bounty](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/bangpateng/velora-bay/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/bangpateng/velora-bay/reward.svg)](https://make.fun/c/gta6-01)

An original open-world crime game that plays offline in a desktop browser
from static files. You are **Kai Marlowe**, a courier turned wheelman for
fixer **Mara Solis**, working ten story jobs across a sun-soaked coastal
city — downtown towers, the marina and pier, the harbor, the hills — while
the Velora Bay Police Department hunts you down.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network: `game/index.html` plus its vendored three.js
(`game/vendor/three.module.min.js`) is the whole game.

## What's in the city

- **10 story missions** — car theft, courier runs, a repo job, taxi fares,
  a pier shootout, a street circuit race, a bank job, a helicopter escape,
  a night harbor sabotage, and a final chase down Vince Kade.
- **A 5-star wanted system** — VBPD cruisers that chase and ram, a police
  helicopter from 3 stars, roadblocks from 4, heat that cools when you
  break line of sight, and the safehouse to clear it entirely.
- **A living city** — traffic that follows the road grid, pedestrians on
  the sidewalks who flee gunfire, a day/night cycle with golden hour,
  street lamps, a ferris wheel on the pier.
- **Cars to steal and keep** — steal anything on the street, buy more at
  Dino's Autos, keep them in the garage; each handles differently.
- **Combat** — fists, pistol and SMG, enemy squads, health/armor/ammo
  pickups, a damage flash and a crosshair.
- **Side work** — taxi fares (T), 30 hidden sun coins, stunt jumps,
  three synth radio stations (R), engine and siren audio.
- **HUD + minimap** — wanted stars, cash, clock, health/armor, speed,
  objective tracker with distance, and a live minimap with mission,
  police and enemy blips.
- **Save & continue** — autosaves at the safehouse and after every job;
  localStorage keeps money, progress, garage and stats.

## Controls

WASD move / drive · Shift sprint / boost · E enter or exit a car (steal
it) · Space handbrake · mouse drag to look, wheel to zoom · click to shoot
(when armed) · F punch · 1 / 2 fists / gun · R radio · M mute · T taxi
fare · G take garage car · B buy a car at Dino's Autos · H horn ·
Enter start the next job · Esc / P pause.

## Entry

Built for the [make.fun gta6-01 bounty](https://make.fun/c/gta6-01)
("Make GTA 6"). `main.ts` (Node 22) copies `game/` and `screenshots/`
to `/output` and writes `/output/dossier.json`. Round 4 is a genuine
re-implementation from scratch: new code structure, 10 missions, night
jobs, a chase finale, and four fresh screenshots.

Velora Bay, its people and its story are invented — no real city, person
or game is copied. MIT licensed.
