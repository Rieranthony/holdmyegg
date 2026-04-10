# Findings

## Current Renderer State
- `apps/web/src/engine/GameClient.ts` is the live renderer path today and still owns Three.js scene creation, animation, camera math, terrain patch application, and most runtime visuals on the main thread.
- `apps/web/src/engine/worker.ts` already owns the local editor/runtime simulation, terrain meshing, and diagnostics, but not rendering.
- `apps/web/src/engine/multiplayerWorker.ts` is only a main-thread bridge for multiplayer state; it does not render.

## Legacy Code To Remove
- The React Three.js stack under `apps/web/src/components/GameCanvas*.tsx` and the related scene components are not the live gameplay path anymore and should be removed during this migration.
- Existing `GameCanvas` already contains a dev-only FPS probe, but it is legacy and should not remain as the shipped diagnostics path.

## Migration Implications
- `GameHost` can stay as the React mount seam, but only as a host/controller for canvas transfer and DOM callbacks.
- `GameClient` should shrink to input forwarding, pointer-lock coordination, resize forwarding, unsupported-browser handling, and worker message routing.
- The worker protocol needs new messages for `OffscreenCanvas` init, viewport updates, pointer movement/button changes, and multiplayer realtime events.
