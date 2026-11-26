import {
  BLOCKING_FURNITURE_KINDS,
  FURNITURE_FOOTPRINTS,
  NAV_CELL_FOOTPRINT_PAD_M,
} from "./constants";
import { getRotatedHalfExtents } from "./layout";
import type {
  CharacterActionPose,
  DeskConfig,
  FindPath,
  FloorConfig,
  FloorNavGrid,
  FurnitureKind,
  IdlePointOfInterest,
} from "./types";

export const EDGE_N = 1;
export const EDGE_S = 2;
export const EDGE_W = 4;
export const EDGE_E = 8;

function cellIndex(width: number, x: number, z: number): number {
  return z * width + x;
}

function inGrid(width: number, depth: number, x: number, z: number): boolean {
  return x >= 0 && x < width && z >= 0 && z < depth;
}

/**
 * Builds a grid-cell navigation map with solid wall edge masks matching room
 * walls & doorway openings plus blocked cells for desks, elevator, and furniture.
 */
export function buildFloorNavGrid(floor: FloorConfig): FloorNavGrid {
  const [rawW, rawD] = floor.gridSize;
  const width = Math.max(1, Math.floor(rawW));
  const depth = Math.max(1, Math.floor(rawD));
  const blockedCells = new Uint8Array(width * depth);
  const wallEdges = new Uint8Array(width * depth);

  const markBlocked = (x: number, z: number) => {
    if (inGrid(width, depth, x, z)) {
      blockedCells[cellIndex(width, x, z)] = 1;
    }
  };

  for (const desk of floor.desks) {
    markBlocked(desk.x, desk.z);
  }

  if (floor.elevatorCell) {
    markBlocked(floor.elevatorCell[0], floor.elevatorCell[1]);
  }

  for (const item of floor.furniture) {
    if (!BLOCKING_FURNITURE_KINDS.has(item.kind)) continue;
    markBlocked(item.x, item.z);
    const footprint = FURNITURE_FOOTPRINTS[item.kind];
    const { halfW, halfD } = getRotatedHalfExtents(footprint, item.rotation);
    const fx = item.x + 0.5;
    const fz = item.z + 0.5;
    const minCx = Math.floor(fx - halfW - NAV_CELL_FOOTPRINT_PAD_M);
    const maxCx = Math.floor(fx + halfW + NAV_CELL_FOOTPRINT_PAD_M);
    const minCz = Math.floor(fz - halfD - NAV_CELL_FOOTPRINT_PAD_M);
    const maxCz = Math.floor(fz + halfD + NAV_CELL_FOOTPRINT_PAD_M);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (
          Math.abs(cx + 0.5 - fx) < halfW + NAV_CELL_FOOTPRINT_PAD_M &&
          Math.abs(cz + 0.5 - fz) < halfD + NAV_CELL_FOOTPRINT_PAD_M
        ) {
          markBlocked(cx, cz);
        }
      }
    }
  }

  for (const room of floor.rooms) {
    if (room.wallStyle === "none") continue;
    const { minX, minZ, maxX, maxZ } = room.bounds;
    const doorSet = new Set(room.doors.map((d) => `${d.x},${d.z}`));

    for (let x = minX; x <= maxX; x++) {
      if (!doorSet.has(`${x},${minZ}`) && inGrid(width, depth, x, minZ)) {
        wallEdges[cellIndex(width, x, minZ)] |= EDGE_N;
        if (inGrid(width, depth, x, minZ - 1)) {
          wallEdges[cellIndex(width, x, minZ - 1)] |= EDGE_S;
        }
      }
      if (!doorSet.has(`${x},${maxZ}`) && inGrid(width, depth, x, maxZ)) {
        wallEdges[cellIndex(width, x, maxZ)] |= EDGE_S;
        if (inGrid(width, depth, x, maxZ + 1)) {
          wallEdges[cellIndex(width, x, maxZ + 1)] |= EDGE_N;
        }
      }
    }

    for (let z = minZ; z <= maxZ; z++) {
      if (!doorSet.has(`${minX},${z}`) && inGrid(width, depth, minX, z)) {
        wallEdges[cellIndex(width, minX, z)] |= EDGE_W;
        if (inGrid(width, depth, minX - 1, z)) {
          wallEdges[cellIndex(width, minX - 1, z)] |= EDGE_E;
        }
      }
      if (!doorSet.has(`${maxX},${z}`) && inGrid(width, depth, maxX, z)) {
        wallEdges[cellIndex(width, maxX, z)] |= EDGE_E;
        if (inGrid(width, depth, maxX + 1, z)) {
          wallEdges[cellIndex(width, maxX + 1, z)] |= EDGE_W;
        }
      }
    }
  }

  return {
    floorId: floor.id,
    width,
    depth,
    blockedCells,
    wallEdges,
  };
}

