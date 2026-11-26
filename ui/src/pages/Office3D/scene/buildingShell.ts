import * as THREE from "three";
import {
  BALCONY_DEPTH_M,
  BUILDING_CUTAWAY_WALL_HEIGHT_M,
  BUILDING_EXTERIOR_WALL_HEIGHT_M,
  BUILDING_FLOOR_HEIGHT_M,
  BUILDING_GROUNDS_MARGIN_M,
  BUILDING_WALL_THICKNESS_M,
  ENTRANCE_DOOR_GAP_WIDTH_M,
  ENTRANCE_DOOR_SLIDE_M,
  ENTRANCE_DOOR_TRIGGER_RADIUS_M,
  getBalconyBenches,
  getBalconyBounds,
  getCampusBenches,
  getCampusFountainCenter,
  getCampusPergolaBounds,
  getCampusPondBounds,
  getCampusTreeCoords,
} from "../model/constants";
import type { BuildingViewMode } from "../model/types";
import type { OfficePalette } from "./palette";

export interface BuildingShellParams {
  gridW: number;
  gridD: number;
  floorIndex: number;
  totalFloors: number;
  elevatorCell: [number, number] | null;
  palette: OfficePalette;
}

export interface BuildingShellHandle {
  root: THREE.Group;
  updateView: (
    cameraPos: THREE.Vector3,
    mode: BuildingViewMode,
    playerPos?: { x: number; z: number },
  ) => void;
  updateEntranceDoors: (dt: number, actorPositions: ReadonlyArray<{ x: number; z: number }>) => void;
  setNightLights: (level: boolean | number) => void;
}

export interface CutawayVisibility {
  cutNorth: boolean;
  cutSouth: boolean;
  cutWest: boolean;
  cutEast: boolean;
  showInteriorCeiling: boolean;
  showUpperFloors: boolean;
  showFullRoof: boolean;
}

/**
 * Resolves perimeter wall cutaway and ceiling visibility based on camera position
 * and whether the player has stepped outdoors onto the campus or balcony.
 */
export function computeCutawayVisibility(
  cameraPos: { x: number; y: number; z: number },
  gridW: number,
  gridD: number,
  mode: BuildingViewMode,
  hasUpperFloors: boolean,
  playerPos?: { x: number; z: number },
): CutawayVisibility {
  const playerOutside = playerPos
    ? playerPos.x < -0.25 ||
      playerPos.x > gridW + 0.25 ||
      playerPos.z < -0.25 ||
      playerPos.z > gridD + 0.45
    : false;

  if (mode === "full" || playerOutside) {
    return {
      cutNorth: false,
      cutSouth: false,
      cutWest: false,
      cutEast: false,
      showInteriorCeiling: false,
      showUpperFloors: hasUpperFloors,
      showFullRoof: true,
    };
  }

  const margin = 0.25;
  const interiorMaxY = BUILDING_EXTERIOR_WALL_HEIGHT_M + 1.1;
  const insideX = cameraPos.x >= margin && cameraPos.x <= gridW - margin;
  const insideZ = cameraPos.z >= margin && cameraPos.z <= gridD - margin;

  if (insideX && insideZ && cameraPos.y <= interiorMaxY) {
    return {
      cutNorth: false,
      cutSouth: false,
      cutWest: false,
      cutEast: false,
      showInteriorCeiling: true,
      showUpperFloors: false,
      showFullRoof: false,
    };
  }

  if (cameraPos.y <= interiorMaxY) {
    return {
      cutNorth: cameraPos.z < margin,
      cutSouth: cameraPos.z > gridD - margin,
      cutWest: cameraPos.x < margin,
      cutEast: cameraPos.x > gridW - margin,
      showInteriorCeiling: false,
      showUpperFloors: false,
      showFullRoof: false,
    };
  }

  const dx = cameraPos.x - gridW / 2;
  const dz = cameraPos.z - gridD / 2;
  return {
    cutNorth: dz < -0.5,
    cutSouth: dz > 0.5,
    cutWest: dx < -0.5,
    cutEast: dx > 0.5,
    showInteriorCeiling: false,
    showUpperFloors: false,
    showFullRoof: false,
  };
}

interface CutawaySide {
  fullGroup: THREE.Group;
  lowGroup: THREE.Group;
  slidingDoors?: {
    left: THREE.Mesh;
    right: THREE.Mesh;
    closedLeftX: number;
    closedRightX: number;
  };
}

interface ShellMaterials {
  wall: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  activeWindow: THREE.MeshStandardMaterial;
  facadeWindow: THREE.MeshStandardMaterial;
  roofSurface: THREE.MeshStandardMaterial;
  roofTrim: THREE.MeshStandardMaterial;
  canopy: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  grassAlt: THREE.MeshStandardMaterial;
  paving: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  pine: THREE.MeshStandardMaterial;
  sakura: THREE.MeshStandardMaterial;
  fence: THREE.MeshStandardMaterial;
  pot: THREE.MeshStandardMaterial;
  flowerGold: THREE.MeshStandardMaterial;
  flowerBlue: THREE.MeshStandardMaterial;
  flowerRed: THREE.MeshStandardMaterial;
  outdoorLamp: THREE.MeshStandardMaterial;
  windowGlowMaterials: THREE.MeshStandardMaterial[];
  boxGeoCache: Map<string, THREE.BoxGeometry>;
}

function createShellMaterials(palette: OfficePalette): ShellMaterials {
  const windowLitColor = palette.getColor("--office-exterior-window-lit");
  const windowBaseColor = palette.getColor("--office-exterior-window");
  const warmLampColor = palette.getColor("--office-lamp-warm");

  const activeWindow = new THREE.MeshStandardMaterial({
    color: windowBaseColor,
    emissive: windowLitColor,
    emissiveIntensity: 0.04,
    transparent: true,
    opacity: 0.28,
    roughness: 0.15,
    metalness: 0.1,
  });

  const facadeWindow = new THREE.MeshStandardMaterial({
    color: windowBaseColor,
    emissive: windowLitColor,
    emissiveIntensity: 0.04,
    transparent: true,
    opacity: 0.86,
    roughness: 0.2,
    metalness: 0.18,
  });

  const outdoorLamp = new THREE.MeshStandardMaterial({
    color: warmLampColor,
    emissive: warmLampColor,
    emissiveIntensity: 0.12,
    roughness: 0.25,
  });

  return {
    wall: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-exterior-wall"),
      roughness: 0.78,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-exterior-trim"),
      roughness: 0.55,
      metalness: 0.15,
    }),
    activeWindow,
    facadeWindow,
    roofSurface: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-roof-surface"),
      roughness: 0.85,
    }),
    roofTrim: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-roof-trim"),
      roughness: 0.6,
      metalness: 0.2,
    }),
    canopy: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-entrance-canopy"),
      roughness: 0.55,
      metalness: 0.2,
    }),
    grass: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-ground-grass"),
      roughness: 0.94,
    }),
    grassAlt: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-ground-grass-alt"),
      roughness: 0.94,
    }),
    paving: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-ground-paving"),
      roughness: 0.88,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-ground-stone"),
      roughness: 0.84,
    }),
    water: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-water-pond"),
      transparent: true,
      opacity: 0.8,
      roughness: 0.12,
      metalness: 0.15,
    }),
    trunk: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-furniture-accent"),
      roughness: 0.82,
    }),
    leaf: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-plant-leaf"),
      roughness: 0.86,
    }),
    pine: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-pine-leaf"),
      roughness: 0.88,
    }),
    sakura: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-sakura-blossom"),
      roughness: 0.82,
    }),
    fence: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-fence-wood"),
      roughness: 0.8,
    }),
    pot: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-plant-pot"),
      roughness: 0.78,
    }),
    flowerGold: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-blossom-gold"),
      roughness: 0.72,
    }),
    flowerBlue: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-palette-sky"),
      roughness: 0.72,
    }),
    flowerRed: new THREE.MeshStandardMaterial({
      color: palette.getColor("--office-book-red"),
      roughness: 0.72,
    }),
    outdoorLamp,
    windowGlowMaterials: [activeWindow, facadeWindow],
    boxGeoCache: new Map<string, THREE.BoxGeometry>(),
  };
}

