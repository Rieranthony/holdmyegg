import { describe, expect, it } from "vitest";
import { createDefaultArenaMap } from "@out-of-bounds/map";
import {
  EXIT_PORTAL_ID,
  RETURN_PORTAL_ID,
  VIBE_JAM_PORTAL_URL,
  buildExplorePortalRuntimeConfig,
  buildPortalRedirectUrl,
  normalizePortalRef,
  readPortalBootstrapState,
  resolveIncomingPortalPaletteName
} from "./portalSession";

describe("portalSession", () => {
  it("normalizes inbound refs and rejects unsupported protocols", () => {
    expect(normalizePortalRef("/play", "https://holdmyegg.com")).toBe(
      "https://holdmyegg.com/play"
    );
    expect(normalizePortalRef("javascript:alert(1)", "https://holdmyegg.com")).toBeNull();
  });

  it("maps inbound colors and query params into a portal bootstrap state", () => {
    const bootstrap = readPortalBootstrapState({
      origin: "https://holdmyegg.com",
      pathname: "/",
      search:
        "?portal=true&username=Levels&color=red&speed=5&rotation_y=1.57&ref=https%3A%2F%2Fexample.com%2Fgame"
    });

    expect(bootstrap).toMatchObject({
      playerName: "Levels",
      paletteName: "coral",
      incomingRefUrl: "https://example.com/game"
    });
    expect(bootstrap?.localPlayerSpawnOverride?.velocity).toEqual(
      expect.objectContaining({
        y: 0
      })
    );
    expect(bootstrap?.localPlayerSpawnOverride?.facing).toEqual(
      expect.objectContaining({
        z: expect.any(Number)
      })
    );
  });

  it("builds runtime portal scene anchors for explore mode", () => {
    const config = buildExplorePortalRuntimeConfig(createDefaultArenaMap(), {
      includeReturnPortal: true
    });

    expect(config.arrivalAnchor).not.toBeNull();
    expect(config.scene.portals.map((portal) => portal.id)).toEqual([
      EXIT_PORTAL_ID,
      RETURN_PORTAL_ID
    ]);
    expect(config.scene.portals.every((portal) => portal.label === "MAGIC PORTAL")).toBe(true);
  });

  it("builds exit portal redirects to the Vibe Jam hub with live continuity params", () => {
    const redirectUrl = buildPortalRedirectUrl({
      currentGameUrl: "https://holdmyegg.com/",
      incomingRefUrl: "https://example.com/game",
      forwardedParams: {},
      matchColorSeed: 0,
      paletteName: "sky",
      playerName: "Anthony",
      portalId: EXIT_PORTAL_ID,
      snapshot: {
        speed: 5.4321,
        speedX: 1,
        speedY: -2,
        speedZ: 4,
        rotationX: 0.2,
        rotationY: 1.1,
        rotationZ: 0
      }
    });

    const url = new URL(redirectUrl!);
    expect(url.origin + url.pathname).toBe(VIBE_JAM_PORTAL_URL);
    expect(url.searchParams.get("username")).toBe("Anthony");
    expect(url.searchParams.get("color")).toBe("#8abcf2");
    expect(url.searchParams.get("speed")).toBe("5.432");
    expect(url.searchParams.get("ref")).toBe("https://holdmyegg.com/");
  });

  it("builds return portal redirects back to the incoming ref and preserves optional params", () => {
    const redirectUrl = buildPortalRedirectUrl({
      currentGameUrl: "https://holdmyegg.com/",
      incomingRefUrl: "https://example.com/game?team=blue",
      forwardedParams: {
        team: "blue",
        username: "Previous"
      },
      matchColorSeed: 0,
      paletteName: "gold",
      playerName: "Anthony",
      portalId: RETURN_PORTAL_ID,
      snapshot: {
        speed: 2,
        speedX: 0,
        speedY: 0,
        speedZ: 2,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0
      }
    });

    const url = new URL(redirectUrl!);
    expect(url.origin + url.pathname).toBe("https://example.com/game");
    expect(url.searchParams.get("portal")).toBe("true");
    expect(url.searchParams.get("team")).toBe("blue");
    expect(url.searchParams.get("username")).toBe("Anthony");
    expect(url.searchParams.get("ref")).toBe("https://holdmyegg.com/");
  });

  it("matches named and hex colors to the closest chicken palette", () => {
    expect(resolveIncomingPortalPaletteName("mint")).toBe("mint");
    expect(resolveIncomingPortalPaletteName("#8bc0f0")).toBe("sky");
  });
});
