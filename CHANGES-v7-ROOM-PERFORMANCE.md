# TITAN v7 — Multiplayer Visibility, Room Lifecycle & Engine Room Optimisation

## Release scope

This is an engineering update on top of `TITAN-Multiplayer-FIXED-v6-POSITION-SYNC.zip`. Existing HTML rooms, the two-ship model, character customisation, game systems, WebSocket server, Netlify static deployment and Render server deployment have been retained.

The project calls the Engine Room page `engine-room.html` (not `engine.html`); that existing filename and its navigation links are preserved.

## Root causes addressed

1. **Different remote-avatar systems by room.** Main Deck already used `TitanCharacterRuntime`, while Engine Room drew its crew with a separate low-detail cylinder model and a second timer. The rooms therefore did not render the same character definition or share the same interpolation cadence.
2. **Duplicate Engine Room simulation loops.** Multiple legacy boot paths called `Game.start()`, and the rudder simulation plus crew interpolation also ran outside the main room loop. Those paths could multiply CPU work.
3. **Room transition state ambiguity.** Some embedded transitions were emitted as movement messages with a destination area but source-area coordinates. The parent multiplayer page still used `player:move` / `host:move` for area changes. The server kept one active position per player, so source coordinates could be interpreted in destination room bounds.
4. **Reconnect visibility gap.** Full-page navigation briefly closes a direct multiplayer WebSocket. A snapshot based only on the currently open socket made the avatar disappear during that reload.
5. **LOW graphics were selected too late.** Some Engine Room resources (renderer features, post-processing, steam and geometry detail) were allocated before the constrained-device profile was applied.

## Implementation changes

### Multiplayer and area membership

- Server player records now keep an independent saved pose for `main-deck`, `engine-room` and `storage`.
- `player:area` and `host:area` messages explicitly change room membership. The server saves the old area's pose, restores the destination pose (or a room-specific safe spawn), and broadcasts the new area.
- The multiplayer parent page now emits those area-membership messages for both player and host sessions instead of treating a room transition as ordinary movement.
- Main Deck, Engine Room and Storage navigation now report the source area before navigating.
- Direct join messages include the room encoded by the page URL, allowing the server to initialise the player in the correct area.
- The direct runtime tags cached poses with their source area. It will not send a cached pose from one room as coordinates for another room.
- The server retains an avatar in shared snapshots for a short 3.5-second page-reload/network-handoff grace period. A longer disconnect is still removed by the existing reconnect expiry.
- Existing per-room/per-ship filtering remains in place: same-ship crew in the same area are rendered together; other ship occupants and other areas remain separated.

### Avatar consistency

- Engine Room remote players now use `TitanCharacterRuntime.createModel` with the same `.78` visual scale used by Main Deck remote avatars.
- Character configuration (skin, clothes, proportions and animation speed) is preserved from the server snapshot.
- Remote crew interpolation and animation now run from Engine Room's main update loop rather than a separate 50 ms timer.
- Remote models are disposed when they leave the Engine Room area or disconnect.

### Engine Room performance and lifecycle

- `Game.start()` is idempotent and owns one stored animation-frame handle. `Game.stop()` cancels it for page/tab suspension and teardown.
- Rudder physics and remote-crew interpolation now use the main simulation frame's `dt`; the independent rudder RAF and crew interval were removed.
- The device profile is selected before renderer and scene allocation. LOW uses no antialiasing, DPR capped at 1, shadows disabled, fewer geometry segments, and no steam/bloom/smoke particle allocation. MEDIUM caps DPR at 1.25; HIGH caps at 1.75 and enables optional post-processing.
- External-hull geometry is constructed only if the player opens the external view.
- LOW quality avoids smoke allocation; switching to LOW disposes steam/smoke buffers and post-processing targets.
- High-cost diegetic screen drawing is rate-limited rather than redrawn every frame.
- Reusable movement vectors avoid allocating new vectors in the walk update path.
- A lightweight adaptive quality downshift responds to sustained slow frame intervals; manual quality selection disables that automatic adjustment.
- Engine Room visibility changes stop/resume the main loop and telemetry publisher. Publisher startup is idempotent, and page teardown stops timers and disposes scene resources.

### Files changed

- `multiplayer-server/server.js`
- `multiplayer-server/tests/position-sync.test.cjs`
- `titan-multiplayer-runtime.js`
- `multiplayer.html`
- `main-deck.html`
- `engine-room.html`
- `storage.html`
- `titan-ship-bus.js`

No existing environment or project source file was deleted. No new runtime dependency was added.
