# TITAN Multiplayer Critical Fixes (v5)

**Date:** 2026-11-27  
**Focus:** Root-cause fixes for the two highest-severity multiplayer bugs + map loading reliability + low-end performance baseline.

## 1. FIXED: Player Teleportation to Spawn (Critical)

**Root cause identified in `main-deck.html` → `mpApplyState`:**

Every network state snapshot was blindly overwriting the local player's `state.playerLocal.x/z` and yaw with the server values. Because network snapshots lag behind local movement (and interactions can trigger state broadcasts), this caused repeated teleports back to the last server-known (often spawn) position whenever any action or update occurred.

**Fix:**
- Local position is now only corrected from the server on:
  - First pose application after join
  - Large desync (> 4.5 units)
  - Explicit area change or force-respawn flag
- Normal movement, interactions, door/hatch/equipment use, and regular snapshots no longer reset coordinates.
- The same soft-correction policy was applied in `titan-multiplayer-runtime.js` (threshold raised from 0.9 → 4.5 units and only used as a safety net).

## 2. FIXED / Improved: Same-Ship Player Visibility

**Issues addressed:**
- Dual remote-actor systems (runtime + main-deck) could create duplicates or hide players.
- Remote players were snapped instantly instead of interpolated.

**Fixes:**
- When `main-deck.html` owns the multiplayer state (`TitanDeckGame.setMultiplayerState` present), the runtime no longer creates its own remote player models (prevents duplicates / incorrect hiding).
- Remote actors in main-deck now use target positions + smooth lerp (position + shortest-path yaw) every frame.
- Character animation continues to run on remote models.
- Filtering remains team + area aware so Ship A and Ship B stay independent.

## 3. Map Geometry Loading Reliability

**Problem:** Lobby could remain stuck on “WAITING FOR MAP GEOMETRY” / “RENDERING MAP GEOMETRY” if the embedded map.html failed to report (or reported only once).

**Fixes:**
- `map.html` now sends geometry on load **and** retries automatically (8 attempts, 1.5 s apart).
- Multiplayer lobby automatically re-requests geometry every 4 s while waiting.
- `map.html` listens for `REQUEST_MAP_GEOMETRY` messages and re-sends.
- Status text updated to “MAP LOADING (waiting for geometry from map.html)” for clearer feedback.

These changes make the existing host-published geometry path far more reliable without inventing a second map system.

## 4. Low-End Device Performance Baseline

**Added automatic low-end detection** in `main-deck.html`:
- Uses `navigator.deviceMemory` and `hardwareConcurrency`.
- Devices ≤ ~3.5 GB RAM or ≤ 4 cores (typical 3 GB Android class) automatically start on **LOW** quality.
- LOW profile: reduced pixel ratio (0.65), no antialias, shadows disabled, low-power preference.
- Existing LOW / MED / HIGH cycle and manual Quality button remain fully functional.

Further aggressive culling / LOD / texture work can still be layered on top of this foundation.

## 5. What Was Intentionally Preserved

- Existing two-ship architecture, room server protocol (`titan-world-v3`), device identity, reconnect grace, direct Main Deck entry, character system, controls, and overall design.
- No second networking stack.
- No placeholder or fake multiplayer data.
- Map still originates from the real `map.html` scene geometry (deterministic once reported).

## 6. Remaining Work (Not Completed in This Pass)

The full pasted brief is extremely large. The following items still require dedicated engineering time:

- Full host map-designer UI that publishes a compact map representation into a generated `projection.html` (current system already has editor tools inside map.html + geometry reporting; a true “design → publish → become projection.html” pipeline needs more UI + server storage).
- Comprehensive adaptive quality profiles with dynamic resolution scaling, frustum culling, instancing, particle budgets, etc. across all pages.
- Full cross-browser matrix testing and measured FPS/memory numbers on real 3 GB hardware.
- Exhaustive multiplayer integration test suite on multiple physical devices.

The critical gameplay blockers (teleport + visibility + stuck map geometry) have been directly addressed at the root-cause level.

## Deployment

Same as previous build:

**Netlify:** publish the project root (no build command).  
**Render:** root directory `multiplayer-server`, `npm install`, `npm start`, health check `/healthz`. Keep existing `TITAN_HOST_KEY`.

Protocol remains `titan-world-v3`.

## How to Test the Fixes

1. Open two browsers / devices.
2. Host creates a room on `multiplayer.html`.
3. Second player joins via lobby **or** via direct Main Deck entry (`main-deck.html?room=CODE&team=A` or JOIN ROOM button).
4. Both enter the same ship → they should see each other.
5. Walk around, open doors, operate equipment, receive network updates → neither player should teleport to spawn.
6. Host lobby should progress past “MAP LOADING…” within a few seconds (geometry auto-retries).
7. On a low-memory device the Quality button should start on LOW.

Report any remaining issues with exact reproduction steps.
