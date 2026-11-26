import { describe, expect, it } from "vitest";
import {
  buildFloorNavGrid,
  canStepBetweenCells,
  findPath,
  getDeskSeatCell,
  getIdlePointsOfInterest,
  getLoungeSpotCells,
  getMeetingSeatCells,
  hasLineOfSight,
  pickWeightedIdlePoi,
  smoothPath,
} from "./navGrid";
import type { DeskConfig, FloorConfig } from "./types";

function makeTestFloor(overrides: Partial<FloorConfig> = {}): FloorConfig {
  return {
    id: "floor-1",
    name: "Floor 1",
    gridSize: [16, 16],
    elevatorCell: [8, 1],
    rooms: [
      {
        id: "room-exec",
        name: "Executive",
        floorPalette: "amber",
        wallStyle: "glass",
        bounds: { minX: 1, minZ: 1, maxX: 6, maxZ: 6 },
        doors: [{ x: 6, z: 3 }],
      },
      {
        id: "room-meet",
        name: "Meeting",
        floorPalette: "slate",
        wallStyle: "wood",
        bounds: { minX: 1, minZ: 8, maxX: 7, maxZ: 14 },
        doors: [{ x: 7, z: 11 }],
      },
    ],
    desks: [
      { id: "d1", x: 3, z: 3, rotation: 180, roomId: "room-exec", assignedAgentId: "a1" },
    ],
    furniture: [
      { id: "f-meet", kind: "meeting_table", x: 4, z: 11, rotation: 0, roomId: "room-meet" },
      { id: "f-coffee", kind: "coffee_machine", x: 11, z: 8, rotation: 0, roomId: null },
    ],
    ...overrides,
  };
}

