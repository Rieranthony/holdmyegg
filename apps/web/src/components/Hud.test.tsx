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
  spaceFailPulseActive: false,
  spaceMistakePulseActive: false,
  spaceSuccessPulseActive: false,
  spaceLocalTargetKey: null,
  spaceLocalHitCount: 0
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

  it("renders the centered mash challenge with optimistic local progress", () => {
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
            targetKey: "g",
            hits: 2,
            requiredHits: 5,
            phase: "mash"
          }
        }}
        mode="explore"
        overlayState={{
          ...inactiveOverlayState,
          spaceLocalTargetKey: "g",
          spaceLocalHitCount: 3
        }}
      />
    );

    expect(screen.getByTestId("space-typing-overlay")).toBeInTheDocument();
    expect(screen.getByText("MASH THIS KEY")).toBeInTheDocument();
    expect(screen.getByTestId("space-typing-key")).toHaveTextContent("G");
    expect(screen.getByText("BOMB CHARGE")).toBeInTheDocument();
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    expect(screen.getByText("MASH LIKE A GREMLIN")).toBeInTheDocument();
    expect(container.querySelectorAll(".space-typing-overlay__trail-chip")).toHaveLength(5);
  });

  it("adds the harsher arcade mistake state when local typing feedback flags an error", () => {
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
            targetKey: "g",
            hits: 1,
            requiredHits: 5,
            phase: "mash"
          }
        }}
        mode="explore"
        overlayState={{
          ...inactiveOverlayState,
          spaceMistakePulseActive: true,
          spaceLocalTargetKey: "g",
          spaceLocalHitCount: 1
        }}
      />
    );

    expect(screen.getByTestId("space-typing-overlay")).toHaveClass("space-typing-overlay--mistake");
    expect(screen.getByText("WRONG KEY. HIT THE BIG ONE.")).toBeInTheDocument();
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
            targetKey: "g",
            hits: 5,
            requiredHits: 5,
            phase: "dive"
          }
        }}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByText("STAND CLEAR")).toBeInTheDocument();
    expect(screen.getByTestId("space-typing-stamp")).toHaveTextContent("SUPER BOOM");
    expect(screen.getByText("DELIVERY EXPRESS")).toBeInTheDocument();
    expect(screen.queryByTestId("space-typing-key")).not.toBeInTheDocument();
  });

  it("keeps the mash target visible when local success pulses arrive before the authoritative dive", () => {
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
            targetKey: "g",
            hits: 4,
            requiredHits: 5,
            phase: "mash"
          }
        }}
        mode="explore"
        overlayState={{
          ...inactiveOverlayState,
          spaceSuccessPulseActive: true,
          spaceLocalTargetKey: "g",
          spaceLocalHitCount: 5
        }}
      />
    );

    expect(screen.queryByTestId("space-typing-stamp")).not.toBeInTheDocument();
    expect(screen.getByTestId("space-typing-key")).toHaveTextContent("G");
  });

  it("shows a fail flash after the mash challenge is missed", () => {
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
        overlayState={{
          ...inactiveOverlayState,
          spaceFailPulseActive: true
        }}
      />
    );

    expect(screen.getByTestId("space-typing-fail")).toHaveTextContent("MISS");
    expect(screen.getByText("TOO SLOW")).toBeInTheDocument();
  });
});
