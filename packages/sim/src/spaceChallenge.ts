const SPACE_CHALLENGE_MIN_LENGTH = 8;
const SPACE_CHALLENGE_MAX_LENGTH = 22;

const curatedPhrases = [
  "i love feet",
  "kiss the void",
  "lick the moon",
  "bite the cosmos",
  "worship the knees",
  "dirty goblin hours",
  "kiss my sneakers",
  "feral ankle lore",
  "chaos needs hugs",
  "bad toes club",
  "thighs fear me",
  "slap the planets",
  "toes of destiny",
  "touch grass never",
  "ego wants kisses",
  "cursed feet chant"
] as const;

const loveTargets = [
  "feet",
  "toes",
  "knees",
  "ankles",
  "thighs",
  "chaos",
  "slime",
  "trouble",
  "sneakers",
  "goblins"
] as const;

const verbs = [
  "lick",
  "bite",
  "kiss",
  "worship",
  "slap",
  "tickle",
  "haunt",
  "tease"
] as const;

const objects = [
  "moon",
  "void",
  "feet",
  "toes",
  "knees",
  "cosmos",
  "goblin",
  "slime",
  "chaos",
  "ankles",
  "planets",
  "sneakers"
] as const;

const adjectives = [
  "cursed",
  "dirty",
  "feral",
  "nasty",
  "sweaty",
  "unholy",
  "chaotic",
  "spicy"
] as const;

const clubs = [
  "club",
  "hours",
  "energy",
  "agenda",
  "lore"
] as const;

const pick = <T>(items: readonly T[], random: () => number) =>
  items[Math.floor(random() * items.length)]!;

export const normalizeSpaceChallengePhrase = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isValidSpaceChallengePhrase = (value: string) => {
  if (value.length < SPACE_CHALLENGE_MIN_LENGTH || value.length > SPACE_CHALLENGE_MAX_LENGTH) {
    return false;
  }

  const words = value.split(" ");
  return words.length >= 2 && words.length <= 4;
};

const createRemixedPhrase = (random: () => number) => {
  const variant = Math.floor(random() * 5);

  switch (variant) {
    case 0:
      return `i love ${pick(loveTargets, random)}`;
    case 1:
      return `${pick(verbs, random)} the ${pick(objects, random)}`;
    case 2:
      return `${pick(adjectives, random)} ${pick(objects, random)} ${pick(clubs, random)}`;
    case 3:
      return `${pick(objects, random)} wants ${pick(objects, random)}`;
    default:
      return `kiss my ${pick(objects, random)}`;
  }
};

export const createSpaceChallengePhrase = ({
  previousPhrase,
  random
}: {
  previousPhrase: string | null;
  random: () => number;
}) => {
  const normalizedPreviousPhrase = previousPhrase ? normalizeSpaceChallengePhrase(previousPhrase) : null;
  const fallback = normalizeSpaceChallengePhrase(curatedPhrases[0]);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const rawCandidate =
      random() < 0.72
        ? pick(curatedPhrases, random)
        : createRemixedPhrase(random);
    const candidate = normalizeSpaceChallengePhrase(rawCandidate);

    if (!isValidSpaceChallengePhrase(candidate)) {
      continue;
    }

    if (candidate === normalizedPreviousPhrase) {
      continue;
    }

    return candidate;
  }

  return normalizedPreviousPhrase === fallback
    ? normalizeSpaceChallengePhrase(curatedPhrases[1] ?? curatedPhrases[0])
    : fallback;
};
