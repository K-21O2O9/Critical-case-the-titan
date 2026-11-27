# TITAN v10 — Host Participation, Avatar, Movement and Shared Settings

## Implementation summary

### Host gameplay participation

- The host dashboard now has a **Join Game as Player** control under Host Settings.
- It activates the room's already-created `host-{roomCode}` actor. It does not create a second room, second WebSocket session or second player ID.
- The host remains connected with the `host` server role. Host-only room controls remain available through **HOST CONTROL**, and **RETURN TO GAME** resumes the existing gameplay view.
- Host movement and avatar changes use host-authorized messages against that same host actor.

### Character orientation and locomotion

- The character model uses one forward convention: local/world `-Z` at yaw zero.
- The face details and model geometry are built facing `-Z`, matching the Main Deck camera/movement convention.
- The server derives signed forward and strafe animation axes from its accepted player displacement and yaw, then includes those axes in room snapshots while movement is active.
- Both Main Deck and Engine Room remote-avatar renderers consume those axes, while their root transforms continue to use the authoritative replicated position and yaw.
- Animation bob/sway is kept below the network-owned model root so it cannot overwrite replicated world transforms.

### Character workshop

- The shared workshop is available from both Main Deck and Engine Room settings.
- Male/female profiles, outfit style, skin/outfit/accent/hair/eye colours, hair style, accessories, height, build and animation speed are normalized by one shared runtime.
- The preview updates as appearance controls change; saving writes the existing `titan-character-v1` profile and forwards the appearance to the current multiplayer player record.
- Remote avatars are rebuilt only when that player's appearance data changes; the current room actor remains the same.
- The renderer uses an optimized procedural, stylized low-poly humanoid with a tapered lathed torso, shared materials and simple limb pivots. It is not a photorealistic externally authored/skinned GLB model.

### Shared settings

- Added `titan-shared-settings.js`, used by both `main-deck.html` and `engine-room.html`.
- Shared values include quality, dynamic shadows, FOV, look sensitivity, touch controls, controller profile/stick choices/deadzone, and controller bindings.
- Existing legacy quality/FOV/controller values are migrated on first load.
- Voice activation bindings and voice-assistant configuration are excluded from the shared contract. Existing Engine Room voice functionality remains in Engine Room; it has not been copied into Main Deck.
- Both pages retain their native settings styling and room-specific layout controls. Shared values persist in same-origin browser local storage between room navigations.

## Files changed / added

- `multiplayer.html` — host gameplay participation UI, state handling and host action bindings.
- `multiplayer-server/server.js` — canonical movement-axis derivation, appearance validation/update, host actor pose/appearance handling.
- `character-runtime.js` — common avatar schema, `-Z` model orientation, procedural humanoid and directional animation.
- `character-creator.html` — embedded workshop support and profile update bridge.
- `main-deck.html` — shared settings UI, controller controls, embedded workshop and remote-avatar updates.
- `engine-room.html` — shared settings initialization/integration and embedded workshop bridge.
- `titan-shared-settings.js` — common persistence module.
- `titan-multiplayer-runtime.js` — shared player appearance update path.
- `multiplayer-server/tests/critical-integration.test.cjs` — integration regression checks.

## Local validation

From `multiplayer-server/`:

```sh
npm install
npm test
npm start
```

The included regression suite passed **25/25 tests** during this build. JavaScript syntax checks also passed for the server/runtime files and every inline script extracted from the edited HTML pages.

## Live multiplayer validation still required

A real two-independent-client test was not possible in the build environment: the server's declared `ws` dependency was not installed here and dependency installation could not complete. Therefore the 24 automated regression tests and syntax checks should not be represented as proof of live WebSocket or two-device behaviour. After installing dependencies and deploying the static pages and server, test with one host and at least one independent player device. Confirm host movement, remote orientation, avatar replacement, Engine Room transitions, reconnects and host-administration access on the deployed service.

The server uses the existing `multiplayer-server/package.json` dependency manifest and existing Render configuration. Keep the already-configured `TITAN_HOST_KEY` secret private; do not replace it unless intentionally rotating the host credential.
