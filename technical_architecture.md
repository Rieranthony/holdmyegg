# Technical Architecture

## Workspace
- Bun workspace at the repo root
- `apps/web`: Vite + React + Three.js client
- `packages/map`: map schema, validation, mutations, chunking
- `packages/sim`: simulation rules and fixed-step runtime
- `test`: shared fixtures, command builders, snapshot helpers, and web test setup

## Boundaries
- React owns the start menu, HUD, editor panels, and mode changes
- The simulation owns per-frame gameplay logic
- The renderer reads simulation state and mutates scene objects in the render loop
- Terrain chunk rebuilds happen only when the world changes
- The web renderer derives block visuals from render profiles rather than map schema changes
- Runtime input uses a camera-forward basis ref so player commands stay stable while the avatar and camera are both turning
- Settled terrain lives in `MutableVoxelWorld`, while active falling debris lives in transient simulation entities
- Runtime pointer-lock and pause-overlay state stay renderer-local in `GameCanvas`, outside shared sim contracts
- Active sky drops live beside collapse debris as separate transient simulation entities
- `apps/web/src/app/useEditorSession.ts` owns editor mutations and map editing state
- `apps/web/src/app/useRuntimeSession.ts` owns match lifecycle and runtime state
- `apps/web/src/app/useMapPersistence.ts` owns save/load/import/export orchestration
- `App.tsx` switches between a menu shell, a full-view runtime shell, and the split editor shell without changing the shared sim contracts

## Performance Constraints
- Avoid per-frame React state updates for gameplay motion
- Render terrain with chunk-local merged `BufferGeometry`
- Share geometry and texture-backed materials
- Rebuild only dirty chunks after terrain edits
- Use indexed surface chunks so dirty rebuilds do not rescan the full voxel map
- Resolve editor/runtime block targeting from ray hit points and face normals instead of instance ids
- Keep full map snapshots off the normal HUD path
- Keep the chase camera in the render loop and out of React state
- Keep the over-the-shoulder aim rig in the render loop and out of React state
- Use shortest-path angle stepping for both sim-facing turns and render-facing yaw smoothing
- Keep structural support analysis in the map layer so editor settling and gameplay collapse share the same rule
- Keep speed-camera blending renderer-local so feel tuning does not leak into shared simulation contracts
- Keep player body collision simple and deterministic with lightweight XZ separation
- Keep the 10-layer foundation anchored in support analysis so the giant slab does not trigger wasteful whole-map detach scans
- Keep underground visual treatment renderer-side so the map schema does not need “subsoil” block kinds
- Keep NPC count modest now, but design for 40-player simulation later
- Split the web build into `react`, `rendering`, and `vendor` chunks so the bundle is not a single opaque slab

## Multiplayer Preparation
- Use serializable command and snapshot contracts
- Keep map format server-safe
- Keep gameplay deterministic enough for server authority
- Plan for Colyseus using the same sim package later
- Keep `getSnapshot()` available for tests/debugging, but treat `getMatchState`, `getHudState`, and `getPlayerState` as the normal runtime read APIs
- Keep block rendering concerns in the client so map documents stay visual-style agnostic
- Keep chunk meshing pure so it can move to a worker later if rebuild cost grows

## Test Strategy
- Use a single root `vitest.config.ts` with three projects: `map`, `sim`, and `web`
- Keep map and simulation tests in a node environment
- Keep app tests in `jsdom` with React Testing Library
- Test pure helpers and app flows instead of snapshotting Three.js scene graphs
- Enforce coverage thresholds high enough to protect mechanics without forcing brittle renderer tests
