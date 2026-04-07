import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HudState } from "@out-of-bounds/sim";
import type { RuntimeOverlayState } from "../engine/types";
import { Hud } from "./Hud";

const createHudState = (eggStatus: HudState["eggStatus"]): HudState => ({
  mode: "explore",
  localPlayerId: "human-1",
  localPlayer: {
    id: "human-1",
    name: "You",
    alive: true,
    grounded: true,
    mass: 84,
    maxMass: 300,
    livesRemaining: 3,
    maxLives: 3,
    respawning: false,
    invulnerableRemaining: 0,
    stunRemaining: 0
  },
  eggStatus,
  ranking: [{ id: "human-1", name: "You", alive: true }]
});

const inactiveOverlayState: RuntimeOverlayState = {
  matterPulseActive: false
};

describe("Hud", () => {
  it("shows a blinking egg loading card while egg slots are still cooling down", () => {
    render(
      <Hud
        hudState={createHudState({
          reason: "cooldown",
          hasMatter: true,
          ready: false,
          activeCount: 2,
          maxActiveCount: 2,
          cost: 42,
          cooldownRemaining: 0.8,
          cooldownDuration: 1.6,
          canQuickEgg: false,
          canChargedThrow: false
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("hud-egg-card")).toHaveTextContent("Egg loading");
    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "cooldown");
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByTestId("hud-egg-shell")).toBeInTheDocument();
    expect(screen.getByTestId("hud-egg-meter-fill")).toHaveStyle({ width: "50%" });
  });

  it("shows a steady ready card when eggs can launch again", () => {
    render(
      <Hud
        hudState={createHudState({
          reason: "ready",
          hasMatter: true,
          ready: true,
          activeCount: 0,
          maxActiveCount: 2,
          cost: 42,
          cooldownRemaining: 0,
          cooldownDuration: 1.6,
          canQuickEgg: true,
          canChargedThrow: true
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("hud-egg-card")).toHaveTextContent("Egg ready!");
    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "ready");
    expect(screen.getByText("0 / 2")).toBeInTheDocument();
    expect(screen.getByTestId("hud-egg-meter-fill")).toHaveStyle({ width: "100%" });
  });

  it("keeps the egg card visible with a need matter warning when the player is dry", () => {
    render(
      <Hud
        hudState={createHudState({
          reason: "notEnoughMatter",
          hasMatter: false,
          ready: false,
          activeCount: 0,
          maxActiveCount: 2,
          cost: 42,
          cooldownRemaining: 0,
          cooldownDuration: 1.6,
          canQuickEgg: false,
          canChargedThrow: false
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("hud-egg-card")).toHaveTextContent("Need matter");
    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "notEnoughMatter");
    expect(screen.getByTestId("hud-egg-meter-fill")).toHaveStyle({ width: "100%" });
  });

  it("pulses the matter meter when the runtime overlay flags a no-matter attempt", () => {
    render(
      <Hud
        hudState={createHudState({
          reason: "notEnoughMatter",
          hasMatter: false,
          ready: false,
          activeCount: 0,
          maxActiveCount: 2,
          cost: 42,
          cooldownRemaining: 0,
          cooldownDuration: 1.6,
          canQuickEgg: false,
          canChargedThrow: false
        })}
        mode="explore"
        overlayState={{ matterPulseActive: true }}
      />
    );

    expect(screen.getByTestId("hud-matter-meter")).toHaveClass("hud-meter--pulse");
  });
});
