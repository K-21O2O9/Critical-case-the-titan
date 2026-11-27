# THE TITAN — Updated Character Edition

## Start the project

1. Extract the complete ZIP into one folder.
2. Start a local web server from that folder: `python3 -m http.server 8080`.
3. Open `http://localhost:8080/` (or `main-menu.html`).
4. Create a character in the Character Workshop, save it, then enter the Main Deck.

## Character system

- `character-creator.html` is the shared avatar workshop used by the Main Deck and Engine Room settings.
- `character-runtime.js` builds the optimized procedural stylized humanoid with male/female profiles, outfit styles, hair, accessories, colours, height/build and animation speed.
- Character appearance is saved in browser local storage under `titan-character-v1` and sent to the current multiplayer player record when connected.
- The Main Deck uses the saved outfit/skin for its first-person arms; Main Deck and Engine Room both render remote players from the same appearance profile.
- The avatar is a lightweight low-poly procedural model, not an externally authored photorealistic rigged asset.

## Project pages

- `index.html` opens the Main Menu.
- `main-menu.html` is the expedition launch screen.
- `character-creator.html` is the standalone character workshop.
- `main-deck.html` is the in-game starting location.
- `map.html` is the active tactical map; `projection.html` is retained as its preserved source/reference. `engine-room.html` and `storage.html` remain separate ship areas.
- `VOICE-CORE/` retains the original voice assistant resources.

## Notes

Keep all files and folders together. The project uses the local `three.min.js` build and does not require a remote model download. The character is rendered procedurally, so no external model asset is required. Browser local storage is scoped to the same browser profile and origin; use the same local server address to retain the saved character between pages.


## Multiplayer race

Open `multiplayer.html` or choose **MULTIPLAYER RACE** from the main menu. The first screen asks whether you are hosting, joining a crew, or displaying the spectator view. Players must enter the host's room code, select Ship A or Ship B, create/save their character if needed, and then join. See `MULTIPLAYER-SETUP.md` for Netlify/Render deployment and testing instructions.


## Multiplayer Map + Direct Entry update

The current multiplayer map route is `map.html` (fast rendering enabled by default). `projection.html` remains preserved as the map source/reference. Players can join an existing multiplayer room directly from the Main Deck top-bar **JOIN ROOM** control or with `main-deck.html?room=ROOMCODE&team=A/B`; the room code is required to enter the same shared session. See `MAP-AND-DIRECT-ENTRY-UPDATE.md` and `DEPLOY-THIS-BUILD.md`.


## v10 host / movement / settings rework

The host can join gameplay using the room's existing Captain actor while retaining the host controls. Multiplayer character orientation uses a canonical `-Z` forward axis, and signed movement/strafe axes are replicated for remote animation. Main Deck and Engine Room use `titan-shared-settings.js` for common graphics, camera, touch and controller preferences; assistant voice settings remain Engine Room-only. See `REWORK-V10-HOST-CHARACTER-SETTINGS.md` for the implementation summary and validation limits.
