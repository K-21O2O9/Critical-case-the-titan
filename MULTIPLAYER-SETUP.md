# THE TITAN — Multiplayer World v3 setup

## Map loading and direct entry

- `map.html` is the active multiplayer map page. `projection.html` is retained as the original source/reference; lobby map frames, chart-table map frames and shared world rendering use `map.html`.
- The map's fast profile is enabled by default: local Three.js preload, reduced antialias/shadows, capped pixel ratio, approximately 30 FPS, and pause while hidden. It still uses the full scene and current map object geometry; only rendering quality/work while hidden is reduced.
- From the Main Deck top bar, use **JOIN ROOM** to enter a room code and choose Ship A/B without visiting the multiplayer lobby page first.
- A host can also share `main-deck.html?room=ROOMCODE` (player chooses team) or `main-deck.html?room=ROOMCODE&team=A/B` (automatic join).
- Direct entrants use the same room server, room code, device identity and authoritative player snapshot. Joining during countdown/racing is supported; the entrant is automatically ready and appears to teammates on their assigned ship. Existing team assignments and the 15-player-per-ship cap are enforced server-side.
- If a player has neither an invite code nor a saved session, they must obtain the host's room code; the page cannot infer which private room they intend to join.

## What this build integrates

- The multiplayer server creates exactly two independent ship records when a host creates a room. Each ship has its own transform, speed, throttle, rudder, progress, hull health, system state, telemetry snapshot and collision metadata.
- The authenticated host receives a server-owned Captain avatar on Ship A. The host is not counted against the 15 crew seats per ship.
- The lobby requires a connected player on Ship A and Ship B, with every joined player READY, before START GAME is enabled. The server enforces the same checks.
- START GAME starts a server-controlled five-second countdown. All clients enter gameplay when the server changes the room to `racing`; player clients open their assigned `main-deck.html`, and the host opens Ship A's Main Deck.
- `map.html` is the shared world map (with `projection.html` retained as the original reference/source page). Multiplayer renders two independent instances of its existing Titan vessel model and follows server transforms. It does not replace the projection with a simplified ocean preview.
- Before the host can start, the embedded `map.html` reports its actual islands, reefs, rocks, typhoon hazard, world bounds and route to the server. The server derives safe separated ship starts from that data and enforces oriented hull-vs-obstacle collisions while vessels move. The same route data drives progress calculations.
- `main-deck.html` remains the actual deck experience. Player positions are synchronized in ship-local coordinates; the server clamps players to the deck outline and resolves its mirrored static obstacle boxes. Each ship has independent doors, hatch, propulsion orders, system state and crew actors.
- Same-ship crew are rendered as character models on the Main Deck and as lightweight crew avatars in the Engine Room. The map shows live ship transforms and connected crew markers, including their current area.
- Main Deck ↔ Engine Room / Storage navigation preserves multiplayer room, team and player identity.
- Engine Room throttle/rudder, selected electrical/cooling/reactor commands and telemetry are relayed through the parent WebSocket session and the room server.
- Host **FLY MODE** moves the original projection camera only. Keyboard controls are WASD/arrows, Space/Shift to zoom and Q/E to tilt; touch devices get an on-screen directional/zoom pad. It does not alter player pose or ship physics. Turning it off returns to the host's normal walking deck.
- Player rejoin uses the same device identity during the 60-second reconnect grace period. A reconnect cannot change the player's ship assignment.

## Deploy the website to Netlify

1. Upload the extracted project files to the existing GitHub repository, preserving all folders (not just the ZIP).
2. Netlify Base directory: blank.
3. Build command: blank.
4. Publish directory: `.` (project root).
5. Deploy and open `/multiplayer.html` on the published Netlify site.

## Deploy/update Render

Use the existing Render Web Service:

- Root Directory: `multiplayer-server`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/healthz`
- Environment variable `TITAN_HOST_KEY`: keep your existing secret value in Render only.

After the deploy, `/healthz` must return `protocol: "titan-world-v3"`. The default client WebSocket URL is `wss://titan-multiplayer.onrender.com`; change it on the lobby page if your Render hostname differs.

## Direct-entry flow without the lobby UI

1. Player opens `main-deck.html` and clicks **JOIN ROOM** in the Main Deck top bar (or opens a room invite link).
2. Player enters the same room code that the host shared and chooses Ship A or Ship B.
3. The runtime connects to the same TITAN server and joins that existing room. It does not create a second room.
4. If the room is in the lobby, the player is marked ready through the usual room rules. If countdown/gameplay has already started, the server accepts the new player, adds them to the live state and marks them ready automatically.
5. The server's snapshot places the player on the correct ship. Same-ship players can see and move with them; the chart map displays both ships.
6. Navigation to Engine Room/Storage retains the same saved room, team and device identity. Reconnection returns the player to the same room and ship.

A finished room cannot accept brand-new players; the host must reset/create another match.

## Correct event flow

1. Host opens `/multiplayer.html`, chooses **Host a Race**, enters the private host key and creates a single room.
2. Share the room's six-character code. Players must join this room; players must not create separate rooms.
3. Each player chooses Ship A or Ship B, enters their name, and creates/saves a character before joining (or uses an existing saved character). Assignment remains fixed for that player's room identity.
4. Host is automatically assigned to Ship A and appears as Captain. Host does not use a 15-person crew slot.
5. Keep the host page open until the projection has reported map geometry; START GAME stays disabled until that step is complete. A connected player must occupy Ship B (the host Captain is on Ship A); every joined crew member must be online and READY.
6. Host presses START GAME. The server runs the countdown, changes the shared room status, and broadcasts the state. Each browser enters its assigned Main Deck.
7. Players use **WORLD MAP** to see both vessels on `map.html` and **MAIN DECK** to return to their ship interior. The host additionally uses **FLY MODE** to inspect the world, then toggles it off to return to walking.
8. Spectator Display joins the same code and follows the live world map without taking a crew slot.

## Local test commands

Requirements: Node.js 20+ and npm.

Terminal 1 (server):

```bash
cd multiplayer-server
npm install
# Linux/macOS
export TITAN_HOST_KEY="replace-with-a-long-random-secret"
# PowerShell alternative:
# $env:TITAN_HOST_KEY="replace-with-a-long-random-secret"
npm start
```

Terminal 2 (project root):

```bash
python -m http.server 8080
```

Open `http://localhost:8080/multiplayer.html` in three separate browser sessions. The host uses `ws://localhost:2567`. Do not use `ws://` from an HTTPS Netlify page; use the secure Render `wss://` URL.

## Limits to understand before an event

- Rooms are in memory. Render restarts and redeployments clear them. Keep one Render instance and do not redeploy while a match is active.
- Do not scale Render horizontally until a shared room store and cross-instance broadcast driver are added.
- Main Deck fixed obstacle/deck bounds are checked by both the local game and the server. Engine Room's detailed machinery hitboxes remain local; its network movement is clamped to the room envelope by the server. Storage remains a lightweight transition page, not a fully modelled walkable area.
- The server synchronizes engine orders, selected on/off system flags, last interaction and telemetry snapshots, but the complete Engine Room machinery simulation is not yet a deterministic server-authoritative physics model. Multiple clients' engine telemetry can still reflect their local simulation timing.
- A browser-driven end-to-end run against the actual Render service and Netlify site, and a 30-device load test, remain to be performed after deployment. Do not treat static syntax validation as certification for an event.