function isWallBetweenCardinal(
  grid: FloorNavGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const fromEdges = grid.wallEdges[cellIndex(grid.width, ax, az)] ?? 0;
  if (dz === -1 && (fromEdges & EDGE_N) !== 0) return true;
  if (dz === 1 && (fromEdges & EDGE_S) !== 0) return true;
  if (dx === -1 && (fromEdges & EDGE_W) !== 0) return true;
  if (dx === 1 && (fromEdges & EDGE_E) !== 0) return true;
  return false;
}

/**
 * Checks whether stepping directly from `(ax, az)` to 4-neighbor `(bx, bz)` is permitted.
 */
export function canStepBetweenCells(
  grid: FloorNavGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  if (!inGrid(grid.width, grid.depth, ax, az) || !inGrid(grid.width, grid.depth, bx, bz)) {
    return false;
  }
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) + Math.abs(dz) !== 1) return false;
  if (grid.blockedCells[cellIndex(grid.width, bx, bz)] !== 0) return false;

  return !isWallBetweenCardinal(grid, ax, az, bx, bz);
}

const CARDINAL_DIRS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 4-directional A* pathfinder respecting room wall edges and blocked furniture/desks.
 */
export const findPath: FindPath = (
  grid: FloorNavGrid,
  from: [number, number],
  to: [number, number],
): Array<[number, number]> | null => {
  const sx = Math.floor(from[0]);
  const sz = Math.floor(from[1]);
  const gx = Math.floor(to[0]);
  const gz = Math.floor(to[1]);

  if (!inGrid(grid.width, grid.depth, sx, sz) || !inGrid(grid.width, grid.depth, gx, gz)) {
    return null;
  }
  const goalIdx = cellIndex(grid.width, gx, gz);
  if (grid.blockedCells[goalIdx] !== 0) {
    return null;
  }
  const startIdx = cellIndex(grid.width, sx, sz);
  if (startIdx === goalIdx) {
    return [[sx, sz]];
  }

  const total = grid.width * grid.depth;
  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const inOpen = new Uint8Array(total);

  const heuristic = (x: number, z: number) => Math.abs(x - gx) + Math.abs(z - gz);
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(sx, sz);
  const open: number[] = [startIdx];
  inOpen[startIdx] = 1;

  while (open.length > 0) {
    let bestPos = 0;
    let current = open[0]!;
    let bestF = fScore[current]!;
    for (let i = 1; i < open.length; i++) {
      const candidate = open[i]!;
      const cf = fScore[candidate]!;
      if (cf < bestF) {
        bestF = cf;
        bestPos = i;
        current = candidate;
      }
    }

    if (current === goalIdx) {
      const path: Array<[number, number]> = [];
      let trace = current;
      while (trace !== -1) {
        const px = trace % grid.width;
        const pz = Math.floor(trace / grid.width);
        path.push([px, pz]);
        trace = cameFrom[trace]!;
      }
      path.reverse();
      return path;
    }

    open[bestPos] = open[open.length - 1]!;
    open.pop();
    inOpen[current] = 0;
    closed[current] = 1;

    const cx = current % grid.width;
    const cz = Math.floor(current / grid.width);
    const curG = gScore[current]!;

    for (const [dx, dz] of CARDINAL_DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!canStepBetweenCells(grid, cx, cz, nx, nz)) continue;
      const nIdx = cellIndex(grid.width, nx, nz);
      if (closed[nIdx] !== 0) continue;

      const tentativeG = curG + 1;
      if (tentativeG < gScore[nIdx]!) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + heuristic(nx, nz);
        if (inOpen[nIdx] === 0) {
          open.push(nIdx);
          inOpen[nIdx] = 1;
        }
      }
    }
  }

  return null;
}

