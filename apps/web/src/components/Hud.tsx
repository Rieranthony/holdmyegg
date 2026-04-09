import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HudState, OutOfBoundsSimulation } from "@out-of-bounds/sim";
import type { ActiveMode, RuntimeOverlayState } from "../engine/types";
import { EggIcon } from "./EggIcon";
import { FeatherIcon } from "./FeatherIcon";
import { MatterCubeIcon } from "./MatterCubeIcon";

const hudFeatherSlotCount = 3;
type MatterFeedbackState = "idle" | "gain" | "spend";

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

const useRuntimeHudState = (runtime: OutOfBoundsSimulation | undefined, mode: ActiveMode) => {
  const [hudState, setHudState] = useState<HudState | null>(() =>
    mode === "editor" ? null : runtime?.getHudState() ?? null
  );

  useEffect(() => {
    if (mode === "editor" || !runtime) {
      setHudState(null);
      return;
    }

    const syncHudState = () => {
      const next = runtime.getHudState();
      setHudState((current) => (current && areHudStatesEqual(current, next) ? current : next));
    };

    syncHudState();
    const interval = window.setInterval(syncHudState, 250);
    return () => window.clearInterval(interval);
  }, [mode, runtime]);

  return hudState;
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
  const runtimeHudState = useRuntimeHudState(runtime, mode);
  const hudState =
    mode === "editor"
      ? null
      : externalHudState !== undefined
        ? externalHudState
        : runtimeHudState;

  if (!hudState || hudState.localPlayer === null) {
    return null;
  }

  return (
    <HudContent
      hudState={hudState}
      localPlayer={hudState.localPlayer}
      overlayState={overlayState}
    />
  );
}

function HudContent({
  hudState,
  localPlayer,
  overlayState
}: {
  hudState: HudState;
  localPlayer: NonNullable<HudState["localPlayer"]>;
  overlayState: RuntimeOverlayState | null;
}) {
  const [matterFeedback, setMatterFeedback] = useState<MatterFeedbackState>("idle");
  const previousRoundedMassRef = useRef<number | null>(null);
  const eggStatus = hudState.eggStatus;
  const visibleLives = Math.max(0, Math.min(localPlayer.livesRemaining, hudFeatherSlotCount));
  const roundedMass = Math.max(0, Math.round(localPlayer.mass));
  const roundedMaxMass = Math.max(roundedMass, Math.round(localPlayer.maxMass));
  const isHpCritical = visibleLives === 1;
  const isMatterEmpty = localPlayer.mass <= 0;
  const isMatterWarning = !isMatterEmpty && eggStatus !== null && localPlayer.mass < eggStatus.cost;
  const matterState = isMatterEmpty ? "empty" : isMatterWarning ? "warning" : "normal";
  const matterAmountText = `${roundedMass}/${roundedMaxMass}`;
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
        : null;
  const hasRanking = hudState.ranking.length > 1;
  const matterClassName = [
    "hud-matter",
    `hud-matter--${matterState}`,
    matterFeedback !== "idle" ? `hud-matter--${matterFeedback}` : "",
    overlayState?.matterPulseActive ? "hud-matter--pulse" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const previousRoundedMass = previousRoundedMassRef.current;
    if (previousRoundedMass === null) {
      previousRoundedMassRef.current = roundedMass;
      return;
    }

    if (roundedMass > previousRoundedMass) {
      setMatterFeedback("gain");
    } else if (roundedMass < previousRoundedMass) {
      setMatterFeedback("spend");
    }

    previousRoundedMassRef.current = roundedMass;
  }, [roundedMass]);

  useEffect(() => {
    if (matterFeedback === "idle") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMatterFeedback("idle");
    }, 420);

    return () => window.clearTimeout(timeoutId);
  }, [matterFeedback]);

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
        aria-label="Player vitals"
        className="hud-vitals"
      >
        {statusText && <div className="hud-vitals__captions">
          <span className="hud-vitals__status">{statusText}</span>
        </div>}
        <div className="hud-vitals__cluster">
          <div
            aria-label={`Feathers ${visibleLives} of ${hudFeatherSlotCount}`}
            className="hud-health"
            data-testid="hud-health"
          >
            {Array.from({ length: hudFeatherSlotCount }, (_, index) => {
              const isActive = index < visibleLives;
              const isCritical = isHpCritical && isActive;
              const featherState = isCritical ? "critical" : isActive ? "active" : "spent";

              return (
                <span
                  className={[
                    "hud-feather",
                    isActive ? "hud-feather--active" : "hud-feather--spent",
                    isCritical ? "hud-feather--critical" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-state={featherState}
                  data-testid={`hud-feather-${index + 1}`}
                  key={index}
                >
                  <FeatherIcon
                    className="hud-feather__icon"
                    tone={isCritical ? "critical" : "default"}
                  />
                </span>
              );
            })}
          </div>
          <div
            aria-label={`Matter ${roundedMass} of ${roundedMaxMass}`}
            className={matterClassName}
            data-state={matterState}
            data-testid="hud-matter"
          >
            <span className="hud-matter__voxel-orbit" aria-hidden="true">
              <MatterCubeIcon
                className="hud-matter__cube"
                testId="hud-matter-cube"
              />
              <span className="hud-matter__shard hud-matter__shard--left">
                <MatterCubeIcon className="hud-matter__shard-icon" />
              </span>
              <span className="hud-matter__shard hud-matter__shard--right">
                <MatterCubeIcon className="hud-matter__shard-icon" />
              </span>
              <span className="hud-matter__shadow" />
            </span>
            <span className="hud-matter__copy">
              <span
                className="hud-matter__amount"
                data-testid="hud-matter-amount"
              >
                {matterAmountText}
              </span>
            </span>
          </div>
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
