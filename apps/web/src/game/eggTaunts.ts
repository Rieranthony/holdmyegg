export const eggTauntDurationSeconds = 1.6;

export const eggTauntMessages = [
  "Don't be a human.",
  "Human detected.",
  "Peak human behavior.",
  "Human, please.",
  "Bad look, human.",
  "Not very evolved.",
  "Stay humble, mammal.",
  "Skill issue, biped.",
  "That's a human move.",
  "Run, human, run.",
  "Touch grass, human.",
  "Wrong bird, pal.",
  "Catch this omen.",
  "Eat shell.",
  "Free-range violence.",
  "Coop sent me.",
  "This one's personal.",
  "Tiny bomb. Big lesson.",
  "Stay nervous.",
  "No notes. Just damage.",
  "That's your warning.",
  "Cope and scatter.",
  "Problem delivered.",
  "Bad day to blink.",
  "Here's your receipt.",
  "Wrong place. Wrong egg.",
  "Egg on your face.",
  "The yolk's on you.",
  "Egg now. Cry later.",
  "Hold my egg.",
  "You had that coming.",
  "Behold: consequences.",
  "Walk it off, primate.",
  "You're brunch now.",
  "Born to throw.",
  "Bad egg energy."
] as const;

const eggTauntOrderCache = new Map<string, readonly string[]>();

const normalizeSeed = (seed: number | string) => String(seed);

const hashSeed = (seed: string) => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const createTauntOrder = (seed: string) => {
  const messages = [...eggTauntMessages];
  const random = createSeededRandom(hashSeed(seed));

  for (let index = messages.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [messages[index], messages[swapIndex]] = [messages[swapIndex]!, messages[index]!];
  }

  return messages;
};

const getTauntOrder = (seed: number | string) => {
  const normalizedSeed = normalizeSeed(seed);
  const cached = eggTauntOrderCache.get(normalizedSeed);
  if (cached) {
    return cached;
  }

  const nextOrder = createTauntOrder(normalizedSeed);
  eggTauntOrderCache.set(normalizedSeed, nextOrder);
  return nextOrder;
};

export const getEggTauntMessage = (seed: number | string, sequence: number) => {
  if (!Number.isFinite(sequence) || sequence <= 0) {
    return null;
  }

  const order = getTauntOrder(seed);
  return order[(Math.floor(sequence) - 1) % order.length] ?? null;
};
