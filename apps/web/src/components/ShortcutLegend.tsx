import { detectEggLaunchPlatform, getEggLaunchShortcutLabels } from "../game/eggLaunchControls";

export interface ShortcutBinding {
  action: string;
  detail?: string;
  keys: string[];
}

export type ShortcutLegendVariant = "default" | "compact" | "pause";

export const getRuntimeShortcutBindings = (
  platform = detectEggLaunchPlatform(),
): ShortcutBinding[] => [
  {
    action: "Look",
    detail: "aim the camera",
    keys: ["Mouse"],
  },
  {
    action: "Move",
    detail: "run and strafe",
    keys: ["WASD"],
  },
  {
    action: "Jump / Fly",
    detail: "tap to jump, hold Space after takeoff to fly, tap Space during reentry to recover",
    keys: ["Space"],
  },
  {
    action: "Harvest",
    detail: "break cubes for matter",
    keys: ["LMB"],
  },
  {
    action: "Build",
    detail: "place a cube",
    keys: ["E"],
  },
  {
    action: "Launch Eggs",
    detail: "hold to charge, release to throw, costs matter",
    keys: getEggLaunchShortcutLabels(platform),
  },
  {
    action: "Push",
    detail: "costs matter",
    keys: ["F"],
  },
  {
    action: "Pause",
    detail: "unlock the mouse",
    keys: ["Esc"],
  },
];

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
  return (
    <div className={joinClasses("shortcut-legend", `shortcut-legend--${variant}`, className)}>
      {bindings.map((binding) => (
        <div
          className={joinClasses("shortcut-binding", `shortcut-binding--${variant}`)}
          key={binding.action}
        >
          <div className="shortcut-binding__copy">
            <span className="shortcut-binding__action">{binding.action}</span>
            {binding.detail ? (
              <span className="shortcut-binding__detail">{binding.detail}</span>
            ) : null}
          </div>
          <div className="shortcut-binding__keys" aria-label={`${binding.action} shortcut`}>
            {binding.keys.map((key) => (
              <ShortcutKey key={`${binding.action}-${key}`} label={key} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
