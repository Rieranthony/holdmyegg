# Findings

## Backend Foundation
- `apps/server` already exists with Bun + Hono + Hono websocket helper, room manager, room FSM, auth mount, and core HTTP routes.
- `packages/netcode` already defines shared room/chat/bootstrap/delta contracts plus websocket packet codecs.
- `packages/db` already defines Better Auth-compatible tables and app persistence tables.

## Frontend Seams
- `apps/web/src/engine/GameClient.ts` is the best compatibility layer because it already consumes worker-style `frame`, `world_sync`, and `terrain_patches` messages.
- `apps/web/src/engine/GameHost.tsx` can stay stable if `GameClient` learns how to choose between a real worker and a multiplayer-backed worker-like transport.
- `apps/web/src/app/App.tsx` still has a purely local menu flow and needs auth/lobby/session integration.

## Important Constraints
- The shared netcode package already contains packed runtime input logic, so the web app should stop owning that format.
- Waiting-room clarity and chat are first-class user requirements, not extras.

## Implementation Results
- The web app now restores Better Auth anonymous sessions, persists display names through `/profile`, and uses that identity to join rooms and keep users ready on later visits.
- Multiplayer rendering now uses a worker-compatible websocket bridge, so the existing renderer path stays intact while live room state comes from the server.
- Waiting rooms now expose room cards in the menu plus an in-game roster/chat overlay with FaceHash avatars, explicit presence states, and exact countdown reasons.
- Multiplayer spectators now get a client-side free-fly camera while waiting or after death.

## Validation Results
- Full workspace `bun run check` passed after the multiplayer/auth integration and one test expectation update for `typedText` on keyboard input state.
