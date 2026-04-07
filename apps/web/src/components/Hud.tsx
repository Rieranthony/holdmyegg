import { useEffect, useState } from "react";
import type { HudState, OutOfBoundsSimulation } from "@out-of-bounds/sim";
import type { RuntimeOverlayState } from "../engine/types";
import type { ActiveMode } from "./GameCanvas";
import { EggIcon } from "./EggIcon";

const getModeLabel = (mode: ActiveMode) => (mode === "playNpc" ? "PLAY NPC" : mode.toUpperCase());

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

  if (left.eggStatus === null || right.eggStatus === null) {
    if (left.eggStatus !== right.eggStatus) {
      return false;
    }
  } else if (
    left.eggStatus.reason !== right.eggStatus.reason ||
    left.eggStatus.hasMatter !== right.eggStatus.hasMatter ||
    left.eggStatus.ready !== right.eggStatus.ready ||
    left.eggStatus.activeCount !== right.eggStatus.activeCount ||
    left.eggStatus.maxActiveCount !== right.eggStatus.maxActiveCount ||
    left.eggStatus.cost !== right.eggStatus.cost ||
    left.eggStatus.cooldownRemaining !== right.eggStatus.cooldownRemaining ||
    left.eggStatus.cooldownDuration !== right.eggStatus.cooldownDuration ||
    left.eggStatus.canQuickEgg !== right.eggStatus.canQuickEgg ||
    left.eggStatus.canChargedThrow !== right.eggStatus.canChargedThrow
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
  mode,
  hudState: externalHudState,
  overlayState = null
}: {
  runtime?: OutOfBoundsSimulation;
  mode: ActiveMode;
  hudState?: HudState | null;
  overlayState?: RuntimeOverlayState | null;
}) {
  const [hudState, setHudState] = useState(() => externalHudState ?? runtime?.getHudState() ?? null);

  useEffect(() => {
    if (externalHudState !== undefined) {
      setHudState(externalHudState);
      return;
    }

    if (!runtime) {
      setHudState(null);
      return;
    }

    if (mode === "editor") {
      return;
    }

    setHudState(runtime.getHudState());
    const interval = window.setInterval(() => {
      const next = runtime.getHudState();
      setHudState((current) => (current && areHudStatesEqual(current, next) ? current : next));
    }, 250);

    return () => window.clearInterval(interval);
  }, [externalHudState, mode, runtime]);

  if (mode === "editor") {
    return null;
  }

  if (!hudState) {
    return null;
  }

  const localPlayer = hudState.localPlayer;
  if (!localPlayer) {
    return null;
  }
  const massWidth = `${(localPlayer.mass / localPlayer.maxMass) * 100}%`;
  const featherText = "^".repeat(localPlayer.livesRemaining).padEnd(localPlayer.maxLives, ".");
  const eggStatus = hudState.eggStatus;
  const statusText = localPlayer.respawning
    ? `Respawning ${Math.max(0, localPlayer.invulnerableRemaining).toFixed(1)}s shield queued`
    : localPlayer.stunRemaining > 0
      ? `Smashed ${localPlayer.stunRemaining.toFixed(1)}s`
      : localPlayer.invulnerableRemaining > 0
        ? `Shielded ${localPlayer.invulnerableRemaining.toFixed(1)}s`
        : localPlayer.grounded
          ? "Grounded"
          : "Airborne";
  const hasRanking = hudState.ranking.length > 1;
  const matterMeterClassName = [
    "meter",
    "hud-meter",
    overlayState?.matterPulseActive ? "hud-meter--pulse" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="hud">
      {eggStatus && (
        <section
          aria-label={eggStatus.reason === "ready" ? "Egg ready" : "Egg unavailable"}
          className={`hud-egg-card hud-egg-card--${eggStatus.reason}`}
          data-state={eggStatus.reason}
          data-testid="hud-egg-card"
        >
          <EggIcon
            className="hud-egg-card__icon"
            testId="hud-egg-icon"
          />
        </section>
      )}
      <section
        aria-label="Player status"
        className="hud-status"
      >
        <div className="hud-status__row hud-status__row--top">
          <span className="hud-kicker">{getModeLabel(mode)}</span>
          <span className="hud-status__text">{statusText}</span>
        </div>
        <div className="hud-status__row">
          <span className="hud-inline-label">Feathers</span>
          <span className="hud-inline-value">{featherText}</span>
          <span className="hud-inline-meta">{localPlayer.livesRemaining} / {localPlayer.maxLives}</span>
        </div>
        <div className="hud-status__row hud-status__row--matter">
          <span className="hud-inline-label">Matter</span>
          <div className={matterMeterClassName} data-testid="hud-matter-meter">
            <div
              className="meter-fill"
              style={{ width: massWidth }}
            />
          </div>
          <span className="hud-inline-meta">{Math.round(localPlayer.mass)} / {Math.round(localPlayer.maxMass)}</span>
        </div>
      </section>
      {hasRanking && (
        <aside
          aria-label="Ranking"
          className="hud-ranking"
        >
          <ol className="ranking-list ranking-list--overlay">
            {hudState.ranking.map((player, index) => (
              <li key={player.id}>
                <span className="ranking-list__position">{index + 1}</span>
                <span className="ranking-list__name">{player.name}</span>
                <span className="ranking-list__state">{player.alive ? "IN" : "OUT"}</span>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}
