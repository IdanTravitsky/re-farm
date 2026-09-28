# Verification — upstream integration, 2026-09-28

Baseline: upstream `831e04a` (Claude's updated cameras, lighting, poses and staging). Earlier local fixes were merged selectively; collision was regenerated from the updated upstream scene assets.

## Checks

- **45 passing Node tests**, including the complete story sequence, text bounds, inventory/save behavior, assets, collision, cinematics and the monster checkpoint.
- **28 rooms, 188 interaction points, 34 door spawns:** all have connected, body-clear approaches.
- **74 model assets and 196 cameras:** decoded and validated. Every camera renders in both Classic and Enhanced in Chromium with no page exceptions or console errors.
- The exact photographed farmhouse door is tested against its depth-derived plane at y=4.925. Holding forward for 600 frames and applying a large movement displacement do not cross it. Loading a position inside it recovers to clear floor.
- Formerly blocked, depth-confirmed ground samples in road, city and sewer scenes are exercised with actual actor movement. Low details and shoulder-height obstacles use separate collision layers.
- Wilson/farm escape regression checks scenery and vehicle overlap each frame. The city Amalgam must actually advance away from its spawn.
- The new monster form and all three fleeing workers survive checkpoint reload. Claws cause damage on the attack's impact frame, subject to range, facing and line of sight.
- Bench gestures continue during dialogue without advancing story actions. Bridge disappearance is replaced by a falling/rotating sprite, with actors falling and the missing floor remaining blocked.
- Visual review: cutscene text, inventory, farmhouse door, tunnel, revised creature, bridge fall, bench recording, monster control and window exit.

## Two distinct campaign tests

`tests/journey.test.js` uses direct positioning and accelerated combat for fast story-logic coverage. It does not demonstrate combat balance.

`npm run test:playthrough` drives tank-control inputs continuously from a new game through all ten chapters, the monster hunt and the climb out. It does not teleport, enable invulnerability, grant inventory, edit story flags, or directly damage enemies. It uses normal combat, pickups, healing, reloading and transitions. Navigation reads the room map, and dialogue is advanced rapidly. This is an automated input playthrough, not a manual real-time play session. Seed 42 makes it reproducible. Its route visits 27 rooms; the optional barn loft is covered by the asset/render/connectivity checks.

The generated report records input runs, events, dialogue, ammunition, health, screenshots and completion. See `tests/artifacts/playthrough/report.json` after running it, and `PLAYTEST.md` for findings.

## Limits

- Original upstream plates remain 320×240. Live geometry and the authored tunnel support 640×480; this does not recreate missing high-resolution scenery detail.
- Collision recovery uses the provided depth maps and grids. The tests cover the reported failures and broad room connectivity, not every possible point on every prop.
- Some first-render timings exceeded the 33 ms simulation interval in software-rendered Chromium. Classic mode is available on slower machines; this pass does not claim sustained 30 FPS on every device.
- Physical controllers, other browsers, prolonged audio playback and every inventory/combat history have not been exhaustively tested.
- Film reference review used sampled frames and a machine transcript, supplemented by the user's scene descriptions. It is not a shot-for-shot fidelity certification; game dialogue and monster designs remain adaptations.

No reference-film media or transcript is included in the repository or release archive.
