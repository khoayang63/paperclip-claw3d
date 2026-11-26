import type {
  AvatarHairColor,
  AvatarHeadwear,
  AvatarOutfit,
  AvatarSkinConfig,
  AvatarSkinTone,
  EnvironmentConfig,
  FurnitureFootprint,
  FurnitureKind,
  OfficePaletteKey,
} from "./types";

export const OFFICE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_GRID_SIZE: [number, number] = [30, 30];
export const DEFAULT_ELEVATOR_CELL: [number, number] = [14, 1];
export const DEFAULT_MAX_DESKS_PER_FLOOR = 24;
export const CELL_SIZE_METERS = 1;
export const INTERACTION_RADIUS_METERS = 2.0;
export const RUN_ERROR_RECENCY_MS = 10 * 60 * 1000;
export const RECAP_TRIGGER_HOUR = 18;
export const PLAYER_SPEED_MPS = 5.4;
export const PLAYER_SPRINT_MULTIPLIER = 1.68;
export const PLAYER_JUMP_VELOCITY_MPS = 5.4;
export const PLAYER_GRAVITY_MPS2 = 16.5;
export const AGENT_WALK_SPEED_MPS = 2.4;
export const AGENT_URGENT_SPEED_MPS = 3.5;
export const AGENT_ACCEL_MPS2 = 5.5;
export const AGENT_DECEL_DIST_M = 1.25;
export const AGENT_SEPARATION_RADIUS_M = 0.85;
export const AGENT_SEPARATION_STRENGTH = 1.1;
export const WALK_STRIDE_RAD_PER_METER = 3.8;
export const REDUCED_MOTION_CHAR_AMP = 0.55;
export const MAX_VISIBLE_LABELS = 8;
export const MAX_VISIBLE_BUBBLES = 5;
export const HANDOFF_BUBBLE_DURATION_MS = 4500;
export const IDLE_MIN_DWELL_MS = 9000;
export const IDLE_MAX_DWELL_MS = 16000;
export const IDLE_INITIAL_MIN_DWELL_MS = 2500;
export const IDLE_INITIAL_STAGGER_MS = 2200;
export const LOUNGE_DWELL_MS = 9000;
export const POI_MIN_DWELL_MS = 5500;
export const POI_MAX_DWELL_MS = 10500;
export const SOCIAL_CHAT_MIN_DWELL_MS = 5000;
export const SOCIAL_CHAT_MAX_DWELL_MS = 8000;
export const SOCIAL_CHAT_CHANCE = 0.32;
export const HANDOFF_DWELL_MS = 3500;
export const TOP_HUD_SAFE_PX = 68;
export const TROPHY_SUCCEEDED_RUNS_THRESHOLD = 3;
export const CONTROL_PLANE_THROTTLE_MS = 500;
export const MAX_WEATHER_PARTICLES = 1500;
export const MAX_RAIN_STREAKS = 1800;
export const WEATHER_FIELD_MIN_XZ = -24;
export const WEATHER_FIELD_SPAN_XZ = 78;
export const WEATHER_MIN_Y = 0.25;
export const WEATHER_MAX_Y = 17.5;
export const RAIN_DRIFT_X_MPS = 1.4;
export const RAIN_FALL_Y_MPS = 17.5;
export const RAIN_DROPLET_SIZE: readonly [number, number, number] = [0.032, 0.78, 0.032];
export const RAIN_DROPLET_TILT_RAD = -0.11;
export const SNOW_SWAY_X_MPS = 0.48;
export const SNOW_FALL_Y_MPS = 2.2;
export const SNOW_FLAKE_SIZE: readonly [number, number, number] = [0.15, 0.15, 0.15];
export const REDUCED_MOTION_WEATHER_SCALE = 0.2;
export const BUILD_UNDO_HISTORY_LIMIT = 40;
export const HOTBAR_SLOT_COUNT = 6;
export const PLAYER_ACTION_POSE_DURATION_MS = 2200;
export const AGENT_GIFT_PROXIMITY_METERS = 2.6;

export const BLOCKED_GLOBAL_SHORTCUT_KEYS: ReadonlySet<string> = new Set([
  "w",
  "a",
  "s",
  "d",
  "e",
  "f",
  "q",
  "v",
  "c",
  "g",
  "m",
  "r",
  " ",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "/",
  "?",
]);

