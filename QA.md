# Verification — 2026-09-28

## Automated checks

- **38 passing Node tests.** Focused regressions, asset integrity, and a campaign progression test from Route Six through all ten chapters to the final delivery.
- **28 rooms / 186 interaction points / 34 door spawns:** every pickup, examine point, door and item box has a body-clear approach connected to the room entrance within its interaction radius.
- **67 model assets:** texture palette indices, vertex references, topology, parent ordering, and item/actor model references validated.
- **120 cameras:** all background and depth images decode with the expected dimensions; incompatible camera transforms cannot share one background filename. Sampled walkable cells have in-frame camera projections.
- **Chromium browser checks:** every room and all 120 cameras rendered in both Enhanced and Classic modes; no browser exceptions or console errors. The Water Department pickup was selected using real keyboard input. Inventory and settings screenshots were visually inspected.
- **Cutscene regressions:** Wilson and the farm Amalgam are checked frame by frame for overlap with scenery and live vehicle footprints. The escape test requires the creature to chase beyond the truck's departure point. The city test requires pursuit away from the spawn, not just successful creation.
- **Interior movement:** 8,000 deterministic swept moves across five furnished interiors remain on body-clear floor; loading a saved furniture-top position relocates the player safely.
- **Text layout:** every intro, chapter and file page preserves its narrative text within screen bounds. Long-question pagination and message callbacks are tested. Browser screenshots include both rendering modes, the ending, corrected interior positions and the revised cutscenes.
- **Tunnel:** all seven native 640×480 backgrounds and 320×240 versions decode; the RV, service cabinet and rescue lane have body-clear routes.
- **Git whitespace validation:** `git diff --check` passes.

## What the campaign test does

The campaign test invokes real pickups, door interactions, item use, triggers, boss transformations and chapter transitions. It checks the city gate/key/manhole chain, both sewer boss phases, the elevator/shaft sequence, the bridge clamp, decontamination and the final delivery. It uses direct positioning and accelerated enemy damage with invulnerability to make the test deterministic and fast. It is **not** an end-to-end human playthrough or a proof of combat balance. A separate audit checks the underlying walk-grid connectivity and interaction access.

## Limits

- Original scenery art remains 320×240; live geometry and the new tunnel backgrounds render at 640×480 in Enhanced mode. The new tunnel has a reproducible Blender source; the other original environments do not.
- Visual inspection covers representative gameplay positions, interior clearance, narrative screens, the redesigned creature, cutscenes, the tunnel, inventory, settings and the garage correction; browser rendering covers every camera. It does not inspect every animation frame at every position.
- The automated browser run uses desktop Chromium. Other browsers, physical controller hardware, long-session audio, and every possible inventory/combat history have not been exhaustively tested.
- Collision sweeps improve movement against the authored grid. The audit proves connectivity and hotspot access, not pixel-perfect agreement between every background prop and its collision boundary.

Run the commands in README.md to reproduce the checks. Browser artifacts are generated locally in `tests/artifacts/`.
