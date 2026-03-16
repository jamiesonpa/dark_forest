# Engineering Baseline

## Purpose

This document records the current behavior and validation targets that the engineering pass must preserve while reorganizing the codebase.

## Behavior Invariants

- Multiplayer message names remain unchanged: `move`, `warp`, `star_system_regenerate`, `ships_snapshot`, `star_system_snapshot`.
- Client ship simulation remains client-authoritative in the first pass.
- Warp flow remains `idle -> aligning -> warping -> landing -> idle`.
- Station switching and hotkeys remain unchanged:
  - `F1` selects pilot.
  - `F2` selects EW.
  - `Backspace` toggles `AA` / `DAC`.
  - `Enter` activates MWD.
  - `G` begins warp when aligned and capacitor allows it.
  - `Space` toggles dampeners.
- The root dev workflow remains `npm run dev:restart` for combined local client/server startup.
- Server-driven star system regeneration keeps the same payload shape and still respawns ships around anchor bodies.
- Client and server continue to exchange the same ship snapshot fields during the first pass.

## High-Risk Files

- `src/systems/simulation/SimulationLoop.tsx`
- `src/App.tsx`
- `src/components/stations/EWConsole.jsx`
- `src/network/colyseusClient.ts`
- `server/src/rooms/StarSystemRoom.ts`

## Verification Commands

From the repository root:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

From `server/`:

```powershell
npm run typecheck
npm run test
```

## Refactor Checklist

- Add tests before moving logic that lacks direct coverage.
- Preserve existing imports through compatibility re-exports while canonical module ownership is changing.
- Move wire contracts into shared definitions before altering message handlers.
- Keep behavior-sensitive frame math and networking cadence behind extraction wrappers, then validate with tests.
- Prefer extracting pure helpers before changing control flow in render or room lifecycle code.