export const OFFICE_PALETTE_KEYS: readonly OfficePaletteKey[] = [
  "slate",
  "sand",
  "sage",
  "sky",
  "rose",
  "amber",
  "graphite",
];

export const AVATAR_OUTFITS: readonly AvatarOutfit[] = [
  "shirt",
  "hoodie",
  "suit",
  "tshirt",
  "apron",
];

export const AVATAR_HEADWEAR: readonly AvatarHeadwear[] = [
  "none",
  "glasses",
  "sunglasses",
  "headset",
  "hardhat",
  "beanie",
];

export const AVATAR_SKIN_TONES: readonly AvatarSkinTone[] = [
  "tone1",
  "tone2",
  "tone3",
  "tone4",
  "tone5",
];

export const AVATAR_HAIR_COLORS: readonly AvatarHairColor[] = [
  "black",
  "brown",
  "blonde",
  "red",
  "gray",
  "blue",
];

export const BUILDABLE_FURNITURE_KINDS: readonly FurnitureKind[] = [
  "approval_desk",
  "server_rack",
  "hr_reception",
  "routines_clock",
  "artifacts_showcase",
  "whiteboard",
  "coffee_machine",
  "meeting_table",
  "plant",
  "sofa",
  "bookshelf",
  "water_cooler",
  "printer",
  "filing_cabinet",
  "aquarium",
  "arcade_machine",
  "floor_lamp",
  "lounge_table",
  "vending_machine",
  "outdoor_sakura_tree",
  "outdoor_oak_tree",
  "outdoor_pine_tree",
  "outdoor_bench",
  "outdoor_lamp",
  "outdoor_flower_bed",
  "kpi_screen",
];

export const BUILDABLE_PLACEABLE_KINDS: readonly ("desk" | "door" | FurnitureKind)[] = [
  "desk",
  "door",
  ...BUILDABLE_FURNITURE_KINDS,
];

export const OUTDOOR_FURNITURE_KINDS: ReadonlySet<FurnitureKind> = new Set([
  "outdoor_sakura_tree",
  "outdoor_oak_tree",
  "outdoor_pine_tree",
  "outdoor_bench",
  "outdoor_lamp",
  "outdoor_flower_bed",
]);

export type BuildObjectCategory = "indoor_work" | "indoor_decor" | "outdoor";

export const BUILD_CATEGORY_ITEMS: Record<
  BuildObjectCategory,
  readonly ("desk" | "door" | FurnitureKind)[]
> = {
  indoor_work: [
    "desk",
    "door",
    "approval_desk",
    "hr_reception",
    "whiteboard",
    "meeting_table",
    "server_rack",
    "routines_clock",
    "artifacts_showcase",
    "printer",
    "filing_cabinet",
    "kpi_screen",
  ],
  indoor_decor: [
    "sofa",
    "lounge_table",
    "coffee_machine",
    "water_cooler",
    "aquarium",
    "arcade_machine",
    "vending_machine",
    "floor_lamp",
    "bookshelf",
    "plant",
  ],
  outdoor: [
    "outdoor_sakura_tree",
    "outdoor_oak_tree",
    "outdoor_pine_tree",
    "outdoor_bench",
    "outdoor_lamp",
    "outdoor_flower_bed",
  ],
};

export const BLOCKING_FURNITURE_KINDS: ReadonlySet<FurnitureKind> = new Set([
  "approval_desk",
  "server_rack",
  "hr_reception",
  "routines_clock",
  "artifacts_showcase",
  "whiteboard",
  "coffee_machine",
  "meeting_table",
  "plant",
  "sofa",
  "bookshelf",
  "water_cooler",
  "printer",
  "filing_cabinet",
  "aquarium",
  "arcade_machine",
  "floor_lamp",
  "lounge_table",
  "vending_machine",
  "outdoor_sakura_tree",
  "outdoor_oak_tree",
  "outdoor_pine_tree",
  "outdoor_bench",
  "outdoor_lamp",
  "outdoor_flower_bed",
  "kpi_screen",
]);

