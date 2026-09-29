# Polish changes

## Road encounter fix (29 Sep 2026)

- Fix duplicate Katie actors during the deputy attack: replacing a scripted actor now retires every previous instance and clears stale targeting, grabs, movement and saved state.
- Katie gets up from her feeding pose and visibly escapes around the wagon, with collision enabled and camera cuts following her into the woods. Dialogue no longer interrupts and replaces her escape movement.
- Remove Katie completely after the escape, including on subsequent room reloads.
- Add regression coverage for the full encounter with normal pistol fire, vehicle clearance throughout the escape, actor replacement, and offscreen replacement.

## Round 5 (Claude, 28 Sep 2026): building on the Enhanced renderer

- Every scene now has a true 640x480 Enhanced plate (202 cameras, JPEG, decoded by the browser), plus HD pickup sprites. They are cut from the raw renders the pipeline already made, so nothing needed re-rendering. Classic 320x240 is unchanged.
- Difficulty select at New Game, after RE2 (2019):
  - ASSISTED: 0.6x damage, health recovers to CAUTION, 1.5x ammo, typewriters need no ribbon.
  - STANDARD: the tuned game.
  - HARDCORE: 1.4x damage, 0.7x ammo.
  Scripted story damage is never scaled, and pickup messages always state the real count.
- Modern controls option (Settings): the arrows move Bryan where you point on screen; the camera frame is held while a direction is held, so camera cuts never flip him.
- The map colours rooms RE2-style: red while items remain, blue when cleared, with a legend.
- Eight new files, one or two per chapter, telling the outbreak's side (dispatch log, fridge note, water dept. work order, cistern log, B2 security log, Lab 4 memo, B7 notes), and Michelle's saved voicemail, which Bryan plays on the bench.
- The city crash fire and smoke are real Cycles volumes. They were emissive boxes and stacked discs.
- Finishing the game unlocks INFINITE AMMO on the difficulty screen.


## Source integration (Claude, 28 Sep 2026)

- The published build is now reproducible from source. `python tools/build.py --site` compiles the content, then runs post-passes over `game/data`: the vendored North Pass tunnel (`vendor/tunnel`), the many-body Amalgam (`tools/build_amalgam.py` on the freshly built model), and body-clearance collision (`tools/rebuild_collision.py`). The collision pass always starts from the freshly compiled grids. Rebuilt data matches the previous release byte for byte, apart from the fixes below.
- `site/` mirrors `game/` (engine, data, tests, tools, docs). The export no longer deletes tests or tools, and the stale-file prune keeps `_body` grids and `_hd` plates.
- `walk_floor_limit` is authored per room in `content/` and emitted by the level compiler.
- City: the Amalgam again comes from the burning wreck (east). The previous spawn put it between Bryan and the manhole he flees to, contradicting "coming around the crash".
- Movement: when both the straight step and the axis slides are blocked, actors glance off at up to 52 degrees instead of stopping dead. Tank controls no longer snag on table corners and narrow doorways.
- Skybridge: the Amalgam bursts through as an intro beat, then wakes with a moment's grace, and Bryan is pushed clear of the door. It could land repeated hits on a player standing at the entrance.
- `tests/playthrough.mjs`: pickups interrupted by a hit are retried, as a player would.


## Integration with upstream 831e04a

- Retain the updated upstream camera coverage, lighting, actor props, poses, door/ladder transitions, combat framing, infection colouring and revised scene staging.
- Rebuild collision from the updated scene depth instead of carrying over stale grids. Separate foot clearance from shoulder clearance and recover invalid player placements, including the city SUV spawn.
- Repair camera assignments on newly opened or incorrectly framed floor cells. Scale moving headlights correctly in Enhanced mode.
- Preserve the authored tunnel and mass-of-bodies Amalgam, and route the officer and pursuing creature around vehicles.
- Allow boarding the rescue SUV without first killing both tunnel zombies.
- Keep text pagination and queued dialogue alongside upstream inventory improvements.
- Act out the bench scene and bridge fall. Add a playable, saveable monster finale with fleeing workers, timed melee impact, and a climb through the lab window.
- Add continuous input-driven campaign QA and geometry-based wall, floor-detail, dynamic boundary, lighting and monster-checkpoint regressions.

## Second pass: interiors, cutscenes and tunnel

