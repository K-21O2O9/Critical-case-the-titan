# TITAN v8 — Multiplayer Character Rendering & Animation Fix

## Root cause

The Main Deck mesh is created at ship-local Y = 3.2, but the multiplayer renderer placed remote character roots at Y = 0.06. The remote avatars were therefore positioned below the visible deck surface.

A second transform conflict made the positioning failure persistent: the shared character animator wrote its idle/walk bob directly to `model.position.y` every frame. That overwrote the root transform being interpolated from multiplayer snapshots. Correcting only the spawn height would not have fixed this second issue.

## Changes

- `character-runtime.js`: introduced an inner visual rig group. Body parts and rig pivots live under it; animation bobbing is applied to that inner group. The outer model root is now reserved for scene/network position, rotation and scale.
- `main-deck.html`: places same-ship remote avatars on the Main Deck's actual local deck plane (Y = 3.2), keeps interpolation on the root transform, and removes a duplicate per-frame animation call.
- `main-deck.html` / `multiplayer.html` message flow: sends sprint state alongside the existing movement pose.
- `multiplayer-server/server.js`: includes the running flag in snapshots and updates/resets it with authoritative movement and area transitions.
- `engine-room.html`: consumes the same server locomotion state for remote character animation; the current Engine Room controller reports its existing walking state without changing its controls.
- `titan-multiplayer-runtime.js`: aligns its fallback Main Deck avatar height with the deck and forwards running state in direct-entry movement snapshots.

No map, ship design, room layout, UI, controls, game mechanics, asset, deployment setting or unrelated optimisation was changed.
