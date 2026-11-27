# TITAN V12 — Multiplayer and Engine Synchronization Rework

## Implemented

- Added a server-owned schema for 16 stable Engine Room component IDs: 10 boolean controls and 6 numeric setpoints. Server writes are type-checked, range-clamped, revisioned, and broadcast as authoritative room snapshots.
- Routed Engine Room switch and slider changes through the existing multiplayer bridge. Dynamic Hologram sliders and their corresponding standard controls use the same component IDs and do not register duplicate listeners.
- Separated periodic sensor telemetry from control writes so stale periodic snapshots cannot roll back a newer switch or setpoint command.
- Applied authoritative room snapshots back into Engine Room state, including sensor readings, coolant data, machine heat, condition, and the supported active-fault identifiers, without echoing the update back to the server.
- Expanded the Main Deck engine dashboard to display the synchronized control states, setpoints, sensor/operational readouts, and active fault status. Zero is treated as a valid value rather than as missing data.
- Completed the missing Main Deck settings controls found during the comparison (FOV reset and controller-binding cancellation). It continues using the shared settings implementation; the voice-assistant feature is not included in the Main Deck settings interface.
- Preserved the existing room host actor / automatic entry lifecycle and added regression checks for host registration and the host entry path.
- Added regression checks for movement-axis consistency. The existing local movement, server pose projection, and avatar forward axis all use the same -Z-forward convention; no blind keybinding or animation inversion was introduced.

## Modified files

- `multiplayer-server/server.js`
- `titan-ship-bus.js`
- `engine-room.html`
- `main-deck.html`
- `multiplayer.html`
- `titan-multiplayer-runtime.js`
- `multiplayer-server/tests/engine-components.test.cjs` (new)
- `multiplayer-server/tests/critical-integration.test.cjs`
- `multiplayer-server/tests/position-sync.test.cjs`

## Verification performed

- `npm test` from `multiplayer-server/`: **32 passed, 0 failed**.
- `node --check` passed for the multiplayer server and the shared bus/runtime/character JavaScript files.
- Inline scripts parsed successfully: `engine-room.html` (7), `main-deck.html` (1), and `multiplayer.html` (1).
- Automated coverage includes the component schema and validation, initial state, revisions, room snapshot/broadcast contract, all switch and slider mappings, the browser message bridge, dashboard fields, settings contract, host actor/entry path, reconnection snapshot handling, and the canonical movement direction convention.

## Remaining verification limits

- A live two-or-more-browser WebSocket session was not run in this environment. The server's `ws` runtime dependency is declared in `multiplayer-server/package.json`, but it is not installed in this extracted workspace; package installation could not be completed because the package registry was unreachable. The tests above are automated source/unit regression tests, not a substitute for a live multiplayer session.
- Browser-rendered gameplay, real controller hardware, and end-to-end reconnection were not manually exercised.
- Engine Room physical walk-mode hardware fault flags (`coolingValveSeized`, `breakerTripLock`, and `fuelFeedDrift`) and the local Heat Emergency countdown/trip workflow remain local simulation mechanisms; this rework synchronizes the supported active-fault list, machine heat, condition, component controls, and telemetry, but does not make those three physical fault flags or each countdown timer individually server-authoritative.
- The reported backward-walking issue was not reproducible from the source paths inspected: local movement, server movement projection, and avatar forward orientation agree on -Z as forward. The regression test protects that convention, but a visual in-browser movement test is still required to rule out a specific imported avatar asset with a different authored forward axis.

## Deployment

Install the server dependency before starting the multiplayer server:

```sh
cd multiplayer-server
npm install
npm start
```

Use the existing deployment/environment configuration in `MULTIPLAYER-SETUP.md` and `multiplayer-server/.env.example`.