- Replace point-only collision with a swept circular footprint, including live vehicle rectangles; stop actors stepping onto furniture and resnap loaded player positions safely.
- Remove raised sofas, beds and other furniture from nine room walk grids. Correct the kitchen table's oversized collision footprint and make nearby scenery/pickups usable from clear floor.
- Route scripted actors around obstacles with A*, honor waits on waypoint paths, and remove the automatic wall-phasing fallback. Smooth facing changes and choreograph Wilson around the sheriff SUV and wagon.
- Give the escaping truck a turning path, keep the Amalgam on a separate pursuit route, and verify that the creature actually runs after it.
- Rebuild the Amalgam as a compact mass of nine people with additional supporting legs and asynchronous cluster motion. Add body-size-aware fallback navigation for stalled enemies.
- Move the city's Amalgam entrance to open road in front of the burning wreck and show its arrival with an appropriate camera.
- Replace the RV lot with an authored concrete tunnel full of damaged cars. Rebuild seven camera backgrounds in both resolutions, aligned depth masks, the collision grid and route map. Include the Blender source and asset generators.
- Wrap and paginate intro cards, chapter text, the ending, dialogue and documents using actual font widths. Preserve every narrative line and reserve space for choices and statistics.
- Reveal fully laid-out dialogue without shifting words between lines; queue overlapping messages instead of overwriting them. Keep long inventory/storage/save labels within their panels.
- Accept the quick-turn chord regardless of whether Down or Shift was pressed first.

## Interactions and progression

- Show the exact action near an interaction point, with V to select alternatives in overlapping hotspots.
- Make small pickups less sensitive to facing and prioritize them over generic descriptions and storage.
- Expand the bolt-cutter interaction radius at the Water Department van and improve its description.
- Explain why the sewer exit cannot be climbed while the boss is alive.
- Add 30 handgun rounds near the cistern entrance, available as a normal pickup.
- Preserve scripted rewards by storing inventory overflow in the shared item box, with a notification.

## Collision and combat

- Sweep movement in sub-cell increments rather than checking only the endpoint; large knockback and scripted movement cannot skip a collision strip.
- Prevent diagonal movement and flow-field navigation from cutting through blocked corners.
- Check line of sight for melee and charge hits.
- Wrap facing-angle differences correctly after any number of turns.
- Telegraph the Swollen Man's charge for 0.65 seconds.
- Give 0.65 seconds of protection after damage and 0.8 seconds after breaking a grab. Scripted story damage remains effective.
- Support R to reload and controller Y while aiming.
- Reacquire a target after it dies without overriding manual aim rotation.
- Show loaded/reserve ammunition while aiming and a prompt during grabs.

## Graphics and interface

- Add Enhanced 640×480 geometry rendering with perspective-correct UV interpolation, full-colour shading, and smooth background scaling.
- Preserve Classic 320×240 rendering as an option.
- Use reciprocal-depth interpolation and a dynamic geometry depth buffer to resolve overlap errors. Scale scene depth masks independently with nearest sampling.
- Fix transparent render-target alpha, which hid inventory icons; size icons within slot borders.
- Replace the incompatible garage `lb_cut` camera with a separately named matching garage plate/depth pair. The final lab retains its own `lb_cut` assets.
- Shake the whole view instead of displacing actors against stationary scenery/depth masks.
- Add saved brightness, scanlines, hints and reduced-flash/shake settings, plus a pause/settings dialog.
- Display files opened from the inventory above the menu instead of invisibly behind it.
- Keep item action submenus on screen and allow cancelling a combine selection independently.
- Allow combining two herbs from the same stack; reject combinations that would require a ninth slot without consuming their ingredients.

## State, storage and loading

- Reset old enemies, modal screens, scripts, hidden-player state and transition effects on new games and loads.
- Take chapter checkpoints before entry scripts fire, so loading them replays the introduction correctly.
- Keep ink ribbons/save counters unchanged on storage failure; ignore malformed save structures safely.
- Preserve enemy wake rectangles, hidden parts and fired health events in snapshots.
- Clear stale death/corpse records when an actor ID is respawned or transformed.
- Retain scripted health and other spawn fields for offscreen enemies.
- Retry room loads after failed fetches and show recoverable loading errors.
- Validate PNG signatures, chunk boundaries, filters and scanline lengths rather than silently accepting malformed assets.
- Clear pending keyboard/mouse state on blur, pause simulation when unfocused, and support analog-stick menu edges.
- Prevent double chapter-continuation dispatch while the next location loads.