function getPooledBoxGeometry(
  mats: ShellMaterials | undefined,
  w: number,
  h: number,
  d: number,
): THREE.BoxGeometry {
  if (!mats) return new THREE.BoxGeometry(w, h, d);
  const key = `${Math.round(w * 1000)}|${Math.round(h * 1000)}|${Math.round(d * 1000)}`;
  let geo = mats.boxGeoCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d);
    mats.boxGeoCache.set(key, geo);
  }
  return geo;
}

function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  options: { castShadow?: boolean; receiveShadow?: boolean; mats?: ShellMaterials } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(getPooledBoxGeometry(options.mats, w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  parent.add(mesh);
  return mesh;
}

function buildFacadeSpan(
  parent: THREE.Group,
  span: number,
  wallHeight: number,
  windowMat: THREE.Material,
  mats: ShellMaterials,
  hasEntranceGap: boolean,
  interactiveDoors = false,
): CutawaySide["slidingDoors"] | undefined {
  const t = BUILDING_WALL_THICKNESS_M;
  const sillH = 0.88;
  const lintelH = Math.max(0.42, wallHeight - 2.65);
  const windowH = wallHeight - sillH - lintelH;
  const entranceGapW = ENTRANCE_DOOR_GAP_WIDTH_M;
  let slidingDoors: CutawaySide["slidingDoors"] | undefined;

  if (hasEntranceGap && span > entranceGapW + 2) {
    const sideW = (span - entranceGapW) / 2;
    addBox(parent, sideW, sillH, t, -(entranceGapW / 2 + sideW / 2), sillH / 2, 0, mats.wall, {
      castShadow: true,
    });
    addBox(parent, sideW, sillH, t, entranceGapW / 2 + sideW / 2, sillH / 2, 0, mats.wall, {
      castShadow: true,
    });
    // Entrance glass double doors + frame posts
    addBox(parent, 0.16, windowH + sillH, t + 0.04, -entranceGapW / 2, (windowH + sillH) / 2, 0, mats.trim);
    addBox(parent, 0.16, windowH + sillH, t + 0.04, entranceGapW / 2, (windowH + sillH) / 2, 0, mats.trim);

    if (interactiveDoors) {
      const clearW = entranceGapW - 0.18;
      const leafW = clearW / 2;
      const leafH = windowH + sillH - 0.08;
      const closedOffset = leafW / 2;
      const leftDoor = addBox(parent, leafW, leafH, 0.08, -closedOffset, leafH / 2 + 0.02, 0.02, windowMat);
      const rightDoor = addBox(parent, leafW, leafH, 0.08, closedOffset, leafH / 2 + 0.02, 0.02, windowMat);
      addBox(leftDoor, 0.06, 0.65, 0.12, leafW / 2 - 0.12, 0, 0, mats.trim);
      addBox(rightDoor, 0.06, 0.65, 0.12, -(leafW / 2 - 0.12), 0, 0, mats.trim);
      addBox(leftDoor, 0.04, leafH, 0.1, leafW / 2 - 0.02, 0, 0, mats.roofTrim);
      addBox(rightDoor, 0.04, leafH, 0.1, -(leafW / 2 - 0.02), 0, 0, mats.roofTrim);
      slidingDoors = {
        left: leftDoor,
        right: rightDoor,
        closedLeftX: -closedOffset,
        closedRightX: closedOffset,
      };
    } else {
      addBox(
        parent,
        entranceGapW - 0.24,
        windowH + sillH - 0.1,
        0.08,
        0,
        (windowH + sillH) / 2,
        0,
        windowMat,
      );
    }
  } else {
    addBox(parent, span, sillH, t, 0, sillH / 2, 0, mats.wall, { castShadow: true });
  }

  addBox(parent, span, lintelH, t, 0, sillH + windowH + lintelH / 2, 0, mats.wall, {
    castShadow: true,
  });
  addBox(parent, span + 0.06, 0.1, t + 0.04, 0, wallHeight + 0.05, 0, mats.trim);

  if (!hasEntranceGap || span <= entranceGapW + 2) {
    addBox(parent, Math.max(1, span - 0.5), windowH, 0.08, 0, sillH + windowH / 2, 0, windowMat);
  } else {
    const sideW = (span - entranceGapW) / 2;
    addBox(
      parent,
      Math.max(0.5, sideW - 0.3),
      windowH,
      0.08,
      -(entranceGapW / 2 + sideW / 2),
      sillH + windowH / 2,
      0,
      windowMat,
    );
    addBox(
      parent,
      Math.max(0.5, sideW - 0.3),
      windowH,
      0.08,
      entranceGapW / 2 + sideW / 2,
      sillH + windowH / 2,
      0,
      windowMat,
    );
  }

  const mullionStep = 3.0;
  for (let mx = -span / 2 + mullionStep; mx < span / 2 - 0.6; mx += mullionStep) {
    if (hasEntranceGap && Math.abs(mx) < entranceGapW / 2 + 0.2) continue;
    addBox(parent, 0.16, windowH + 0.06, t + 0.03, mx, sillH + windowH / 2, 0, mats.trim);
  }

  return slidingDoors;
}

function buildCutawaySpan(
  parent: THREE.Group,
  span: number,
  mats: ShellMaterials,
  hasEntranceGap: boolean,
): void {
  const t = BUILDING_WALL_THICKNESS_M;
  const h = BUILDING_CUTAWAY_WALL_HEIGHT_M;
  const entranceGapW = ENTRANCE_DOOR_GAP_WIDTH_M;

  if (hasEntranceGap && span > entranceGapW + 2) {
    const sideW = (span - entranceGapW) / 2;
    addBox(parent, sideW, h, t, -(entranceGapW / 2 + sideW / 2), h / 2, 0, mats.wall);
    addBox(parent, sideW, h, t, entranceGapW / 2 + sideW / 2, h / 2, 0, mats.wall);
    addBox(parent, sideW + 0.04, 0.07, t + 0.04, -(entranceGapW / 2 + sideW / 2), h + 0.035, 0, mats.trim);
    addBox(parent, sideW + 0.04, 0.07, t + 0.04, entranceGapW / 2 + sideW / 2, h + 0.035, 0, mats.trim);
  } else {
    addBox(parent, span, h, t, 0, h / 2, 0, mats.wall);
    addBox(parent, span + 0.06, 0.07, t + 0.04, 0, h + 0.035, 0, mats.trim);
  }
}

function buildActivePerimeterWall(
  root: THREE.Group,
  span: number,
  x: number,
  z: number,
  rotY: number,
  mats: ShellMaterials,
  hasEntranceGap: boolean,
): CutawaySide {
  const fullGroup = new THREE.Group();
  fullGroup.position.set(x, 0, z);
  fullGroup.rotation.y = rotY;
  const slidingDoors = buildFacadeSpan(
    fullGroup,
    span,
    BUILDING_EXTERIOR_WALL_HEIGHT_M,
    mats.activeWindow,
    mats,
    hasEntranceGap,
    hasEntranceGap,
  );

  const lowGroup = new THREE.Group();
  lowGroup.position.set(x, 0, z);
  lowGroup.rotation.y = rotY;
  buildCutawaySpan(lowGroup, span, mats, hasEntranceGap);

  root.add(fullGroup, lowGroup);
  return { fullGroup, lowGroup, slidingDoors };
}

function addOutdoorBenchMesh(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  rotY: number,
  mats: ShellMaterials,
): void {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotY;
  // Wood slats seat + backrest on metal legs
  addBox(group, 1.48, 0.08, 0.56, 0, 0.38, 0, mats.trunk, { castShadow: true, receiveShadow: true });
  addBox(group, 1.48, 0.34, 0.08, 0, 0.62, -0.24, mats.trunk, { castShadow: true });
  for (const lx of [-0.62, 0.62]) {
    addBox(group, 0.08, 0.38, 0.52, lx, 0.19, 0, mats.roofTrim, { castShadow: true });
  }
  parent.add(group);
}

function buildBalconyDeckAndRailings(
  parent: THREE.Group,
  gridW: number,
  gridD: number,
  baseY: number,
  mats: ShellMaterials,
  includeProps: boolean,
): void {
  const bounds = getBalconyBounds(gridW, gridD);
  const w = bounds.maxX - bounds.minX;
  const d = BALCONY_DEPTH_M;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = bounds.minZ + d / 2;

  const balconyGroup = new THREE.Group();
  balconyGroup.position.y = baseY;

  // Cantilevered deck slab flush at local y = 0 + trim fascia
  addBox(balconyGroup, w + 0.16, 0.24, d + 0.12, cx, -0.12, cz + 0.04, mats.paving, {
    receiveShadow: true,
    castShadow: true,
  });
  addBox(balconyGroup, w + 0.22, 0.08, d + 0.18, cx, -0.22, cz + 0.04, mats.roofTrim);

  // Glass & metal balustrade railing around West, East, and South edges
  const railH = 1.05;
  addBox(balconyGroup, w, railH - 0.12, 0.06, cx, (railH - 0.12) / 2, bounds.maxZ - 0.06, mats.activeWindow);
  addBox(balconyGroup, w + 0.12, 0.07, 0.1, cx, railH, bounds.maxZ - 0.06, mats.trim);
  addBox(balconyGroup, 0.06, railH - 0.12, d, bounds.minX + 0.06, (railH - 0.12) / 2, cz, mats.activeWindow);
  addBox(balconyGroup, 0.1, 0.07, d + 0.06, bounds.minX + 0.06, railH, cz, mats.trim);
  addBox(balconyGroup, 0.06, railH - 0.12, d, bounds.maxX - 0.06, (railH - 0.12) / 2, cz, mats.activeWindow);
  addBox(balconyGroup, 0.1, 0.07, d + 0.06, bounds.maxX - 0.06, railH, cz, mats.trim);

  // Vertical railing stanchions
  for (let px = bounds.minX + 0.06; px <= bounds.maxX - 0.04; px += w / 4) {
    addBox(balconyGroup, 0.08, railH, 0.08, px, railH / 2, bounds.maxZ - 0.06, mats.roofTrim);
  }
  addBox(balconyGroup, 0.08, railH, 0.08, bounds.minX + 0.06, railH / 2, gridD + d / 2, mats.roofTrim);
  addBox(balconyGroup, 0.08, railH, 0.08, bounds.maxX - 0.06, railH / 2, gridD + d / 2, mats.roofTrim);

  if (includeProps) {
    for (const bench of getBalconyBenches(gridW, gridD)) {
      addOutdoorBenchMesh(
        balconyGroup,
        bench.cell[0] + 0.5,
        0,
        bench.cell[1] + 0.5,
        (bench.rotation * Math.PI) / 180,
        mats,
      );
    }
    // Corner planters + wall sconces flanking balcony doorway
    for (const px of [bounds.minX + 0.7, bounds.maxX - 0.7]) {
      const pz = bounds.maxZ - 0.7;
      addBox(balconyGroup, 0.62, 0.48, 0.62, px, 0.24, pz, mats.pot, { castShadow: true });
      addBox(balconyGroup, 0.76, 0.65, 0.76, px, 0.78, pz, mats.leaf, { castShadow: true });
    }
    for (const sx of [gridW / 2 - 2.35, gridW / 2 + 2.35]) {
      addBox(balconyGroup, 0.16, 0.28, 0.14, sx, 2.1, gridD + BUILDING_WALL_THICKNESS_M + 0.06, mats.outdoorLamp);
    }
  }

  parent.add(balconyGroup);
}

function buildStackedFloorFacade(
  parent: THREE.Group,
  gridW: number,
  gridD: number,
  baseY: number,
  isGroundFloor: boolean,
  mats: ShellMaterials,
): void {
  const floorGroup = new THREE.Group();
  floorGroup.position.y = baseY;
  const halfT = BUILDING_WALL_THICKNESS_M / 2;

  // Floor slab separator belt
  addBox(floorGroup, gridW + 0.36, 0.28, gridD + 0.36, gridW / 2, -0.14, gridD / 2, mats.trim, {
    receiveShadow: true,
  });

  const sides: Array<{ span: number; x: number; z: number; rotY: number; entrance: boolean }> = [
    { span: gridW, x: gridW / 2, z: -halfT, rotY: 0, entrance: false },
    { span: gridW, x: gridW / 2, z: gridD + halfT, rotY: 0, entrance: true },
    { span: gridD, x: -halfT, z: gridD / 2, rotY: Math.PI / 2, entrance: false },
    { span: gridD, x: gridW + halfT, z: gridD / 2, rotY: Math.PI / 2, entrance: false },
  ];

  for (const s of sides) {
    const wallSide = new THREE.Group();
    wallSide.position.set(s.x, 0, s.z);
    wallSide.rotation.y = s.rotY;
    buildFacadeSpan(wallSide, s.span, BUILDING_FLOOR_HEIGHT_M - 0.28, mats.facadeWindow, mats, s.entrance);
    floorGroup.add(wallSide);
  }

  if (!isGroundFloor) {
    buildBalconyDeckAndRailings(floorGroup, gridW, gridD, 0, mats, false);
  }

  // 4 corner structural pilasters
  for (const [cx, cz] of [
    [-halfT, -halfT],
    [gridW + halfT, -halfT],
    [-halfT, gridD + halfT],
    [gridW + halfT, gridD + halfT],
  ] as const) {
    addBox(
      floorGroup,
      BUILDING_WALL_THICKNESS_M + 0.14,
      BUILDING_FLOOR_HEIGHT_M,
      BUILDING_WALL_THICKNESS_M + 0.14,
      cx,
      (BUILDING_FLOOR_HEIGHT_M - 0.28) / 2,
      cz,
      mats.trim,
    );
  }

  parent.add(floorGroup);
}

function addStylizedTreeMesh(
  parent: THREE.Group,
  tx: number,
  groundY: number,
  tz: number,
  variantIndex: number,
  mats: ShellMaterials,
): void {
  const variety = variantIndex % 3;
  // Base root flare
  addBox(parent, 0.72, 0.18, 0.72, tx, groundY + 0.09, tz, mats.trunk, { castShadow: true });

  if (variety === 0) {
    // Sakura blossom tree with warm bark and layered pink canopy
    addBox(parent, 0.42, 1.7, 0.42, tx, groundY + 0.85, tz, mats.trunk, { castShadow: true });
    addBox(parent, 2.3, 1.15, 2.2, tx, groundY + 2.35, tz, mats.sakura, { castShadow: true });
    addBox(parent, 1.65, 0.9, 1.65, tx + 0.3, groundY + 3.05, tz - 0.18, mats.sakura, { castShadow: true });
    addBox(parent, 1.35, 0.7, 1.35, tx - 0.45, groundY + 2.75, tz + 0.25, mats.sakura, { castShadow: true });
    // Fallen sakura petals around trunk base
    addBox(parent, 0.28, 0.03, 0.24, tx + 0.55, groundY + 0.02, tz + 0.4, mats.sakura);
    addBox(parent, 0.22, 0.03, 0.22, tx - 0.62, groundY + 0.02, tz - 0.35, mats.sakura);
  } else if (variety === 1) {
    // Layered voxel oak tree
    addBox(parent, 0.48, 1.75, 0.48, tx, groundY + 0.88, tz, mats.trunk, { castShadow: true });
    addBox(parent, 2.15, 1.35, 2.15, tx, groundY + 2.45, tz, mats.leaf, { castShadow: true });
    addBox(parent, 1.5, 0.95, 1.5, tx - 0.25, groundY + 3.3, tz + 0.18, mats.grassAlt, { castShadow: true });
    addBox(parent, 1.1, 0.65, 1.1, tx + 0.48, groundY + 2.85, tz - 0.28, mats.leaf, { castShadow: true });
  } else {
    // Tall tiered pine/cypress tree
    addBox(parent, 0.4, 1.3, 0.4, tx, groundY + 0.65, tz, mats.trunk, { castShadow: true });
    addBox(parent, 1.95, 1.1, 1.95, tx, groundY + 1.65, tz, mats.pine, { castShadow: true });
    addBox(parent, 1.4, 1.05, 1.4, tx, groundY + 2.6, tz, mats.pine, { castShadow: true });
    addBox(parent, 0.85, 0.95, 0.85, tx, groundY + 3.45, tz, mats.pine, { castShadow: true });
  }
}

function addFlowerCluster(
  parent: THREE.Group,
  cx: number,
  groundY: number,
  cz: number,
  width: number,
  depth: number,
  mats: ShellMaterials,
): void {
  addBox(parent, width, 0.28, depth, cx, groundY + 0.14, cz, mats.leaf, { castShadow: true, receiveShadow: true });
  const flowerMats = [mats.sakura, mats.flowerGold, mats.flowerBlue, mats.flowerRed];
  const cols = Math.max(2, Math.round(width / 0.55));
  const rows = Math.max(1, Math.round(depth / 0.55));
  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const fx = cx - width * 0.36 + (cols > 1 ? (ix / (cols - 1)) * width * 0.72 : 0);
      const fz = cz - depth * 0.32 + (rows > 1 ? (iz / (rows - 1)) * depth * 0.64 : 0);
      addBox(
        parent,
        0.18,
        0.14,
        0.18,
        fx,
        groundY + 0.33,
        fz,
        flowerMats[(ix + iz) % flowerMats.length]!,
      );
    }
  }
}

