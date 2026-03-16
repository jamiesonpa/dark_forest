# Subsystem Ownership

## Canonical Client Roots

- `src/app`: app shell composition, overlay windows, shell hooks, and top-level station orchestration.
- `src/ui/stations`: canonical station entry points consumed by the app shell.
- `src/components`: renderable UI/canvas building blocks used by stations and shell modules.
- `src/systems`: gameplay/runtime subsystems such as simulation, warp, and EW.
- `src/state`: canonical Zustand store implementation and selectors.
- `src/network`: multiplayer client adapters and wire-state conversion.

## Canonical Shared Roots

- `shared/contracts`: shared transport and star-system contracts used by both client and server.

## Canonical Server Roots

- `server/src/rooms`: Colyseus room orchestration and room lifecycle helpers.
- `server/src/net`: room message names and snapshot/message mappers.
- `server/src/simulation`: spawn policy and server-side star-system runtime helpers.
- `server/src/schema`: Colyseus schema state.
- `server/src/systems`: deterministic procedural generation and related tests.

## Compatibility Layers

- `src/store` remains a compatibility re-export layer. New work should target `src/state`.
- `src/components/stations/PilotStation.tsx` and `src/components/stations/StationSelector.tsx` remain compatibility re-exports. New imports should target `src/ui/stations`.
- `src/systems/ew/EWConsole.jsx` remains a compatibility entry point for the EW implementation under `src/components/stations/EWConsole.jsx`.

## Change Routing Guidance

- New multiplayer payload fields belong in `shared/contracts` first, then client/server adapters.
- New ship simulation math belongs in `src/systems/simulation` helpers before being wired into `SimulationLoop.tsx`.
- New server room behavior should be implemented in `server/src/net`, `server/src/simulation`, or `server/src/rooms/roomLifecycle.ts` before expanding `StarSystemRoom.ts`.
- New station-level views should enter through `src/ui/stations`, not directly through `src/components/stations`.
