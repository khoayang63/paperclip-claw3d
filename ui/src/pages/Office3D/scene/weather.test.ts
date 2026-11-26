import { describe, expect, it } from "vitest";
import { BUILDING_GROUNDS_MARGIN_M } from "../model/constants";
import {
  computeWeatherStopY,
  computeWeatherVolumeBounds,
  isInsideBuildingFootprint,
  sampleWeatherSpawnPosition,
  stepWeatherParticle,
} from "./weather";

describe("weather bounds and collision", () => {
  const bounds = computeWeatherVolumeBounds({
    gridW: 30,
    gridD: 30,
    floorIndex: 0,
    totalFloors: 2,
  });

  it("covers the full expanded campus perimeter in XZ", () => {
    expect(bounds.minX).toBe(-BUILDING_GROUNDS_MARGIN_M);
    expect(bounds.maxX).toBe(30 + BUILDING_GROUNDS_MARGIN_M);
    expect(bounds.minZ).toBe(-BUILDING_GROUNDS_MARGIN_M);
    expect(bounds.maxZ).toBe(30 + BUILDING_GROUNDS_MARGIN_M);

    // Particles spawn across every quadrant of the outer yard (NW, NE, SW, SE), not just a corner.
    let hitsNorthWest = false;
    let hitsSouthEast = false;
    for (let i = 0; i < 400; i++) {
      const p = sampleWeatherSpawnPosition(bounds, true);
      expect(p.y).toBeGreaterThanOrEqual(computeWeatherStopY(p.x, p.z, bounds) - 0.001);
      if (p.x < -8 && p.z < -8) hitsNorthWest = true;
      if (p.x > 38 && p.z > 38) hitsSouthEast = true;
    }
    expect(hitsNorthWest).toBe(true);
    expect(hitsSouthEast).toBe(true);
  });

  it("blocks precipitation from ever entering the building interior or clipping horizontally through walls", () => {
    expect(isInsideBuildingFootprint(15, 15, bounds)).toBe(true);
    expect(computeWeatherStopY(15, 15, bounds)).toBe(bounds.roofTopY);

    // Falling just above the roof triggers respawn instead of dropping into Floor 2 or Floor 1
    const overRoof = stepWeatherParticle(15, bounds.roofTopY + 0.05, 15, -0.02, -0.3, 0, bounds);
    expect(overRoof.respawned).toBe(true);
    expect(overRoof.y).toBeGreaterThan(bounds.roofTopY);

    // Wind-drifted raindrop outside the East glass wall that crosses inward below roof height respawns immediately
    const clippedWall = stepWeatherParticle(30.7, 1.5, 15, -0.2, -0.1, 0, bounds);
    expect(clippedWall.respawned).toBe(true);
    expect(clippedWall.y).toBeGreaterThan(bounds.roofTopY);
  });

  it("stops precipitation on the entrance canopy, upper balcony, and East café pergola while letting open-yard rain reach ground level", () => {
    // Under/above the Floor 2 balcony overhang at z = 32.5 -> stops above balcony (height ~3.5)
    expect(computeWeatherStopY(15, 32.5, bounds)).toBeGreaterThan(3.0);

    // East café pergola roof -> stops at pergola height (~2.6)
    expect(computeWeatherStopY(40, 35.5, bounds)).toBeGreaterThan(2.0);

    // Open courtyard far from shelters -> falls cleanly down to ground level (~-0.17)
    expect(computeWeatherStopY(-15, 42, bounds)).toBe(bounds.minY);
    expect(computeWeatherStopY(15, 48, bounds)).toBe(bounds.minY);

    const openYardStep = stepWeatherParticle(-15, 2.0, 42, -0.02, -0.25, 0, bounds);
    expect(openYardStep.respawned).toBe(false);
    expect(openYardStep.y).toBeCloseTo(1.75, 5);
  });
});
