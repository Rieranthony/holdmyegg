import {
  createDefaultChickenRadioSettings,
  normalizeChickenRadioSettings,
  type ChickenRadioSettings,
} from "../app/chickenRadio";

interface StorageLike {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

interface StoredChickenRadioSettings {
  version: 1;
  settings: ChickenRadioSettings;
}

export const CHICKEN_RADIO_STORAGE_KEY = "out-of-bounds.chicken-radio.v1";

const getStorage = (storage?: StorageLike) => {
  if (storage) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const loadChickenRadioSettings = (
  storage?: StorageLike,
): ChickenRadioSettings => {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return createDefaultChickenRadioSettings();
  }

  try {
    const raw = resolvedStorage.getItem(CHICKEN_RADIO_STORAGE_KEY);
    if (!raw) {
      return createDefaultChickenRadioSettings();
    }

    const parsed = JSON.parse(raw) as Partial<StoredChickenRadioSettings>;
    if (parsed.version !== 1) {
      return createDefaultChickenRadioSettings();
    }

    return normalizeChickenRadioSettings(parsed.settings);
  } catch {
    return createDefaultChickenRadioSettings();
  }
};

export const saveChickenRadioSettings = (
  settings: ChickenRadioSettings,
  storage?: StorageLike,
) => {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  const payload: StoredChickenRadioSettings = {
    version: 1,
    settings: normalizeChickenRadioSettings(settings),
  };

  try {
    resolvedStorage.setItem(
      CHICKEN_RADIO_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Ignore storage failures so the radio still works for the current session.
  }
};

export const resetChickenRadioSettings = (storage?: StorageLike) => {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    resolvedStorage.removeItem(CHICKEN_RADIO_STORAGE_KEY);
  } catch {
    // Ignore storage failures so callers can still restore defaults in memory.
  }
};
