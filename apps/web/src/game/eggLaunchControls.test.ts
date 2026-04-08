import { describe, expect, it } from "vitest";
import {
  getEggLaunchShortcutLabels,
  isEggLaunchKeyCode
} from "./eggLaunchControls";

describe("eggLaunchControls", () => {
  it("lists RMB and E as the egg shortcuts", () => {
    expect(getEggLaunchShortcutLabels()).toEqual(["RMB", "E"]);
  });

  it("accepts E while rejecting build and modifier keys", () => {
    expect(isEggLaunchKeyCode("KeyE")).toBe(true);
    expect(isEggLaunchKeyCode("KeyQ")).toBe(false);
    expect(isEggLaunchKeyCode("KeyR")).toBe(false);
    expect(isEggLaunchKeyCode("MetaLeft")).toBe(false);
    expect(isEggLaunchKeyCode("MetaRight")).toBe(false);
    expect(isEggLaunchKeyCode("ControlLeft")).toBe(false);
    expect(isEggLaunchKeyCode("ControlRight")).toBe(false);
  });
});
