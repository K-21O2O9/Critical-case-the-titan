# TITAN v9 — Multiplayer Movement Synchronisation Rework

## Root causes addressed

1. The direct-entry multiplayer bridge explicitly ignored Main Deck `POSE` messages. It relied on a separate polling loop to rediscover the same position. That split path made movement publication unnecessarily dependent on polling timing and could leave direct-entry clients publishing only stale/spawn state when the fallback was not active as expected.
2. The server's `player:move` handler silently discarded every authenticated player's pose unless the room phase was exactly `racing`. This made avatar movement unavailable in any other valid room phase even though the player remained connected to the session.

## Changes

- `titan-multiplayer-runtime.js`
  - Direct Main Deck `POSE` messages are now validated and forwarded immediately to the common movement publisher.
  - Movement publication carries X/Z world position, yaw, area, moving state and running state together.
  - The existing polling fallback remains as a recovery path and uses the same throttling/publisher implementation to avoid two independent packet formats.
  - Existing room-area tracking and reconnect behaviour remain unchanged.
- `multiplayer-server/server.js`
  - Authenticated `player:move` packets are now applied independently of the race phase.
  - Server-side bounds, area validation, collision handling, movement throttling, locomotion state and dirty-state broadcasting remain in force.
  - Race/ship-control commands keep their existing phase checks; this change does not start or alter the race.
- `multiplayer.html`
  - The embedded-page relay retains walking and running state in its current pose cache as well as forwarding the complete pose packet.
- `multiplayer-server/tests/`
  - Added regression coverage for direct `POSE` forwarding, complete movement payloads, and movement routing outside the racing phase.

## Preservation

No maps, room designs, ships, controls, character models, assets, gameplay mechanics, matchmaking/team assignments or deployment settings were redesigned. Existing character-root separation, Main Deck floor placement, Engine Room avatar interpolation, reconnect grace periods and per-area pose storage were preserved.
