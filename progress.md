# Progress

## 2026-04-03
- Started from an empty directory
- Finalized the initial architecture and implementation strategy
- Began creating the workspace scaffold and root tracking files
- Switched the repo to a Bun workspace
- Implemented the shared voxel map package and tests
- Implemented the shared simulation package with Mass, jump, harvest, push, and NPC skirmish tests
- Implemented the web client with editor, save/load, import/export, explore mode, skirmish mode, HUD, and chunked voxel rendering
- Added root Vitest project configuration, shared test fixtures, and web test setup
- Expanded tests for map validation, map mutation, chunk dirtiness, simulation rules, keyboard mapping, storage flows, and app-level mode changes
- Added a root `README.md` covering usage, debugging, commands, and project structure
- Added indexed surface chunks in the map package for targeted dirty-chunk rebuilds
- Added lightweight sim selectors for match, HUD, and per-player reads
- Split app orchestration into editor, runtime, and persistence hooks
- Replaced flat cube colors with generated pixel-art voxel textures for earth blocks and darkness/void blocks
- Removed first-person mode and replaced the fixed view with a third-person chase camera
- Added horizontal player and NPC body collision in the simulation
- Expanded tests for voxel render profiles, chase camera behavior, facing-relative movement, and player collision
- Decoupled movement input from player facing so controls now use camera-relative movement only
- Added smooth capped turning in the simulation and smoothed chase-camera yaw follow to stop spin loops
- Replaced avatar yaw lerp with shortest-path angle stepping to prevent wraparound spins
- Softened avatar-only turn speed so character rotation feels less brutal while keeping the chase camera responsive
- Tuned avatar-only turn speed down again for a calmer third-person read during small direction changes
- Added graph-based support analysis so detached terrain can be detected without breaking valid bridges and caves
- Added editor-side immediate settling for disconnected floating terrain
- Added collapse warnings, falling debris, and crush damage in the gameplay simulation
- Added a subtle forward-speed camera blend for a stronger rush feeling at max speed
- Replaced the old resource meter with a shared Mass economy across gameplay, HUD, docs, and tests
- Added live runtime harvest/build targeting with a center reticle, focused cube outline, and placement ghost
- Added click-driven block harvesting and placement in Explore and Skirmish
- Tuned arena lighting and shadows to improve voxel depth perception during play
- Added runtime mouse orbit with `RMB drag`, soft recentring, and `E` as the build action
- Added camera-look-driven idle facing so standing turns keep push direction aligned with the current view
- Replaced `RMB drag` orbit with free-look mouse aiming across runtime play
- Changed runtime controls to over-the-shoulder movement with `W/S` forward-back and `A/D` strafe
- Removed runtime auto-recenter so camera orientation now stays where the player last aimed it
- Added a game-first start menu, with Explore and Skirmish entering a full-view runtime shell
- Replaced the fixed-target runtime camera with a true over-the-shoulder aim rig so looking up moves the reticle ray upward for higher builds
- Added runtime return-to-menu support through both the in-game `Menu` button and `Esc`
- Removed the unused direct `zustand` dependency from the web app package
- Verified `bun run test`
- Verified `bun run test:coverage`
- Verified `bun run build`
- Verified `bun run check`
- Verified `bun run dev` starts the Vite server from the repo root

## 2026-04-04
- Added exposed-face masks to visible chunk voxels in the shared map package
- Replaced terrain `InstancedMesh` rendering with greedy-meshed chunk `BufferGeometry` in the web renderer
- Added tiled chunk-face UVs, vertex-color face shading, and dev-only terrain stats for chunk count, draw calls, triangles, and rebuild timing
- Switched editor/runtime voxel picking from instance ids to ray hit point plus face normal resolution
- Added map tests for exposed face masks and chunk-boundary dirty rebuilds
- Added web tests for greedy meshing, performance thresholds, and terrain ray-hit resolution
- Verified `bun run test:mechanics`
- Verified `bun run test:web`
- Verified `bun run build`

## 2026-04-04
- Replaced runtime free-look edge limits with pointer lock so aim no longer dies at the screen boundary
- Added a pause overlay on `Esc`, with explicit `Resume` and `Menu` actions
- Rebuilt the default live arena as `200 x 32 x 200` with a 10-layer destructible foundation and a kill void below it
- Added underground dirt-only rendering, bigger lighting/shadow bounds, and decorative grained sky clouds
- Added random sky-drop hazards that telegraph, fall in, land as permanent ground, and update dirty chunks
- Unified collapse hits and sky-drop hits into one shared block-impact stun path
- Added smashed/blinking stunned player visuals and impact burst particles
- Updated map, sim, and web tests for the deeper arena, shared stun state, pointer lock, and sky-drop behavior
