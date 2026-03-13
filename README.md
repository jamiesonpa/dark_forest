# Dark Forest

Eve Online–style space game: orbit camera around your Raven battleship, star system with warpable celestials, and Eve-style HUD. Multiplayer-ready via Colyseus server.

## Run the game

```bash
npm install
npm run dev
```

Open http://localhost:5173. Use mouse to orbit the camera (left/right drag), scroll to zoom. Use the **System Nav** (left) to pick a destination and **Warp** to jump. Select items in the **Overview** (right) and use **Warp To** in the **Selected Item** panel.

## Run the multiplayer server (optional)

```bash
cd server && npm install && npm run dev
```

Server runs at `ws://localhost:2567`. See `server/README.md` for room API and client integration.

## Stack

- **Client**: React, TypeScript, Vite, React Three Fiber, Three.js, Zustand
- **Server**: Colyseus, Node, Express
