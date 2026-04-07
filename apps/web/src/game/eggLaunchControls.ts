const eggLaunchKeyCodes = ["KeyQ", "KeyR"] as const;

export const getEggLaunchShortcutLabels = () => ["Q", "R"];

export const isEggLaunchKeyCode = (code: string) =>
  eggLaunchKeyCodes.includes(code as (typeof eggLaunchKeyCodes)[number]);
