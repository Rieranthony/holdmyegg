import { describe, expect, it } from "vitest";
import { resolveFixedStepCatchUp } from "./GameCanvas";

describe("resolveFixedStepCatchUp", () => {
  it("clamps large accumulated deltas and reports dropped time", () => {
    const step = 1 / 60;
    const result = resolveFixedStepCatchUp(0, 0.1, step, 5, 0.1);

    expect(result.stepsToRun).toBe(5);
    expect(result.clamped).toBe(true);
    expect(result.droppedMs).toBeCloseTo(step * 1000, 5);
    expect(result.accumulator).toBeCloseTo(0.1 - step * 6, 5);
  });

  it("keeps the sub-step remainder when under the clamp threshold", () => {
    const step = 1 / 60;
    const result = resolveFixedStepCatchUp(step * 0.5, step * 1.5, step, 5, 0.1);

    expect(result.stepsToRun).toBe(2);
    expect(result.clamped).toBe(false);
    expect(result.droppedMs).toBe(0);
    expect(result.accumulator).toBeCloseTo(0, 5);
  });
});
