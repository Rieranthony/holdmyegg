# Findings

- `App.tsx` already seeds portal bootstrap state, runtime capture mode, and portal redirect callbacks.
- `GameHost`, `GameClient`, engine protocol, and sim reset types already include portal/capture/spawn-override plumbing.
- The worker now owns explore-only portal rendering, arming, traversal detection, and traversal snapshot emission.
- Free-look portal arrivals work without pointer lock by treating `captureMode: "free"` as active runtime input while unpaused.
- Focused Vitest coverage is green for `App`, `portalSession`, `GameClient`, `GameHost`, `worker`, and the new sim spawn-override path.
