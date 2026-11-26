import type {
  ComputedLightingState,
  ComputeLighting,
  DayPhase,
  EnvironmentConfig,
  OfficeColorToken,
} from "./types";

interface LightingKeyframe {
  hour: number;
  sunColor: OfficeColorToken;
  sunIntensity: number;
  ambientColor: OfficeColorToken;
  ambientIntensity: number;
  skyTopColor: OfficeColorToken;
  skyHorizonColor: OfficeColorToken;
  fogColor: OfficeColorToken;
}

const KEYFRAMES: readonly LightingKeyframe[] = [
  {
    hour: 0,
    sunColor: "--office-sun-night",
    sunIntensity: 0.3,
    ambientColor: "--office-ambient-night",
    ambientIntensity: 0.42,
    skyTopColor: "--office-sky-night-top",
    skyHorizonColor: "--office-sky-night-horizon",
    fogColor: "--office-fog-night",
  },
  {
    hour: 5.5,
    sunColor: "--office-sun-dawn",
    sunIntensity: 0.65,
    ambientColor: "--office-ambient-dawn",
    ambientIntensity: 0.55,
    skyTopColor: "--office-sky-dawn-top",
    skyHorizonColor: "--office-sky-dawn-horizon",
    fogColor: "--office-fog-dawn",
  },
  {
    hour: 7.5,
    sunColor: "--office-sun-day",
    sunIntensity: 1.15,
    ambientColor: "--office-ambient-day",
    ambientIntensity: 0.72,
    skyTopColor: "--office-sky-day-top",
    skyHorizonColor: "--office-sky-day-horizon",
    fogColor: "--office-fog-day",
  },
  {
    hour: 12,
    sunColor: "--office-sun-day",
    sunIntensity: 1.35,
    ambientColor: "--office-ambient-day",
    ambientIntensity: 0.82,
    skyTopColor: "--office-sky-day-top",
    skyHorizonColor: "--office-sky-day-horizon",
    fogColor: "--office-fog-day",
  },
  {
    hour: 17,
    sunColor: "--office-sun-sunset",
    sunIntensity: 0.9,
    ambientColor: "--office-ambient-sunset",
    ambientIntensity: 0.62,
    skyTopColor: "--office-sky-sunset-top",
    skyHorizonColor: "--office-sky-sunset-horizon",
    fogColor: "--office-fog-sunset",
  },
  {
    hour: 18.5,
    sunColor: "--office-sun-night",
    sunIntensity: 0.35,
    ambientColor: "--office-ambient-night",
    ambientIntensity: 0.45,
    skyTopColor: "--office-sky-night-top",
    skyHorizonColor: "--office-sky-night-horizon",
    fogColor: "--office-fog-night",
  },
  {
    hour: 21,
    sunColor: "--office-sun-night",
    sunIntensity: 0.3,
    ambientColor: "--office-ambient-night",
    ambientIntensity: 0.42,
    skyTopColor: "--office-sky-night-top",
    skyHorizonColor: "--office-sky-night-horizon",
    fogColor: "--office-fog-night",
  },
];

export function normalizeHour(rawHour: number): number {
  if (!Number.isFinite(rawHour)) return 12;
  const wrapped = ((rawHour % 24) + 24) % 24;
  return wrapped;
}

export function resolveDayPhase(hour: number): DayPhase {
  const h = normalizeHour(hour);
  if (h >= 5.5 && h < 7.5) return "dawn";
  if (h >= 7.5 && h < 17) return "day";
  if (h >= 17 && h < 18.5) return "sunset";
  return "night";
}

/**
 * Computes indoor auto-lighting strength [0, 1] from time of day so office lamps
 * warm up smoothly from late dusk (17:30) through early dawn (06:30).
 */
export function computeInteriorLightFactor(rawHour: number): number {
  const hour = normalizeHour(rawHour);
  if (hour >= 18.5 || hour < 5.5) return 1;
  if (hour >= 17.5 && hour < 18.5) return hour - 17.5;
  if (hour >= 5.5 && hour < 6.5) return 1 - (hour - 5.5);
  return 0;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Pure lighting computation for a given decimal hour [0, 24).
 * Uses CSS token identifiers so Three.js resolves theme colors at runtime.
 */
export const computeLighting: ComputeLighting = (rawHour: number): ComputedLightingState => {
  const effectiveHour = normalizeHour(rawHour);
  const phase = resolveDayPhase(effectiveHour);
  const isNight = phase === "night";

  let prev = KEYFRAMES[KEYFRAMES.length - 1]!;
  let next = KEYFRAMES[0]!;
  let span = 24 - prev.hour + next.hour;
  let elapsed = effectiveHour >= prev.hour ? effectiveHour - prev.hour : 24 - prev.hour + effectiveHour;

  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i]!;
    const b = KEYFRAMES[i + 1]!;
    if (effectiveHour >= a.hour && effectiveHour < b.hour) {
      prev = a;
      next = b;
      span = b.hour - a.hour;
      elapsed = effectiveHour - a.hour;
      break;
    }
  }

  const blend = span > 0 ? Math.max(0, Math.min(1, elapsed / span)) : 0;

  // Sun travels east -> overhead -> west between 06:00 and 18:00; moon mirrors overhead at night.
  const sunAngle = ((effectiveHour - 6) / 24) * Math.PI * 2;
  const orbitRadius = 36;
  const sunX = Math.cos(sunAngle) * orbitRadius;
  const rawY = Math.sin(sunAngle) * orbitRadius;
  const sunY = Math.max(10, isNight ? Math.abs(rawY) * 0.75 + 12 : rawY);
  const sunZ = 18;

  const nightFactor = phase === "night" ? 1 : phase === "sunset" ? 0.55 : phase === "dawn" ? 0.35 : 0;
  const interiorLightFactor = computeInteriorLightFactor(effectiveHour);

  return {
    effectiveHour,
    phase,
    isNight,
    sunPosition: [sunX, sunY, sunZ],
    sunColor: blend < 0.5 ? prev.sunColor : next.sunColor,
    sunIntensity: lerpNum(prev.sunIntensity, next.sunIntensity, blend),
    ambientColor: blend < 0.5 ? prev.ambientColor : next.ambientColor,
    ambientIntensity: lerpNum(prev.ambientIntensity, next.ambientIntensity, blend),
    skyTopColor: prev.skyTopColor,
    skyTopColorNext: next.skyTopColor,
    skyHorizonColor: prev.skyHorizonColor,
    skyHorizonColorNext: next.skyHorizonColor,
    fogColor: prev.fogColor,
    fogColorNext: next.fogColor,
    blend,
    screenEmissiveIntensity: lerpNum(0.35, 1.15, Math.max(nightFactor, interiorLightFactor * 0.85)),
    ceilingLampEmissiveIntensity: lerpNum(0.05, 0.95, Math.max(nightFactor, interiorLightFactor)),
    interiorLightFactor,
  };
};

export function resolveEffectiveHour(config: EnvironmentConfig, now: Date = new Date()): number {
  switch (config.timeMode) {
    case "day":
      return 11.5;
    case "sunset":
      return 17.75;
    case "night":
      return 22.0;
    case "custom":
      return normalizeHour(config.customHour);
    case "realtime":
    default:
      return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }
}

export function formatLocalDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