function addLampPost(
  parent: THREE.Group,
  x: number,
  groundY: number,
  z: number,
  tall: boolean,
  mats: ShellMaterials,
): void {
  if (tall) {
    addBox(parent, 0.28, 0.22, 0.28, x, groundY + 0.11, z, mats.stone, { castShadow: true });
    addBox(parent, 0.12, 2.3, 0.12, x, groundY + 1.35, z, mats.roofTrim, { castShadow: true });
    addBox(parent, 0.34, 0.08, 0.34, x, groundY + 2.52, z, mats.roofTrim);
    addBox(parent, 0.24, 0.28, 0.24, x, groundY + 2.7, z, mats.outdoorLamp);
    addBox(parent, 0.38, 0.1, 0.38, x, groundY + 2.88, z, mats.roofTrim);
  } else {
    addBox(parent, 0.14, 0.9, 0.14, x, groundY + 0.5, z, mats.roofTrim, { castShadow: true });
    addBox(parent, 0.24, 0.24, 0.24, x, groundY + 1.02, z, mats.outdoorLamp);
  }
}

function buildGroundCampus(
  parent: THREE.Group,
  gridW: number,
  gridD: number,
  groundY: number,
  mats: ShellMaterials,
): void {
  const campusGroup = new THREE.Group();
  const margin = BUILDING_GROUNDS_MARGIN_M;
  const grassW = gridW + margin * 2;
  const grassD = gridD + margin * 2;

  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(grassW, grassD), mats.grass);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(gridW / 2, groundY - 0.04, gridD / 2);
  lawn.receiveShadow = true;
  campusGroup.add(lawn);

  // Subtle darker clover meadow patches across outer corners for visual richness
  for (const [px, pz, pw, pd] of [
    [-12.5, -11.5, 16, 15],
    [gridW + 12.5, -11.5, 16, 15],
    [-14.5, gridD + 11.5, 14, 15],
    [gridW + 14.5, gridD + 11.5, 14, 15],
    [gridW / 2, -13.0, 22, 12],
  ] as const) {
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), mats.grassAlt);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(px, groundY - 0.032, pz);
    patch.receiveShadow = true;
    campusGroup.add(patch);
  }

  // Sidewalk apron around the building footprint
  addBox(campusGroup, gridW + 5.2, 0.08, gridD + 5.2, gridW / 2, groundY + 0.01, gridD / 2, mats.paving, {
    receiveShadow: true,
  });

  // Main South courtyard plaza + extended stone walkway toward South gate
  addBox(campusGroup, 10.6, 0.09, 15.0, gridW / 2, groundY + 0.015, gridD + 7.5, mats.paving, {
    receiveShadow: true,
  });
  addBox(campusGroup, 4.4, 0.09, 7.2, gridW / 2, groundY + 0.015, gridD + 18.2, mats.paving, {
    receiveShadow: true,
  });
  // Light stone plaza trim rails
  addBox(campusGroup, 11.0, 0.1, 0.28, gridW / 2, groundY + 0.02, gridD + 15.05, mats.stone, {
    receiveShadow: true,
  });

  // West stepping-stone path to Koi Pond + East paved path to Café Pergola
  const pond = getCampusPondBounds(gridW, gridD);
  const pergola = getCampusPergolaBounds(gridW, gridD);
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const sx = (gridW / 2 - 5.8) * (1 - t) + (pond.cx + pond.halfW + 1.1) * t;
    const sz = (gridD + 4.5) * (1 - t) + pond.cz * t;
    addBox(campusGroup, 1.15, 0.08, 0.88, sx, groundY + 0.02, sz, mats.stone, { receiveShadow: true });
  }
  addBox(
    campusGroup,
    pergola.cx - pergola.halfW - (gridW / 2 + 5.0),
    0.08,
    1.8,
    (gridW / 2 + 5.0 + pergola.cx - pergola.halfW) / 2,
    groundY + 0.016,
    gridD + 5.5,
    mats.stone,
    { receiveShadow: true },
  );

  // Two-step threshold transition outside Ground Floor South entrance (bridging y=0 down to y=-0.27)
  const localFloorY = groundY + 0.32;
  addBox(campusGroup, 4.0, 0.14, 0.65, gridW / 2, localFloorY - 0.11, gridD + 0.32, mats.paving, {
    receiveShadow: true,
  });
  addBox(campusGroup, 4.2, 0.12, 0.65, gridW / 2, localFloorY - 0.21, gridD + 0.92, mats.paving, {
    receiveShadow: true,
  });

  // Ground-floor South Entrance overhang canopy
  addBox(
    campusGroup,
    4.6,
    0.22,
    1.8,
    gridW / 2,
    groundY + 2.75,
    gridD + 0.9,
    mats.canopy,
    { castShadow: true },
  );
  addBox(campusGroup, 0.16, 2.7, 0.16, gridW / 2 - 2.0, groundY + 1.38, gridD + 1.6, mats.trim);
  addBox(campusGroup, 0.16, 2.7, 0.16, gridW / 2 + 2.0, groundY + 1.38, gridD + 1.6, mats.trim);

  // Central Tiered Water Fountain on South Plaza
  const [fx, fz] = getCampusFountainCenter(gridW, gridD);
  addBox(campusGroup, 3.2, 0.34, 3.2, fx, groundY + 0.17, fz, mats.stone, { castShadow: true, receiveShadow: true });
  addBox(campusGroup, 2.65, 0.12, 2.65, fx, groundY + 0.26, fz, mats.water);
  addBox(campusGroup, 0.72, 0.9, 0.72, fx, groundY + 0.65, fz, mats.stone, { castShadow: true });
  addBox(campusGroup, 1.55, 0.18, 1.55, fx, groundY + 1.12, fz, mats.stone, { castShadow: true });
  addBox(campusGroup, 1.25, 0.08, 1.25, fx, groundY + 1.18, fz, mats.water);
  addBox(campusGroup, 0.36, 0.5, 0.36, fx, groundY + 1.42, fz, mats.stone, { castShadow: true });

  // West Garden Koi Pond + Natural Stone Rim + Lily Pads + Japanese Stone Lanterns
  addBox(campusGroup, pond.halfW * 2 + 0.7, 0.14, pond.halfD * 2 + 0.7, pond.cx, groundY + 0.02, pond.cz, mats.stone, {
    receiveShadow: true,
  });
  addBox(campusGroup, pond.halfW * 2 - 0.15, 0.06, pond.halfD * 2 - 0.15, pond.cx, groundY + 0.08, pond.cz, mats.water);
  // Decorative pond rim boulders + wooden viewing edge on South bank
  addBox(campusGroup, 2.8, 0.16, 0.9, pond.cx, groundY + 0.1, pond.cz + pond.halfD + 0.35, mats.fence, {
    castShadow: true,
    receiveShadow: true,
  });
  for (const [rx, rz, rs] of [
    [-pond.halfW - 0.1, -pond.halfD * 0.4, 0.68],
    [-pond.halfW + 0.8, -pond.halfD - 0.1, 0.56],
    [pond.halfW + 0.1, -pond.halfD * 0.6, 0.64],
    [pond.halfW - 0.5, pond.halfD + 0.1, 0.52],
    [-pond.halfW + 0.4, pond.halfD + 0.1, 0.58],
  ] as const) {
    addBox(campusGroup, rs, 0.42, rs * 0.9, pond.cx + rx, groundY + 0.22, pond.cz + rz, mats.stone, {
      castShadow: true,
    });
  }
  for (const [lx, lz, hasBloom] of [
    [-1.4, -0.8, true],
    [1.1, 0.6, true],
    [-0.2, 1.2, false],
    [1.8, -1.0, false],
  ] as const) {
    addBox(campusGroup, 0.56, 0.04, 0.52, pond.cx + lx, groundY + 0.12, pond.cz + lz, mats.leaf);
    if (hasBloom) {
      addBox(campusGroup, 0.22, 0.1, 0.22, pond.cx + lx, groundY + 0.17, pond.cz + lz, mats.sakura);
    }
  }
  for (const lx of [pond.cx - pond.halfW - 0.7, pond.cx + pond.halfW + 0.7]) {
    const lz = pond.cz - pond.halfD - 0.4;
    addBox(campusGroup, 0.42, 0.36, 0.42, lx, groundY + 0.18, lz, mats.stone, { castShadow: true });
    addBox(campusGroup, 0.28, 0.32, 0.28, lx, groundY + 0.52, lz, mats.outdoorLamp);
    addBox(campusGroup, 0.52, 0.14, 0.52, lx, groundY + 0.75, lz, mats.stone, { castShadow: true });
  }

  // East Garden Outdoor Café Terrace & Timber Pergola
  addBox(campusGroup, pergola.halfW * 2 + 0.8, 0.1, pergola.halfD * 2 + 0.8, pergola.cx, groundY + 0.03, pergola.cz, mats.paving, {
    receiveShadow: true,
  });
  for (const px of [pergola.cx - pergola.halfW + 0.22, pergola.cx + pergola.halfW - 0.22]) {
    for (const pz of [pergola.cz - pergola.halfD + 0.22, pergola.cz + pergola.halfD - 0.22]) {
      addBox(campusGroup, 0.24, 2.75, 0.24, px, groundY + 1.4, pz, mats.fence, { castShadow: true });
    }
  }
  // Pergola perimeter beams + cross rafters + vine accents + warm fairy bulbs
  addBox(campusGroup, pergola.halfW * 2, 0.2, 0.22, pergola.cx, groundY + 2.8, pergola.cz - pergola.halfD + 0.22, mats.fence, { castShadow: true });
  addBox(campusGroup, pergola.halfW * 2, 0.2, 0.22, pergola.cx, groundY + 2.8, pergola.cz + pergola.halfD - 0.22, mats.fence, { castShadow: true });
  for (let rx = -pergola.halfW + 0.6; rx <= pergola.halfW - 0.5; rx += 1.2) {
    addBox(campusGroup, 0.14, 0.16, pergola.halfD * 2 + 0.2, pergola.cx + rx, groundY + 2.9, pergola.cz, mats.fence, { castShadow: true });
    addBox(campusGroup, 0.16, 0.14, 0.16, pergola.cx + rx, groundY + 2.66, pergola.cz + (rx > 0 ? 0.7 : -0.7), mats.outdoorLamp);
  }
  addBox(campusGroup, 2.2, 0.35, 1.4, pergola.cx - 1.4, groundY + 3.04, pergola.cz - 1.1, mats.leaf);
  addBox(campusGroup, 1.8, 0.32, 1.3, pergola.cx + 1.6, groundY + 3.04, pergola.cz + 1.0, mats.sakura);
  // Two bistro tables + patio umbrellas under the pergola
  for (const [tx, umbrellaMat] of [
    [pergola.cx - 1.35, mats.flowerBlue],
    [pergola.cx + 1.35, mats.sakura],
  ] as const) {
    addBox(campusGroup, 0.92, 0.08, 0.92, tx, groundY + 0.76, pergola.cz, mats.stone, { castShadow: true });
    addBox(campusGroup, 0.12, 0.72, 0.12, tx, groundY + 0.4, pergola.cz, mats.roofTrim);
    addBox(campusGroup, 0.06, 1.5, 0.06, tx, groundY + 1.5, pergola.cz, mats.roofTrim);
    addBox(campusGroup, 1.35, 0.12, 1.35, tx, groundY + 2.24, pergola.cz, umbrellaMat, { castShadow: true });
    for (const sz of [-0.62, 0.62]) {
      addBox(campusGroup, 0.38, 0.44, 0.38, tx, groundY + 0.24, pergola.cz + sz, mats.fence, { castShadow: true });
    }
  }

  // Courtyard benches along the front plaza and gardens
  for (const bench of getCampusBenches(gridW, gridD)) {
    addOutdoorBenchMesh(
      campusGroup,
      bench.cell[0] + 0.5,
      groundY + 0.05,
      bench.cell[1] + 0.5,
      (bench.rotation * Math.PI) / 180,
      mats,
    );
  }

  // Flower beds flanking entrance apron, plaza corners, and West garden
  addFlowerCluster(campusGroup, gridW / 2 - 4.0, groundY, gridD + 2.8, 2.2, 1.1, mats);
  addFlowerCluster(campusGroup, gridW / 2 + 4.0, groundY, gridD + 2.8, 2.2, 1.1, mats);
  addFlowerCluster(campusGroup, -14.0, groundY, -6.5, 3.2, 1.8, mats);
  addFlowerCluster(campusGroup, gridW + 13.5, groundY, -6.5, 3.2, 1.8, mats);
  addFlowerCluster(campusGroup, pond.cx - 5.2, groundY, pond.cz + 3.2, 2.8, 1.5, mats);
  addFlowerCluster(campusGroup, fx - 5.8, groundY, fz + 2.5, 2.6, 1.4, mats);
  addFlowerCluster(campusGroup, fx + 5.8, groundY, fz + 2.5, 2.6, 1.4, mats);

  // Garden lamp bollards + taller park lampposts along South avenue & gate
  for (const lx of [gridW / 2 - 2.6, gridW / 2 + 2.6]) {
    for (const lz of [gridD + 3.8, gridD + 8.5]) {
      addLampPost(campusGroup, lx, groundY, lz, false, mats);
    }
  }
  for (const [lx, lz] of [
    [gridW / 2 - 3.0, gridD + 15.8],
    [gridW / 2 + 3.0, gridD + 15.8],
    [pond.cx + pond.halfW + 1.4, pond.cz - 2.2],
    [pergola.cx - pergola.halfW - 1.2, pergola.cz - 2.0],
  ] as const) {
    addLampPost(campusGroup, lx, groundY, lz, true, mats);
  }

  // Stylized multi-tier trees framing the yard
  const trees = getCampusTreeCoords(gridW, gridD);
  for (let i = 0; i < trees.length; i++) {
    const [tx, tz] = trees[i]!;
    addStylizedTreeMesh(campusGroup, tx, groundY, tz, i, mats);
  }

  // Wooden perimeter fence with open South entrance stone gate piers
  const fenceMinX = -(margin - 2.2);
  const fenceMaxX = gridW + (margin - 2.2);
  const fenceMinZ = -(margin - 2.2);
  const fenceMaxZ = gridD + (margin - 2.2);
  const gateHalfW = 3.2;

  const addFenceSegmentX = (xStart: number, xEnd: number, z: number) => {
    const len = xEnd - xStart;
    if (len <= 0.5) return;
    const cx = (xStart + xEnd) / 2;
    addBox(campusGroup, len, 0.1, 0.08, cx, groundY + 0.86, z, mats.fence, { mats });
    addBox(campusGroup, len, 0.1, 0.08, cx, groundY + 0.44, z, mats.fence, { mats });
    for (let px = xStart; px <= xEnd + 0.05; px += 3.2) {
      addBox(campusGroup, 0.16, 1.08, 0.16, Math.min(xEnd, px), groundY + 0.54, z, mats.fence, {
        castShadow: true,
        mats,
      });
    }
  };

  const addFenceSegmentZ = (zStart: number, zEnd: number, x: number) => {
    const len = zEnd - zStart;
    if (len <= 0.5) return;
    const cz = (zStart + zEnd) / 2;
    addBox(campusGroup, 0.08, 0.1, len, x, groundY + 0.86, cz, mats.fence, { mats });
    addBox(campusGroup, 0.08, 0.1, len, x, groundY + 0.44, cz, mats.fence, { mats });
    for (let pz = zStart; pz <= zEnd + 0.05; pz += 3.2) {
      addBox(campusGroup, 0.16, 1.08, 0.16, x, groundY + 0.54, Math.min(zEnd, pz), mats.fence, {
        castShadow: true,
        mats,
      });
    }
  };

  addFenceSegmentX(fenceMinX, fenceMaxX, fenceMinZ);
  addFenceSegmentX(fenceMinX, gridW / 2 - gateHalfW, fenceMaxZ);
  addFenceSegmentX(gridW / 2 + gateHalfW, fenceMaxX, fenceMaxZ);
  addFenceSegmentZ(fenceMinZ, fenceMaxZ, fenceMinX);
  addFenceSegmentZ(fenceMinZ, fenceMaxZ, fenceMaxX);

  // Grand South Gate stone pillars with warm lantern tops
  for (const gx of [gridW / 2 - gateHalfW, gridW / 2 + gateHalfW]) {
    addBox(campusGroup, 0.68, 1.65, 0.68, gx, groundY + 0.82, fenceMaxZ, mats.stone, { castShadow: true });
    addBox(campusGroup, 0.82, 0.16, 0.82, gx, groundY + 1.7, fenceMaxZ, mats.roofTrim);
    addBox(campusGroup, 0.36, 0.32, 0.36, gx, groundY + 1.94, fenceMaxZ, mats.outdoorLamp);
  }

  parent.add(campusGroup);
}

