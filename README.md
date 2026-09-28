# Resident Evil: Night Zero — polished edition

A local polish branch of [IdanTravitsky/re-farm](https://github.com/IdanTravitsky/re-farm), retaining the fixed cameras, story, tank controls, inventory and survival-horror style.

## Play

From this directory, run:

```sh
npm start
```

Open **http://127.0.0.1:8000**. Node dependencies are not required to play; `npm start` uses Python 3's static server. You can also run `python3 -m http.server 8000 --bind 127.0.0.1` directly. Serve the files over HTTP rather than opening `index.html` as a file.

Press **P** for pause, graphics and controls. Enhanced 640×480 rendering is the default; Classic 320×240 remains available. Both modes simulate at 30 Hz. Brightness, scanlines, interaction hints and reduced flashes/shake are configurable and saved in the browser.

| Control | Action |
| --- | --- |
| Arrows / WASD | Forward, backward, turn |
| Shift | Run |
| Down + Shift | Quick turn |
| Z / Q / right mouse | Aim |
| X / Space / left mouse while aiming | Fire |
| R | Reload |
| E / Enter / Space | Interact / confirm |
| V | Cycle nearby interaction targets |
| Tab / I | Inventory |
| M | Map |
| [ / ] | Inventory tabs |
| Escape / C | Back |
| P | Pause and settings |

Controllers support the left stick/D-pad, B to run, triggers to aim, A to interact/fire, X to cycle nearby interactions, and Y for inventory (or reload while aiming).

## Saves

Chapter-entry checkpoints support **Continue** from the title screen and retry after death. Typewriters still use ink ribbons for exact-position saves in three slots. Checkpoints are separate from those slots. Failed manual saves preserve the ribbon and display an error.

The original manual-save key is retained. Browser storage is isolated by origin, so saves on the original GitHub Pages URL do not automatically appear on localhost. Keep using the same local URL/port to retain local progress. Starting a new game replaces the chapter checkpoint, while manual slots remain intact.

## Main changes

- Body-radius collision keeps Bryan clear of walls and furniture. Raised furniture is removed from interior walk grids; saved positions are moved back to clear floor when loaded.
- Intro, dialogue, documents and chapter endings wrap and paginate without losing text. Long questions reserve room for their choices.
- Wilson walks around his SUV. The farm truck follows a turning route while the Amalgam pursues separately; cutscene actors no longer automatically pass through walls when stuck.
- A nine-person Amalgam with independently moving body clusters and additional support legs. Its city entrance is on the reachable side of the burning wreck.
- The RV chapter takes place in North Pass Tunnel, with abandoned damaged cars, seven new camera views, native 640×480 backgrounds, and matching depth/collision data.

- Visible interaction labels and cycling among nearby actions; bolt cutters can be collected from the van's storage-box approach.
- Inventory icons now render correctly; file reading and item submenus display correctly. Stacked herbs can combine without overflowing inventory slots.
- Swept movement prevents tunnelling through thin collision cells and crossing blocked diagonal corners. Enemy navigation respects those corners; melee/charge damage cannot pass through walls.
- Brief damage protection, readable grab prompts, manual reload, target reacquisition and a telegraphed sewer boss charge. A small ammo cache by the cistern entrance reduces the chance of entering the mandatory fight under-equipped.
- Correct actor depth testing and perspective-correct textures in Enhanced mode. Backgrounds are smoothly resampled; depth masks use nearest sampling to preserve occlusion edges.
- The garage intercom camera no longer uses the final lab's background/depth map. Its replacement uses an existing, matching garage camera composition.
- Clean restart/load state, persistent enemy wake zones, safe scripted rewards when inventory is full, faithful offscreen enemy snapshots, and correct death-state resets during transformations.
- Pause on focus loss, cleared stale inputs, analog-stick menu navigation, load-failure recovery and a reduced-motion option.

See [CHANGELOG.md](CHANGELOG.md) for the detailed fixes and [QA.md](QA.md) for verification and remaining limits.

## Verify

Node 22+ and Python 3:

```sh
npm test
npm run audit
```

The tests use the shipped data, not mocked substitutes for the level content. They cover the full campaign's story progression with direct positioning and accelerated combat, plus focused regressions and asset validation. The grid audit independently checks connectivity and interaction access.

Optional browser checks (start the server first in another terminal):

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

Set `GAME_URL` for a different server URL or `PLAYWRIGHT_EXECUTABLE_PATH` to use an installed Chromium. Screenshots and reports go to `tests/artifacts/` (ignored by Git). The runtime itself has no external JavaScript dependencies.

## Art and scope

The original backgrounds are 320×240 pre-rendered images. Enhanced mode renders live geometry at 640×480 and improves presentation; it does not invent high-resolution environmental detail. The original scene-authoring files are absent. The new tunnel is an exception: its native 640×480 renders, Blender scene and reproducible scene builder are included in `tools/`. The Amalgam generator and original model snapshot are included there too. This is a substantial tested polish pass, not a claim that every possible playthrough or visual edge case is bug-free.


## Rebuild the new art

`tools/build_tunnel.py` uses Python 3.11, `bpy==4.5.3`, NumPy and Pillow to rebuild the tunnel scene, both background resolutions, depth masks, collision grid and camera metadata together. Run it from any directory with that environment's Python. `python3 tools/build_amalgam.py` rebuilds the Amalgam from `tools/amalgam-source.json` using only the standard library. These tools are for editing assets; neither is needed to play.