/**
 * Finds the closest non-blocked cell to `target`, optionally requiring it to be
 * reachable via A* from `reachableFrom`.
 */
export function findNearestWalkableCell(
  grid: FloorNavGrid,
  target: [number, number],
  reachableFrom?: [number, number],
): [number, number] | null {
  const tx = Math.max(0, Math.min(grid.width - 1, Math.floor(target[0])));
  const tz = Math.max(0, Math.min(grid.depth - 1, Math.floor(target[1])));
  const startIdx = cellIndex(grid.width, tx, tz);
  if (
    grid.blockedCells[startIdx] === 0 &&
    (!reachableFrom || findPath(grid, reachableFrom, [tx, tz]) !== null)
  ) {
    return [tx, tz];
  }

  const visited = new Uint8Array(grid.width * grid.depth);
  const queue: number[] = [startIdx];
  visited[startIdx] = 1;

  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    const cx = idx % grid.width;
    const cz = Math.floor(idx / grid.width);

    if (
      idx !== startIdx &&
      grid.blockedCells[idx] === 0 &&
      (!reachableFrom || findPath(grid, reachableFrom, [cx, cz]) !== null)
    ) {
      return [cx, cz];
    }

    for (const [dx, dz] of CARDINAL_DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inGrid(grid.width, grid.depth, nx, nz)) continue;
      // Prefer traversing without crossing solid walls during BFS expansion
      const edges = grid.wallEdges[idx] ?? 0;
      if (dz === -1 && (edges & EDGE_N) !== 0) continue;
      if (dz === 1 && (edges & EDGE_S) !== 0) continue;
      if (dx === -1 && (edges & EDGE_W) !== 0) continue;
      if (dx === 1 && (edges & EDGE_E) !== 0) continue;

      const nIdx = cellIndex(grid.width, nx, nz);
      if (visited[nIdx] === 0) {
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  return null;
}

/**
 * Resolves the walkable chair cell behind a desk given its rotation, falling
 * back to the nearest unblocked cell if the chair tile itself is occupied.
 */
export function getDeskSeatCell(desk: DeskConfig, grid: FloorNavGrid): [number, number] {
  const rad = (desk.rotation * Math.PI) / 180;
  const cx = desk.x - Math.round(Math.sin(rad));
  const cz = desk.z - Math.round(Math.cos(rad));
  if (inGrid(grid.width, grid.depth, cx, cz) && grid.blockedCells[cellIndex(grid.width, cx, cz)] === 0) {
    return [cx, cz];
  }
  return findNearestWalkableCell(grid, [desk.x, desk.z]) ?? [desk.x, desk.z];
}

const POI_META_BY_KIND: Partial<
  Record<FurnitureKind, { actionPose: CharacterActionPose; bubbleKey: string; maxSpots: number }>
> = {
  coffee_machine: { actionPose: "drinking", bubbleKey: "office3d.bubble.coffee", maxSpots: 2 },
  water_cooler: { actionPose: "drinking", bubbleKey: "office3d.bubble.water", maxSpots: 2 },
  sofa: { actionPose: "none", bubbleKey: "office3d.bubble.sofa", maxSpots: 2 },
  whiteboard: { actionPose: "inspecting", bubbleKey: "office3d.bubble.whiteboard", maxSpots: 2 },
  bookshelf: { actionPose: "reading", bubbleKey: "office3d.bubble.bookshelf", maxSpots: 1 },
  server_rack: { actionPose: "inspecting", bubbleKey: "office3d.bubble.server", maxSpots: 1 },
  artifacts_showcase: { actionPose: "inspecting", bubbleKey: "office3d.bubble.artifacts", maxSpots: 1 },
  routines_clock: { actionPose: "inspecting", bubbleKey: "office3d.bubble.routines", maxSpots: 1 },
  approval_desk: { actionPose: "inspecting", bubbleKey: "office3d.bubble.approvals", maxSpots: 1 },
  printer: { actionPose: "inspecting", bubbleKey: "office3d.bubble.printer", maxSpots: 1 },
  filing_cabinet: { actionPose: "reading", bubbleKey: "office3d.bubble.filing", maxSpots: 1 },
  plant: { actionPose: "none", bubbleKey: "office3d.bubble.plant", maxSpots: 1 },
  aquarium: { actionPose: "inspecting", bubbleKey: "office3d.bubble.aquarium", maxSpots: 2 },
  arcade_machine: { actionPose: "playing_arcade", bubbleKey: "office3d.bubble.arcade", maxSpots: 1 },
  vending_machine: { actionPose: "drinking", bubbleKey: "office3d.bubble.vending", maxSpots: 1 },
  lounge_table: { actionPose: "reading", bubbleKey: "office3d.bubble.loungeTable", maxSpots: 1 },
  kpi_screen: { actionPose: "inspecting", bubbleKey: "office3d.bubble.kpiScreen", maxSpots: 2 },
};

const ROLE_WEIGHT_RULES: ReadonlyArray<{
  pattern: RegExp;
  boosts: Partial<Record<FurnitureKind | "corridor", number>>;
}> = [
  {
    pattern: /engineer|dev|qa|test|sre|infra|security|tech/,
    boosts: {
      server_rack: 3.0,
      whiteboard: 2.6,
      bookshelf: 2.2,
      artifacts_showcase: 2.0,
      coffee_machine: 1.8,
      arcade_machine: 1.6,
      vending_machine: 1.5,
    },
  },
  {
    pattern: /ceo|cto|vp|lead|manager|director|pm|product|design/,
    boosts: {
      whiteboard: 3.0,
      approval_desk: 2.6,
      bookshelf: 2.4,
      routines_clock: 2.0,
      sofa: 1.8,
      aquarium: 1.8,
      lounge_table: 1.6,
      coffee_machine: 1.6,
    },
  },
  {
    pattern: /hr|ops|people|admin|finance|support/,
    boosts: {
      printer: 2.6,
      filing_cabinet: 2.6,
      water_cooler: 2.2,
      routines_clock: 2.0,
      aquarium: 1.8,
      vending_machine: 1.6,
      plant: 1.6,
    },
  },
];

function checkRayLineOfSight(
  grid: FloorNavGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(dist * 8));
  let prevX = Math.floor(ax);
  let prevZ = Math.floor(az);

  if (!inGrid(grid.width, grid.depth, prevX, prevZ)) return false;
  if (grid.blockedCells[cellIndex(grid.width, prevX, prevZ)] !== 0) return false;

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.floor(ax + (bx - ax) * t);
    const cz = Math.floor(az + (bz - az) * t);
    if (cx === prevX && cz === prevZ) continue;
    if (!inGrid(grid.width, grid.depth, cx, cz)) return false;
    if (grid.blockedCells[cellIndex(grid.width, cx, cz)] !== 0) return false;

    const dx = cx - prevX;
    const dz = cz - prevZ;
    if (Math.abs(dx) + Math.abs(dz) === 1) {
      if (!canStepBetweenCells(grid, prevX, prevZ, cx, cz)) return false;
    } else if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
      const viaX =
        canStepBetweenCells(grid, prevX, prevZ, cx, prevZ) &&
        canStepBetweenCells(grid, cx, prevZ, cx, cz);
      const viaZ =
        canStepBetweenCells(grid, prevX, prevZ, prevX, cz) &&
        canStepBetweenCells(grid, prevX, cz, cx, cz);
      if (!viaX || !viaZ) return false;
    } else {
      return false;
    }

    prevX = cx;
    prevZ = cz;
  }

  return true;
}

