# Task Plan

## Goal
Implement Vibe Jam explore-mode portals with runtime-only rendering and triggers, portal bootstrap on arrival, free-look runtime entry, and no portal support in multiplayer.

## Phases
- [completed] Finish app-shell integration and pause overlay updates
- [completed] Implement worker portal scene, trigger detection, and free capture behavior
- [completed] Add unit and integration tests for portal flow and spawn override
- [completed] Run targeted tests and fix regressions

## Notes
- Portal config is runtime-only and should not touch saved map schema.
- Portal arrivals should boot directly into `explore` with no blocking pointer-lock overlay.
- Multiplayer must ignore portal visuals and triggers.
- Repo-wide `tsc` for `apps/web` is currently noisy because of pre-existing test typing issues unrelated to portals, so verification used focused Vitest suites plus the new sim-specific test case.
