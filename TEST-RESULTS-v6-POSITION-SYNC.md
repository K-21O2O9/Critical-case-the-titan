# TITAN v6 Position-Sync Hotfix — Test Results

**Run date:** 2026-11-27  
**Source:** `TITAN-Multiplayer-FIXED-v5.zip`  
**Scope:** Player pose preservation during interaction, system/control broadcasts and area transitions.

## Automated checks

| Check | Result |
|---|---|
| `npm --prefix multiplayer-server test` | **PASS — 5 passed, 0 failed** |
| `node --check multiplayer-server/server.js` | **PASS** |
| `node --check titan-multiplayer-runtime.js` | **PASS** |
| Inline scripts in `main-deck.html` | **PASS — 1 block** |
| Inline scripts in `multiplayer.html` | **PASS — 1 block** |
| Inline scripts in `engine-room.html` | **PASS — 6 blocks** |
| Inline scripts in `storage.html` | **PASS — 1 block** |
| Original project file comparison | **PASS — all 43 original files retained** |
| ZIP archive integrity | Run after packaging; see delivery verification in the final handoff |

The five automated regression tests check:

1. Ordinary room snapshots no longer reposition an already-seeded local player.
2. Main Deck interaction messages attach the current player position and yaw.
3. Direct-entry and embedded-lobby bridges forward interaction and transition poses, including the legacy ship-control message.
4. The server can force-commit a bounded actor pose even inside the ordinary movement rate-limit window.
5. Interaction, system, control and telemetry handlers commit the actor pose before broadcasting the updated room state.

## Not tested in this workspace

- Two physical Android devices connected to the deployed Render server.
- Live same-ship visibility and movement while both players interact simultaneously.
- Reconnect/late-join acceptance against the deployed server.
- Real 3 GB Android FPS, memory use, thermal behaviour or loading time.
- Cross-browser acceptance on Chrome Android, Samsung Internet, Firefox, Edge, Safari iOS and desktop Chrome.
- Full browser end-to-end automation. The local browser test attempt was blocked by the environment's browser/network policy.

These are required deployment acceptance checks, not assumed successes. Use `DEPLOY-v6-POSITION-SYNC.md` for the exact two-device test sequence.
