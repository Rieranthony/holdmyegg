import {
  chickenRadioVolumeBounds,
  type ChickenRadioPlaybackState,
  type ChickenRadioStation,
  type ChickenRadioStationId,
} from "../app/chickenRadio";

const joinClasses = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(" ");

interface ChickenRadioOverlayProps {
  expanded: boolean;
  interactive: boolean;
  onSelectStation: (stationId: ChickenRadioStationId) => void;
  onSetExpanded: (expanded: boolean) => void;
  onTogglePlayback: () => void;
  onVolumeChange: (volume: number) => void;
  playbackState: ChickenRadioPlaybackState;
  station: ChickenRadioStation;
  stations: readonly ChickenRadioStation[];
  variant: "menu" | "runtime";
  volume: number;
}

export function ChickenRadioOverlay({
  expanded,
  interactive,
  onSelectStation,
  onSetExpanded,
  onTogglePlayback,
  onVolumeChange,
  playbackState,
  station,
  stations,
  variant,
  volume,
}: ChickenRadioOverlayProps) {
  const isOnAir = playbackState === "playing" || playbackState === "loading";
  const showOptions = variant === "menu";
  const showExpandedPanel = showOptions && expanded && interactive;
  const showTrackTitle = variant === "menu";
  const playButtonDisabled = variant === "runtime" && !interactive;

  return (
    <section
      aria-label="Chicken Radio"
      className={joinClasses(
        "chicken-radio-overlay",
        `chicken-radio-overlay--${variant}`,
        showOptions && expanded ? "chicken-radio-overlay--expanded" : "",
        interactive ? "chicken-radio-overlay--interactive" : "",
      )}
      data-testid={`chicken-radio-${variant}`}
    >
      <div className="chicken-radio-overlay__panel">
        <div className="chicken-radio-overlay__mini">
          <button
            aria-label={
              isOnAir ? "Pause Chicken Radio" : "Play Chicken Radio"
            }
            className={joinClasses(
              "chicken-radio-overlay__play-button",
              isOnAir ? "chicken-radio-overlay__play-button--live" : "",
            )}
            disabled={playButtonDisabled}
            onClick={onTogglePlayback}
            type="button"
          >
            <span
              aria-hidden="true"
              className={joinClasses(
                "chicken-radio-icon",
                isOnAir
                  ? "chicken-radio-icon--pause"
                  : "chicken-radio-icon--play",
              )}
            />
          </button>
          <div className="chicken-radio-overlay__now-playing">
            <span className="chicken-radio-overlay__frequency">
              {station.frequencyLabel}
            </span>
            {showTrackTitle ? (
              <span className="chicken-radio-overlay__track">
                {station.title}
              </span>
            ) : null}
          </div>
          {showOptions ? (
            <button
              aria-label={
                expanded ? "Close Chicken Radio" : "Tune Chicken Radio"
              }
              className="chicken-radio-overlay__toggle"
              disabled={!interactive}
              onClick={() => onSetExpanded(!expanded)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="chicken-radio-icon chicken-radio-icon--more"
              />
            </button>
          ) : null}
        </div>

        {showExpandedPanel ? (
          <div className="chicken-radio-overlay__body">
            <div className="chicken-radio-overlay__header">
              <span className="chicken-radio-overlay__eyebrow">
                PIXEL AIRWAVES
              </span>
              <h2>CHICKEN RADIO</h2>
            </div>

            <div
              aria-label="Chicken Radio Stations"
              className="chicken-radio-overlay__station-list"
              role="group"
            >
              {stations.map((candidate) => {
                const selected = candidate.id === station.id;

                return (
                  <button
                    aria-pressed={selected}
                    className={joinClasses(
                      "chicken-radio-overlay__station",
                      selected ? "chicken-radio-overlay__station--selected" : "",
                    )}
                    key={candidate.id}
                    onClick={() => onSelectStation(candidate.id)}
                    type="button"
                  >
                    <span>{candidate.frequencyLabel}</span>
                    <span>{candidate.title}</span>
                  </button>
                );
              })}
            </div>

            <label className="chicken-radio-overlay__volume">
              <span>VOLUME</span>
              <div className="chicken-radio-overlay__volume-row">
                <input
                  aria-label="Chicken Radio Volume"
                  className="chicken-radio-overlay__slider"
                  max={chickenRadioVolumeBounds.max}
                  min={chickenRadioVolumeBounds.min}
                  onChange={(event) =>
                    onVolumeChange(Number(event.target.value))
                  }
                  step={chickenRadioVolumeBounds.step}
                  type="range"
                  value={volume}
                />
                <span className="chicken-radio-overlay__volume-value">
                  {volume}
                </span>
              </div>
            </label>

            <p className="chicken-radio-overlay__credit">
              Powered by LoFi Girl
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
