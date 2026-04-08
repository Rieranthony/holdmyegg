import { useEffect, useState, type CSSProperties } from "react";
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

  if (left.spaceChallenge === null || right.spaceChallenge === null) {
    if (left.spaceChallenge !== right.spaceChallenge) {
      return false;
    }
  } else if (
    left.spaceChallenge.targetKey !== right.spaceChallenge.targetKey ||
    left.spaceChallenge.hits !== right.spaceChallenge.hits ||
    left.spaceChallenge.requiredHits !== right.spaceChallenge.requiredHits ||
    left.spaceChallenge.phase !== right.spaceChallenge.phase
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
  const spaceChallenge = hudState.spaceChallenge;
  const hitCount =
    spaceChallenge && overlayState?.spaceLocalTargetKey === spaceChallenge.targetKey
      ? Math.max(spaceChallenge.hits, overlayState.spaceLocalHitCount)
      : spaceChallenge?.hits ?? 0;
  const progressRatio =
    spaceChallenge === null ? 0 : hitCount / Math.max(1, spaceChallenge.requiredHits);
  const showSuperBoomStamp = spaceChallenge?.phase === "dive";
  const showFailFlash = spaceChallenge === null && overlayState?.spaceFailPulseActive;
  const challengeChargeLabel =
    progressRatio >= 0.92
      ? "LOCKED IN"
      : progressRatio >= 0.58
        ? "BOMB CHARGE"
        : "ARM THE BOOM";
  const challengeHelperCopy =
    overlayState?.spaceMistakePulseActive
      ? "WRONG KEY. HIT THE BIG ONE."
      : overlayState?.spaceSuccessPulseActive
        ? "KEEP POUNDING IT"
        : progressRatio >= 0.66
          ? "GO FASTER"
          : "MASH LIKE A GREMLIN";
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
      {(spaceChallenge || showFailFlash) && (
        <div
          className={[
            "space-typing-overlay",
            overlayState?.spaceFailPulseActive ? "space-typing-overlay--fail" : "",
            overlayState?.spaceMistakePulseActive ? "space-typing-overlay--mistake" : "",
            overlayState?.spaceSuccessPulseActive ? "space-typing-overlay--success" : "",
            progressRatio >= 0.66 ? "space-typing-overlay--charged" : "",
            showSuperBoomStamp ? "space-typing-overlay--dive" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid="space-typing-overlay"
          style={
            {
              "--space-charge": progressRatio.toFixed(3)
            } as CSSProperties
          }
        >
          {showSuperBoomStamp ? (
            <>
              <div className="space-typing-overlay__lead space-typing-overlay__lead--dive">
                STAND CLEAR
              </div>
              <div
                className="space-typing-overlay__stamp"
                data-testid="space-typing-stamp"
              >
                SUPER BOOM
              </div>
              <div className="space-typing-overlay__helper space-typing-overlay__helper--dive">
                DELIVERY EXPRESS
              </div>
            </>
          ) : showFailFlash ? (
            <>
              <div className="space-typing-overlay__lead space-typing-overlay__lead--fail">
                TOO SLOW
              </div>
              <div
                className="space-typing-overlay__stamp space-typing-overlay__stamp--fail"
                data-testid="space-typing-fail"
              >
                MISS
              </div>
              <div className="space-typing-overlay__helper space-typing-overlay__helper--fail">
                BACK TO EARTH
              </div>
            </>
          ) : (
            <>
              <div className="space-typing-overlay__lead">MASH THIS KEY</div>
              <div className="space-typing-overlay__hero">
                <div
                  className="space-typing-overlay__key"
                  data-testid="space-typing-key"
                >
                  <span className="space-typing-overlay__key-main">
                    {spaceChallenge?.targetKey.toUpperCase()}
                  </span>
                  <span className="space-typing-overlay__key-glow" aria-hidden="true">
                    {spaceChallenge?.targetKey.toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="space-typing-overlay__trail" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <span className="space-typing-overlay__trail-chip" key={`${spaceChallenge?.targetKey ?? "?"}-${index}`}>
                    {spaceChallenge?.targetKey.toUpperCase()}
                  </span>
                ))}
              </div>
              <div className="space-typing-overlay__progress">
                <span className="space-typing-overlay__progress-label">{challengeChargeLabel}</span>
                <span className="space-typing-overlay__progress-value">
                  {hitCount} / {spaceChallenge?.requiredHits}
                </span>
              </div>
              <div
                className="space-typing-overlay__meter"
                data-testid="space-typing-meter"
              >
                <span className="space-typing-overlay__meter-fill" style={{ width: `${progressRatio * 100}%` }} />
              </div>
              <div className="space-typing-overlay__meta">ARM THE BOOM</div>
              <div className="space-typing-overlay__helper">{challengeHelperCopy}</div>
              <div className="space-typing-overlay__footer">
                <span className="space-typing-overlay__footer-text">PUNCH THE LETTER UNTIL THE CHICKEN DROPS</span>
                <span className="space-typing-overlay__footer-key">
                  {spaceChallenge?.targetKey.toUpperCase()}
                </span>
              </div>
            </>
          )}
        </div>
      )}
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
