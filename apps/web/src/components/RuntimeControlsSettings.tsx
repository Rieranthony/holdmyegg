import {
  runtimeControlSettingsBounds,
  type RuntimeControlSettings
} from "../game/runtimeControlSettings";

const joinClasses = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(" ");

interface RuntimeControlsSettingsProps {
  className?: string;
  helperText?: string;
  onReset: () => void;
  onSettingsChange: (patch: Partial<RuntimeControlSettings>) => void;
  settings: RuntimeControlSettings;
  variant?: "menu" | "pause";
}

export function RuntimeControlsSettings({
  className,
  helperText,
  onReset,
  onSettingsChange,
  settings,
  variant = "menu"
}: RuntimeControlsSettingsProps) {
  return (
    <div
      className={joinClasses(
        "runtime-controls-settings",
        `runtime-controls-settings--${variant}`,
        className
      )}
    >
      <label className="field runtime-controls-settings__field">
        <span>Look Sensitivity</span>
        <div className="runtime-controls-settings__slider-row">
          <input
            aria-label="Look Sensitivity"
            className="runtime-controls-settings__slider"
            max={runtimeControlSettingsBounds.lookSensitivityMax}
            min={runtimeControlSettingsBounds.lookSensitivityMin}
            onChange={(event) =>
              onSettingsChange({
                lookSensitivity: Number(event.target.value)
              })
            }
            step={runtimeControlSettingsBounds.lookSensitivityStep}
            type="range"
            value={settings.lookSensitivity}
          />
          <span className="runtime-controls-settings__value">
            {settings.lookSensitivity.toFixed(1)}x
          </span>
        </div>
      </label>

      <div className="runtime-controls-settings__toggle-grid">
        <label className="runtime-controls-settings__toggle">
          <input
            checked={settings.invertLookX}
            onChange={(event) =>
              onSettingsChange({
                invertLookX: event.target.checked
              })
            }
            type="checkbox"
          />
          <span>Invert X</span>
        </label>

        <label className="runtime-controls-settings__toggle">
          <input
            checked={settings.invertLookY}
            onChange={(event) =>
              onSettingsChange({
                invertLookY: event.target.checked
              })
            }
            type="checkbox"
          />
          <span>Invert Y</span>
        </label>
      </div>

      <div className="runtime-controls-settings__actions">
        <button onClick={onReset} type="button">
          Reset to Defaults
        </button>
      </div>

      {helperText ? (
        <p className="runtime-controls-settings__hint">{helperText}</p>
      ) : null}
    </div>
  );
}
