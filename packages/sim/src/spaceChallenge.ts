const SPACE_CHALLENGE_MIN_REQUIRED_HITS = 10;
const SPACE_CHALLENGE_MAX_REQUIRED_HITS = 15;
const alphabet = "abcdefghijklmnopqrstuvwxyz".split("") as string[];

const normalizeSpaceChallengeKey = (value: string | null) =>
  value && /^[a-z]$/.test(value) ? value : null;

export const createSpaceChallengeTargetKey = ({
  previousKey,
  random
}: {
  previousKey: string | null;
  random: () => number;
}) => {
  const normalizedPreviousKey = normalizeSpaceChallengeKey(previousKey);
  const fallback = "a";

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = alphabet[Math.floor(random() * alphabet.length)] ?? fallback;
    if (candidate !== normalizedPreviousKey) {
      return candidate;
    }
  }

  return normalizedPreviousKey === fallback ? "b" : fallback;
};

export const createSpaceChallengeRequiredHits = (random: () => number) =>
  SPACE_CHALLENGE_MIN_REQUIRED_HITS +
  Math.floor(random() * (SPACE_CHALLENGE_MAX_REQUIRED_HITS - SPACE_CHALLENGE_MIN_REQUIRED_HITS + 1));
