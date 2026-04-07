# HoldMyEgg

HoldMyEgg is the current player-facing name for the solo-first voxel arena prototype built with Bun, React, and Three.js.

The current build is focused on the core loop:
- shape a cubic arena
- save, load, import, and export maps
- run `Explore` to test movement, jump, Matter flow, harvesting, and live building
- run `PLAY NPC` to fight smarter NPCs and push them out of bounds

Multiplayer is intentionally not built yet. The map and simulation packages are already structured so we can reuse the same contracts later on a server.

## Current Status
- Bun workspace is set up
- shared map package is working
- shared simulation package is working
- web editor, HUD, explore mode, and PLAY NPC mode are working
- the app now opens on a minimalist HoldMyEgg start menu with a live overhead arena background, `Explore`, `PLAY NPC`, `Build`, and `Map Workshop`
- the UI now uses Geist Pixel Square globally, with hard-edged pixel controls and zero rounded corners
- entering `Explore` or `PLAY NPC` now starts with a sky-drop fall into the map
- indexed dirty-chunk rebuilds are in place for terrain updates
- greedy-meshed terrain chunks now replace one-cube-per-voxel terrain rendering
- lightweight sim selectors keep HUD and runtime reads off the full snapshot path
- generated pixel-art voxel textures are in place for earth blocks and darkness/void blocks
- runtime play now uses a full-view over-the-shoulder aim camera instead of the editor split layout
- the chase camera now reacts subtly to forward speed by lowering and flattening a bit at full rush
- runtime targeting now highlights the focused cube and placement face with a Minecraft-style reticle flow
- runtime play now supports free-look mouse aiming with over-the-shoulder strafing controls and upward building
- player and NPC body collision now prevents normal overlap during movement
- terrain support is graph-based, so bridges and caves are valid while detached masses collapse
- gameplay collapse warnings and falling debris are in place, with heavy crush damage instead of instant kills
- runtime play now uses pointer lock, with `Esc` opening a pause overlay for `Resume` or `Menu`
- the default arena is now `200 x 32 x 200` with a 10-layer destructible foundation and a kill void below it
- underground cubes now render as dirt-only subsoil while the surface keeps grass-top voxel treatment
- decorative sky clouds and random sky-drop cube hazards are now active during runtime play
- block-impact stun is now shared by collapse debris and sky drops, and stunned characters render in a smashed blinking state
- multi-project Vitest coverage is in place for map, sim, and web logic

## Repo Layout
- `apps/web`: Vite app, HUD, editor UI, renderer integration
- `packages/map`: voxel schema, validation, chunking, mutations, save/load helpers
- `packages/sim`: fixed-step gameplay simulation and shared gameplay types
- `test`: shared fixtures, helpers, and web test setup

Inside `apps/web`, the main controller logic now lives in:
- `src/app/useEditorSession.ts`
- `src/app/useRuntimeSession.ts`
- `src/app/useMapPersistence.ts`

## Bun Commands
- `bun install`: install dependencies
- `bun run dev`: start the web app
- `bun run test`: run all tests
- `bun run test:mechanics`: run map and simulation tests only
- `bun run test:web`: run the app and DOM-focused tests only
- `bun run test:coverage`: run coverage with thresholds
- `bun run build`: make a production build
- `bun run check`: run the default safety gate, tests first and build second

## How To Use The Prototype
1. Run `bun run dev`.
2. Open the Vite URL, usually `http://localhost:5173`.
3. Start from the main menu.
4. Type a player name and choose a chicken color.
5. Choose `Explore` or `PLAY NPC` to sky-drop into runtime play, or use `Map Workshop` to open the editor.
6. `Build` is visible on the menu as a future mode, but it is not implemented yet.
7. Click once in runtime play to capture the mouse with pointer lock.
8. Press `Esc` any time during runtime play to unlock the mouse and open the pause overlay.
9. Use `Resume` to re-lock the mouse or `Menu` to return to the main menu.
10. Use `Map Workshop` whenever you want to shape the arena, save/load maps, or import/export JSON.

## Editor Basics
- `Add`: place a cube on the face you click
- `Erase`: remove the cube you click
- `Spawn`: place a spawn marker on the clicked column
- `Cube Type`: choose between `ground`, `boundary`, and `hazard`
- `New Arena`: reset to the default map
- `Save`: persist the current map in IndexedDB
- `Load`: load a saved map from the selected slot
- `Delete`: remove the selected saved map
- `Export`: download the map as JSON
- `Import JSON`: load a saved JSON map back into the editor

Editor note: disconnected floating terrain settles immediately. Bridges, caves, cliffs, and overhangs are fine as long as they stay connected to anchored terrain or the arena shell.

## Runtime Controls
- Move: `WASD` or arrow keys
- Look: `Mouse`
- Jump: `Space`
- Harvest block: `Left click`
- Place block: `E`
- Push: `F`
- Pause / unlock mouse: `Esc`
- Camera: full-view over-the-shoulder aim camera with pointer-locked free-look during runtime play
- Reticle: center-screen focus marker with a cube outline and placement ghost

Gameplay note: `Matter` is the single shared resource. Grounded jumps are free, while jetpack lift, pushing, crush damage, and building still use it. You start below build cost, so you need to harvest before you can place.

Gameplay note: if you break the last support path for a structure, the detached mass flashes briefly and then falls as a crush hazard.

Gameplay note: the character now faces camera look direction during runtime play, so `A/D` strafe, push alignment, and upward build targeting stay tied to what you are looking at.

