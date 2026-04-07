import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultRuntimeControlSettings } from "../game/runtimeControlSettings";
import {
  RUNTIME_CONTROL_SETTINGS_STORAGE_KEY,
  loadRuntimeControlSettings,
  resetRuntimeControlSettings,
  saveRuntimeControlSettings
} from "./runtimeControlSettingsStorage";

describe("runtimeControlSettingsStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the shipped defaults when nothing has been saved", () => {
    expect(loadRuntimeControlSettings()).toEqual(
      createDefaultRuntimeControlSettings()
    );
  });

  it("falls back to defaults when the saved payload is malformed", () => {
    window.localStorage.setItem(
      RUNTIME_CONTROL_SETTINGS_STORAGE_KEY,
      "{not-json"
    );

    expect(loadRuntimeControlSettings()).toEqual(
      createDefaultRuntimeControlSettings()
    );
  });

  it("round-trips saved settings through local storage", () => {
    saveRuntimeControlSettings({
      lookSensitivity: 1.6,
      invertLookX: true,
      invertLookY: false
    });

    expect(loadRuntimeControlSettings()).toEqual({
      lookSensitivity: 1.6,
      invertLookX: true,
      invertLookY: false
    });
  });

  it("migrates legacy v1 settings so existing users keep the same effective feel", () => {
    window.localStorage.setItem(
      "out-of-bounds.runtime-control-settings.v1",
      JSON.stringify({
        version: 1,
        settings: {
          lookSensitivity: 1.3,
          invertLookX: false,
          invertLookY: true
        }
      })
    );

    expect(loadRuntimeControlSettings()).toEqual({
      lookSensitivity: 1.3,
      invertLookX: true,
      invertLookY: false
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(RUNTIME_CONTROL_SETTINGS_STORAGE_KEY)!
      )
    ).toEqual({
      version: 2,
      settings: {
        lookSensitivity: 1.3,
        invertLookX: true,
        invertLookY: false
      }
    });
    expect(
      window.localStorage.getItem("out-of-bounds.runtime-control-settings.v1")
    ).toBeNull();
  });

  it("removes the saved payload when controls are reset", () => {
    saveRuntimeControlSettings({
      lookSensitivity: 0.8,
      invertLookX: true,
      invertLookY: true
    });

    resetRuntimeControlSettings();

    expect(
      window.localStorage.getItem(RUNTIME_CONTROL_SETTINGS_STORAGE_KEY)
    ).toBeNull();
    expect(loadRuntimeControlSettings()).toEqual(
      createDefaultRuntimeControlSettings()
    );
  });
});
