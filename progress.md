# Progress

## 2026-04-11
- Resumed from in-progress portal scaffolding.
- Confirmed modified files and reviewed the worker runtime flow, app overlay, and portal session helper.
- Finished explore portal bootstrap, free-look runtime entry, worker portal rendering, and portal redirect plumbing.
- Added tests for portal query parsing, portal boot behavior, free capture mode, portal trigger relays, worker portal arming, and sim spawn overrides.
- Verified with:
  - `bunx vitest run apps/web/src/app/portalSession.test.ts`
  - `bunx vitest run apps/web/src/app/App.test.tsx`
  - `bunx vitest run apps/web/src/engine/GameClient.test.ts`
  - `bunx vitest run apps/web/src/engine/GameHost.test.tsx`
  - `bunx vitest run apps/web/src/engine/worker.test.ts`
  - `bunx vitest run packages/sim/src/__tests__/simulation.test.ts -t "applies a local spawn override only to the initial local player entry"`
- Repo-wide `bunx tsc -p apps/web/tsconfig.json --noEmit` still reports existing unrelated test typing issues, so it was not a useful signal for this change set.
