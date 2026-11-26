# THE TITAN — Multiplayer v2 setup

## What is fixed in this build

- The main menu now has a dedicated **MULTIPLAYER RACE** entry. The normal character workshop remains available for single-player use.
- Multiplayer opens on a role-selection screen: Host a Race, Join a Crew, or Spectator Display. It no longer opens the host screen by default.
- Players must enter the room code, enter a name, and explicitly select Ship A or Ship B before they can proceed.
- The character-creation route remembers the selected room, name, team, and server in the current browser tab. Saving the character returns to the crew lobby and automatically attempts the join.
- Players with an existing saved character can join directly.
- Host and spectator sessions do not consume one of the 30 player places. Each ship has a hard limit of 15.
- The server returns clear room-not-found, team-full, already-connected, host-key and start-readiness errors.
- Starting requires at least one connected, ready player on each ship and every player must be connected and ready.
- Player positions and character profiles are included in room state. The multiplayer shared-world preview renders both ships and the players' custom character models; movement is broadcast to the other connected clients.
- Host rejoin is supported with the room code and host key. A player can reconnect using the same browser/device identity during the reconnection grace period.

## Deploy the website to Netlify

1. Upload the **contents** of this project to the GitHub repository (not only the ZIP file).
2. In Netlify, import that GitHub repository.
3. Set Base directory to blank, Build command to blank, and Publish directory to `.` (project root).
4. Deploy. The public multiplayer page is `/multiplayer.html`.
5. After updating these files in GitHub, Netlify should create a new production deployment. Confirm its deploy status is Published before testing.

## Deploy/update the Render multiplayer server

The Render Web Service must use the `multiplayer-server` folder as its Root Directory:

- Root Directory: `multiplayer-server`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/healthz` (or `/`)
- Environment variable: `TITAN_HOST_KEY` = your private host key (keep it in Render only)

The service uses the `PORT` supplied by Render. Do not hard-code a public port.

To update an existing Render service, commit/push the changed `multiplayer-server/server.js` and `multiplayer-server/package.json` to the same connected GitHub repository, then allow Render to deploy the latest commit. Keep your existing `TITAN_HOST_KEY` value; do not paste it into GitHub or Netlify. After deployment, open the Render URL with `/healthz`; the response should include `protocol: "titan-room-v2"`.

The browser automatically defaults to `wss://titan-multiplayer.onrender.com`. It can be changed in the host/player/spectator URL field if your Render hostname is different. HTTPS Netlify pages must use `wss://`, not `ws://`.

## Correct event flow

1. Open `https://YOUR-NETLIFY-SITE.netlify.app/multiplayer.html` on the host device.
2. Select **Host a Race**, enter your Render WebSocket URL and the private host key, then create one room.
3. Share the six-character room code or copied invite link. Do not ask players to create rooms.
4. Each player opens the same `/multiplayer.html`, selects **Join a Crew**, enters that same room code and their name, and selects exactly one ship.
5. A player without a saved character chooses **Create / Customise Character**. On save, the page returns to the crew setup and submits the join. A player with a saved character can press **Join Room** directly.
6. The host sees team counts and the crew manifest. Players press **I'm Ready**.
7. Start becomes available only when there is at least one connected and ready player on both teams and all joined players are ready.
8. The projector opens **Spectator Display** and connects with the same room code. It does not use a player slot.

## Local test

Requirements: Node.js 20+.

Terminal 1:

```bash
cd multiplayer-server
npm install
# Linux/macOS
export TITAN_HOST_KEY="replace-with-a-long-random-secret"
# PowerShell alternative:
# $env:TITAN_HOST_KEY="replace-with-a-long-random-secret"
npm start
```

Terminal 2, from the project root:

```bash
python -m http.server 8080
```

Open `http://localhost:8080/multiplayer.html`. Host uses `ws://localhost:2567`. Use the exact same room code on two other browser sessions. To test across phones on the same Wi-Fi, use the computer's LAN IP address in the website URL and the server WebSocket URL, and ensure the local firewall permits the ports.

## Important limitations and event readiness

This build fixes the room entry, team choice, character return flow, player state, and shared multiplayer 3D lobby view. It does **not yet network every pre-existing Main Deck, Engine Room, reactor, cooling, voice or ship-equipment control** from the original single-player simulation. Those systems still need a dedicated integration pass before they affect race physics.

Rooms are stored in server memory. A Render restart/deploy will clear live rooms and disconnect active matches. Do not deploy during an event. Keep this service at **one instance**: scaling this in-memory build to multiple instances would put clients in separate room stores. Multi-instance scaling requires shared room state (for example, a Redis-backed room driver) first. This is not a guarantee of flawless 30-device operation: first test on two phones, then 5–10, then do a full 30-client test on the actual event network. Measure Render CPU/memory, WebSocket stability, latency, and Netlify/mobile browser performance. Have a backup internet connection.

Do not publish the host key. Do not share it with players. The player-side source code does not contain the host key.
