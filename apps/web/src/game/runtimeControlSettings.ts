export interface RuntimeControlSettings {
  lookSensitivity: number;
  invertLookX: boolean;
  invertLookY: boolean;
}

export const runtimeControlSettingsBounds = {
  lookSensitivityMin: 0.2,
  lookSensitivityMax: 2,
  lookSensitivityStep: 0.1
} as const;

export const defaultRuntimeControlSettings: RuntimeControlSettings = {
  lookSensitivity: 1,
  invertLookX: false,
  invertLookY: false
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const clampLookSensitivity = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultRuntimeControlSettings.lookSensitivity;
  }

  const clamped = Math.min(
    runtimeControlSettingsBounds.lookSensitivityMax,
    Math.max(runtimeControlSettingsBounds.lookSensitivityMin, value)
  );
  const rounded =
    Math.round(clamped / runtimeControlSettingsBounds.lookSensitivityStep) *
    runtimeControlSettingsBounds.lookSensitivityStep;

  return Number(rounded.toFixed(2));
};

export const createDefaultRuntimeControlSettings = (): RuntimeControlSettings => ({
  ...defaultRuntimeControlSettings
});

export const normalizeRuntimeControlSettings = (
  value: unknown
): RuntimeControlSettings => {
  const record = isRecord(value) ? value : {};

  return {
    lookSensitivity: clampLookSensitivity(record.lookSensitivity),
    invertLookX:
      typeof record.invertLookX === "boolean"
        ? record.invertLookX
        : defaultRuntimeControlSettings.invertLookX,
    invertLookY:
      typeof record.invertLookY === "boolean"
        ? record.invertLookY
        : defaultRuntimeControlSettings.invertLookY
  };
};
