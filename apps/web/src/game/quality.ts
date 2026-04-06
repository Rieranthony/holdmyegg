import { useEffect, useState } from "react";
import { getGPUTier, type TierResult } from "detect-gpu";

export type QualityTier = "high" | "medium" | "low";

export interface RendererBudgets {
  targetFps: number;
  maxCombatDrawCalls: number;
}

export interface RendererQualityProfile {
  tier: QualityTier;
  antialias: boolean;
  dpr: [number, number];
  decorationDensity: number;
  enableClouds: boolean;
  enableBirds: boolean;
  enableAtmosphereSky: boolean;
  maxImpactBursts: number;
  maxEggDebrisInstances: number;
  avatarDetailDistance: number;
  budgets: RendererBudgets;
  gpu: TierResult | null;
}

const highProfile = (gpu: TierResult | null): RendererQualityProfile => ({
  tier: "high",
  antialias: true,
  dpr: [1, 1.5],
  decorationDensity: 1,
  enableClouds: true,
  enableBirds: true,
  enableAtmosphereSky: true,
  maxImpactBursts: 18,
  maxEggDebrisInstances: 120,
  avatarDetailDistance: 72,
  budgets: {
    targetFps: 120,
    maxCombatDrawCalls: 160
  },
  gpu
});

const mediumProfile = (gpu: TierResult | null): RendererQualityProfile => ({
  tier: "medium",
  antialias: false,
  dpr: [1, 1.25],
  decorationDensity: 0.68,
  enableClouds: true,
  enableBirds: false,
  enableAtmosphereSky: true,
  maxImpactBursts: 12,
  maxEggDebrisInstances: 72,
  avatarDetailDistance: 56,
  budgets: {
    targetFps: 90,
    maxCombatDrawCalls: 120
  },
  gpu
});

const lowProfile = (gpu: TierResult | null): RendererQualityProfile => ({
  tier: "low",
  antialias: false,
  dpr: [1, 1],
  decorationDensity: 0.4,
  enableClouds: false,
  enableBirds: false,
  enableAtmosphereSky: false,
  maxImpactBursts: 8,
  maxEggDebrisInstances: 36,
  avatarDetailDistance: 36,
  budgets: {
    targetFps: 60,
    maxCombatDrawCalls: 90
  },
  gpu
});

const prefersMobileFallback = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const coarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || coarsePointer;
};

const resolveFallbackProfile = () => (prefersMobileFallback() ? lowProfile(null) : mediumProfile(null));

export const resolveQualityProfile = (gpu: TierResult | null): RendererQualityProfile => {
  if (!gpu) {
    return resolveFallbackProfile();
  }

  if (gpu.tier >= 3 && !gpu.isMobile) {
    return highProfile(gpu);
  }

  if (gpu.tier >= 3 || (!gpu.isMobile && gpu.tier >= 2)) {
    return mediumProfile(gpu);
  }

  return lowProfile(gpu);
};

export function useRendererQualityProfile() {
  const [profile, setProfile] = useState<RendererQualityProfile>(() => resolveFallbackProfile());

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const gpu = await getGPUTier();
        if (!cancelled) {
          setProfile(resolveQualityProfile(gpu));
        }
      } catch {
        if (!cancelled) {
          setProfile(resolveFallbackProfile());
        }
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  return profile;
}
