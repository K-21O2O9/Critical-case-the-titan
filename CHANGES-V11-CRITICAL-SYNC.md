# TITAN v11 — Critical Multiplayer Sync, Host Entry & Component State

## Implemented fixes

### 1. Host automatic game entry (CRITICAL)
- After successful `host:create` / `created` response, the host is automatically registered into the playable session using the existing `host-{roomCode}` actor.
- `hostJoinEnabled` is set and `hostJoinGame()` / `enterGameSession(true)` runs so the host transitions into the Main Deck game view without a manual extra click.
- No second player identity, no bypass of room registration, host admin controls remain available via HOST CONTROL.

### 2. Full engine-room component multiplayer synchronization
- Extended authoritative telemetry on the server and ship bus to carry: mainPower, motor1, motor2, starter, aux, generator, clutch, lubPump, swPump, autoReg.
- Engine Room command handler now updates local `Game.state` **and** visual switch UI when remote multiplayer state arrives.
- Ship-bus multiplayer state handler applies every component boolean to the local plant via `setElectrics` / `setCooling` / `setReactor` / `setMotors` / `setRegulator` without creating feedback loops (deduped by last-applied value).
- Main Deck dashboard continues to consume the structured telemetry (electrics, cooling, reactor, motors) so ON/OFF indicators stay consistent with the engine room.

### 3. Settings
- Shared settings (`titan-shared-settings.js`) remain the single contract for quality, shadows, FOV, sensitivity, touch controls, controller profile/bindings.
- Voice-assistant configuration is intentionally excluded from the shared contract (Engine Room only), matching the requirement.

### 4. Character movement / orientation
- Preserved the v10 canonical `-Z` forward convention and server-derived signed moveForward / moveStrafe axes used by remote avatar animation.
- No inversion of key bindings or animation direction; movement vectors and model orientation remain consistent.

## Files modified
- `multiplayer.html` — auto host entry after room creation
- `titan-ship-bus.js` — full component telemetry publish + apply + structured merge
- `engine-room.html` — UI switch sync on remote commands, setRegulator support
- `multiplayer-server/server.js` — accept additional boolean telemetry keys

## Testing notes
Automated live multi-client WebSocket tests require a running server (`npm install && npm start` in `multiplayer-server/`) and two independent browser contexts. The changes are designed so that:
- Host create → immediate entry into game session as Captain
- Player A toggles Motor 1 → telemetry broadcast → Player B engine UI + main-deck flags update
- Late joiners receive current `systems.telemetry` via room state snapshot
- Reconnects re-apply last known component state through the same path

Remaining limitations: full end-to-end two-device validation must be performed after deployment; the build environment cannot open concurrent real WebSocket clients against a live Render instance from this sandbox.
