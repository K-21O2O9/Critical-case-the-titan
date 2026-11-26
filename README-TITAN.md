# THE TITAN — Updated Character Edition

## Start the project

1. Extract the complete ZIP into one folder.
2. Start a local web server from that folder: `python3 -m http.server 8080`.
3. Open `http://localhost:8080/` (or `main-menu.html`).
4. Create a character in the Character Workshop, save it, then enter the Main Deck.

## Character system

- `character-creator.html` is the only character editing page.
- `character-runtime.js` builds a lightweight stylized humanoid using the included Three.js library.
- Character name, colors, hairstyle, accessory, height, build, and animation speed are saved in browser local storage under `titan-character-v1`.
- Profiles can be exported to and imported from JSON.
- The Main Deck displays animated first-person arms that use the saved outfit and skin colors.
- No character editor, floating character button, or avatar menu is injected into Engine Room, Projection, Storage, or Voice Core.

## Project pages

- `index.html` opens the Main Menu.
- `main-menu.html` is the expedition launch screen.
- `character-creator.html` is the standalone character workshop.
- `main-deck.html` is the in-game starting location.
- `engine-room.html`, `projection.html`, and `storage.html` remain separate ship systems.
- `VOICE-CORE/` retains the original voice assistant resources.

## Notes

Keep all files and folders together. The project uses the local `three.min.js` build and does not require a remote model download. The character is rendered procedurally, so no external model asset is required. Browser local storage is scoped to the same browser profile and origin; use the same local server address to retain the saved character between pages.


## Multiplayer race

Open `multiplayer.html` or choose **MULTIPLAYER RACE** from the main menu. The first screen asks whether you are hosting, joining a crew, or displaying the spectator view. Players must enter the host's room code, select Ship A or Ship B, create/save their character if needed, and then join. See `MULTIPLAYER-SETUP.md` for Netlify/Render deployment and testing instructions.
