import type {
  EggViewState,
  HudEggStatus,
  RuntimePlayerState
} from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const getHudEggStatus = ({
  localPlayerId,
  localPlayerMass,
  localPlayer,
  eggs,
  eggCost,
  maxActiveEggsPerPlayer,
  eggFuseDuration
}: {
  localPlayerId: string | null;
  localPlayerMass: number;
  localPlayer:
    | Pick<
        RuntimePlayerState,
        "alive" | "fallingOut" | "grounded" | "respawning" | "spacePhase" | "stunRemaining"
      >
    | null;
  eggs: ReadonlyArray<Pick<EggViewState, "ownerId" | "fuseRemaining">>;
  eggCost: number;
  maxActiveEggsPerPlayer: number;
  eggFuseDuration: number;
}): HudEggStatus => {
  if (!localPlayerId) {
    return {
      reason: "stateBlocked",
      hasMatter: false,
      ready: false,
      activeCount: 0,
      maxActiveCount: maxActiveEggsPerPlayer,
      cost: eggCost,
      cooldownRemaining: 0,
      cooldownDuration: eggFuseDuration,
      canQuickEgg: false,
      canChargedThrow: false
    };
  }

  const ownedEggs = eggs.filter((egg) => egg.ownerId === localPlayerId);
  const activeCount = ownedEggs.length;
  const hasMatter = localPlayerMass >= eggCost;
  const hasFreeSlot = activeCount < maxActiveEggsPerPlayer;
  const stateBlocked =
    !localPlayer ||
    !localPlayer.alive ||
    localPlayer.fallingOut ||
    localPlayer.respawning ||
    localPlayer.stunRemaining > 0 ||
    localPlayer.spacePhase === "reentry";
  const cooldownRemainingRaw =
    !hasFreeSlot && ownedEggs.length > 0 ? Math.min(...ownedEggs.map((egg) => egg.fuseRemaining)) : 0;
  const cooldownRemaining = clamp(cooldownRemainingRaw, 0, Number.POSITIVE_INFINITY);
  const cooldownDuration = Math.max(eggFuseDuration, cooldownRemaining);
  const canQuickEgg = !stateBlocked && hasMatter && hasFreeSlot;
  const canChargedThrow =
    canQuickEgg &&
    localPlayer !== null &&
    localPlayer.grounded &&
    localPlayer.spacePhase !== "float" &&
    localPlayer.spacePhase !== "reentry";
  const reason = !hasMatter
    ? "notEnoughMatter"
    : !hasFreeSlot
      ? "cooldown"
      : stateBlocked
        ? "stateBlocked"
        : "ready";

  return {
    reason,
    hasMatter,
    ready: canQuickEgg,
    activeCount,
    maxActiveCount: maxActiveEggsPerPlayer,
    cost: eggCost,
    cooldownRemaining,
    cooldownDuration,
    canQuickEgg,
    canChargedThrow
  };
};
