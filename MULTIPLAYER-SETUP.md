# THE TITAN — Private-host multiplayer integration

## What was added
- `multiplayer.html`: host, player and spectator entry point; room-code lobby; 15-player team caps; ready checks; host controls; shared course preview.
- `multiplayer-server/`: Node.js WebSocket server with in-memory rooms, host-key authentication, player/team state, reconnection grace period, ready checks, ship state and race lifecycle.
- A Multiplayer Command shortcut on the existing main menu.
- Existing ship, deck, character creator, voice and system pages are retained.

## Run locally
Requirements: Node.js 20+.

1. Open a terminal in `multiplayer-server/`.
2. Run `npm install`.
3. Set a private host key:
   - macOS/Linux: `export TITAN_HOST_KEY="your-long-random-secret"`
   - PowerShell: `$env:TITAN_HOST_KEY="your-long-random-secret"`
4. Run `npm start`.
5. Serve the ZIP root over HTTP (do not open pages with `file://`):
   `python -m http.server 8080`
6. Open `http://localhost:8080/multiplayer.html`.
7. Host enters `ws://localhost:2567` and the same host key, then creates a room.
8. Players open the same website from their phones, enter the reachable WebSocket server URL, room code, name and team.

## Deploy
- Deploy the ZIP root as a static site on Netlify. Publish directory is the project root; no build command is required.
- Deploy `multiplayer-server/` as a separate Node service on a WebSocket-capable host such as Render or Railway.
- Configure `TITAN_HOST_KEY` as a server environment secret. Never put this secret in the website or commit it.
- Use the server's public `wss://` URL in host, player and display screens.
- The included `render.yaml` is a deployment starting point. Review the host's current pricing, sleep policy, bandwidth and connection limits before the event.

## Important current limitations — test before an event
This is an initial multiplayer foundation, not yet a finished 30-player production game:
- Rooms and player state are in server memory; restarting the server loses active rooms. No persistent database is configured.
- Player movement is synchronised as coordinates, but existing main-deck 3D gameplay and engine controls have NOT yet been wired into the authoritative multiplayer state.
- The spectator preview is a lightweight generated course with two ships; it is not yet the final custom map nor a full replica of the main-deck environment.
- Host camera can move around the spectator preview, but ship steering is currently limited to speed adjustment and winner/reset controls. Add server-side ship physics and full helm controls in the next integration pass.
- Player avatars are not yet rendered with the full character-creator model on every client.
- The spectator display connects read-only and does not consume a player slot.
- HTTPS sites require `wss://`; browsers will block insecure `ws://` connections from a Netlify HTTPS page.
- Use a production persistent server and load-test 30 concurrent phone clients on the actual event network before relying on it.

## Network at the venue
All devices must have internet access to the deployed server, or be on a LAN where the server is reachable. The room code is not a substitute for server connectivity. Have a backup hotspot/router and test Wi-Fi coverage in the venue.

## Security
Use a long random `TITAN_HOST_KEY`, keep it server-side, and do not share it with players. This starter server does not yet include rate limiting, moderation tooling, persistent identity, TLS termination configuration or robust anti-cheat validation; deploy behind a reputable HTTPS/WSS platform and add those before a public event.
