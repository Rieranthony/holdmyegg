import { describe, expect, it } from "vitest";
import {
  LOCAL_DEV_MULTIPLAYER_SERVER_URL,
  resolveMultiplayerServerUrl
} from "./authClient";

describe("resolveMultiplayerServerUrl", () => {
  it("prefers an explicit VITE_SERVER_URL override", () => {
    expect(
      resolveMultiplayerServerUrl({
        configuredServerUrl: "https://api.example.com///",
        locationOrigin: "http://localhost:5173"
      })
    ).toBe("https://api.example.com");
  });

  it("uses the tracked local multiplayer URL for local dev origins", () => {
    expect(
      resolveMultiplayerServerUrl({
        locationOrigin: "http://localhost:5173"
      })
    ).toBe(LOCAL_DEV_MULTIPLAYER_SERVER_URL);
  });

  it("keeps same-origin routing for non-local deployments", () => {
    expect(
      resolveMultiplayerServerUrl({
        locationOrigin: "https://play.example.com"
      })
    ).toBe("https://play.example.com");
  });
});
