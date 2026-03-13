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

## Room: `star_system`

- **State**: `StarSystemRoomState` — `ships: MapSchema<ShipState>`
- **Messages** (client → server):
  - `warp`, `{ celestialId: string }` — set ship's current celestial
  - `move`, `{ x, y, z }` — update ship position in grid

Client integration: use `colyseus.js` or `colyseus-client` to join the room and sync with `state.ships`.
