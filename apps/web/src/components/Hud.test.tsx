import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HudState } from "@out-of-bounds/sim";
import type { RuntimeOverlayState } from "../engine/types";
import { Hud } from "./Hud";

const createHudState = (): HudState => ({
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
  eggStatus: null,
  ranking: [{ id: "human-1", name: "You", alive: true }]
});

const createOverlayState = (
  overrides: Partial<RuntimeOverlayState> = {}
): RuntimeOverlayState => ({
  eggActionState: {
    reason: "ready",
    hasMatter: true,
    cooldownRemaining: 0,
    cooldownDuration: 1.6,
    canQuickEgg: true,
    canChargedThrow: true
  },
  interactionMode: "normal",
  matterPulseActive: false,
  resourceMessage: null,
  ...overrides
});

describe("Hud", () => {
  it("shows a blinking egg card while eggs are cooling down", () => {
    render(
      <Hud
        hudState={createHudState()}
        mode="explore"
        overlayState={createOverlayState({
          eggActionState: {
            reason: "cooldown",
            hasMatter: true,
            cooldownRemaining: 0.8,
            cooldownDuration: 1.6,
            canQuickEgg: false,
            canChargedThrow: false
          }
        })}
      />
    );

    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "cooldown");
    expect(screen.getByTestId("hud-egg-caption")).toHaveTextContent("Egg loading");
  });

  it("shows the ready caption when the player can lay or throw eggs", () => {
    render(
      <Hud
        hudState={createHudState()}
        mode="explore"
        overlayState={createOverlayState()}
      />
    );

    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "ready");
    expect(screen.getByTestId("hud-egg-caption")).toHaveTextContent(
      "Tap E to lay • Hold E or RMB to throw"
    );
  });

  it("dims the egg card and labels the blocker when matter is missing", () => {
    render(
      <Hud
        hudState={createHudState()}
        mode="explore"
        overlayState={createOverlayState({
          eggActionState: {
            reason: "notEnoughMatter",
            hasMatter: false,
            cooldownRemaining: 0,
            cooldownDuration: 1.6,
            canQuickEgg: false,
            canChargedThrow: false
          }
        })}
      />
    );

    expect(screen.getByTestId("hud-egg-card")).toHaveAttribute("data-state", "notEnoughMatter");
    expect(screen.getByTestId("hud-egg-caption")).toHaveTextContent("Need matter");
  });

  it("shows build mode, pulses the matter meter, and surfaces the chicken feedback message", () => {
    render(
      <Hud
        hudState={createHudState()}
        mode="explore"
        overlayState={createOverlayState({
          interactionMode: "build",
          matterPulseActive: true,
          resourceMessage: "I need more matter"
        })}
      />
    );

    expect(screen.getByTestId("hud-build-badge")).toHaveTextContent("BUILD MODE");
    expect(screen.getByTestId("hud-egg-caption")).toHaveTextContent("BUILD MODE");
    expect(screen.getByTestId("hud-matter-meter")).toHaveClass("hud-meter--pulse");
    expect(screen.getByTestId("hud-resource-message")).toHaveTextContent("I need more matter");
  });
});
