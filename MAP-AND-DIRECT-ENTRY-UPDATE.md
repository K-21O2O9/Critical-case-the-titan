# TITAN — map.html + direct Main Deck room entry

## Active map

- `multiplayer.html` now loads `map.html` for its shared multiplayer world. `projection.html` remains in the project as the preserved source/reference page; the active runtime URL is `map.html`.
- `map.html` retains the original tactical scene, course, vessel assets and map-object geometry. The server receives the obstacle list and route from the actual loaded map scene, rather than a second hand-maintained obstacle list.
- The map is fast by default. `three.min.js` is preloaded locally, antialiasing and shadow maps are disabled in the fast profile, device pixel ratio is capped (0.9 mobile / 1.25 desktop), rendering is limited to about 30 FPS, and rendering pauses while the map iframe is hidden or the document is backgrounded. The query `quality=high` or `quality=ultra` opts out of the fast profile.
- The lobby loads its hidden map iframe before the race to register map geometry. The server does not enable START GAME until the map geometry is validated. The map renderer also accepts the current room snapshot and `MAP_VISIBILITY` messages so it does not waste GPU time when the player is on the deck view.
- Main Deck's chart-table iframe also uses `map.html`; it receives the live room snapshot directly from the Main Deck runtime and pauses when the chart is not being viewed.

## Direct Main Deck multiplayer entry

There are three supported direct-entry paths:

1. **Room-only invite:** `main-deck.html?room=ABC123` opens the room join gate with the code prefilled. The player enters a name and chooses Ship A or Ship B.
2. **Room + ship invite:** `main-deck.html?room=ABC123&team=A` or `&team=B` joins automatically. The saved character name is used, or the project seeds a simple default character if none exists.
3. **Direct entry without an invite:** open `main-deck.html` and press **JOIN ROOM** in the Main Deck top bar. Enter the room code and select the ship. **Enter Main Deck** remains the offline option.

The direct join gate sends a normal `join` request to the existing TITAN room server. It does not create a local room or invent a local multiplayer player. The room code is the shared room identity; if the player has no room code and no saved session, they must obtain the host's code before they can join the same room.

- The room server now accepts new players in the lobby, countdown or active race. Players joining during countdown/live play are added to the existing room snapshot, assigned one ship, and marked ready automatically.
- Existing saved sessions reconnect using the same device ID and room code. A player's team is locked to their existing assignment for that room. A connection cannot attach itself to multiple rooms, and the 15-player-per-ship capacity remains server-enforced.
- After `joined`, the direct-entry runtime applies the authoritative snapshot, starts the local Main Deck scene and sends live player movement to the room server. Teammates on the same ship see one another; the shared chart map shows both ships and all connected crew.
- The runtime preserves the same room, team, name and device identity when moving between `main-deck.html`, `engine-room.html` and `storage.html`. It reuses the existing saved session on reconnect instead of opening a separate room.
- Opening a direct link for a room that has finished is rejected for new entrants. The host must reset/create a new match to accept new participants.

## Deployment

Deploy the extracted project contents to the same GitHub repository. Keep Render configured with root directory `multiplayer-server`, `npm install`, `npm start`, and `/healthz`. The protocol remains `titan-world-v3`; the direct-entry and map-page changes are website/runtime changes plus the already-updated server behavior. Keep the existing `TITAN_HOST_KEY` secret in Render.

## Verification boundary

The local mock-server test covers an entrant joining an already-running room, receiving the live room snapshot, appearing once in the shared player list, being marked ready, reconnecting with the same device ID, retaining the same ship assignment, and being prevented from attaching the same WebSocket to a second room. It is a logic test with a mock WebSocket transport, not a live Render or real network/device test. Perform the included 2–3 device live acceptance test after deployment.
