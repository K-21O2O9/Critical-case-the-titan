# Deploy TITAN v7

Deploy the contents of this ZIP to **both** Netlify and Render. The web client and multiplayer server must use the same v7 code.

## GitHub

1. Back up the existing repository.
2. Extract `TITAN-Multiplayer-ENGINE-ROOM-V7.zip`.
3. Upload the extracted **contents** into the existing repository, preserving every folder path and replacing files when prompted.
4. Confirm `engine-room.html`, `main-deck.html`, `multiplayer.html`, `storage.html`, `titan-multiplayer-runtime.js`, `titan-ship-bus.js` and `multiplayer-server/server.js` are present.
5. Commit and push the same branch used by Netlify and Render.

## Netlify

Keep the current static-site settings:

| Setting | Value |
|---|---|
| Base directory | blank |
| Build command | blank |
| Publish directory | `.` |

Deploy the latest commit and confirm the Main Deck, Engine Room and Multiplayer pages load.

## Render

Keep the existing Web Service settings:

| Setting | Value |
|---|---|
| Root directory | `multiplayer-server` |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/healthz` |

Preserve the existing `TITAN_HOST_KEY` in Render Environment settings. Do not commit the secret to GitHub or include it in messages. Deploy the same commit as Netlify. Verify `/healthz` reports the server online and protocol `titan-world-v3`.

## Regression test

Run locally with Node.js 20 or newer:

```bash
cd multiplayer-server
npm test
```

Expected result for this archive: 12 tests pass.

## Important

Do not deploy only the HTML files or only the Render server. The new area-membership message types are implemented in both the client and server. A mismatched deployment can leave transitions inconsistent.

The regression tests are code-level tests; they do not replace the physical-device and live two-device acceptance checks in `TEST-RESULTS-v7.md`.
