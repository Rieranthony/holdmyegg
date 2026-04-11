export type ChickenRadioStationId = "synthwave" | "lofi" | "gentle-rain";

export interface ChickenRadioStation {
  id: ChickenRadioStationId;
  frequencyLabel: string;
  title: string;
  videoId: string;
  sourceUrl: string;
}

export type ChickenRadioPlaybackPreference = "play" | "pause";

export type ChickenRadioPlaybackState =
  | "loading"
  | "playing"
  | "paused"
  | "blocked";

export interface ChickenRadioSettings {
  stationId: ChickenRadioStationId;
  volume: number;
  playbackPreference: ChickenRadioPlaybackPreference;
}

export const chickenRadioVolumeBounds = {
  min: 0,
  max: 100,
  step: 1,
} as const;

export const chickenRadioStations: readonly ChickenRadioStation[] = [
  {
    id: "synthwave",
    frequencyLabel: "88.7 SYNTHWAVE",
    title: "SYNTHWAVE",
    videoId: "4xDzrJKXOOY",
    sourceUrl: "https://www.youtube.com/live/4xDzrJKXOOY?si=TJ_8yfn-wSn2U1Kk",
  },
  {
    id: "lofi",
    frequencyLabel: "90.5 LOFI",
    title: "LOFI",
    videoId: "jfKfPfyJRdk",
    sourceUrl: "https://www.youtube.com/live/jfKfPfyJRdk?si=IYYnneQPpTQbTJO_",
  },
  {
    id: "gentle-rain",
    frequencyLabel: "94.3 GENTLE RAIN",
    title: "GENTLE RAIN",
    videoId: "-OekvEFm1lo",
    sourceUrl: "https://www.youtube.com/watch?v=-OekvEFm1lo",
  },
] as const;

export const defaultChickenRadioSettings: ChickenRadioSettings = {
  stationId: "lofi",
  volume: 35,
  playbackPreference: "play",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isChickenRadioStationId = (
  value: unknown,
): value is ChickenRadioStationId =>
  chickenRadioStations.some((station) => station.id === value);

const clampVolume = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultChickenRadioSettings.volume;
  }

  const clamped = Math.min(
    chickenRadioVolumeBounds.max,
    Math.max(chickenRadioVolumeBounds.min, value),
  );

  return Math.round(clamped);
};

export const createDefaultChickenRadioSettings =
  (): ChickenRadioSettings => ({
    ...defaultChickenRadioSettings,
  });

export const normalizeChickenRadioSettings = (
  value: unknown,
): ChickenRadioSettings => {
  const record = isRecord(value) ? value : {};

  return {
    stationId: isChickenRadioStationId(record.stationId)
      ? record.stationId
      : defaultChickenRadioSettings.stationId,
    volume: clampVolume(record.volume),
    playbackPreference:
      record.playbackPreference === "pause" ||
      record.playbackPreference === "play"
        ? record.playbackPreference
        : defaultChickenRadioSettings.playbackPreference,
  };
};

export const getChickenRadioStation = (
  stationId: ChickenRadioStationId,
): ChickenRadioStation =>
  chickenRadioStations.find((station) => station.id === stationId) ??
  chickenRadioStations[1]!;
