# Dark Forest Game Server

Multiplayer backend skeleton using [Colyseus](https://colyseus.io/). Each star system instance runs as a Colyseus room; clients join and receive synchronized ship/entity state.

## Setup

```bash
cd server && npm install
```

## Run

```bash
npm run dev
```

Server listens on `ws://localhost:2567` by default. Set `PORT` to change.

For LAN multiplayer, start the server on the host machine and share the host LAN IP
(example: `192.168.1.24`) with the joining player.

## Room: `star_system`

- **State**: `StarSystemRoomState` — `ships: MapSchema<ShipState>`
- **Messages** (client → server):
  - `warp`, `{ celestialId: string }` — set ship's current celestial
  - `move`, `{ x, y, z }` — update ship position in grid

Client integration: use `colyseus.js` or `colyseus-client` to join the room and sync with `state.ships`.

## Host/Friend v1 Smoke Test

1. Host machine:
   - Start server in this folder: `npm run dev`
   - Start game client from project root: `npm run dev`
   - In the game HUD, connect to `localhost:2567`
2. Friend machine:
   - Start only the game client.
   - In the game HUD, connect to `<host-lan-ip>:2567` (example `192.168.1.24:2567`).
3. Verify:
   - Both players appear in the same room.
   - Second join spawns offset from first ship.
   - Both can see each other move.
   - Leaving removes that ship from remaining clients.