/**
 * Checks whether a straight corridor connects the centers of cells `a` and `b`
 * with radial body clearance so smoothed paths do not clip walls or desks.
 */
export function hasLineOfSight(
  grid: FloorNavGrid,
  a: [number, number],
  b: [number, number],
): boolean {
  const ax = Math.floor(a[0]) + 0.5;
  const az = Math.floor(a[1]) + 0.5;
  const bx = Math.floor(b[0]) + 0.5;
  const bz = Math.floor(b[1]) + 0.5;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len === 0) return true;

  if (!checkRayLineOfSight(grid, ax, az, bx, bz)) return false;

  const shoulderOffset = 0.22;
  const nx = (-dz / len) * shoulderOffset;
  const nz = (dx / len) * shoulderOffset;
  return (
    checkRayLineOfSight(grid, ax + nx, az + nz, bx + nx, bz + nz) &&
    checkRayLineOfSight(grid, ax - nx, az - nz, bx - nx, bz - nz)
  );
}

/**
 * Applies greedy string-pulling to remove grid staircase zigzags while
 * preserving obstacles, walls, and doorway clearances.
 */
export function smoothPath(
  grid: FloorNavGrid,
  path: Array<[number, number]>,
): Array<[number, number]> {
  if (path.length <= 2) return [...path];
  const smoothed: Array<[number, number]> = [path[0]!];
  let i = 0;

  while (i < path.length - 1) {
    let furthest = i + 1;
    for (let j = path.length - 1; j > i + 1; j--) {
      if (hasLineOfSight(grid, path[i]!, path[j]!)) {
        furthest = j;
        break;
      }
    }
    smoothed.push(path[furthest]!);
    i = furthest;
  }

  return smoothed;
}

