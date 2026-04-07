import {
  createDefaultRuntimeControlSettings,
  normalizeRuntimeControlSettings,
  type RuntimeControlSettings
} from "../game/runtimeControlSettings";

interface StorageLike {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

interface StoredRuntimeControlSettings {
  version: 2;
  settings: RuntimeControlSettings;
}

export const RUNTIME_CONTROL_SETTINGS_STORAGE_KEY =
  "out-of-bounds.runtime-control-settings.v2";
const LEGACY_RUNTIME_CONTROL_SETTINGS_STORAGE_KEY =
  "out-of-bounds.runtime-control-settings.v1";

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

export const loadRuntimeControlSettings = (
  storage?: StorageLike
): RuntimeControlSettings => {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return createDefaultRuntimeControlSettings();
  }

  try {
    const raw = resolvedStorage.getItem(RUNTIME_CONTROL_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredRuntimeControlSettings>;
      if (parsed.version === 2) {
        return normalizeRuntimeControlSettings(parsed.settings);
      }
    }

    const legacyRaw = resolvedStorage.getItem(
      LEGACY_RUNTIME_CONTROL_SETTINGS_STORAGE_KEY
    );
    if (!legacyRaw) {
      return createDefaultRuntimeControlSettings();
    }

    const legacyParsed = JSON.parse(legacyRaw) as Partial<{
      version: 1;
      settings: RuntimeControlSettings;
    }>;
    if (legacyParsed.version !== 1) {
      return createDefaultRuntimeControlSettings();
    }

    const legacySettings = normalizeRuntimeControlSettings(
      legacyParsed.settings
    );
    const migratedSettings = normalizeRuntimeControlSettings({
      ...legacySettings,
      invertLookX: !legacySettings.invertLookX,
      invertLookY: !legacySettings.invertLookY
    });

    saveRuntimeControlSettings(migratedSettings, resolvedStorage);
    resolvedStorage.removeItem(LEGACY_RUNTIME_CONTROL_SETTINGS_STORAGE_KEY);
    return migratedSettings;
  } catch {
    return createDefaultRuntimeControlSettings();
  }
};

export const saveRuntimeControlSettings = (
  settings: RuntimeControlSettings,
  storage?: StorageLike
) => {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  const payload: StoredRuntimeControlSettings = {
    version: 2,
    settings: normalizeRuntimeControlSettings(settings)
  };

  try {
    resolvedStorage.setItem(
      RUNTIME_CONTROL_SETTINGS_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // Ignore storage write failures so controls still work for the current session.
  }
};

export const resetRuntimeControlSettings = (storage?: StorageLike) => {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    resolvedStorage.removeItem(RUNTIME_CONTROL_SETTINGS_STORAGE_KEY);
    resolvedStorage.removeItem(LEGACY_RUNTIME_CONTROL_SETTINGS_STORAGE_KEY);
  } catch {
    // Ignore storage reset failures so the caller can still restore defaults in memory.
  }
};
