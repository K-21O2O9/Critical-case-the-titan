# Deploy TITAN v6 — Position Synchronisation Fix

This release changes both the static Netlify client and the Render multiplayer server. Deploy the same ZIP contents to both services; deploying only the website or only the server leaves the fix incomplete.

## 1. Back up and update the repository

1. Download or clone the current GitHub repository as a backup.
2. Extract `TITAN-Multiplayer-FIXED-v6-POSITION-SYNC.zip`.
3. Upload the **contents** of the extracted folder into the existing repository, preserving paths. Replace the old files when prompted.
4. Confirm these files are present: `main-deck.html`, `multiplayer.html`, `titan-multiplayer-runtime.js`, and `multiplayer-server/server.js`. Also keep `multiplayer-server/package.json` and `multiplayer-server/tests/position-sync.test.cjs`.
5. Commit and push to the branch connected to Netlify and Render.

## 2. Netlify static site

Keep the existing site settings:

| Setting | Value |
|---|---|
| Base directory | blank |
| Build command | blank |
| Publish directory | `.` |

Deploy the new commit. Check that `/main-deck.html` and `/multiplayer.html` load from the updated site.

## 3. Render multiplayer server

Keep the existing Web Service settings:

| Setting | Value |
|---|---|
| Root directory | `multiplayer-server` |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/healthz` |

Keep the existing `TITAN_HOST_KEY` value in Render's environment settings. Do not place the key in the repository or share it with players. Deploy the same commit. Verify the service health endpoint returns `status: online` and protocol `titan-world-v3`.

## 4. Run the bundled regression test

In the Render service's project folder (or locally with Node.js 20+):

```bash
cd multiplayer-server
npm test
```

The test checks snapshot correction removal, direct and embedded interaction/control pose forwarding, area-transition pose forwarding, the legacy ship-control path, and the server's forced interaction-pose commit before room broadcast. It is a source/helper regression test, not a substitute for a live multiplayer acceptance test.

## 5. Two-device acceptance test

1. Create a new room and join with two devices assigned to the same ship.
2. Start the match and walk each player well away from the spawn point.
3. On device 1, rapidly operate the bridge door, hatch, crane, windlass and capstan.
4. Confirm neither device's local player position changes when those interactions are broadcast.
5. Repeat with device 2 interacting while device 1 is moving.
6. Verify both same-ship characters remain visible and move smoothly.
7. Navigate to the Engine Room and return; confirm identity, ship assignment and player position remain valid.
8. Repeat using direct Main Deck entry and the normal multiplayer lobby flow.

Do not treat the source regression test as evidence of real-device FPS, memory use, latency or full browser compatibility. Those require the actual Render deployment and physical devices.
