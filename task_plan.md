# Worker-Only Three.js Migration Plan

## Goal
- Move all Three.js rendering and render-loop computation into a background worker that owns an `OffscreenCanvas`, while React remains a canvas shell plus DOM UI only.

## Phases
- [ ] Replace the current planning files and document the migration scope.
- [ ] Refactor engine protocols and the `GameClient` / `GameHost` seam into a thin worker controller.
- [ ] Move renderer ownership, diagnostics, camera, terrain, and multiplayer visual state into the worker runtime.
- [ ] Remove the legacy React Three.js renderer stack and its obsolete tests.
- [ ] Verify web tests and workspace checks, then fix regressions.

## Constraints
- No React-side Three.js rendering path or main-thread renderer fallback.
- Keep pointer-lock, HUD, status, pause overlays, and multiplayer room UI in the DOM shell.
- Preserve worker-driven local simulation and expand it to own rendering too.

## Open Risks
- The current `GameClient` mixes renderer logic with host event wiring, so the split has to preserve shell callbacks without leaving visual work behind.
- Multiplayer currently enters through a main-thread bridge and needs to be rerouted into the worker without regressing room sync.
- Unsupported browsers must fail clearly instead of silently falling back to a main-thread renderer.

## Validation
- `bun run test:web`
- `bun run check`
