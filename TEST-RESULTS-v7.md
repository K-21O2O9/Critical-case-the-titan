# TITAN v7 — Verification Results

## Automated checks executed

| Check | Result | Detail |
|---|---|---|
| Render server test command | PASS | `cd multiplayer-server && npm test` — 12/12 tests passed |
| Server JavaScript syntax | PASS | `node --check multiplayer-server/server.js` |
| Runtime JavaScript syntax | PASS | `node --check titan-multiplayer-runtime.js` |
| Ship-bus JavaScript syntax | PASS | `node --check titan-ship-bus.js` |
| All other standalone `.js` files | PASS | Node syntax checked all project `.js` files |
| Changed HTML inline scripts | PASS | 7 Engine Room blocks + 1 Main Deck + 1 Multiplayer + 1 Storage block parsed by Node |
| Local HTML references | PASS | 48 local `src`/`href` references checked; no missing local targets |
| Baseline file comparison | PASS | No existing project files removed; 8 existing files changed |

The 12 automated regression tests cover:

1. Ordinary snapshots do not overwrite the local Main Deck pose.
2. Main Deck interactions forward the latest local pose.
3. Direct and embedded interaction/control/transition message forwarding.
4. Forced interaction pose commits bypass movement throttling and remain within room bounds.
5. Server action handlers commit a pose before broadcasting the resulting room state.
6. Independent room-area poses are saved and restored.
7. Legacy source-area coordinates are not reinterpreted in destination geometry.
8. Engine Room uses one idempotent frame loop and the shared avatar runtime/scale.
9. LOW graphics are selected before renderer creation and expensive effects are omitted.
10. Reconnect snapshots retain short-lived visibility and area pose data.
11. Embedded player and host transitions use explicit area-membership messages.
12. The direct runtime does not reuse a pose cached for a different room area.

## Not run — must be verified after deployment

The following require devices, a browser automation environment, or live Render/Netlify services and are **not claimed as passed**:

- Two/three physical devices joining the same live room and moving simultaneously.
- Actual in-browser remote-avatar visibility and transition tests.
- Actual 3 GB Android RAM/FPS/temperature/extended-play measurements.
- Real memory-leak measurements over repeated Engine Room entry/exit cycles.
- iOS Safari, Samsung Internet, Firefox, Edge and desktop browser acceptance testing.
- Live Render WebSocket reconnect/latency testing and Netlify production validation.

No FPS, memory or load-time numbers are reported because no physical-device benchmark was run in this environment.

## Recommended acceptance test

1. Deploy the same v7 source to Netlify and Render.
2. Join two devices to one room and assign them to the same ship.
3. Start the match, move both players, operate several pieces of equipment, and verify neither local player snaps to spawn.
4. Confirm both players see each other on Main Deck.
5. Move device A to Engine Room. Confirm device B no longer sees A on Main Deck; if B enters Engine Room, both see each other there.
6. Repeat Engine Room → Main Deck and Main Deck → Storage → Engine Room.
7. Repeat with a third player joining late and with one player refreshing a room page.
8. Run an extended Engine Room session on the actual 3 GB Android device and record browser FPS/memory diagnostics.
