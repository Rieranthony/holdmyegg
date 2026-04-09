import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HudState } from "@out-of-bounds/sim";
import type { RuntimeOverlayState } from "../engine/types";
import { Hud } from "./Hud";

const defaultLocalPlayer: NonNullable<HudState["localPlayer"]> = {
  id: "human-1",
  name: "You",
  alive: true,
  grounded: true,
  mass: 84,
  maxMass: 500,
  livesRemaining: 3,
  maxLives: 3,
  respawning: false,
  invulnerableRemaining: 0,
  stunRemaining: 0
};

const createHudState = (
  eggStatus: HudState["eggStatus"],
  {
    localPlayer,
    ...overrides
  }: Partial<HudState> & {
    localPlayer?: Partial<NonNullable<HudState["localPlayer"]>>;
  } = {}
): HudState => ({
  mode: "explore",
  localPlayerId: "human-1",
  localPlayer: {
    ...defaultLocalPlayer,
    ...localPlayer
  },
  eggStatus,
  spaceChallenge: null,
  ranking: [{ id: "human-1", name: "You", alive: true }],
  ...overrides
});

const readyEggStatus: HudState["eggStatus"] = {
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
};

const createReadyHudState = (
  overrides: Partial<HudState> & {
    localPlayer?: Partial<NonNullable<HudState["localPlayer"]>>;
  } = {}
) =>
  createHudState(readyEggStatus, overrides);

const createHudStateWithoutEgg = (): HudState => ({
  mode: "explore",
  localPlayerId: "human-1",
  localPlayer: {
    id: "human-1",
    name: "You",
    alive: true,
    grounded: true,
    mass: 84,
    maxMass: 500,
    livesRemaining: 3,
    maxLives: 3,
    respawning: false,
    invulnerableRemaining: 0,
    stunRemaining: 0
  },
  eggStatus: null,
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
  it("can switch from runtime mode to editor mode without breaking hook order", () => {
    const { rerender } = render(
      <Hud
        hudState={createReadyHudState()}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(() =>
      rerender(
        <Hud
          hudState={createReadyHudState()}
          mode="editor"
          overlayState={inactiveOverlayState}
        />
      )
    ).not.toThrow();
  });

  it("can clear a populated hud state without throwing", () => {
    const { rerender } = render(
      <Hud
        hudState={createReadyHudState()}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(() =>
      rerender(
        <Hud
          hudState={null}
          mode="explore"
          overlayState={inactiveOverlayState}
        />
      )
    ).not.toThrow();
  });

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

  it("keeps the space overlay hidden when the default space flow has no challenge armed", () => {
    render(
      <Hud
        hudState={createReadyHudState()}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.queryByTestId("space-typing-overlay")).not.toBeInTheDocument();
    expect(screen.queryByText("MASH THIS KEY")).not.toBeInTheDocument();
    expect(screen.queryByText("TOO SLOW")).not.toBeInTheDocument();
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

    expect(screen.getByTestId("hud-matter")).toHaveClass("hud-matter--pulse");
  });

  it("always renders three feathers and dims the spent ones", () => {
    render(
      <Hud
        hudState={createReadyHudState({
          localPlayer: {
            livesRemaining: 2
          }
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("hud-health").children).toHaveLength(3);
    expect(screen.getByTestId("hud-feather-1")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("hud-feather-2")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("hud-feather-3")).toHaveAttribute("data-state", "spent");
  });

  it("turns the final feather red and blinking at one life", () => {
    render(
      <Hud
        hudState={createReadyHudState({
          localPlayer: {
            livesRemaining: 1
          }
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("hud-feather-1")).toHaveAttribute("data-state", "critical");
    expect(screen.getByTestId("hud-feather-1")).toHaveClass("hud-feather--critical");
    expect(screen.getByTestId("hud-feather-2")).toHaveAttribute("data-state", "spent");
    expect(screen.getByTestId("hud-feather-3")).toHaveAttribute("data-state", "spent");
  });

  it("renders matter as a voxel with a number instead of a meter", () => {
    render(
      <Hud
        hudState={createReadyHudState()}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("hud-matter")).toHaveAttribute("data-state", "normal");
    expect(screen.getByTestId("hud-matter-cube")).toBeInTheDocument();
    expect(screen.getByTestId("hud-matter-amount")).toHaveTextContent("84/500");
    expect(screen.queryByTestId("hud-matter-meter")).not.toBeInTheDocument();
  });

  it("shows the weaker warning state when matter is below egg cost", () => {
    render(
      <Hud
        hudState={createReadyHudState({
          localPlayer: {
            mass: 18
          }
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("hud-matter")).toHaveAttribute("data-state", "warning");
    expect(screen.getByTestId("hud-matter-amount")).toHaveTextContent("18/500");
  });

  it("shows the critical red blink state when matter is empty", () => {
    render(
      <Hud
        hudState={createReadyHudState({
          localPlayer: {
            mass: 0
          }
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.getByTestId("hud-matter")).toHaveAttribute("data-state", "empty");
    expect(screen.getByTestId("hud-matter")).toHaveClass("hud-matter--empty");
    expect(screen.getByTestId("hud-matter-amount")).toHaveTextContent("0/500");
  });

  it("does not show the old mode or idle grounded copy", () => {
    render(
      <Hud
        hudState={createReadyHudState()}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.queryByText("EXPLORE")).not.toBeInTheDocument();
    expect(screen.queryByText("Grounded")).not.toBeInTheDocument();
    expect(screen.queryByText("Airborne")).not.toBeInTheDocument();
  });

  it("bounces the matter cube upward when matter increases", async () => {
    const { rerender } = render(
      <Hud
        hudState={createReadyHudState({
          localPlayer: {
            mass: 84
          }
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    rerender(
      <Hud
        hudState={createReadyHudState({
          localPlayer: {
            mass: 96
          }
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("hud-matter")).toHaveClass("hud-matter--gain");
    });
  });

  it("plays the spend reaction when matter is used", async () => {
    const { rerender } = render(
      <Hud
        hudState={createReadyHudState({
          localPlayer: {
            mass: 84
          }
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    rerender(
      <Hud
        hudState={createReadyHudState({
          localPlayer: {
            mass: 42
          }
        })}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("hud-matter")).toHaveClass("hud-matter--spend");
    });
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

  it("renders the HUD without the egg widget when egg status is unavailable", () => {
    render(
      <Hud
        hudState={createHudStateWithoutEgg()}
        mode="explore"
        overlayState={inactiveOverlayState}
      />
    );

    expect(screen.queryByTestId("hud-egg-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("hud-health")).toBeInTheDocument();
    expect(screen.getByTestId("hud-matter")).toBeInTheDocument();
  });
});
