# Game Design

## Pillars
- Chunky, readable voxel arena
- Party-game energy rather than survival sandbox complexity
- Easy controls with room for depth through positioning and terrain destruction
- Destruction as a shared Mass economy, not just decoration

## Core Loop
1. Move through a cubic arena
2. Spend Mass to jump, push, and build
3. Recover Mass by harvesting nearby cubes
4. Use terrain destruction to open paths, break supports, and trigger collapses
5. Push opponents out of bounds

## Feel Goals
- Minecraft-adjacent visuals
- Simple generated pixel-art textures with crisp nearest-neighbor sampling
- Third-person over-the-shoulder aim camera that follows player position and uses free-look mouse aiming during runtime play
- Pointer-locked runtime aiming so the camera can keep turning without hitting the screen edge
- Forward rush should lower and flatten the chase camera slightly for subtle arcade speed
- Strong silhouettes, readable relief, and a clear dark void below the arena
- Body contact should feel solid so opponents cannot ghost through each other
- Terrain should feel structural: bridges and caves are allowed, but detached masses should warn and collapse
- The arena should feel layered: grassy surface, dirt-only subsoil, dark kill void below, and light stylized clouds above

## Modes
- `Menu`: game-first launch screen with `Explore` and `Skirmish` as primary actions
- `Editor`: paint cubes, erase cubes, place spawns, save/load maps
- `Explore`: solo sandbox for movement, jump, harvesting, and building
- `Skirmish`: solo plus NPCs
- `Multiplayer`: later phase

## Mechanical Defaults
- Mass starts below build cost, so harvesting matters immediately
- Jumping costs Mass
- Pushing costs Mass
- Harvesting cubes restores Mass
- Placing cubes spends Mass
- Runtime building uses `E`, harvesting uses `LMB`, and mouse movement controls the camera look
- Runtime play captures the mouse with pointer lock, and `Esc` opens a pause overlay instead of instantly leaving the match
- Players and NPCs collide in XZ during normal movement
- Crush hazards deal big Mass damage and knockback, but ring-out remains the hard elimination rule
- Sky-drop cubes telegraph a landing column, fall from above, and become permanent terrain on impact
- Both sky drops and collapse debris can launch and stun players, and stunned characters should read as visibly smashed
- Runtime movement is over-the-shoulder: `W/S` move forward-back, `A/D` strafe, and the player faces look direction for pushing
- Runtime play fills the whole app viewport, while the editor keeps a tool-heavy split layout
- Ring-out decides eliminations
