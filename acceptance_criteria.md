# Acceptance Criteria

## Milestone 1
- Workspace installs cleanly
- Root tracking files exist and are meaningful
- Shared map and simulation packages compile
- Status: complete

## Milestone 2
- Editor can add and erase cubes
- Editor can place spawns
- Map can be saved, loaded, exported, and imported
- Status: complete

## Milestone 3
- Explore mode supports movement, jump, Mass spending, harvesting, and building
- HUD exposes current Mass and instructions
- Status: complete

## Milestone 4
- Skirmish mode spawns NPCs
- Push can knock players out of bounds
- Arena terrain updates without full scene rebuilds
- Status: complete for the prototype foundation

## Milestone 5
- Root test structure covers map, sim, and web layers
- Coverage thresholds pass from the repo root
- `bun run check` is the default local safety gate
- Root README explains how to run, use, and debug the prototype
- Status: complete

## Milestone 6
- Dirty chunk rebuilds use indexed surface data instead of scanning the full voxel map per key
- HUD and runtime UI paths avoid full simulation snapshots
- App orchestration is split into editor, runtime, and persistence controllers
- Status: complete

## Milestone 7
- Earth cubes render with generated pixel-art grass/dirt textures
- Hazard and under-map visuals read as dark void instead of grass
- The camera follows the player with a third-person chase rig
- Players and NPCs no longer overlap during normal movement
- Status: complete

## Milestone 8
- Holding a movement key no longer causes repeated camera spin
- Character facing rotates smoothly toward movement direction instead of snapping
- Camera-relative movement stays stable while the chase camera is turning
- Avatar and camera yaw take the shortest turn path across angle wrap boundaries
- Status: complete

## Milestone 9
- Forward near-max speed lowers and flattens the chase camera slightly without affecting sideways or backward movement
- Bridges and caves remain valid when connected to anchors, but detached masses are detected as unsupported
- Editor terrain settles disconnected floating components immediately
- Gameplay detachments warn briefly, fall as rigid debris clusters, and apply heavy crush damage plus knockback
- Status: complete

## Milestone 10
- Runtime play shows a center-screen reticle, focused cube outline, and placement ghost
- Harvesting and building use explicit voxel targets instead of facing-only inference
- The public resource meter is Mass, and building is gated by harvesting first
- Terrain shadows and lighting provide a clearer read of voxel depth during play
- Status: complete

## Milestone 11
- Runtime play supports `RMB drag` orbit without breaking the chase-camera feel
- Building moves to `E`, while `LMB` remains harvest and `F` remains push
- Standing camera turns rotate facing toward the viewed direction so push alignment stays intuitive
- Orbit holds briefly after release, then eases back behind the player
- Status: complete

## Milestone 12
- Moving the mouse directly changes runtime camera look and reticle aim without holding a button
- The character faces camera look direction, while `A/D` strafe and `W/S` move forward/back relative to that look
- Runtime camera no longer auto-recenters behind the player
- Editor camera behavior stays unchanged
- Status: complete

## Milestone 13
- The app opens on a game-first menu with `Explore`, `Skirmish`, and `Map Workshop`
- `Explore` and `Skirmish` enter a full-view play layout, while the editor keeps the split tool layout
- The runtime camera uses an over-the-shoulder aim rig, so looking up moves the reticle ray upward and allows higher block targeting
- The in-game `Menu` button and `Esc` both return runtime play to the main menu
- Status: complete

## Milestone 14
- Runtime play captures the mouse with pointer lock, and `Esc` unlocks it into a pause overlay with `Resume` and `Menu`
- The default arena is `200 x 32 x 200`, with a 10-layer destructible slab and ring-out below `y < 0`
- Surface cubes keep grass treatment while underground cubes render as dirt-only subsoil
- Decorative clouds and random sky-drop cube hazards are active during runtime play
- Collapse debris and sky drops both apply the shared block-impact stun path, and stunned characters render as visibly smashed
- Status: complete
