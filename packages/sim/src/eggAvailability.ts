import type { EggViewState, HudEggStatus } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
  if (!localPlayerId) {
    return {
      hasMatter: false,
      ready: false,
      activeCount: 0,
      maxActiveCount: maxActiveEggsPerPlayer,
      cost: eggCost,
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
    ready: hasMatter && hasFreeSlot,
    activeCount,
    maxActiveCount: maxActiveEggsPerPlayer,
    cost: eggCost,
    cooldownRemaining,
    cooldownDuration
  };
};
