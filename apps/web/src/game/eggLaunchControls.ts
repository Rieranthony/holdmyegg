const eggLaunchKeyCodes = ["KeyE"] as const;

export const getEggLaunchShortcutLabels = () => ["RMB", "E"];

export const isEggLaunchKeyCode = (code: string) =>
  eggLaunchKeyCodes.includes(code as (typeof eggLaunchKeyCodes)[number]);
