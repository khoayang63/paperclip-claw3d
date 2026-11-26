import {
  BALCONY_DEPTH_M,
  BUILDING_FLOOR_HEIGHT_M,
  BUILDING_GROUNDS_MARGIN_M,
  WEATHER_FIELD_MIN_XZ,
  WEATHER_FIELD_SPAN_XZ,
  WEATHER_MAX_Y,
  getBalconyBounds,
  getCampusPergolaBounds,
} from "../model/constants";

export interface WeatherRectXZ {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WeatherShelterZone extends WeatherRectXZ {
  topY: number;
}

export interface WeatherVolumeBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  roofTopY: number;
  buildingFootprint: WeatherRectXZ;
  shelterZones: WeatherShelterZone[];
}

export interface WeatherParticleStepResult {
  x: number;
  y: number;
  z: number;
  respawned: boolean;
}

/**
 * Computes outdoor precipitation bounds, solid building exclusion footprint (including roof
 * overhangs), and canopy/balcony/pergola shelter planes for the active floor view.
 */
export function computeWeatherVolumeBounds(params: {
  gridW: number;
  gridD: number;
  floorIndex: number;
  totalFloors: number;
}): WeatherVolumeBounds {
  const { gridW, gridD, floorIndex, totalFloors } = params;
  const minX = -BUILDING_GROUNDS_MARGIN_M;
  const maxX = gridW + BUILDING_GROUNDS_MARGIN_M;
  const minZ = -BUILDING_GROUNDS_MARGIN_M;
  const maxZ = gridD + BUILDING_GROUNDS_MARGIN_M;

  const groundY = -floorIndex * BUILDING_FLOOR_HEIGHT_M - 0.32;
  const minY = groundY + 0.15;
  const safeTotalFloors = Math.max(floorIndex + 1, totalFloors);
  const roofTopY = (safeTotalFloors - floorIndex) * BUILDING_FLOOR_HEIGHT_M + 0.32;
  const maxY = Math.max(WEATHER_MAX_Y, roofTopY + 11.5);

  // Include roof overhang (0.55m) + wall thickness padding so wind drift never clips exterior glass.
  const pad = 0.65;
  const buildingFootprint: WeatherRectXZ = {
    minX: -pad,
    maxX: gridW + pad,
    minZ: -pad,
    maxZ: gridD + pad,
  };

  const shelterZones: WeatherShelterZone[] = [];

  // Ground-floor South entrance canopy
  shelterZones.push({
    minX: gridW / 2 - 2.38,
    maxX: gridW / 2 + 2.38,
    minZ: gridD,
    maxZ: gridD + 1.85,
    topY: groundY + 2.9,
  });

  // East café pergola timber roof
  const pergola = getCampusPergolaBounds(gridW, gridD);
  shelterZones.push({
    minX: pergola.cx - pergola.halfW - 0.18,
    maxX: pergola.cx + pergola.halfW + 0.18,
    minZ: pergola.cz - pergola.halfD - 0.18,
    maxZ: pergola.cz + pergola.halfD + 0.18,
    topY: groundY + 2.95,
  });

  // Upper-floor balconies shelter anything beneath them; if currently on an upper floor,
  // the balcony floor deck itself stops precipitation from falling through its slab.
  const balcony = getBalconyBounds(gridW, gridD);
  for (let f = 1; f < safeTotalFloors; f++) {
    const balconyY = (f - floorIndex) * BUILDING_FLOOR_HEIGHT_M;
    shelterZones.push({
      minX: balcony.minX - 0.14,
      maxX: balcony.maxX + 0.14,
      minZ: gridD,
      maxZ: gridD + BALCONY_DEPTH_M + 0.14,
      topY: balconyY + 0.1,
    });
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    minY,
    maxY,
    roofTopY,
    buildingFootprint,
    shelterZones,
  };
}

export function createDefaultWeatherBounds(): WeatherVolumeBounds {
  return {
    minX: WEATHER_FIELD_MIN_XZ,
    maxX: WEATHER_FIELD_MIN_XZ + WEATHER_FIELD_SPAN_XZ,
    minZ: WEATHER_FIELD_MIN_XZ,
    maxZ: WEATHER_FIELD_MIN_XZ + WEATHER_FIELD_SPAN_XZ,
    minY: 0.15,
    maxY: WEATHER_MAX_Y,
    roofTopY: BUILDING_FLOOR_HEIGHT_M + 0.32,
    buildingFootprint: { minX: -0.65, maxX: 30.65, minZ: -0.65, maxZ: 30.65 },
    shelterZones: [],
  };
}

function inRectXZ(x: number, z: number, rect: WeatherRectXZ): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/**
 * Returns true if horizontal coordinate `(x, z)` lies inside the building or its roof overhang.
 */
export function isInsideBuildingFootprint(
  x: number,
  z: number,
  bounds: WeatherVolumeBounds,
): boolean {
  return inRectXZ(x, z, bounds.buildingFootprint);
}

/**
 * Computes the Y elevation at which a falling rain streak or snowflake collides with
 * the rooftop, a protective canopy/balcony/pergola overhang, or the outdoor ground.
 */
export function computeWeatherStopY(
  x: number,
  z: number,
  bounds: WeatherVolumeBounds,
): number {
  if (isInsideBuildingFootprint(x, z, bounds)) {
    return bounds.roofTopY;
  }

  let stopY = bounds.minY;
  for (const zone of bounds.shelterZones) {
    if (inRectXZ(x, z, zone) && zone.topY > stopY) {
      stopY = zone.topY;
    }
  }
  return stopY;
}

/**
 * Samples a spawn coordinate across the full outdoor grounds (including above the rooftop),
 * ensuring particles never spawn inside the building interior.
 */
export function sampleWeatherSpawnPosition(
  bounds: WeatherVolumeBounds,
  initialFill: boolean,
  rng: () => number = Math.random,
): { x: number; y: number; z: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  let x = bounds.minX + rng() * spanX;
  let z = bounds.minZ + rng() * spanZ;

  // Bias density slightly toward the open yard instead of piling too many particles above the roof.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!isInsideBuildingFootprint(x, z, bounds) || rng() > 0.55) break;
    x = bounds.minX + rng() * spanX;
    z = bounds.minZ + rng() * spanZ;
  }

  const stopY = computeWeatherStopY(x, z, bounds);
  const effectiveMaxY = Math.max(bounds.maxY, stopY + 1.0);
  const y = initialFill
    ? stopY + rng() * (effectiveMaxY - stopY)
    : bounds.maxY - rng() * 0.4;

  return { x, y, z };
}

/**
 * Advances one precipitation particle and respawns it whenever it leaves horizontal bounds
 * or crosses the building roof / exterior wall / canopy plane (preventing interior clipping).
 */
export function stepWeatherParticle(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  bounds: WeatherVolumeBounds,
  rng: () => number = Math.random,
): WeatherParticleStepResult {
  const nx = x + dx;
  const ny = y + dy;
  const nz = z + dz;

  if (
    nx < bounds.minX ||
    nx > bounds.maxX ||
    nz < bounds.minZ ||
    nz > bounds.maxZ ||
    ny <= computeWeatherStopY(nx, nz, bounds)
  ) {
    const respawned = sampleWeatherSpawnPosition(bounds, false, rng);
    return { ...respawned, respawned: true };
  }

  return { x: nx, y: ny, z: nz, respawned: false };
}
