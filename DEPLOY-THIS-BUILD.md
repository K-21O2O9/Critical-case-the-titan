# Deploy this fixed TITAN build

## 0. Make a backup

Keep a copy of the current GitHub repository and your current Netlify deploy before replacing files.

## 1. Update GitHub

Extract `TITAN-Multiplayer-FIXED-v2.zip`. Upload the extracted project files into the existing GitHub repository, preserving every folder. Do not upload only the ZIP file.

Make sure these updated files are present at these exact paths:

- `main-menu.html`
- `multiplayer.html`
- `character-creator.html`
- `multiplayer-server/server.js`
- `multiplayer-server/package.json`
- `MULTIPLAYER-SETUP.md`
- `MULTIPLAYER-V2-CHANGES.md`

Remove the obsolete root-level `server.js` and root-level `package.json` from the old repository if they are still there. Do **not** remove `multiplayer-server/server.js` or `multiplayer-server/package.json`.

Commit the changes to the branch connected to Render and Netlify.

## 2. Render

Open the existing `titan-multiplayer` Web Service. Keep its current service URL and keep the existing `TITAN_HOST_KEY` environment variable unchanged. Confirm:

- Root Directory: `multiplayer-server`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz` (or `/`)

Deploy the latest commit. Do not create a second service unless the existing one is incorrectly configured. When the deployment is live, open:

`https://titan-multiplayer.onrender.com/healthz`

The JSON response should include `"protocol":"titan-room-v2"`. If it still only shows the old response without that protocol field, the updated server code has not been deployed.

Do not change the host key just because you are redeploying. Never paste it into GitHub, Netlify, a screenshot, or a player chat.

## 3. Netlify

Open the existing TITAN site linked to this GitHub repository. Confirm the publish directory is the project root (`.`), with no build command. Wait for the new production deploy to show Published.

Open `/multiplayer.html` on the Netlify domain. It should now show **Host a Race**, **Join a Crew**, and **Spectator Display** before anyone enters character creation.

## 4. First test

1. On the host device, choose Host a Race, enter the Render WebSocket URL `wss://titan-multiplayer.onrender.com`, enter the exact `TITAN_HOST_KEY` from Render, and create one room.
2. Copy the room code.
3. On phone 2, choose Join a Crew, enter the same room code, enter a player name, choose Ship A or B, then create/save a character. The creator returns to the lobby and automatically attempts the join.
4. On phone 3, repeat with the same room code but choose the other ship. If a character is already saved on that device, press Join Room directly.
5. The host should see both players in one crew manifest, one on each ship. Both players press Ready; the host can then start.
6. Connect a fourth screen with Spectator Display and the same room code.

The host is not one of the 30 player seats. The projector/spectator is not a player seat either. Each ship can accept up to 15 players.

## 5. If it fails

- `HOST_AUTH_FAILED`: the value typed into the host page must exactly match the Render `TITAN_HOST_KEY` environment variable.
- `ROOM_NOT_FOUND`: create a room on the host device first; make sure everyone types the same current code. A Render restart/deploy clears in-memory rooms.
- `TEAM_FULL`: choose the other ship; each ship has 15 seats.
- Server says online but browser cannot connect: use `wss://titan-multiplayer.onrender.com` (not `https://` and not `ws://`) in the multiplayer URL field.
- New front page not visible: check that Netlify published the latest commit and open `/multiplayer.html` directly, then refresh the Netlify page.

For the event, keep one Render server instance. The current room store is in memory; scaling to multiple instances would require a shared room-state service before it is safe. Do not redeploy the server while a match is running.
