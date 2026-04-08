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
  spaceChallenge: null,
  ranking: [{ id: "human-1", name: "You", alive: true }]
});

const inactiveOverlayState: RuntimeOverlayState = {
  matterPulseActive: false,
  spaceMistakePulseActive: false,
  spaceSuccessPulseActive: false,
  spaceLocalPhrase: null,
  spaceLocalTypedLength: 0
};

describe("Hud", () => {
  it("renders only the shared egg icon when launch is cooling down", () => {
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

    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "cooldown");
    expect(screen.getByTestId("hud-egg-icon")).toBeInTheDocument();
    expect(screen.queryByText("Egg loading")).not.toBeInTheDocument();
    expect(screen.queryByText("2 / 2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hud-egg-meter-fill")).not.toBeInTheDocument();
  });

  it("shows the same icon at full state when eggs are ready", () => {
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

    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "ready");
    expect(screen.getByTestId("hud-egg-icon")).toBeInTheDocument();
    expect(screen.queryByText("Egg ready!")).not.toBeInTheDocument();
    expect(screen.queryByText("0 / 2")).not.toBeInTheDocument();
  });

  it("keeps the icon visible without labels when the player is dry", () => {
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

    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "notEnoughMatter");
    expect(screen.getByTestId("hud-egg-icon")).toBeInTheDocument();
    expect(screen.queryByText("Need matter")).not.toBeInTheDocument();
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
        overlayState={{ ...inactiveOverlayState, matterPulseActive: true }}
      />
    );

    expect(screen.getByTestId("hud-matter-meter")).toHaveClass("hud-meter--pulse");
  });

  it("renders the top typing strip with optimistic local progress", () => {
    const { container } = render(
      <Hud
        hudState={{
          ...createHudState({
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
          }),
          spaceChallenge: {
            phrase: "go go",
            typedLength: 2,
            phase: "typing"
          }
        }}
        mode="explore"
        overlayState={{
          ...inactiveOverlayState,
          spaceLocalPhrase: "go go",
          spaceLocalTypedLength: 3
        }}
      />
    );

    expect(screen.getByTestId("space-typing-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("space-typing-phrase")).toHaveTextContent("go go");
    expect(container.querySelectorAll('[data-state="done"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-state="current"]')).toHaveLength(1);
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
  });

  it("swaps the phrase strip for the super boom stamp during the dive", () => {
    render(
      <Hud
        hudState={{
          ...createHudState({
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
          }),
          spaceChallenge: {
            phrase: "kiss the moon",
            typedLength: 13,
            phase: "dive"
          }
        }}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("space-typing-stamp")).toHaveTextContent("SUPER BOOM");
    expect(screen.queryByTestId("space-typing-phrase")).not.toBeInTheDocument();
  });
});
