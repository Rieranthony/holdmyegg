import type {
  EggViewState,
  HudEggStatus,
  LocalEggActionState,
  RuntimePlayerState
} from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getEggSlotAvailability = ({
  localPlayerId,
  localPlayerMass,
  eggs,
  eggCost,
  maxActiveEggsPerPlayer,
  eggFuseDuration
}: {
  localPlayerId: string | null;
  localPlayerMass: number;
  eggs: ReadonlyArray<Pick<EggViewState, "ownerId" | "fuseRemaining">>;
  eggCost: number;
  maxActiveEggsPerPlayer: number;
  eggFuseDuration: number;
}) => {
  if (!localPlayerId) {
    return {
      hasMatter: false,
      hasFreeSlot: false,
      activeCount: 0,
      cooldownRemaining: 0,
      cooldownDuration: eggFuseDuration
    };
  }

  const ownedEggs = eggs.filter((egg) => egg.ownerId === localPlayerId);
  const activeCount = ownedEggs.length;
  const hasMatter = localPlayerMass >= eggCost;
  const hasFreeSlot = activeCount < maxActiveEggsPerPlayer;
  const cooldownRemainingRaw =
    !hasFreeSlot && ownedEggs.length > 0 ? Math.min(...ownedEggs.map((egg) => egg.fuseRemaining)) : 0;
  const cooldownRemaining = clamp(cooldownRemainingRaw, 0, Number.POSITIVE_INFINITY);
  const cooldownDuration = Math.max(eggFuseDuration, cooldownRemaining);

  return {
    hasMatter,
    hasFreeSlot,
    activeCount,
    cooldownRemaining,
    cooldownDuration
  };
};

export const getHudEggStatus = ({
  localPlayerId,
  localPlayerMass,
  eggs,
  eggCost,
  maxActiveEggsPerPlayer,
  eggFuseDuration
}: {
  localPlayerId: string | null;
  localPlayerMass: number;
  eggs: ReadonlyArray<Pick<EggViewState, "ownerId" | "fuseRemaining">>;
  eggCost: number;
  maxActiveEggsPerPlayer: number;
  eggFuseDuration: number;
}): HudEggStatus => {
  const slotAvailability = getEggSlotAvailability({
    localPlayerId,
    localPlayerMass,
    eggs,
    eggCost,
    maxActiveEggsPerPlayer,
    eggFuseDuration
  });

  return {
    hasMatter: slotAvailability.hasMatter,
    ready: slotAvailability.hasMatter && slotAvailability.hasFreeSlot,
    activeCount: slotAvailability.activeCount,
    maxActiveCount: maxActiveEggsPerPlayer,
    cost: eggCost,
    cooldownRemaining: slotAvailability.cooldownRemaining,
    cooldownDuration: slotAvailability.cooldownDuration
  };
};

export const getLocalEggActionState = ({
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
}): LocalEggActionState => {
  const slotAvailability = getEggSlotAvailability({
    localPlayerId,
    localPlayerMass,
    eggs,
    eggCost,
    maxActiveEggsPerPlayer,
    eggFuseDuration
  });

  const stateBlocked =
    !localPlayerId ||
    localPlayer === null ||
    !localPlayer.alive ||
    localPlayer.fallingOut ||
    localPlayer.respawning ||
    localPlayer.stunRemaining > 0 ||
    localPlayer.spacePhase === "reentry";
  const reason = stateBlocked
    ? "stateBlocked"
    : !slotAvailability.hasMatter
      ? "notEnoughMatter"
      : !slotAvailability.hasFreeSlot
        ? "cooldown"
        : "ready";

  return {
    reason,
    hasMatter: slotAvailability.hasMatter,
    cooldownRemaining: slotAvailability.cooldownRemaining,
    cooldownDuration: slotAvailability.cooldownDuration,
    canQuickEgg: reason === "ready",
    canChargedThrow:
      reason === "ready" &&
      localPlayer !== null &&
      localPlayer.alive &&
      !localPlayer.fallingOut &&
      !localPlayer.respawning &&
      localPlayer.grounded &&
      localPlayer.stunRemaining <= 0 &&
      localPlayer.spacePhase !== "float" &&
      localPlayer.spacePhase !== "reentry"
  };
};
