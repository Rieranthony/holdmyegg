# Findings

## Research Notes
- `react-three-fiber` performance guidance strongly favors mutation in `useFrame` for hot paths and warns against using React state inside render loops.
- `InstancedMesh` is the right baseline for a voxel arena because it sharply reduces draw calls.
- Greedy chunk meshing is the right next step once hidden-voxel culling is already in place, because exposed surface voxels still waste most terrain triangles when rendered as full cubes.
- A custom fixed-step simulation is a better long-term fit than general rigid-body physics for destructible terrain and future server authority.
- `Colyseus` remains a good fit for later room-based multiplayer.

## Current Decisions
- Bun workspace
- `Vite + React + TypeScript`
- `three` + `@react-three/fiber` + `@react-three/drei`
- `idb` for local map persistence
- `Vitest` as the single test runner across map, sim, and web
- `React Testing Library` for app-level DOM flows
- Shared test helpers and fixtures at the repo root to keep mechanic tests deterministic
- Keep full simulation snapshots for tests and debugging only
- Use lightweight runtime selectors for HUD and match reads
- Maintain an indexed surface chunk map in the voxel world so dirty chunk rebuilds stay targeted
- Keep map documents free of art-style data and derive voxel textures from client-side render profiles
- Keep terrain meshing in the web layer and only expose face masks from the shared map layer
- Resolve voxel targeting from ray hit points plus face normals so picking survives renderer changes
- Use a single third-person chase camera instead of supporting first-person during the prototype phase
- Use simple XZ body separation for player collision instead of full rigid-body physics
- Use camera-relative movement input, not player-facing-relative input, to avoid turning feedback loops
- Use shortest-path angle smoothing for avatar and camera yaw so small direction changes do not produce wraparound spins
- Use graph-based support analysis instead of “block below” rules so bridges, caves, and cliffs are still valid
- Treat collapse warnings and falling debris as transient sim entities instead of mutating the map schema
- Treat pointer lock, pause overlay behavior, and aim-camera state as client/runtime concerns, not simulation concerns
- Treat sky-drop hazards as separate transient sim entities instead of overloading collapse clusters
- Keeping the default live arena huge is fine for runtime play, but tests should use compact fixture maps so feedback stays fast

## Verification Notes
- `bun install` completed successfully
- `bun run test` passes across `packages/map`, `packages/sim`, and `apps/web`
- `bun run test:coverage` passes with the configured workspace thresholds
- `bun run build` passes for the workspace
- `bun run test:mechanics` passes after the terrain meshing refactor
- `bun run test:web` passes after the terrain meshing refactor
- The web build still emits a large-chunk warning for the rendering bundle even after initial splitting; that is a follow-up optimization, not a build failure

## Testing Notes
- Vitest projects let us keep node-focused mechanic tests separate from `jsdom` app tests while still running everything from the repo root.
- The safest tests are pure gameplay and persistence assertions. We are intentionally not snapshot-testing Three.js scenes.
- Browser file import flows are more reliable with `FileReader` than fallback response-based text extraction in the test environment.
- Renderer-facing tests now focus on render-profile selection and texture configuration rather than scene snapshots.
- Large integration tests around saving/loading giant live maps are much slower than mechanics tests; compact imported fixtures keep those flows testable without wasting time on irrelevant voxel volume.
