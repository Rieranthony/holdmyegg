import { describe, expect, it } from "vitest";
import {
  detectEggLaunchPlatform,
  getEggLaunchShortcutLabels,
  isEggLaunchKeyCode
} from "./eggLaunchControls";

describe("eggLaunchControls", () => {
  it("detects Apple platforms from navigator-style hints", () => {
    expect(detectEggLaunchPlatform("MacIntel")).toBe("apple");
    expect(detectEggLaunchPlatform("iPhone")).toBe("apple");
    expect(detectEggLaunchPlatform("Win32")).toBe("other");
  });

  it("maps the primary launch shortcut label by platform", () => {
    expect(getEggLaunchShortcutLabels("apple")).toEqual(["Cmd"]);
    expect(getEggLaunchShortcutLabels("other")).toEqual(["Ctrl"]);
  });

  it("accepts the platform modifier key and keeps Q as a fallback", () => {
    expect(isEggLaunchKeyCode("MetaLeft", "apple")).toBe(true);
    expect(isEggLaunchKeyCode("MetaRight", "apple")).toBe(true);
    expect(isEggLaunchKeyCode("ControlLeft", "apple")).toBe(false);
    expect(isEggLaunchKeyCode("ControlLeft", "other")).toBe(true);
    expect(isEggLaunchKeyCode("MetaLeft", "other")).toBe(false);
    expect(isEggLaunchKeyCode("KeyQ", "apple")).toBe(true);
    expect(isEggLaunchKeyCode("KeyQ", "other")).toBe(true);
  });
});
