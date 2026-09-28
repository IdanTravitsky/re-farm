# Playtest findings

The new upstream version is the baseline. Its additional cameras, moving lights, visible attack/bite sequences, bridge setup, infection colouring and prop work are retained.

## Fixed after inspecting the updated version

| Finding | Result |
| --- | --- |
| Interior navigation included parts of visible walls and closed doors | Recovered vertical solids from the updated scene depth; swept, layered actor collision keeps the full body clear. |
| Ground paint, blood and shallow snow could behave as obstacles | Shared collision rebuild restores depth-confirmed low ground; no object-name exception list. |
| The city entry could overlap the parked SUV and prevent escape | Engine recovery now checks live vehicle footprints as well as room collision. |
| Wilson's direct route crossed his SUV; the farm pursuit used ghost movement | Reapplied separated paths and physical navigation while retaining upstream shots and dialogue. |
| The city monster travelled through the crash | It enters from reachable ground and pursues through the normal movement system. |
| RV scenery still needed the requested tunnel setting | Kept the authored tunnel, matching depth, damaged vehicles and rescue lane; updated script camera references. |
| Boarding the rescue SUV still required two zombie kills | Boarding is available once the SUV arrives, avoiding an ammunition-dependent escape lock. |
| Upstream moving light effects assumed a 320×240 framebuffer | Lighting now samples and writes the correct pixels in both resolutions. |
| Long text could exceed a fixed display region | Kept measured wrapping, pagination, stable reveal and queued messages across dialogue, documents and chapter screens. |
| The bench was a static seated swap | Added sitting, phone-recording gestures and standing, including motion while dialogue is read. |
| The bridge span disappeared between shots | It now rotates and accelerates downward; occupants fall and the gap remains blocked. |
| The ending removed the workers and completed through narration | Added player-controlled monster Bryan, fleeing lab workers, timed melee, a persisted transformation checkpoint and an animated window exit. |

## Campaign observations

The input-driven route completes the sewer's two phases, escapes the rats, reaches the hospital/ward, breaks the bridge clamp, delivers the cooler, hunts the workers and climbs out. The test uses regular pickups and finite ammunition. It also manages the eight inventory slots by reloading or using carried healing items before taking a new item.

Some early test attempts failed because the controller fired at the distant bridge clamp, fought rats instead of escaping, retained an unintended aiming target, or attempted a pickup with full inventory. Those are recorded as test-controller/route corrections rather than falsely reported as game fixes. A separate real failure—the SUV spawn trapping movement—was reproduced and corrected in the engine.

## Adaptation and remaining observations

- The tunnel and mass-of-bodies creature follow the requested scene corrections while preserving the game's existing visual style.
- The old final text about a completed helicopter delivery did not provide the requested playable lab sequence. The new ending implements the user's hunt-and-climb description.
- The provided reference was sampled across its duration and transcribed for review. The garage phone scene's framing/costuming differs from the game's bench scene, and substantial dialogue remains game-authored. Neither the current monster model nor every proper name or line has been certified against the film.
- Original low-resolution plates and occasional expensive software-rendered frames remain presentation limits. Not every incidental scene has been replaced with a bespoke animation.

Reproduce with `npm test`, `npm run audit`, `npm run test:playthrough`, and `npm run test:browser` with the local server running.
