# Deploy TITAN Multiplayer World v3

## 0. Back up your current deployment

Keep a copy of the current GitHub repository and note the existing Netlify and Render settings before replacing the project files.

## 1. Update GitHub

Extract the new `TITAN-Multiplayer-WORLD-v3.zip` and upload the **contents** of the extracted folder into the existing repository, preserving the folder structure. Do not upload only the ZIP file.

Confirm these files exist at the repository root / exact paths:

- `multiplayer.html`
- `projection.html`
- `main-deck.html`
- `engine-room.html`
- `storage.html`
- `character-runtime.js`
- `titan-ship-bus.js`
- `multiplayer-server/server.js`
- `multiplayer-server/package.json`
- `MULTIPLAYER-WORLD-V3-CHANGES.md`

Remove an obsolete root-level `server.js` and root-level `package.json` from the old repository only if they are remnants of an earlier setup. Keep `multiplayer-server/server.js` and `multiplayer-server/package.json`.

Commit the update to the branch connected to Render and Netlify.

## 2. Render Web Service

Update the existing `titan-multiplayer` service; do not create another service when the current one is correctly configured.

| Setting | Value |
|---|---|
| Root Directory | `multiplayer-server` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

Keep the existing `TITAN_HOST_KEY` environment variable unchanged. Do not put it in GitHub, Netlify, a screenshot or player chat.

After Render deploys the latest commit, open:

`https://titan-multiplayer.onrender.com/healthz`

Expected response includes:

```json
{
  "service": "TITAN multiplayer",
  "status": "online",
  "protocol": "titan-world-v3",
  "rooms": 0
}
```

`rooms` is a live count and will change while rooms exist. The `titan-world-v3` protocol value is the key deployment check.

## 3. Netlify

Keep the static site publishing the repository root:

| Setting | Value |
|---|---|
| Base directory | blank |
| Build command | blank |
| Publish directory | `.` |

Publish the updated commit. Open `/multiplayer.html` directly on the Netlify domain.

The default WebSocket address remains `wss://titan-multiplayer.onrender.com`. Change it in the page only when your Render hostname differs. HTTPS websites must use `wss://`.

## 4. First live test (three devices)

1. Host device: open `/multiplayer.html`, choose **Host a Race**, enter the Render host key, and create one room. The server instantiates Ship A, Ship B and the host actor (host is assigned to A). Keep the page open while its embedded original projection loads and registers the current map obstacles/course; START GAME remains disabled until this server-side map validation succeeds.
2. Phone 2: join the same six-character room code and select Ship A. Create/save a character first when prompted, then mark READY.
3. Phone 3: join the same room code, select Ship B, create/save a character if needed, then mark READY.
4. The host should see both teams in one crew manifest. START GAME becomes available only when both ships have a connected occupant and all connected crew are READY.
5. Host presses **START GAME**. After the synchronized five-second server countdown, all clients should enter their own Main Deck. The host enters Ship A like a player.
6. On each device, switch to **WORLD MAP** and confirm that the two ships move independently on the original projection. Return to **MAIN DECK** to walk around.
7. Test moving players, ladder transitions to Engine Room / Storage, door and hatch state, bridge throttle/rudder orders, and host **FLY MODE**. Turning FLY MODE off returns the host to the walking deck.
8. Connect a spectator using the same room code and verify both ships and player markers appear on the map.

Test with 2–3 devices first, then 5–10, and only then a full 30-player event test on the actual venue network.

## 5. Operational limits

- Room data is currently stored in the Node process memory. A Render restart or redeploy clears active rooms. Do not redeploy during a match.
- Keep the Render service at **one instance**. Multiple instances would have separate in-memory room stores; shared persistence/pub-sub is required before scaling horizontally.
- The Engine Room environment keeps its existing client-side detailed machinery simulation and obstruction collision. The server synchronizes bridge orders, selected system states, telemetry snapshots and player area/pose bounds; it is not yet a deterministic server-side simulation of every internal machine or every Engine Room obstacle.
- Main Deck position bounds and mirrored fixed colliders are enforced by the server. Local page collision remains active as immediate prediction. Engine Room's detailed machine collision remains local; the server clamps movement to the room envelope.
- A real Render + Netlify multi-device test is still required after deployment. Syntax and local page/runtime checks are not a substitute for testing live WebSocket behavior, mobile browser performance, network latency or a 30-client load.

Never publish the private host key.