/**
 * Collects diverse, wall-aware Points of Interest (POIs) around interactive
 * office props (coffee, water cooler, bookshelf, whiteboard, servers, etc.)
 * plus open lobby stroll spots.
 */
export function getIdlePointsOfInterest(
  floor: FloorConfig,
  grid: FloorNavGrid,
): IdlePointOfInterest[] {
  const pois: IdlePointOfInterest[] = [];
  const seenCells = new Set<string>();

  for (const item of floor.furniture) {
    const meta = POI_META_BY_KIND[item.kind];
    if (!meta) continue;
    if (!inGrid(grid.width, grid.depth, item.x, item.z)) continue;

    const rad = (item.rotation * Math.PI) / 180;
    const frontDx = Math.round(Math.sin(rad));
    const frontDz = Math.round(Math.cos(rad));
    const dirs: Array<[number, number]> = [[frontDx, frontDz]];
    for (const dir of CARDINAL_DIRS) {
      if (dir[0] !== frontDx || dir[1] !== frontDz) {
        dirs.push(dir);
      }
    }

    let addedForItem = 0;
    for (const [dx, dz] of dirs) {
      if (addedForItem >= meta.maxSpots) break;
      const nx = item.x + dx;
      const nz = item.z + dz;
      if (!inGrid(grid.width, grid.depth, nx, nz)) continue;
      if (grid.blockedCells[cellIndex(grid.width, nx, nz)] !== 0) continue;
      if (isWallBetweenCardinal(grid, item.x, item.z, nx, nz)) continue;

      const cellKey = `${nx},${nz}`;
      if (seenCells.has(cellKey)) continue;
      seenCells.add(cellKey);
      pois.push({
        key: `poi-${item.id}-${nx}-${nz}`,
        cell: [nx, nz],
        lookAt: { x: item.x + 0.5, z: item.z + 0.5 },
        kind: item.kind,
        actionPose: meta.actionPose,
        bubbleKey: meta.bubbleKey,
        furnitureId: item.id,
        roomId: item.roomId,
      });
      addedForItem += 1;
    }
  }

  const insideAnyRoom = (x: number, z: number) =>
    floor.rooms.some(
      (r) => x >= r.bounds.minX && x <= r.bounds.maxX && z >= r.bounds.minZ && z <= r.bounds.maxZ,
    );

  const midX = Math.floor(grid.width / 2);
  for (let z = 5; z <= grid.depth - 4; z += 5) {
    for (let dx = -3; dx <= 3; dx += 3) {
      const x = midX + dx;
      if (!inGrid(grid.width, grid.depth, x, z)) continue;
      if (grid.blockedCells[cellIndex(grid.width, x, z)] !== 0) continue;
      if (insideAnyRoom(x, z)) continue;
      const cellKey = `${x},${z}`;
      if (seenCells.has(cellKey)) continue;
      seenCells.add(cellKey);
      pois.push({
        key: `poi-corridor-${x}-${z}`,
        cell: [x, z],
        lookAt: null,
        kind: "corridor",
        actionPose: "none",
        bubbleKey: "office3d.bubble.stroll",
      });
    }
  }

  return pois;
}

