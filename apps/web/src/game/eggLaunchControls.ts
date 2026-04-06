export type EggLaunchPlatform = "apple" | "other";

const applePlatformPattern = /mac|iphone|ipad|ipod/i;
const appleEggLaunchCodes = ["MetaLeft", "MetaRight"] as const;
const otherEggLaunchCodes = ["ControlLeft", "ControlRight"] as const;
const eggLaunchFallbackCode = "KeyQ";

const getNavigatorPlatformHint = () => {
  if (typeof navigator === "undefined") {
    return "";
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  return (
    navigatorWithUserAgentData.userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent ??
    ""
  );
};

export const detectEggLaunchPlatform = (
  platformHint: string = getNavigatorPlatformHint(),
): EggLaunchPlatform => (applePlatformPattern.test(platformHint) ? "apple" : "other");

export const getEggLaunchShortcutLabels = (
  platform: EggLaunchPlatform = detectEggLaunchPlatform(),
) => (platform === "apple" ? ["Cmd"] : ["Ctrl"]);

export const isEggLaunchKeyCode = (
  code: string,
  platform: EggLaunchPlatform = detectEggLaunchPlatform(),
) =>
  (platform === "apple" ? appleEggLaunchCodes : otherEggLaunchCodes).includes(
    code as (typeof appleEggLaunchCodes)[number] | (typeof otherEggLaunchCodes)[number],
  ) || code === eggLaunchFallbackCode;