function buildRoofAndTrim(
  cutawayTrimGroup: THREE.Group,
  fullRoofGroup: THREE.Group,
  gridW: number,
  gridD: number,
  floorIndex: number,
  totalFloors: number,
  elevatorCell: [number, number] | null,
  mats: ShellMaterials,
): void {
  const topActiveY = BUILDING_FLOOR_HEIGHT_M - 0.16;
  const fullRoofY = (totalFloors - floorIndex) * BUILDING_FLOOR_HEIGHT_M;
  const overhang = 0.55;
  const rimThickness = 0.55;

  // Lightweight overhanging parapet rim visible in top-floor Cutaway mode
  addBox(
    cutawayTrimGroup,
    gridW + overhang * 2,
    0.2,
    rimThickness,
    gridW / 2,
    topActiveY,
    -rimThickness / 2,
    mats.roofTrim,
  );
  addBox(
    cutawayTrimGroup,
    gridW + overhang * 2,
    0.2,
    rimThickness,
    gridW / 2,
    topActiveY,
    gridD + rimThickness / 2,
    mats.roofTrim,
  );
  addBox(
    cutawayTrimGroup,
    rimThickness,
    0.2,
    gridD,
    -rimThickness / 2,
    topActiveY,
    gridD / 2,
    mats.roofTrim,
  );
  addBox(
    cutawayTrimGroup,
    rimThickness,
    0.2,
    gridD,
    gridW + rimThickness / 2,
    topActiveY,
    gridD / 2,
    mats.roofTrim,
  );

  // Full enclosed architectural rooftop at topY
  const skyW = Math.min(8, Math.max(4, gridW - 10));
  const skyD = Math.min(6, Math.max(4, gridD - 10));
  const cx = gridW / 2;
  const cz = gridD / 2;
  const roofW = gridW + overhang * 2;
  const roofD = gridD + overhang * 2;
  const wingZ = (roofD - skyD) / 2;
  const wingX = (roofW - skyW) / 2;

  // Four roof slabs enclosing a central glass skylight
  addBox(fullRoofGroup, roofW, 0.24, wingZ, cx, fullRoofY, -overhang + wingZ / 2, mats.roofSurface, {
    receiveShadow: true,
    castShadow: true,
  });
  addBox(
    fullRoofGroup,
    roofW,
    0.24,
    wingZ,
    cx,
    fullRoofY,
    gridD + overhang - wingZ / 2,
    mats.roofSurface,
    { receiveShadow: true, castShadow: true },
  );
  addBox(fullRoofGroup, wingX, 0.24, skyD, -overhang + wingX / 2, fullRoofY, cz, mats.roofSurface, {
    receiveShadow: true,
    castShadow: true,
  });
  addBox(
    fullRoofGroup,
    wingX,
    0.24,
    skyD,
    gridW + overhang - wingX / 2,
    fullRoofY,
    cz,
    mats.roofSurface,
    { receiveShadow: true, castShadow: true },
  );

  // Skylight frame & translucent glass atrium
  addBox(fullRoofGroup, skyW - 0.1, 0.1, skyD - 0.1, cx, fullRoofY + 0.14, cz, mats.activeWindow);
  addBox(fullRoofGroup, skyW + 0.2, 0.22, 0.18, cx, fullRoofY + 0.18, cz - skyD / 2, mats.roofTrim);
  addBox(fullRoofGroup, skyW + 0.2, 0.22, 0.18, cx, fullRoofY + 0.18, cz + skyD / 2, mats.roofTrim);
  addBox(fullRoofGroup, 0.18, 0.22, skyD, cx - skyW / 2, fullRoofY + 0.18, cz, mats.roofTrim);
  addBox(fullRoofGroup, 0.18, 0.22, skyD, cx + skyW / 2, fullRoofY + 0.18, cz, mats.roofTrim);

  // Raised roof parapet perimeter
  const parapetH = 0.52;
  const pt = 0.34;
  addBox(fullRoofGroup, roofW, parapetH, pt, cx, fullRoofY + parapetH / 2, -overhang + pt / 2, mats.roofTrim);
  addBox(
    fullRoofGroup,
    roofW,
    parapetH,
    pt,
    cx,
    fullRoofY + parapetH / 2,
    gridD + overhang - pt / 2,
    mats.roofTrim,
  );
  addBox(
    fullRoofGroup,
    pt,
    parapetH,
    roofD - pt * 2,
    -overhang + pt / 2,
    fullRoofY + parapetH / 2,
    cz,
    mats.roofTrim,
  );
  addBox(
    fullRoofGroup,
    pt,
    parapetH,
    roofD - pt * 2,
    gridW + overhang - pt / 2,
    fullRoofY + parapetH / 2,
    cz,
    mats.roofTrim,
  );

  // Rooftop elevator penthouse / HVAC mechanical block above elevator
  const elevX = (elevatorCell?.[0] ?? Math.floor(gridW / 2)) + 0.5;
  const elevZ = (elevatorCell?.[1] ?? 2) + 0.5;
  addBox(fullRoofGroup, 2.8, 1.35, 2.4, elevX, fullRoofY + 0.78, elevZ + 0.4, mats.canopy, {
    castShadow: true,
  });
  addBox(fullRoofGroup, 1.6, 0.85, 1.4, Math.max(3, cx - 7), fullRoofY + 0.52, Math.max(3, cz - 7), mats.trim);
}