export const FURNITURE_FOOTPRINTS: Record<FurnitureKind, FurnitureFootprint> = {
  approval_desk: { width: 1.4, depth: 0.8 },
  server_rack: { width: 0.9, depth: 0.9 },
  hr_reception: { width: 1.8, depth: 0.75 },
  routines_clock: { width: 0.65, depth: 0.45 },
  artifacts_showcase: { width: 1.2, depth: 0.6 },
  whiteboard: { width: 1.8, depth: 0.48 },
  coffee_machine: { width: 1.1, depth: 0.7 },
  meeting_table: { width: 2.6, depth: 1.5 },
  plant: { width: 0.65, depth: 0.65 },
  sofa: { width: 1.9, depth: 0.8 },
  bookshelf: { width: 0.92, depth: 0.42 },
  water_cooler: { width: 0.48, depth: 0.48 },
  printer: { width: 0.76, depth: 0.6 },
  filing_cabinet: { width: 0.56, depth: 0.54 },
  aquarium: { width: 1.4, depth: 0.56 },
  arcade_machine: { width: 0.78, depth: 0.72 },
  floor_lamp: { width: 0.52, depth: 0.52 },
  lounge_table: { width: 1.1, depth: 0.65 },
  vending_machine: { width: 0.95, depth: 0.68 },
  outdoor_sakura_tree: { width: 1.4, depth: 1.4 },
  outdoor_oak_tree: { width: 1.4, depth: 1.4 },
  outdoor_pine_tree: { width: 1.2, depth: 1.2 },
  outdoor_bench: { width: 1.5, depth: 0.65 },
  outdoor_lamp: { width: 0.5, depth: 0.5 },
  outdoor_flower_bed: { width: 1.4, depth: 0.9 },
  kpi_screen: { width: 1.85, depth: 0.45 },
};

export const DESK_FOOTPRINT: FurnitureFootprint = { width: 1.28, depth: 0.72 };
export const ELEVATOR_FOOTPRINT: FurnitureFootprint = { width: 1.5, depth: 1.0 };
export const CHARACTER_COLLISION_RADIUS_M = 0.22;
export const DESK_COLLISION_PAD_M = 0.14;
export const NAV_CELL_FOOTPRINT_PAD_M = 0.12;
export const ELEVATOR_DOOR_TRIGGER_RADIUS_M = 2.4;
export const ELEVATOR_DOOR_SLIDE_M = 0.26;

export const BUILDING_FLOOR_HEIGHT_M = 3.4;
export const BUILDING_EXTERIOR_WALL_HEIGHT_M = 3.15;
export const BUILDING_CUTAWAY_WALL_HEIGHT_M = 0.45;
export const BUILDING_WALL_THICKNESS_M = 0.28;
export const BUILDING_GROUNDS_MARGIN_M = 24;

export const ENTRANCE_DOOR_GAP_WIDTH_M = 3.6;
export const ENTRANCE_DOOR_PASSAGE_HALF_WIDTH_M = 1.45;
export const ENTRANCE_DOOR_TRIGGER_RADIUS_M = 3.2;
export const ENTRANCE_DOOR_SLIDE_M = 1.15;
export const OUTDOOR_WALK_MARGIN_M = 18.5;
export const OUTDOOR_GROUND_Y = -0.27;
export const BALCONY_WIDTH_M = 12.0;
export const BALCONY_DEPTH_M = 4.0;
export const BALCONY_RAIL_MARGIN_M = 0.45;

export interface ObstacleBox {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  kind: "tree" | "pillar" | "bench" | "planter" | "fountain" | "pond" | "gazebo" | "table";
}

