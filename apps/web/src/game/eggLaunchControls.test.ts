import { describe, expect, it } from "vitest";
import {
  getEggLaunchShortcutLabels,
  isEggLaunchKeyCode
} from "./eggLaunchControls";

describe("eggLaunchControls", () => {
  it("lists Q and R as the egg launch shortcuts", () => {
    expect(getEggLaunchShortcutLabels()).toEqual(["Q", "R"]);
  });

  it("accepts Q and R while rejecting old modifier-key launches", () => {
    expect(isEggLaunchKeyCode("KeyQ")).toBe(true);
    expect(isEggLaunchKeyCode("KeyR")).toBe(true);
    expect(isEggLaunchKeyCode("MetaLeft")).toBe(false);
    expect(isEggLaunchKeyCode("MetaRight")).toBe(false);
    expect(isEggLaunchKeyCode("ControlLeft")).toBe(false);
    expect(isEggLaunchKeyCode("ControlRight")).toBe(false);
  });
});