Gameplay note: runtime matches now play on a larger `200 x 32 x 200` arena with a 10-layer diggable slab. If players chew all the way through the slab, the dark void below becomes a ring-out kill zone.

Gameplay note: random sky-drop cubes now telegraph a landing column, fall in from above, and become permanent terrain when they land. Block impacts from either sky drops or collapse debris can launch and stun players, and stunned characters render as smashed and blinking until they recover.

## Where The Game Logic Lives
- Map rules and chunking: `packages/map/src/world.ts`
- Map schema and serialization: `packages/map/src/types.ts` and `packages/map/src/serialization.ts`
- Gameplay simulation: `packages/sim/src/simulation.ts`
- Structural support and terrain settling: `packages/map/src/world.ts`
- App shell and mode flow: `apps/web/src/app/App.tsx`
- App controllers: `apps/web/src/app/useEditorSession.ts`, `apps/web/src/app/useRuntimeSession.ts`, and `apps/web/src/app/useMapPersistence.ts`
- Renderer loop, over-the-shoulder aim camera, and runtime targeting: `apps/web/src/components/GameCanvas.tsx`
- Keyboard mapping: `apps/web/src/hooks/useKeyboardInput.ts`
- Voxel textures and render profiles: `apps/web/src/game/voxelMaterials.ts`
- Terrain meshing and voxel ray-hit helpers: `apps/web/src/game/terrainMesher.ts` and `apps/web/src/game/terrainRaycast.ts`
- Falling debris visuals: `apps/web/src/components/FallingClusters.tsx` and `apps/web/src/game/fallingClusters.ts`
- Sky-drop hazards and visuals: `packages/sim/src/simulation.ts`, `apps/web/src/components/SkyDrops.tsx`, and `apps/web/src/game/skyDrops.ts`
- Pointer-lock runtime shell and pause overlay: `apps/web/src/components/GameCanvas.tsx`
- Clouds and underground block treatments: `apps/web/src/components/SkyClouds.tsx` and `apps/web/src/game/voxelMaterials.ts`

## Sim And Render Split
- React owns the start menu, player setup state, status text, HUD refresh, editor controls, and mode changes.
- The fixed-step simulation owns movement, jump, Matter economy, harvesting, building, pushing, NPC behavior, player collision, collapse warnings, falling debris, sky-drop hazards, block-impact stun, and elimination.
- The runtime UI reads `getMatchState`, `getHudState`, and `getPlayerState` instead of polling full snapshots.
- Three.js only rebuilds dirty terrain chunks and now reads them from the world’s indexed surface chunks instead of rescanning the full voxel map per dirty key.
- The world renderer turns exposed chunk faces into greedy-merged chunk meshes, so the GPU sees tiled terrain quads instead of one cube per surface voxel.
- Runtime and editor block picking now resolve voxel hits from ray intersection points plus face normals, so targeting stays stable even with merged chunk meshes.
- Active falling debris and sky drops are rendered as transient entities, separate from settled terrain.
- This split is what lets us move quickly without baking gameplay rules into fragile render code.

## Debugging A Broken Mechanic
If a mechanic breaks, use this order:

1. Run `bun run test:mechanics`.
2. If the failure is about terrain or save/load, start in `packages/map`.
3. If the failure is about Matter, jump, harvest/build, push, NPCs, or elimination, start in `packages/sim`.
4. If the mechanic works in tests but looks wrong in the browser, inspect `apps/web/src/components/GameCanvas.tsx`, `apps/web/src/components/Hud.tsx`, and `apps/web/src/hooks/useKeyboardInput.ts`.
5. Re-run `bun run check` before considering the fix complete.

Useful signals:
- broken imports or save/load flows usually point to `apps/web/src/data/mapStorage.ts` or map serialization
- terrain not visually updating usually points to dirty chunk propagation or the surface chunk index in `packages/map/src/world.ts`
- floating terrain behaving strangely usually points to structural support analysis in `packages/map/src/world.ts`
- input feeling wrong usually points to `buildPlayerCommand`
- camera weirdness or broken upward aim usually points to `apps/web/src/game/camera.ts` or runtime aim handling in `apps/web/src/components/GameCanvas.tsx`
- cubes looking wrong usually points to `apps/web/src/game/voxelMaterials.ts` or `apps/web/src/game/terrainMesher.ts`
- players clipping through each other usually points to collision resolution in `packages/sim/src/simulation.ts`
- collapse timing or crush behavior usually points to falling cluster updates in `packages/sim/src/simulation.ts`
- pointer lock or pause-overlay issues usually points to runtime shell logic in `apps/web/src/components/GameCanvas.tsx`
- sky-drop targeting, landing, or stun issues usually points to sky-drop updates in `packages/sim/src/simulation.ts`

## Test Commands And What They Protect
- `bun run test:mechanics`: protects voxel edits, chunk dirtiness, structural support, Matter rules, movement, harvesting, building, pushing, falling debris, crush damage, eliminations, and NPC behavior
- `bun run test:web`: protects app-level flows like menu/runtime transitions, map persistence, import/export, HUD, aim-camera wiring, keyboard mapping, and renderer-facing helpers
- `bun run test:coverage`: enforces the current coverage thresholds across the workspace
- `bun run check`: the fast local “safe to ship” command

## Root Tracking Files
- `task_plan.md`
- `game_design.md`
- `technical_architecture.md`
- `map_format.md`
- `findings.md`
- `progress.md`
- `backlog.md`
- `acceptance_criteria.md`

Those files are meant to stay current as we build, test, and change direction.
