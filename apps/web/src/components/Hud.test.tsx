import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HudState } from "@out-of-bounds/sim";
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

describe("Hud", () => {
  it("shows an egg loading strip while egg slots are still cooling down", () => {
    render(
      <Hud
        hudState={createHudState({
          hasMatter: true,
          ready: false,
          activeCount: 2,
          maxActiveCount: 2,
          cost: 42,
          cooldownRemaining: 0.8,
          cooldownDuration: 1.6
        })}
        mode="explore"
      />
    );

    expect(screen.getByTestId("hud-egg-status")).toHaveTextContent("Egg loading");
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByTestId("hud-egg-meter-fill")).toHaveStyle({ width: "50%" });
  });

  it("shows a full egg strip when eggs are ready again", () => {
    render(
      <Hud
        hudState={createHudState({
          hasMatter: true,
          ready: true,
          activeCount: 0,
          maxActiveCount: 2,
          cost: 42,
          cooldownRemaining: 0,
          cooldownDuration: 1.6
        })}
        mode="explore"
      />
    );

    expect(screen.getByTestId("hud-egg-status")).toHaveTextContent("Egg ready!");
    expect(screen.getByText("0 / 2")).toBeInTheDocument();
    expect(screen.getByTestId("hud-egg-meter-fill")).toHaveStyle({ width: "100%" });
  });

  it("hides the egg strip when the player does not have enough matter", () => {
    render(
      <Hud
        hudState={createHudState({
          hasMatter: false,
          ready: false,
          activeCount: 0,
          maxActiveCount: 2,
          cost: 42,
          cooldownRemaining: 0,
          cooldownDuration: 1.6
        })}
        mode="explore"
      />
    );

    expect(screen.queryByTestId("hud-egg-status")).not.toBeInTheDocument();
  });
});
