# TITAN Multiplayer World v3 — implementation notes

## Server-owned room and vessels

- Protocol and health endpoint: `titan-world-v3`.
- Each newly created room gets two server-created vessel records before it is returned to the host. Records use separate objects and independent navigation/system fields.
- The host also has a room-owned `Captain` player actor on Ship A, included in all shared snapshots and not charged to the 15-person team limit.
- Player team assignment is fixed for the lifetime of that room/device identity, including reconnects.
- Server owns room phase, connected/readiness checks, countdown, vessel transforms and movement, speed/throttle/rudder, map bounds, ship spacing, system flags and interaction revisions.
- Ship spawn placement is delayed until the host's embedded original `projection.html` sends its live obstacle catalogue, projection bounds and course points to the server. The server chooses two clear, separated hull positions from that geometry; it does not place the ships on a hardcoded island/reef-free assumption.
- The server keeps the source map's obstacle records (islands, reefs, rocks and typhoon hazard), checks the oriented ship hull rectangle against each obstacle's shallow-danger radius, clamps hulls to the projection bounds and enforces an 8.5-unit minimum centre separation. A grounded ship is stopped and receives a small hull-health penalty until it clears the hazard.
- Course progress is projected onto the original `DEFAULT_PATH` polyline sent by `projection.html`, rather than being estimated from world X alone.
- Server world simulation ticks at 20 Hz. WebSocket broadcasts are snapshot-based and no fake/local substitute player sessions are created.

## Actual map and ship pages

- `multiplayer.html` no longer uses its earlier simplified ocean preview as the world. It hosts `projection.html` and `main-deck.html` in same-origin game frames.
- `projection.html` keeps its original map, projection, geography and renderer. Its adapter creates two independent vessel instances from the page's original `buildTitan()` model, applies the server transforms, and displays per-vessel crew markers. Host flight moves only the map camera.
- `main-deck.html` is the actual player interior. All players in the room load the same source page with their server-assigned team and player identity.
- Main Deck spawn positions are ship-local, offset into clear areas away from the fixed obstacles and the host actor. Each ship instance uses its own copy of that positional state.
- Main Deck movement snapshots are sent to the parent every 75 ms; the server clamps to the original deck outline and resolves mirrored static AABB obstacle geometry. Door and hatch collision state uses the server copy of the ship's system state.
- Same-team remote characters are rendered in the Main Deck when they are in that area. Engine Room occupants appear in the Engine Room as simple networked crew figures; their area and positions are also visible from the world map and crew manifest.
- Main Deck navigation passes `multiplayer`, `team`, `room` and `player` query values into Engine Room and Storage.
- The original ship bus remains for single-player operation. In multiplayer, it forwards commands/telemetry to the parent page, which owns the room WebSocket. Server-owned throttle/rudder and selected power/cooling/reactor states are applied to each Engine Room client.

## Host flight mode

- Host-only FLY MODE switches to the original projection view and enables smooth keyboard camera movement (WASD/arrows, Space/Shift zoom, Q/E tilt).
- It does not send player movement or modify either ship transform.
- Turning FLY MODE off returns the host to the assigned Ship A Main Deck; the host can still view the map normally using the map tab.

## Files changed

- `multiplayer-server/server.js`
- `multiplayer-server/package.json`
- `multiplayer.html`
- `projection.html`
- `main-deck.html`
- `engine-room.html`
- `titan-ship-bus.js`
- `DEPLOY-THIS-BUILD.md`
- `MULTIPLAYER-SETUP.md`

## Validation and known gaps

- Run `node --check multiplayer-server/server.js` and `node --check titan-ship-bus.js`.
- Extract each inline script from the HTML pages and pass it through `node --check` to catch parse errors.
- Verify the static site loads over HTTP and that each page's referenced local assets return successfully.
- All inline HTML scripts and project JavaScript passed `node --check` parsing. A temporary in-process WebSocket test harness (mock transport, not the real `ws` package) exercised room creation, map-geometry acceptance, separated ship spawn selection, team joins/readiness, the server countdown, the `titan-world-v3` health response, and independent Ship A / Ship B movement. Installing the real server `ws` dependency timed out in the packaging environment, so an actual WebSocket network test could not be completed here.
- This build has not been certified against live Render/Netlify services or tested with real mobile devices. The simulated harness does not replace the first real two/three-device acceptance test.
- Room state is in process memory; one Render instance is required until shared persistence/pub-sub is introduced.
- Main Deck obstacle and deck-bound checks are server-enforced. Engine Room's detailed machinery collision is still locally simulated; the server checks its movement envelope but does not reproduce every machine obstacle. Storage remains a lightweight transition page and is not a second fully modelled walkable deck.
- Engine systems expose server-synchronized bridge orders, a set of system flags and telemetry snapshots; full deterministic server-side modelling of every reactor/electrical/cooling/motor subsystem and reconciling competing local telemetry producers remains future hardening.
- A real two/three-device acceptance test and then a 30-device venue load test are required before calling the deployment event-ready.


## v4 follow-up — map.html and direct Main Deck entry

- Added `map.html` as the active shared map page, retaining `projection.html` as the source/reference. Multiplayer world and chart-table map iframes now load `map.html` with fast rendering enabled by default.
- Fast map mode preloads the local Three.js runtime, reduces expensive rendering settings, caps DPR, limits to about 30 FPS, and pauses when hidden. The map still sends its actual current obstacles and course geometry to the room server.
- Added `titan-multiplayer-runtime.js` as the single direct-entry/session bridge on Main Deck, Engine Room and Storage pages. It uses one server socket per page, a stable device identity and the saved room/team; it never creates local fake players.
- Added a Main Deck top-bar **JOIN ROOM** action to join an existing room without first visiting `multiplayer.html`. A room code and ship assignment are required; room-only links allow the player to select a ship, while room+team links auto-join.
- Server accepts brand-new entrants during countdown and active gameplay, applies the current authoritative room state, auto-readies them, and preserves the 15-player-per-team limit and locked device-to-team assignment. Finished matches reject new entrants.
- Navigation between Main Deck, Engine Room and Storage carries the room identity and server reconnect restores the same player.
- Mock-server validation passed for a live-match direct join, shared room snapshot, auto-ready, same-device reconnect, team lock and duplicate-socket guard. This does not replace testing with the real `ws` dependency and live Render/Netlify devices.
