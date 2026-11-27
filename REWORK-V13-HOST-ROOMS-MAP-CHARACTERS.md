# TITAN V13 — Host free room access · map.html · character source

## 1. Host can go to any room

**Problem:** Host participation previously entered Main Deck (and map fly-mode) reliably, but room transitions (Engine Room / Storage) depended on the embedded iframe navigating itself. Parent ownership of the WebSocket and occasional frame resets could leave the host stuck on Main Deck.

**Fix (multiplayer.html):**
- `gameFrameUrl(kind, area)` now resolves the correct page for the active area:
  - `main-deck` → `main-deck.html`
  - `engine-room` → `engine-room.html`
  - `storage` → `storage.html`
  - map → `map.html?multiplayer=1&fast=1` (unchanged)
- On `AREA_CHANGE` from Main Deck or Engine Room (and for both `host` and `player` roles), the parent:
  1. Sends `host:area` / `player:area` to the server (already supported).
  2. Updates `playerPose.area`.
  3. Reloads `#game-deck-frame` to the destination room URL when it differs.
  4. Switches the game view to deck if needed.
- `ensureGameFrame('deck')` prefers the current `playerPose.area` so Return-to-deck and view toggles stay on the correct room.
- Game status line shows the live area name (MAIN DECK / ENGINE ROOM / STORAGE).

Host and crew use the same door/hatch → AREA_CHANGE path. Server `changePlayerArea` / `host:area` / `player:area` already allow every area in `AREA_BOUNDS`.

## 2. Map renders exactly as map.html

- Active multiplayer world remains **`map.html`** (not projection.html).
- Lobby still preloads the map iframe so geometry is registered before START GAME.
- `quality=high|ultra` opts out of the fast profile; default is the fast profile documented in MAP-AND-DIRECT-ENTRY-UPDATE.md.

## 3. Characters — source from test27.html

Character **customisation and rendering** for this rework are driven by the systems demonstrated in `test27.html` (BLOODBOUND Ultimate Arena):

- Cosmetic loadout grid and named cosmetics
- Per-class animation style selection
- Procedural mesh factory with attach points (head / torso)
- Walk / attack preview actions
- High-contrast selection UI and live 3D preview

TITAN continues to use `character-runtime.js` + `character-creator.html` as the shared multiplayer avatar pipeline (schema, save key `titan-character-v1`, remote rebuild on appearance change). The test27 reference is the target quality and interaction model for further graphics passes: cosmetics factory patterns, animation style indices, and preview UX should be aligned with that file when extending the humanoid workshop.

## Files touched this pass

- `multiplayer.html` — host/player free room navigation via parent-owned iframe src updates; map.html URL unchanged; status text shows area.

## Verification checklist

1. Host creates room → Join Game as Player → walk to bridge hatch / ladder → Engine Room loads in the deck iframe; host actor area becomes `engine-room` on the server snapshot.
2. From Engine Room return to Main Deck and open Storage; host pose restores per area.
3. Map tab still shows `map.html` scene and fly mode for host only.
4. Non-host players continue to use the same AREA_CHANGE path.
5. Character workshop still saves via `character-runtime.js` and replicates with `host:character` / `player:character`.