describe("FloorNavGrid & A* pathfinding", () => {
  it("routes strictly through declared room doors and never crosses solid walls or obstacles", () => {
    const floor = makeTestFloor();
    const grid = buildFloorNavGrid(floor);

    const path = findPath(grid, [3, 4], [11, 9]);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual([3, 4]);
    expect(path![path!.length - 1]).toEqual([11, 9]);

    // Every consecutive step must satisfy canStepBetweenCells
    for (let i = 1; i < path!.length; i++) {
      const [ax, az] = path![i - 1]!;
      const [bx, bz] = path![i]!;
      expect(canStepBetweenCells(grid, ax, az, bx, bz)).toBe(true);
    }

    // Must cross East boundary at the door (6, 3) -> (7, 3)
    const crossedDoor = path!.some(
      (cell, idx) =>
        idx > 0 &&
        path![idx - 1]![0] === 6 &&
        path![idx - 1]![1] === 3 &&
        cell[0] === 7 &&
        cell[1] === 3,
    );
    expect(crossedDoor).toBe(true);
  });

  it("returns null when a room has no door or the destination is blocked", () => {
    const floor = makeTestFloor({
      rooms: [
        {
          id: "sealed",
          name: "Sealed",
          floorPalette: "slate",
          wallStyle: "wood",
          bounds: { minX: 1, minZ: 1, maxX: 5, maxZ: 5 },
          doors: [],
        },
      ],
      desks: [{ id: "d1", x: 3, z: 3, rotation: 0, roomId: "sealed", assignedAgentId: "a1" }],
      furniture: [],
    });
    const grid = buildFloorNavGrid(floor);

    expect(findPath(grid, [3, 2], [10, 10])).toBeNull();
    // Target is blocked desk cell
    expect(findPath(grid, [10, 10], [3, 3])).toBeNull();
  });

  it("treats wallStyle === 'none' rooms as open floor without wall blockers", () => {
    const floor = makeTestFloor({
      rooms: [
        {
          id: "open-zone",
          name: "Open Zone",
          floorPalette: "sage",
          wallStyle: "none",
          bounds: { minX: 1, minZ: 1, maxX: 5, maxZ: 5 },
          doors: [],
        },
      ],
      desks: [],
      furniture: [],
    });
    const grid = buildFloorNavGrid(floor);
    const path = findPath(grid, [3, 3], [8, 3]);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(6);
  });

  it("resolves desk seat cells accurately across all 4 rotations", () => {
    const floor = makeTestFloor({ desks: [], furniture: [] });
    const grid = buildFloorNavGrid(floor);

    const makeDesk = (rotation: DeskConfig["rotation"]): DeskConfig => ({
      id: "desk",
      x: 5,
      z: 5,
      rotation,
      roomId: null,
      assignedAgentId: null,
    });

    expect(getDeskSeatCell(makeDesk(0), grid)).toEqual([5, 4]);
    expect(getDeskSeatCell(makeDesk(90), grid)).toEqual([4, 5]);
    expect(getDeskSeatCell(makeDesk(180), grid)).toEqual([5, 6]);
    expect(getDeskSeatCell(makeDesk(270), grid)).toEqual([6, 5]);
  });

  it("collects distinct walkable seats around meeting_table and lounge spots", () => {
    const floor = makeTestFloor();
    const grid = buildFloorNavGrid(floor);

    const loungeSpots = getLoungeSpotCells(floor, grid);
    expect(loungeSpots.length).toBeGreaterThan(0);
    for (const [lx, lz] of loungeSpots) {
      expect(grid.blockedCells[lz * grid.width + lx]).toBe(0);
    }

    const meeting = getMeetingSeatCells(floor, grid, 4);
    expect(meeting).not.toBeNull();
    expect(meeting!.tableCenter).toEqual([4, 11]);
    expect(meeting!.seats).toHaveLength(4);
    for (const seat of meeting!.seats) {
      const path = findPath(grid, [3, 4], seat);
      expect(path).not.toBeNull();
    }
  });

  it("smooths open diagonals while preserving wall corners and doorways", () => {
    const floor = makeTestFloor();
    const grid = buildFloorNavGrid(floor);

    const openRaw = findPath(grid, [9, 2], [13, 6]);
    expect(openRaw).not.toBeNull();
    const openSmoothed = smoothPath(grid, openRaw!);
    expect(openSmoothed.length).toBeLessThan(openRaw!.length);
    expect(openSmoothed[0]).toEqual([9, 2]);
    expect(openSmoothed[openSmoothed.length - 1]).toEqual([13, 6]);

    // Path leaving room-exec through door (6,3)->(7,3) must never gain direct LOS across the solid wall
    expect(hasLineOfSight(grid, [4, 2], [9, 5])).toBe(false);
    const doorRaw = findPath(grid, [4, 2], [9, 5]);
    expect(doorRaw).not.toBeNull();
    const doorSmoothed = smoothPath(grid, doorRaw!);
    for (let i = 1; i < doorSmoothed.length; i++) {
      expect(hasLineOfSight(grid, doorSmoothed[i - 1]!, doorSmoothed[i]!)).toBe(true);
    }
  });

  it("extracts wall-aware POIs for expanded furniture and weights selection by role", () => {
    const floor = makeTestFloor({
      furniture: [
        { id: "f-meet", kind: "meeting_table", x: 4, z: 11, rotation: 0, roomId: "room-meet" },
        { id: "f-wb", kind: "whiteboard", x: 6, z: 5, rotation: 270, roomId: "room-exec" },
        { id: "f-book", kind: "bookshelf", x: 10, z: 4, rotation: 90, roomId: null },
        { id: "f-water", kind: "water_cooler", x: 10, z: 8, rotation: 90, roomId: null },
        { id: "f-printer", kind: "printer", x: 12, z: 6, rotation: 0, roomId: null },
        { id: "f-filing", kind: "filing_cabinet", x: 12, z: 10, rotation: 180, roomId: null },
        { id: "f-server", kind: "server_rack", x: 14, z: 4, rotation: 270, roomId: null },
      ],
    });
    const grid = buildFloorNavGrid(floor);
    const pois = getIdlePointsOfInterest(floor, grid);

    // Whiteboard at (6, 5) next to solid East wall must never yield an outside spot at (7, 5)
    const wbPois = pois.filter((p) => p.furnitureId === "f-wb");
    expect(wbPois.length).toBeGreaterThan(0);
    expect(wbPois.some((p) => p.cell[0] === 7 && p.cell[1] === 5)).toBe(false);

    for (const kind of ["bookshelf", "water_cooler", "printer", "filing_cabinet", "server_rack"] as const) {
      expect(pois.some((p) => p.kind === kind)).toBe(true);
    }

    const filteredPois = pois.filter((p) => p.kind === "server_rack" || p.kind === "corridor");
    let serverHits = 0;
    for (let i = 0; i < 40; i++) {
      const picked = pickWeightedIdlePoi(filteredPois, {
        role: "Senior Software Engineer",
        occupiedCells: new Set(),
        rng: () => (i + 0.5) / 40,
      });
      if (picked?.kind === "server_rack") serverHits += 1;
    }
    expect(serverHits).toBeGreaterThan(10);

    const excluded = pickWeightedIdlePoi(pois.slice(0, 2), {
      role: "ceo",
      occupiedCells: new Set(),
      excludeKey: pois[0]!.key,
      rng: () => 0.1,
    });
    expect(excluded?.key).toBe(pois[1]!.key);
  });

  it("marks full multi-cell spans of wide furniture blocked while keeping doors, meeting seats, and POI cells open", () => {
    const floor = makeTestFloor({
      furniture: [
        { id: "f-meet", kind: "meeting_table", x: 4, z: 11, rotation: 0, roomId: "room-meet" },
        { id: "f-sofa", kind: "sofa", x: 11, z: 6, rotation: 180, roomId: null },
        { id: "f-hr", kind: "hr_reception", x: 11, z: 10, rotation: 0, roomId: null },
        { id: "f-plant", kind: "plant", x: 10, z: 2, rotation: 0, roomId: null },
        { id: "f-art", kind: "artifacts_showcase", x: 13, z: 13, rotation: 0, roomId: null },
      ],
    });
    const grid = buildFloorNavGrid(floor);

    // Sofa (1.9m) centered at x=11 blocks x=10,11,12 along z=6
    expect(grid.blockedCells[6 * grid.width + 10]).toBe(1);
    expect(grid.blockedCells[6 * grid.width + 11]).toBe(1);
    expect(grid.blockedCells[6 * grid.width + 12]).toBe(1);

    // HR reception (1.8m) centered at x=11 blocks x=10,11,12 along z=10
    expect(grid.blockedCells[10 * grid.width + 10]).toBe(1);
    expect(grid.blockedCells[10 * grid.width + 12]).toBe(1);

    // Plant & artifacts_showcase are marked blocked
    expect(grid.blockedCells[2 * grid.width + 10]).toBe(1);
    expect(grid.blockedCells[13 * grid.width + 13]).toBe(1);

    // Doorways, meeting seats, and Exec desk chair stay passable & reachable
    expect(findPath(grid, [3, 4], [11, 5])).not.toBeNull();
    const meeting = getMeetingSeatCells(floor, grid, 4);
    expect(meeting?.seats).toHaveLength(4);
    expect(findPath(grid, [3, 4], meeting!.seats[0]!)).not.toBeNull();
  });
});