/**
 * Builds the architectural shell (campus grounds, stacked lower/upper floors,
 * active-floor cutaway perimeter walls with glass windows, structural ceiling beams,
 * and enclosed rooftop + skylight) cleanly separated from interior interactive stations.
 */
export function buildBuildingShell(params: BuildingShellParams): BuildingShellHandle {
  const { gridW, gridD, floorIndex, totalFloors, elevatorCell, palette } = params;
  const mats = createShellMaterials(palette);
  const root = new THREE.Group();
  root.name = "BuildingShellRoot";

  const groundY = -floorIndex * BUILDING_FLOOR_HEIGHT_M - 0.32;
  buildGroundCampus(root, gridW, gridD, groundY, mats);

  // Stacked lower floors beneath the active floor
  for (let f = 0; f < floorIndex; f++) {
    const baseY = -(floorIndex - f) * BUILDING_FLOOR_HEIGHT_M;
    buildStackedFloorFacade(root, gridW, gridD, baseY, f === 0, mats);
  }

  // Active floor exterior walls with auto-cutaway support & sliding South glass doors
  const halfT = BUILDING_WALL_THICKNESS_M / 2;
  const north = buildActivePerimeterWall(root, gridW, gridW / 2, -halfT, 0, mats, false);
  const south = buildActivePerimeterWall(
    root,
    gridW,
    gridW / 2,
    gridD + halfT,
    0,
    mats,
    true,
  );
  const west = buildActivePerimeterWall(root, gridD, -halfT, gridD / 2, Math.PI / 2, mats, false);
  const east = buildActivePerimeterWall(
    root,
    gridD,
    gridW + halfT,
    gridD / 2,
    Math.PI / 2,
    mats,
    false,
  );

  // Cantilevered South Balcony on upper floors (floorIndex > 0)
  if (floorIndex > 0) {
    buildBalconyDeckAndRailings(root, gridW, gridD, 0, mats, true);
  }

  // Outdoor dusk/night accent lights (South plaza, West garden pond, East café pergola)
  const outdoorNightLights: THREE.PointLight[] = [];
  const createOutdoorNightLight = (x: number, y: number, z: number, range = 20) => {
    const light = new THREE.PointLight(palette.getColor("--office-lamp-warm"), 0, range, 1.05);
    light.castShadow = false;
    light.visible = false;
    light.position.set(x, y, z);
    root.add(light);
    outdoorNightLights.push(light);
  };
  createOutdoorNightLight(
    gridW / 2,
    floorIndex === 0 ? groundY + 2.45 : 2.35,
    gridD + (floorIndex === 0 ? 4.2 : 2.0),
    20,
  );
  if (floorIndex === 0) {
    const pond = getCampusPondBounds(gridW, gridD);
    const pergola = getCampusPergolaBounds(gridW, gridD);
    createOutdoorNightLight(gridW / 2, groundY + 2.9, gridD + 12.5, 22);
    createOutdoorNightLight(pond.cx, groundY + 2.2, pond.cz, 18);
    createOutdoorNightLight(pergola.cx, groundY + 2.6, pergola.cz, 18);
  }

  // Ceiling structural beams supporting room lights at y ~ 3.22
  const ceilingBeamsGroup = new THREE.Group();
  const beamY = BUILDING_EXTERIOR_WALL_HEIGHT_M + 0.06;
  for (const frac of [0.25, 0.5, 0.75]) {
    addBox(ceilingBeamsGroup, gridW + 0.2, 0.14, 0.16, gridW / 2, beamY, gridD * frac, mats.trim);
  }
  for (const frac of [0.33, 0.67]) {
    addBox(ceilingBeamsGroup, 0.16, 0.12, gridD + 0.2, gridW * frac, beamY, gridD / 2, mats.trim);
  }
  root.add(ceilingBeamsGroup);

  // Stacked upper floors & complete roof (hidden during cutaway, shown in Full Building view)
  const upperFloorsGroup = new THREE.Group();
  for (let f = floorIndex + 1; f < totalFloors; f++) {
    const baseY = (f - floorIndex) * BUILDING_FLOOR_HEIGHT_M;
    buildStackedFloorFacade(upperFloorsGroup, gridW, gridD, baseY, false, mats);
  }
  root.add(upperFloorsGroup);

  const cutawayRoofTrimGroup = new THREE.Group();
  const fullRoofGroup = new THREE.Group();
  const interiorCeilingGroup = new THREE.Group();
  interiorCeilingGroup.visible = false;
  addBox(
    interiorCeilingGroup,
    gridW,
    0.12,
    gridD,
    gridW / 2,
    BUILDING_EXTERIOR_WALL_HEIGHT_M + 0.16,
    gridD / 2,
    mats.wall,
    { receiveShadow: true },
  );

  buildRoofAndTrim(
    cutawayRoofTrimGroup,
    fullRoofGroup,
    gridW,
    gridD,
    floorIndex,
    totalFloors,
    elevatorCell,
    mats,
  );
  root.add(cutawayRoofTrimGroup, fullRoofGroup, interiorCeilingGroup);

  let entranceOpenAmount = 0;

  const updateView = (
    cameraPos: THREE.Vector3,
    mode: BuildingViewMode,
    playerPos?: { x: number; z: number },
  ) => {
    const vis = computeCutawayVisibility(
      cameraPos,
      gridW,
      gridD,
      mode,
      totalFloors > floorIndex + 1,
      playerPos,
    );

    north.fullGroup.visible = !vis.cutNorth;
    north.lowGroup.visible = vis.cutNorth;
    south.fullGroup.visible = !vis.cutSouth;
    south.lowGroup.visible = vis.cutSouth;
    west.fullGroup.visible = !vis.cutWest;
    west.lowGroup.visible = vis.cutWest;
    east.fullGroup.visible = !vis.cutEast;
    east.lowGroup.visible = vis.cutEast;

    interiorCeilingGroup.visible = vis.showInteriorCeiling;
    upperFloorsGroup.visible = vis.showUpperFloors;
    fullRoofGroup.visible = vis.showFullRoof;
    ceilingBeamsGroup.visible = !vis.showFullRoof;
    cutawayRoofTrimGroup.visible = !vis.showFullRoof && floorIndex === totalFloors - 1;
  };

  const updateEntranceDoors = (
    dt: number,
    actorPositions: ReadonlyArray<{ x: number; z: number }>,
  ) => {
    const doors = south.slidingDoors;
    if (!doors) return;
    const doorX = gridW / 2;
    const doorZ = gridD;
    let shouldOpen = false;
    for (const pos of actorPositions) {
      if (Math.hypot(pos.x - doorX, pos.z - doorZ) <= ENTRANCE_DOOR_TRIGGER_RADIUS_M) {
        shouldOpen = true;
        break;
      }
    }
    const target = shouldOpen ? 1 : 0;
    entranceOpenAmount += (target - entranceOpenAmount) * Math.min(1, dt * 6);
    const slide = entranceOpenAmount * ENTRANCE_DOOR_SLIDE_M;
    doors.left.position.x = doors.closedLeftX - slide;
    doors.right.position.x = doors.closedRightX + slide;
  };

  const setNightLights = (level: boolean | number) => {
    const factor =
      typeof level === "number" ? Math.max(0, Math.min(1, level)) : level ? 1 : 0;
    const intensity = 0.04 + factor * 0.45;
    for (const mat of mats.windowGlowMaterials) {
      mat.emissiveIntensity = intensity;
    }
    mats.outdoorLamp.emissiveIntensity = 0.12 + factor * 1.1;
    for (const light of outdoorNightLights) {
      light.intensity = factor * 2.4;
      light.visible = factor > 0.02;
    }
  };

  return { root, updateView, updateEntranceDoors, setNightLights };
}
