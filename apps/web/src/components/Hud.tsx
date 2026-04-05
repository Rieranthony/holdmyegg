import { useEffect, useState } from "react";
import type { HudState, OutOfBoundsSimulation } from "@out-of-bounds/sim";
import type { ActiveMode } from "./GameCanvas";

const areHudStatesEqual = (left: HudState, right: HudState) => {
  if (left.mode !== right.mode || left.localPlayerId !== right.localPlayerId) {
    return false;
  }

  if (left.localPlayer === null || right.localPlayer === null) {
    if (left.localPlayer !== right.localPlayer) {
      return false;
    }
  } else if (
    left.localPlayer.id !== right.localPlayer.id ||
    left.localPlayer.name !== right.localPlayer.name ||
    left.localPlayer.alive !== right.localPlayer.alive ||
    left.localPlayer.grounded !== right.localPlayer.grounded ||
    left.localPlayer.mass !== right.localPlayer.mass ||
    left.localPlayer.maxMass !== right.localPlayer.maxMass ||
    left.localPlayer.livesRemaining !== right.localPlayer.livesRemaining ||
    left.localPlayer.maxLives !== right.localPlayer.maxLives ||
    left.localPlayer.respawning !== right.localPlayer.respawning ||
    left.localPlayer.invulnerableRemaining !== right.localPlayer.invulnerableRemaining ||
    left.localPlayer.stunRemaining !== right.localPlayer.stunRemaining
  ) {
    return false;
  }

  if (left.ranking.length !== right.ranking.length) {
    return false;
  }

  return left.ranking.every((entry, index) => {
    const other = right.ranking[index];
    return other && entry.id === other.id && entry.name === other.name && entry.alive === other.alive;
  });
};

export function Hud({
  runtime,
  mode
}: {
  runtime: OutOfBoundsSimulation;
  mode: ActiveMode;
}) {
  const [hudState, setHudState] = useState(() => runtime.getHudState());

  useEffect(() => {
    if (mode === "editor") {
      return;
    }

    setHudState(runtime.getHudState());
    const interval = window.setInterval(() => {
      const next = runtime.getHudState();
      setHudState((current) => (areHudStatesEqual(current, next) ? current : next));
    }, 250);

    return () => window.clearInterval(interval);
  }, [mode, runtime]);

  if (mode === "editor") {
    return null;
  }

  const localPlayer = hudState.localPlayer;
  if (!localPlayer) {
    return null;
  }
  const massWidth = `${(localPlayer.mass / localPlayer.maxMass) * 100}%`;
  const featherText = "^".repeat(localPlayer.livesRemaining).padEnd(localPlayer.maxLives, ".");
  const statusText = localPlayer.respawning
    ? `Respawning ${Math.max(0, localPlayer.invulnerableRemaining).toFixed(1)}s shield queued`
    : localPlayer.stunRemaining > 0
      ? `Smashed ${localPlayer.stunRemaining.toFixed(1)}s`
      : localPlayer.invulnerableRemaining > 0
        ? `Shielded ${localPlayer.invulnerableRemaining.toFixed(1)}s`
        : localPlayer.grounded
          ? "Grounded"
          : "Airborne";

  return (
    <div className="hud">
      <div className="hud-card">
        <div className="hud-title-row">
          <span className="hud-kicker">{mode.toUpperCase()}</span>
          <span className="hud-kicker">MASS FLOW</span>
        </div>
        <div className="hud-label">Feathers</div>
        <div className="hud-label-row">
          <span>{featherText}</span>
          <span>{localPlayer.livesRemaining} / {localPlayer.maxLives}</span>
        </div>
        <div className="hud-label">Mass</div>
        <div className="meter">
          <div
            className="meter-fill"
            style={{ width: massWidth }}
          />
        </div>
        <div className="hud-label-row">
          <span>{Math.round(localPlayer.mass)} / {Math.round(localPlayer.maxMass)}</span>
          <span>{statusText}</span>
        </div>
      </div>
      <div className="hud-card hud-card--compact">
        <div className="hud-label">Controls</div>
        <p>Look `Mouse`, move `W/S`, strafe `A/D`, jump `Space`, jetpack `Space` again and hold, harvest `LMB`, build `E`, egg `Q`, push `F`, pause `Esc`.</p>
      </div>
      <div className="hud-card hud-card--compact">
        <div className="hud-label">Ranking</div>
        <ol className="ranking-list">
          {hudState.ranking.map((player) => (
            <li key={player.id}>
              <span>{player.name}</span>
              <span>{player.alive ? "IN" : "OUT"}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