/**
 * Selects an available idle POI with soft role affinity and variety across visits.
 */
export function pickWeightedIdlePoi(
  pois: readonly IdlePointOfInterest[],
  options: {
    role: string;
    occupiedCells: ReadonlySet<string>;
    excludeKey?: string | null;
    behavior?: {
      refreshmentWeight?: number;
      wanderWeight?: number;
    } | null;
    rng?: () => number;
  },
): IdlePointOfInterest | null {
  if (pois.length === 0) return null;
  const unblocked = pois.filter((p) => !options.occupiedCells.has(`${p.cell[0]},${p.cell[1]}`));
  const basePool = unblocked.length > 0 ? unblocked : [...pois];
  const nonRepeated =
    options.excludeKey && basePool.some((p) => p.key !== options.excludeKey)
      ? basePool.filter((p) => p.key !== options.excludeKey)
      : basePool;

  const lowerRole = options.role.toLowerCase();
  const matchedRules = ROLE_WEIGHT_RULES.filter((r) => r.pattern.test(lowerRole));
  const refreshmentScale = options.behavior?.refreshmentWeight ?? 1;
  const wanderScale = options.behavior?.wanderWeight ?? 1;
  const weights = nonRepeated.map((poi) => {
    let weight = poi.kind === "corridor" ? 0.65 : 1.0;
    for (const rule of matchedRules) {
      const boost = rule.boosts[poi.kind];
      if (typeof boost === "number") {
        weight = Math.max(weight, boost);
      }
    }
    const isRefreshment = poi.kind === "water_cooler" || poi.kind === "coffee_machine";
    return Math.max(0, weight * (isRefreshment ? refreshmentScale : wanderScale));
  });

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight <= 0) return null;
  let cursor = (options.rng ?? Math.random)() * totalWeight;
  for (let i = 0; i < nonRepeated.length; i++) {
    cursor -= weights[i]!;
    if (cursor <= 0) {
      return nonRepeated[i]!;
    }
  }
  return nonRepeated[nonRepeated.length - 1] ?? null;
}

/**
 * Collects walkable corridor & POI spots for idle agents taking a break.
 */
export function getLoungeSpotCells(floor: FloorConfig, grid: FloorNavGrid): Array<[number, number]> {
  return getIdlePointsOfInterest(floor, grid).map((p) => p.cell);
}

/**
 * Resolves up to `count` walkable seats around the floor's meeting table.
 */
export function getMeetingSeatCells(
  floor: FloorConfig,
  grid: FloorNavGrid,
  count: number,
): { tableCenter: [number, number]; seats: Array<[number, number]> } | null {
  const table = floor.furniture.find((f) => f.kind === "meeting_table");
  if (!table) return null;

  const isRotated = table.rotation === 90 || table.rotation === 270;
  const candidateOffsets: ReadonlyArray<[number, number]> = isRotated
    ? [
        [-1, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [1, 1],
        [0, -2],
        [0, 2],
        [-2, 0],
        [2, 0],
      ]
    : [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 1],
        [0, 1],
        [1, 1],
        [-2, 0],
        [2, 0],
        [-2, -1],
        [2, 1],
        [-2, 1],
        [2, -1],
      ];

  const room = table.roomId ? floor.rooms.find((r) => r.id === table.roomId) ?? null : null;
  const seats: Array<[number, number]> = [];
  for (const [dx, dz] of candidateOffsets) {
    if (seats.length >= count) break;
    const x = table.x + dx;
    const z = table.z + dz;
    if (!inGrid(grid.width, grid.depth, x, z)) continue;
    if (grid.blockedCells[cellIndex(grid.width, x, z)] !== 0) continue;
    if (
      room &&
      (x < room.bounds.minX || x > room.bounds.maxX || z < room.bounds.minZ || z > room.bounds.maxZ)
    ) {
      continue;
    }
    seats.push([x, z]);
  }

  return { tableCenter: [table.x, table.z], seats };
}
