# Multiplayer Implementation Plan

## Goal
- Ship the planned multiplayer/auth/persistence foundation end-to-end in this repo without regressing the existing solo/editor flows.

## Phases
- [x] Add shared multiplayer/server/db packages and server foundation.
- [x] Wire the web client to Better Auth sessions and persistent player profiles.
- [x] Add multiplayer transport support that preserves the existing `GameClient` rendering contract.
- [x] Add lobby, waiting-room, roster, countdown, and chat UI.
- [x] Verify builds and targeted tests; fix integration regressions.

## Constraints
- Keep the runtime hot path allocation-light.
- Preserve the current worker-based solo mode.
- Use FaceHash as the v1 avatar source.
- Keep waiting-room state explicit and easy to understand.

## Open Risks
- Websocket-backed multiplayer needs to fit the existing worker-style rendering pipeline cleanly.
- Better Auth client integration has to avoid creating a second, conflicting identity source in the browser.

## Validation
- `bun run test:web`
- `bun run test:server`
- `bun run check`
