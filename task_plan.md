# Task Plan

## Goal
Ship a solo-first playable foundation for **Out of Bounds**:
- root tracking system
- voxel map package
- fixed-step gameplay simulation
- web client with editor, explore mode, and skirmish mode
- test structure and practical documentation so we can move fast without breaking mechanics
- scale-oriented cleanup so the prototype stays cheap to extend toward multiplayer
- Minecraft-like pixel-textured cubes, a follow camera, and solid player collision so the prototype feels more like the actual game
- pointer-locked runtime play, a larger deep arena, and shared block-impact stun so the prototype reads more like the intended match experience

## Current Phase
`Phase 14` complete for the prototype foundation: runtime play now uses pointer lock, the default arena is a larger deep-slab map, sky-drop hazards are active, and block impacts share a smashed stun state.

## Phases
1. Workspace scaffold and project memory files
2. Shared map package ✅
3. Shared simulation package ✅
4. Web app, renderer, editor, HUD ✅
5. Tests, coverage verification, documentation updates ✅
6. Scale and cleanup pass ✅
7. Texture, collision, and chase-camera pass ✅
8. Stable turning and smooth camera-follow pass ✅
9. Speed camera and structural collapse pass ✅
10. Focus, Mass economy, and runtime building pass ✅
11. Runtime mouse orbit camera pass ✅
12. Runtime free-look and strafe control pass ✅
13. Over-the-shoulder aim camera and start menu pass ✅
14. Pointer lock, deep arena, sky-drop hazards, and smashed stun pass ✅

## Blockers
- None currently for the solo foundation
- Later work: further chunk/code splitting for the rendering bundle if startup size becomes a concern
- Later work: wire `bun run check` into CI so the local safety gate also protects merges

## Next Steps
- Playtest feel tuning for jump, push, build, and Mass values
- Improve NPC pathing and edge behavior
- Add richer editor tooling like spawn deletion and brush shapes
- Add more focused regression tests whenever a mechanic bug is found
- Consider event-driven HUD/runtime subscriptions if polling ever becomes a measurable cost
- Tune chase camera feel, obstruction handling, and framing around tall terrain
- Continue playtesting `turnSpeed`, camera yaw follow speed, and damping values for the cleanest feel
- Tune the speed-camera rush effect and collapse warning readability with real playtests
- Decide whether crush damage should stay as Mass loss or evolve into direct elimination later
- Tune runtime destroy/place cadence and highlight readability with real playtests
- Tune free-look sensitivity, pitch limits, and chase-camera damping with real playtests
- Tune the over-the-shoulder aim offset, upward pitch cap, and full-view HUD balance with real playtests
- Add more block palettes and texture variants without changing the map format
- Tune pointer-lock onboarding, pause overlay wording, and sky-drop cadence with real playtests
- Tune block-impact stun readability, launch feel, and smashed recovery timing
- Add richer cloud variants and more sky dressing without hurting runtime targeting clarity
- Start the multiplayer server package when the solo loop feels locked
