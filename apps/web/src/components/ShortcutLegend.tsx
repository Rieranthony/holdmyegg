import { getEggLaunchShortcutLabels } from "../game/eggLaunchControls";

export interface ShortcutBinding {
  action: string;
  detail?: string;
  pauseDetail?: string;
  keys: string[];
}

export type ShortcutLegendVariant = "default" | "compact" | "pause";

export const getRuntimeShortcutBindings = (): ShortcutBinding[] => [
  {
    action: "Look",
    detail: "aim the camera",
    pauseDetail: "mouse aim",
    keys: ["Mouse"],
  },
  {
    action: "Move",
    detail: "run and strafe",
    pauseDetail: "run / strafe",
    keys: ["WASD"],
  },
  {
    action: "Jump / Fly",
    detail: "tap to jump, hold Space after takeoff to fly, tap Space during reentry to recover",
    pauseDetail: "jump, jetpack, recover",
    keys: ["Space"],
  },
  {
    action: "Harvest",
    detail: "click to eat terrain for matter",
    pauseDetail: "eat terrain for matter",
    keys: ["Click"],
  },
  {
    action: "Build",
    detail: "tap F to place a block",
    pauseDetail: "place a block",
    keys: ["F"],
  },
  {
    action: "Launch Eggs",
    detail: "tap E to egg, hold E to throw, costs matter",
    pauseDetail: "tap to lay, hold to throw",
    keys: getEggLaunchShortcutLabels(),
  },
  {
    action: "Push",
    detail: "double tap W, costs matter",
    pauseDetail: "double-tap W",
    keys: ["W W"],
  },
  {
    action: "Pause",
    detail: "unlock the mouse",
    pauseDetail: "unlock cursor",
    keys: ["Esc"],
  },
];

export const getPauseShortcutBindings = (): ShortcutBinding[] =>
  getRuntimeShortcutBindings().filter((binding) => binding.action !== "Pause");

const joinClasses = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(" ");

export function ShortcutKey({ label }: { label: string }) {
  return <kbd className="shortcut-key">{label}</kbd>;
}

export function ShortcutLegend({
  bindings,
  className,
  variant = "default",
}: {
  bindings: ShortcutBinding[];
  className?: string;
  variant?: ShortcutLegendVariant;
}) {
  const isPauseVariant = variant === "pause";

  return (
    <div className={joinClasses("shortcut-legend", `shortcut-legend--${variant}`, className)}>
      {bindings.map((binding) => (
        <div
          className={joinClasses("shortcut-binding", `shortcut-binding--${variant}`)}
          key={binding.action}
        >
          <div className="shortcut-binding__copy">
            <span className="shortcut-binding__action">{binding.action}</span>
            {(isPauseVariant ? binding.pauseDetail ?? binding.detail : binding.detail) ? (
              <span className="shortcut-binding__detail">
                {isPauseVariant ? binding.pauseDetail ?? binding.detail : binding.detail}
              </span>
            ) : null}
          </div>
          <div className="shortcut-binding__keys" aria-label={`${binding.action} shortcut`}>
            {binding.keys.map((key, index) => (
              <span className="shortcut-binding__key-cluster" key={`${binding.action}-${key}`}>
                <ShortcutKey label={key} />
                {isPauseVariant && index < binding.keys.length - 1 ? (
                  <span aria-hidden="true" className="shortcut-binding__plus">
                    +
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
