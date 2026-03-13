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

Server listens on `0.0.0.0:2567` by default (all interfaces). Set `PORT` to change port and `HOST` to override bind address.

For LAN/Tailscale multiplayer, start the server on the host machine and share the host IP
(example LAN: `192.168.1.24`, example Tailscale: `100.x.y.z`) with the joining player.

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
   - In the game HUD, connect to `<host-ip>:2567` (example `192.168.1.24:2567` or `100.x.y.z:2567`).
3. Verify:
   - Both players appear in the same room.
   - Second join spawns offset from first ship.
   - Both can see each other move.
   - Leaving removes that ship from remaining clients.
