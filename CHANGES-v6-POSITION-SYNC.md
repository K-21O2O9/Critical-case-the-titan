# TITAN v6 — Position Synchronisation Hotfix

**Date:** 2026-11-27  
**Scope:** Prevent local player teleportation caused by interaction-triggered multiplayer snapshots.

## Root cause

The v5 build removed unconditional snapshot overwrites, but it retained two large-distance correction paths:

1. `main-deck.html` still replaced the local player position when the server snapshot differed by more than 4.5 units (and on inferred area changes).
2. `titan-multiplayer-runtime.js` independently applied another correction when the same distance threshold was crossed.

Movement packets are rate-limited. An interaction can be sent during that short interval before the latest movement packet reaches the server. The server broadcasts the interaction immediately, so the snapshot can contain an older server-side pose. The two remaining correction paths interpreted that normal timing difference as a reason to move the player back toward the old position.

## Changes

- Main Deck now seeds the local player's position exactly once from the room snapshot on join/reconnect. Later snapshots update shared ship systems and remote players, but never rewrite an already-seeded local position.
- Removed the runtime's duplicate large-distance correction. There is one owner of local movement: Main Deck's local movement controller.
- Main Deck interaction and area-transition messages now include the exact current local position, yaw and area.
- The embedded lobby bridge retains the latest live pose separately from room snapshots and forwards it for interactions, controls, system changes, telemetry and area transitions.
- Direct-entry runtime forwards the current Main Deck/Engine Room pose with interactions, controls, system changes and telemetry. The embedded lobby bridge now does this for both its current ship-bus commands and the legacy `SHIP_CONTROL` message path.
- Server interaction/system/control/telemetry handlers commit the actor's accompanying pose before broadcasting the resulting room snapshot. This closes the movement-throttle timing gap for both the local actor and remote crew representations.
- Navigation between pages captures the current Main Deck pose before unload. The runtime no longer emits a fabricated spawn heartbeat while a deck is loading and no pose is known.
- Existing ship/team ownership, player identity, remote-actor filtering and ship-system behaviour are preserved.

## Verification performed in this build workspace

- `npm test`: **5 passed, 0 failed**. The regression tests cover snapshot non-correction, interaction pose attachment, direct/embedded bridge forwarding (including legacy ship controls and area transitions), forced server pose commits despite movement throttling, and pose commit ordering before broadcasts.
- `node --check` passed for `multiplayer-server/server.js` and `titan-multiplayer-runtime.js`.
- Inline JavaScript syntax checks passed for `main-deck.html`, `multiplayer.html`, `engine-room.html` (6 inline blocks) and `storage.html`.
- The source tree was compared with the supplied v5 ZIP: all 43 original files were retained; five existing files were modified and three files were added.

## Not claimed / still requires live acceptance testing

Automated browser end-to-end execution was blocked in this workspace, and there is no access to the deployed Render process or two physical devices. Therefore this build does **not** claim live two-device acceptance, measured multiplayer latency, low-end Android FPS/RAM measurements, or cross-browser acceptance. After deploying, test with two devices in the same room: move each player more than 4.5 units from spawn, rapidly interact with the door, hatch, crane, windlass and capstan, and confirm neither player's position changes as a result of the other player's actions.
