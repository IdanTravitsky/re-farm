# Polish changes

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
