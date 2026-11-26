import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENT_CONFIG } from "./constants";
import {
  computeInteriorLightFactor,
  computeLighting,
  normalizeHour,
  resolveEffectiveHour,
} from "./lighting";

describe("computeLighting", () => {
  it("classifies all 4 day phases and boundary hours accurately", () => {
    expect(computeLighting(0).phase).toBe("night");
    expect(computeLighting(0).isNight).toBe(true);

    expect(computeLighting(5.5).phase).toBe("dawn");
    expect(computeLighting(5.5).isNight).toBe(false);

    expect(computeLighting(7.5).phase).toBe("day");
    expect(computeLighting(12).phase).toBe("day");

    expect(computeLighting(17).phase).toBe("sunset");
    expect(computeLighting(18.5).phase).toBe("night");
    expect(computeLighting(23.95).phase).toBe("night");
  });

  it("wraps negative and >=24 hours cleanly around midnight", () => {
    expect(normalizeHour(-1)).toBe(23);
    expect(normalizeHour(25.5)).toBe(1.5);
    expect(normalizeHour(Number.NaN)).toBe(12);

    const lateNight = computeLighting(23.95);
    const earlyMorning = computeLighting(0.05);
    expect(lateNight.phase).toBe("night");
    expect(earlyMorning.phase).toBe("night");
    expect(Math.abs(lateNight.sunIntensity - earlyMorning.sunIntensity)).toBeLessThan(0.1);
  });

  it("raises screen and ceiling lamp emissive intensity at night", () => {
    const noon = computeLighting(12);
    const midnight = computeLighting(23);
    expect(midnight.screenEmissiveIntensity).toBeGreaterThan(noon.screenEmissiveIntensity);
    expect(midnight.ceilingLampEmissiveIntensity).toBeGreaterThan(noon.ceilingLampEmissiveIntensity);
  });

  it("ramps interior auto-lighting from dusk (17:30) through night and fades out at dawn", () => {
    expect(computeInteriorLightFactor(12)).toBe(0);
    expect(computeInteriorLightFactor(17.5)).toBe(0);
    expect(computeInteriorLightFactor(18.0)).toBeCloseTo(0.5, 2);
    expect(computeInteriorLightFactor(18.43)).toBeGreaterThan(0.9);
    expect(computeInteriorLightFactor(22.0)).toBe(1);
    expect(computeInteriorLightFactor(2.0)).toBe(1);
    expect(computeInteriorLightFactor(6.0)).toBeCloseTo(0.5, 2);
    expect(computeInteriorLightFactor(7.0)).toBe(0);
    expect(computeLighting(18.43).interiorLightFactor).toBeGreaterThan(0.9);
  });
});

describe("resolveEffectiveHour", () => {
  it("resolves all 5 EnvironmentTimeMode presets and realtime clock", () => {
    const sampleDate = new Date(2026, 10, 24, 15, 30, 0);
    expect(resolveEffectiveHour({ ...DEFAULT_ENVIRONMENT_CONFIG, timeMode: "realtime" }, sampleDate)).toBeCloseTo(15.5, 2);
    expect(resolveEffectiveHour({ ...DEFAULT_ENVIRONMENT_CONFIG, timeMode: "day" }, sampleDate)).toBe(11.5);
    expect(resolveEffectiveHour({ ...DEFAULT_ENVIRONMENT_CONFIG, timeMode: "sunset" }, sampleDate)).toBe(17.75);
    expect(resolveEffectiveHour({ ...DEFAULT_ENVIRONMENT_CONFIG, timeMode: "night" }, sampleDate)).toBe(22);
    expect(resolveEffectiveHour({ ...DEFAULT_ENVIRONMENT_CONFIG, timeMode: "custom", customHour: 6.25 }, sampleDate)).toBe(6.25);
  });
});
