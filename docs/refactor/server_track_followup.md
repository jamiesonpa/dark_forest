# Server Reorg/Performance Follow-up Track

## Deferred Scope

- Server runtime under `server/src` is intentionally deferred from the current client-first reorganization.
- Colyseus room/schema layout and message handling will be migrated in a dedicated pass.

## Proposed Server Track

1. Create domain folders under `server/src`:
   - `rooms/`
   - `schema/`
   - `net/messages/`
   - `simulation/`
2. Align shared transport types between client and server to prevent schema drift.
3. Add lightweight load smoke tests (join/move/warp loops) to validate behavior.
4. Add message-path timing instrumentation for latency and per-room throughput.

## Safety Requirement

- Server migration must preserve all existing message names and payload semantics during the first pass.
