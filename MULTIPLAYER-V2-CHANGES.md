# TITAN multiplayer v2 — change summary

## Corrected reported issues

1. **No team menu:** the new multiplayer join screen makes Ship A / Ship B explicit selectable cards. A team is mandatory before character creation or joining.
2. **Devices in different rooms:** the host creates one server room and shares its six-character code. Players join that exact room; the same Render WebSocket URL is prefilled on every role. Players do not create rooms.
3. **Character creation bypassed the lobby:** the main menu now has an obvious Multiplayer Race entry. The player flow gathers room code, player name and team first. The chosen data is kept in session storage through character creation. Saving returns to the crew lobby and attempts the join.
4. **Shared players not updating:** the server broadcasts position/ready/player changes and includes the saved character configuration in room state. The multiplayer view renders the two ships and player avatars from that shared state.

## Server behavior

- Host authenticated with the existing `TITAN_HOST_KEY`; host is not counted as a crew member.
- One active host connection per room.
- 15 player maximum per ship, 30 across both ships.
- Spectator is read-only and does not consume a seat.
- Race requires at least one player per ship; all players must be connected and ready.
- Player reconnection grace period: 60 seconds.
- Health endpoint reports `protocol: titan-room-v2`.

## Verification performed

- Node syntax check passed for the server and all inline page scripts.
- Multiplayer HTML ID reference check: no missing referenced IDs and no duplicate IDs.
- Server protocol simulation passed for room creation, same-room joins, one-host restriction, 15-player team cap, ready countdown, movement broadcast, spectator connection, and health response.
- A real browser-based interaction run was blocked by the execution environment's browser policy; therefore this archive is not represented as fully browser-tested or event-certified.

## Still required before the event

- Upload/deploy these files to GitHub, Render and Netlify.
- Test the deployed site from two separate phones and a spectator screen.
- Perform 5–10 device and then 30-device load tests on the real venue Wi-Fi.
- The original single-player Main Deck, Engine Room, reactor, cooling and voice controls are not all wired into multiplayer race simulation yet. The multiplayer shared-world preview and crew movement are synchronised; full ship-systems gameplay remains a separate integration task.
