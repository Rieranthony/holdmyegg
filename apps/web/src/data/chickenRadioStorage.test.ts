import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultChickenRadioSettings } from "../app/chickenRadio";
import {
  CHICKEN_RADIO_STORAGE_KEY,
  loadChickenRadioSettings,
  resetChickenRadioSettings,
  saveChickenRadioSettings,
} from "./chickenRadioStorage";

describe("chickenRadioStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the shipped defaults when nothing has been saved", () => {
    expect(loadChickenRadioSettings()).toEqual(
      createDefaultChickenRadioSettings(),
    );
  });

  it("falls back to defaults when the saved payload is malformed", () => {
    window.localStorage.setItem(CHICKEN_RADIO_STORAGE_KEY, "{not-json");

    expect(loadChickenRadioSettings()).toEqual(
      createDefaultChickenRadioSettings(),
    );
  });

  it("round-trips saved settings through local storage", () => {
    saveChickenRadioSettings({
      stationId: "synthwave",
      volume: 61,
      playbackPreference: "play",
    });

    expect(loadChickenRadioSettings()).toEqual({
      stationId: "synthwave",
      volume: 61,
      playbackPreference: "play",
    });
  });

  it("persists paused playback preference", () => {
    saveChickenRadioSettings({
      stationId: "gentle-rain",
      volume: 18,
      playbackPreference: "pause",
    });

    expect(loadChickenRadioSettings()).toEqual({
      stationId: "gentle-rain",
      volume: 18,
      playbackPreference: "pause",
    });
  });

  it("defaults first load to autoplaying LOFI at 35 volume", () => {
    expect(loadChickenRadioSettings()).toMatchObject({
      stationId: "lofi",
      volume: 35,
      playbackPreference: "play",
    });
  });

  it("removes the saved payload when the radio is reset", () => {
    saveChickenRadioSettings({
      stationId: "synthwave",
      volume: 48,
      playbackPreference: "pause",
    });

    resetChickenRadioSettings();

    expect(window.localStorage.getItem(CHICKEN_RADIO_STORAGE_KEY)).toBeNull();
    expect(loadChickenRadioSettings()).toEqual(
      createDefaultChickenRadioSettings(),
    );
  });
});