export interface OutdoorBenchSpec {
  id: string;
  cell: [number, number];
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Computes central South courtyard fountain coordinates [x, z].
 */
export function getCampusFountainCenter(gridW: number, gridD: number): readonly [number, number] {
  return [gridW / 2, gridD + 12.0];
}

/**
 * Computes West garden koi pond bounds in world meters.
 */
export function getCampusPondBounds(
  _gridW: number,
  gridD: number,
): { cx: number; cz: number; halfW: number; halfD: number } {
  return {
    cx: -10.5,
    cz: gridD / 2 + 6.5,
    halfW: 3.8,
    halfD: 2.8,
  };
}

/**
 * Computes East outdoor café pergola bounds in world meters.
 */
export function getCampusPergolaBounds(
  gridW: number,
  gridD: number,
): { cx: number; cz: number; halfW: number; halfD: number } {
  return {
    cx: gridW + 10.0,
    cz: gridD + 5.5,
    halfW: 3.4,
    halfD: 2.6,
  };
}

/**
 * Computes perimeter campus tree trunk coordinates framing the expanded office grounds.
 */
export function getCampusTreeCoords(gridW: number, gridD: number): ReadonlyArray<[number, number]> {
  return [
    [-4.5, -4],
    [gridW + 4.5, -4],
    [-4.5, gridD / 2],
    [gridW + 4.5, gridD / 2],
    [-4.5, gridD + 4.5],
    [gridW + 4.5, gridD + 4.5],
    [gridW / 2 - 6.5, gridD + 8.5],
    [gridW / 2 + 6.5, gridD + 8.5],
    // Outer park grove & sakura corners across the expanded grounds
    [-16.5, -13.5],
    [gridW / 4, -14.5],
    [(gridW * 3) / 4, -14.5],
    [gridW + 16.5, -13.5],
    [-17.5, gridD / 3 - 2],
    [-16.5, gridD + 11.5],
    [gridW + 17.0, gridD / 3 - 2],
    [gridW + 16.5, gridD + 13.0],
    [-11.0, gridD + 15.5],
    [gridW / 2 - 9.0, gridD + 15.5],
    [gridW / 2 + 9.0, gridD + 15.5],
    [gridW + 11.0, gridD + 15.5],
  ];
}

/**
 * Computes walkable grid-aligned courtyard benches along the South plaza and gardens.
 */
export function getCampusBenches(gridW: number, gridD: number): ReadonlyArray<OutdoorBenchSpec> {
  const midX = Math.floor(gridW / 2);
  const pond = getCampusPondBounds(gridW, gridD);
  return [
    { id: "campus-bench-west", cell: [midX - 4, gridD + 5], rotation: 90 },
    { id: "campus-bench-east", cell: [midX + 3, gridD + 5], rotation: 270 },
    { id: "campus-bench-pond", cell: [Math.round(pond.cx), Math.round(pond.cz + 4)], rotation: 180 },
    { id: "campus-bench-fountain", cell: [midX + 4, gridD + 12], rotation: 270 },
  ];
}

/**
 * Computes solid obstacle collision boxes outdoors on the ground floor campus.
 */
export function getCampusObstacleBoxes(gridW: number, gridD: number): ObstacleBox[] {
  const boxes: ObstacleBox[] = [];
  for (const [tx, tz] of getCampusTreeCoords(gridW, gridD)) {
    boxes.push({ cx: tx, cz: tz, halfW: 0.42, halfD: 0.42, kind: "tree" });
  }
  boxes.push(
    { cx: gridW / 2 - 2.0, cz: gridD + 1.6, halfW: 0.22, halfD: 0.22, kind: "pillar" },
    { cx: gridW / 2 + 2.0, cz: gridD + 1.6, halfW: 0.22, halfD: 0.22, kind: "pillar" },
  );
  for (const bench of getCampusBenches(gridW, gridD)) {
    const northSouth = bench.rotation === 0 || bench.rotation === 180;
    boxes.push({
      cx: bench.cell[0] + 0.5,
      cz: bench.cell[1] + 0.5,
      halfW: northSouth ? 0.78 : 0.38,
      halfD: northSouth ? 0.38 : 0.78,
      kind: "bench",
    });
  }
  const [fx, fz] = getCampusFountainCenter(gridW, gridD);
  boxes.push({ cx: fx, cz: fz, halfW: 1.65, halfD: 1.65, kind: "fountain" });

  const pond = getCampusPondBounds(gridW, gridD);
  boxes.push({ cx: pond.cx, cz: pond.cz, halfW: pond.halfW, halfD: pond.halfD, kind: "pond" });

  const pergola = getCampusPergolaBounds(gridW, gridD);
  for (const px of [pergola.cx - pergola.halfW + 0.22, pergola.cx + pergola.halfW - 0.22]) {
    for (const pz of [pergola.cz - pergola.halfD + 0.22, pergola.cz + pergola.halfD - 0.22]) {
      boxes.push({ cx: px, cz: pz, halfW: 0.22, halfD: 0.22, kind: "gazebo" });
    }
  }
  boxes.push(
    { cx: pergola.cx - 1.35, cz: pergola.cz, halfW: 0.65, halfD: 0.65, kind: "table" },
    { cx: pergola.cx + 1.35, cz: pergola.cz, halfW: 0.65, halfD: 0.65, kind: "table" },
  );
  return boxes;
}

/**
 * Computes cantilevered upper-floor South balcony footprint in meters.
 */
export function getBalconyBounds(
  gridW: number,
  gridD: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const halfW = Math.min(BALCONY_WIDTH_M / 2, Math.max(3, gridW / 2 - 1));
  return {
    minX: gridW / 2 - halfW,
    maxX: gridW / 2 + halfW,
    minZ: gridD,
    maxZ: gridD + BALCONY_DEPTH_M,
  };
}

/**
 * Computes walkable grid-aligned lounge bench(es) on upper-floor South balconies.
 */
export function getBalconyBenches(gridW: number, gridD: number): ReadonlyArray<OutdoorBenchSpec> {
  const bounds = getBalconyBounds(gridW, gridD);
  return [
    {
      id: "balcony-bench-east",
      cell: [Math.floor(bounds.maxX - 2.5), gridD + 2],
      rotation: 0,
    },
  ];
}

/**
 * Computes solid obstacle collision boxes on upper-floor balconies (planters + bench).
 */
export function getBalconyObstacleBoxes(gridW: number, gridD: number): ObstacleBox[] {
  const bounds = getBalconyBounds(gridW, gridD);
  const boxes: ObstacleBox[] = [
    { cx: bounds.minX + 0.7, cz: bounds.maxZ - 0.7, halfW: 0.38, halfD: 0.38, kind: "planter" },
    { cx: bounds.maxX - 0.7, cz: bounds.maxZ - 0.7, halfW: 0.38, halfD: 0.38, kind: "planter" },
  ];
  for (const bench of getBalconyBenches(gridW, gridD)) {
    boxes.push({
      cx: bench.cell[0] + 0.5,
      cz: bench.cell[1] + 0.5,
      halfW: 0.78,
      halfD: 0.38,
      kind: "bench",
    });
  }
  return boxes;
}

export const DEFAULT_ENVIRONMENT_CONFIG: EnvironmentConfig = {
  timeMode: "realtime",
  customHour: 11,
  weather: "clear",
  enableNightAutoLights: true,
  enableEndOfDayRecap: true,
  weatherAudioVolume: 0.4,
};

export const DEFAULT_PLAYER_SKIN: AvatarSkinConfig = {
  outfit: "suit",
  headwear: "glasses",
  skinTone: "tone2",
  hairColor: "black",
};

export function officeLayoutStorageKey(companyId: string): string {
  return `paperclip.office3d.layout.v1.${companyId}`;
}

export function agentSkinsStorageKey(companyId: string): string {
  return `paperclip.office3d.agentSkins.v1.${companyId}`;
}

export function playerSkinStorageKey(): string {
  return "paperclip.office3d.playerSkin.v1";
}

export function environmentStorageKey(): string {
  return "paperclip.office3d.environment.v1";
}

export function performanceModeStorageKey(): string {
  return "paperclip.office3d.performanceMode.v1";
}

export function recapDismissedStorageKey(companyId: string, dateStr: string): string {
  return `paperclip.office3d.recapDismissed.${companyId}.${dateStr}`;
}

export function hotbarStorageKey(companyId: string): string {
  return `paperclip.office3d.hotbar.v1.${companyId}`;
}

export function minimapVisibilityStorageKey(companyId: string): string {
  return `paperclip.office3d.minimap.v1.${companyId}`;
}

export function playerStateStorageKey(companyId: string): string {
  return `paperclip.office3d.playerState.v1.${companyId}`;
}

export function arcadeHighScoreStorageKey(companyId: string): string {
  return `paperclip.office3d.arcadeHighScore.v1.${companyId}`;
}
