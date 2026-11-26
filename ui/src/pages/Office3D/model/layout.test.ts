import { describe, expect, it } from "vitest";
import { OFFICE_SCHEMA_VERSION } from "./constants";
import {
  autoPlaceDeskInBuilding,
  buildInteractiveStations,
  canMoveBetween,
  computePlayerGroundY,
  computeRoomDeskCapacity,
  createBlueprintExport,
  createPresetDefaultHqLayout,
  generateLayoutFromOrg,
  getAgentIdsSeatedOnOtherFloors,
  hasUnobstructedWallLineOfSight,
  isBuildCellOccupied,
  isPointBlocked,
  moveDeskToCell,
  moveFurnitureToCell,
  moveRoomToCell,
  parseBlueprintImport,
  rotateGridRotation,
  validateAndSanitizeLayout,
  validateRoom,
} from "./layout";
import type { FloorConfig, OfficeLayout, OrgLayoutAgentInput, RoomConfig } from "./types";

function makeAgents(count: number): OrgLayoutAgentInput[] {
  const list: OrgLayoutAgentInput[] = [
    { agentId: "a-ceo", name: "Founder", role: "ceo", reportsTo: null, status: "active" },
  ];
  for (let i = 1; i < count; i++) {
    list.push({
      agentId: `a-${i}`,
      name: `Worker ${i}`,
      role: i % 2 === 0 ? "engineer" : "qa",
      reportsTo: "a-ceo",
      status: "active",
    });
  }
  return list;
}

describe("generateLayoutFromOrg", () => {
  it("generates deterministic layouts and excludes terminated / pending_approval agents from desks", () => {
    const agents: OrgLayoutAgentInput[] = [
      ...makeAgents(4),
      { agentId: "a-term", name: "Old Bot", role: "engineer", reportsTo: "a-ceo", status: "terminated" },
      { agentId: "a-pend", name: "New Hire", role: "engineer", reportsTo: "a-ceo", status: "pending_approval" },
    ];

    const first = generateLayoutFromOrg("company-1", agents);
    const second = generateLayoutFromOrg("company-1", agents);
    expect(first.buildings).toEqual(second.buildings);

    const assignedIds = first.buildings
      .flatMap((b) => b.floors)
      .flatMap((f) => f.desks)
      .map((d) => d.assignedAgentId)
      .filter((id): id is string => id !== null);

    expect(assignedIds).toContain("a-ceo");
    expect(assignedIds).not.toContain("a-term");
    expect(assignedIds).not.toContain("a-pend");
  });

  it("overflows into additional floors with matching elevator cells when maxDesksPerFloor is exceeded", () => {
    const agents = makeAgents(18);
    const layout = generateLayoutFromOrg("company-1", agents, { maxDesksPerFloor: 6 });
    const floors = layout.buildings[0]!.floors;
    expect(floors.length).toBeGreaterThan(1);
    expect(floors[0]!.elevatorCell).toEqual(floors[1]!.elevatorCell);
  });

  it("populates rich lobby & room furniture without overlapping desks, chairs, or room doors", () => {
    const orgLayout = generateLayoutFromOrg("company-rich", makeAgents(5));
    const presetLayout = createPresetDefaultHqLayout("company-preset");

    for (const layout of [orgLayout, presetLayout]) {
      const allFurniture = layout.buildings.flatMap((b) => b.floors).flatMap((f) => f.furniture);
      for (const expectedKind of ["bookshelf", "water_cooler", "printer", "filing_cabinet"] as const) {
        expect(allFurniture.some((f) => f.kind === expectedKind)).toBe(true);
      }

      for (const floor of layout.buildings.flatMap((b) => b.floors)) {
        const blockedByDesks = new Set<string>();
        for (const desk of floor.desks) {
          blockedByDesks.add(`${desk.x},${desk.z}`);
          const rad = (desk.rotation * Math.PI) / 180;
          blockedByDesks.add(`${desk.x - Math.round(Math.sin(rad))},${desk.z - Math.round(Math.cos(rad))}`);
        }
        const furnitureCoords = new Set<string>();
        for (const item of floor.furniture) {
          const coord = `${item.x},${item.z}`;
          expect(blockedByDesks.has(coord)).toBe(false);
          expect(furnitureCoords.has(coord)).toBe(false);
          furnitureCoords.add(coord);
          for (const room of floor.rooms) {
            for (const door of room.doors) {
              expect(
                Math.abs(item.x - door.x) <= 1 && Math.abs(item.z - door.z) <= 1,
              ).toBe(false);
            }
          }
        }
      }
    }
  });
});

describe("validateAndSanitizeLayout & validateRoom", () => {
  it("rejects mismatched schemaVersion and corrupt payloads", () => {
    expect(validateAndSanitizeLayout(null, "c1", new Set())).toBeNull();
    expect(validateAndSanitizeLayout({ schemaVersion: 99, buildings: [] }, "c1", new Set())).toBeNull();
  });

  it("enforces desk invariants, removes unknown/terminated agents, aligns elevators, and repairs missing doors", () => {
    const raw: OfficeLayout = {
      schemaVersion: OFFICE_SCHEMA_VERSION,
      companyId: "old-company",
      updatedAt: "2026-11-24T00:00:00.000Z",
      buildings: [
        {
          id: "b1",
          name: "HQ",
          floors: [
            {
              id: "f1",
              name: "F1",
              gridSize: [30, 30],
              elevatorCell: [14, 1],
              rooms: [
                {
                  id: "r1",
                  name: "No Door Room",
                  floorPalette: "slate",
                  wallStyle: "glass",
                  bounds: { minX: 1, minZ: 1, maxX: 6, maxZ: 6 },
                  doors: [],
                },
                {
                  id: "r-overlap",
                  name: "Overlapping",
                  floorPalette: "amber",
                  wallStyle: "wood",
                  bounds: { minX: 4, minZ: 4, maxX: 9, maxZ: 9 },
                  doors: [{ x: 9, z: 6 }],
                },
              ],
              desks: [
                { id: "d1", x: 3, z: 3, rotation: 0, roomId: "r1", assignedAgentId: "agent-1" },
                { id: "d2", x: 4, z: 3, rotation: 0, roomId: "r1", assignedAgentId: "agent-1" },
                { id: "d3", x: 5, z: 3, rotation: 0, roomId: "r1", assignedAgentId: "terminated-agent" },
              ],
              furniture: [],
            },
            {
              id: "f2",
              name: "F2",
              gridSize: [30, 30],
              elevatorCell: [2, 2],
              rooms: [],
              desks: [],
              furniture: [],
            },
          ],
        },
      ],
    };

    const result = validateAndSanitizeLayout(raw, "target-company", new Set(["agent-1"]));
    expect(result).not.toBeNull();
    expect(result!.repaired).toBe(true);

    const floor1 = result!.layout.buildings[0]!.floors[0]!;
    const floor2 = result!.layout.buildings[0]!.floors[1]!;

    // Overlapping room dropped; no-door room repaired with a boundary door
    expect(floor1.rooms).toHaveLength(1);
    expect(floor1.rooms[0]!.doors.length).toBeGreaterThanOrEqual(1);

    // Agent-1 kept only once; terminated-agent cleared
    expect(floor1.desks[0]!.assignedAgentId).toBe("agent-1");
    expect(floor1.desks[1]!.assignedAgentId).toBeNull();
    expect(floor1.desks[2]!.assignedAgentId).toBeNull();

    // Elevator aligned across floors
    expect(floor2.elevatorCell).toEqual(floor1.elevatorCell);
  });

  it("reports validation failure reasons accurately via validateRoom", () => {
    const existing: RoomConfig[] = [
      {
        id: "r1",
        name: "Existing",
        floorPalette: "slate",
        wallStyle: "glass",
        bounds: { minX: 1, minZ: 1, maxX: 6, maxZ: 6 },
        doors: [{ x: 6, z: 3 }],
      },
    ];

    expect(
      validateRoom(
        { ...existing[0]!, id: "r2", bounds: { minX: 1, minZ: 1, maxX: 2, maxZ: 2 } },
        existing,
        [30, 30],
      ),
    ).toEqual({ valid: false, reason: "too_small" });

    expect(
      validateRoom(
        { ...existing[0]!, id: "r2", bounds: { minX: 25, minZ: 1, maxX: 31, maxZ: 5 } },
        existing,
        [30, 30],
      ),
    ).toEqual({ valid: false, reason: "out_of_bounds" });

    expect(
      validateRoom(
        { ...existing[0]!, id: "r2", bounds: { minX: 5, minZ: 5, maxX: 10, maxZ: 10 }, doors: [{ x: 10, z: 7 }] },
        existing,
        [30, 30],
      ),
    ).toEqual({ valid: false, reason: "overlaps" });

    expect(
      validateRoom(
        { ...existing[0]!, id: "r2", bounds: { minX: 10, minZ: 10, maxX: 15, maxZ: 15 }, doors: [] },
        existing,
        [30, 30],
      ),
    ).toEqual({ valid: false, reason: "missing_door" });
  });
});

describe("canMoveBetween & Blueprint Export/Import", () => {
  const sampleFloor: FloorConfig = {
    id: "f1",
    name: "F1",
    gridSize: [20, 20],
    elevatorCell: [14, 1],
    rooms: [
      {
        id: "r1",
        name: "Office",
        floorPalette: "slate",
        wallStyle: "glass",
        bounds: { minX: 2, minZ: 2, maxX: 6, maxZ: 6 },
        doors: [{ x: 6, z: 4 }],
      },
    ],
    desks: [{ id: "d1", x: 3, z: 4, rotation: 0, roomId: "r1", assignedAgentId: null }],
    furniture: [],
  };

  it("blocks crossing solid walls while permitting passage through doors and blocking desks", () => {
    // Solid east wall at x=7 for z=2.5 (no door at z=2)
    expect(canMoveBetween(sampleFloor, 6.8, 2.5, 7.2, 2.5)).toBe(false);

    // Door on east wall at cell (6, 4) -> z in [4, 5)
    expect(canMoveBetween(sampleFloor, 6.8, 4.5, 7.2, 4.5)).toBe(true);

    // Desk at (3, 4) blocks movement to its center (3.5, 4.5)
    expect(canMoveBetween(sampleFloor, 2.5, 4.5, 3.5, 4.5)).toBe(false);
  });

  it("strips foreign agent assignments when importing blueprints into a new company", () => {
    const layout = generateLayoutFromOrg("source-co", makeAgents(3));
    const json = JSON.stringify(createBlueprintExport(layout, "Source Co"));
    const imported = parseBlueprintImport(json, "target-co", new Set(["only-target-agent"]));

    expect(imported).not.toBeNull();
    expect(imported!.strippedForeignAgents).toBe(true);
    expect(imported!.layout.companyId).toBe("target-co");
    for (const desk of imported!.layout.buildings[0]!.floors[0]!.desks) {
      expect(desk.assignedAgentId).toBeNull();
    }
  });

  it("blocks oriented multi-cell furniture footprints including plant, artifacts_showcase, routines_clock, whiteboard, and sofa wings", () => {
    const richFloor: FloorConfig = {
      id: "f-col",
      name: "Collision Floor",
      gridSize: [30, 30],
      elevatorCell: [14, 1],
      rooms: [],
      desks: [{ id: "d1", x: 5, z: 5, rotation: 0, roomId: null, assignedAgentId: "a1" }],
      furniture: [
        { id: "s1", kind: "sofa", x: 10, z: 10, rotation: 0, roomId: null },
        { id: "s2", kind: "sofa", x: 15, z: 10, rotation: 90, roomId: null },
        { id: "m1", kind: "meeting_table", x: 20, z: 10, rotation: 0, roomId: null },
        { id: "p1", kind: "plant", x: 10, z: 15, rotation: 0, roomId: null },
        { id: "a1", kind: "artifacts_showcase", x: 14, z: 15, rotation: 0, roomId: null },
        { id: "r1", kind: "routines_clock", x: 18, z: 15, rotation: 0, roomId: null },
        { id: "w1", kind: "whiteboard", x: 22, z: 15, rotation: 0, roomId: null },
        { id: "h1", kind: "hr_reception", x: 10, z: 20, rotation: 0, roomId: null },
      ],
    };

    // Sofa (1.9m wide): outer wing ±0.95m is blocked, front cell +1.0m stays passable
    expect(isPointBlocked(richFloor, 10.5 + 0.95, 10.5)).toBe(true);
    expect(isPointBlocked(richFloor, 10.5 - 0.95, 10.5)).toBe(true);
    expect(isPointBlocked(richFloor, 10.5, 11.5)).toBe(false);

    // Rotated 90° sofa: elongated along Z instead of X
    expect(isPointBlocked(richFloor, 15.5, 10.5 + 0.95)).toBe(true);
    expect(isPointBlocked(richFloor, 15.5 + 0.95, 10.5)).toBe(false);

    // Meeting table ends ±1.3m & HR reception wings ±0.9m
    expect(isPointBlocked(richFloor, 20.5 + 1.25, 10.5)).toBe(true);
    expect(isPointBlocked(richFloor, 10.5 + 0.9, 20.5)).toBe(true);

    // Previously non-blocking items now block their footprints
    expect(isPointBlocked(richFloor, 10.5, 15.5)).toBe(true);
    expect(isPointBlocked(richFloor, 14.5 + 0.55, 15.5)).toBe(true);
    expect(isPointBlocked(richFloor, 18.5, 15.5)).toBe(true);
    expect(isPointBlocked(richFloor, 22.5 + 0.85, 15.5)).toBe(true);

    // Desk chair seated position (0.52m behind desk rotation=0) remains passable
    expect(isPointBlocked(richFloor, 5.5, 5.5 - 0.52)).toBe(false);

    // Elevator cabin (width=1.5, depth=1.0 centered at 14.5, 1.5) blocks center & side edges while front landing stays open
    expect(isPointBlocked(richFloor, 14.5, 1.5)).toBe(true);
    expect(isPointBlocked(richFloor, 14.5 + 0.7, 1.5)).toBe(true);
    expect(isPointBlocked(richFloor, 14.5, 2.4)).toBe(false);
  });
});

describe("getAgentIdsSeatedOnOtherFloors", () => {
  it("returns agents assigned to desks on other floors across all buildings while excluding active floor and unassigned agents", () => {
    const layout = createPresetDefaultHqLayout("co-multi");
    // Preset has 2 floors on building-hq; add an extra building to ensure cross-building lookup works too.
    layout.buildings[0]!.floors[0]!.desks[0]!.assignedAgentId = "agent-f1-a";
    layout.buildings[0]!.floors[0]!.desks[1]!.assignedAgentId = "agent-f1-b";
    layout.buildings[0]!.floors[1]!.desks.push({
      id: "desk-f2-assigned",
      x: 5,
      z: 5,
      rotation: 0,
      roomId: null,
      assignedAgentId: "agent-f2-a",
    });
    layout.buildings.push({
      id: "building-annex",
      name: "Annex",
      floors: [
        {
          id: "floor-annex-1",
          name: "Annex Floor 1",
          gridSize: [20, 20],
          elevatorCell: null,
          rooms: [],
          desks: [
            { id: "desk-annex-1", x: 3, z: 3, rotation: 0, roomId: null, assignedAgentId: "agent-annex" },
            { id: "desk-annex-empty", x: 6, z: 3, rotation: 0, roomId: null, assignedAgentId: null },
          ],
          furniture: [],
        },
      ],
    });

    const floor1Id = layout.buildings[0]!.floors[0]!.id;
    const floor2Id = layout.buildings[0]!.floors[1]!.id;

    const whenViewingFloor1 = getAgentIdsSeatedOnOtherFloors(layout, floor1Id);
    expect([...whenViewingFloor1].sort()).toEqual(["agent-annex", "agent-f2-a"]);

    const whenViewingFloor2 = getAgentIdsSeatedOnOtherFloors(layout, floor2Id);
    expect([...whenViewingFloor2].sort()).toEqual(["agent-annex", "agent-f1-a", "agent-f1-b"]);
  });
});

describe("buildInteractiveStations", () => {
  it("emits stations for unassigned empty chairs and interactive props alongside core Paperclip stations", () => {
    const layout = createPresetDefaultHqLayout("co-stations");
    const floor1 = layout.buildings[0]!.floors[0]!;
    const stations = buildInteractiveStations(floor1, {
      companyId: "co-stations",
      pendingApprovalsCount: 0,
      upcomingRoutines: [],
      runningWorkspaces: [],
      recentArtifactsCount: 0,
      agentsById: {},
      allowedActions: [],
    });

    const kinds = new Set(stations.map((s) => s.kind));
    expect(kinds.has("empty_chair")).toBe(true);
    expect(kinds.has("sofa")).toBe(true);
    expect(kinds.has("coffee_machine")).toBe(true);
    expect(kinds.has("water_cooler")).toBe(true);
    expect(kinds.has("meeting_table")).toBe(true);
    expect(kinds.has("bookshelf")).toBe(true);
    expect(kinds.has("printer")).toBe(true);
    expect(kinds.has("filing_cabinet")).toBe(true);
    expect(kinds.has("plant")).toBe(true);
    expect(kinds.has("elevator")).toBe(true);

    const floor2Stations = buildInteractiveStations(floor1, {
      companyId: "co-stations",
      pendingApprovalsCount: 0,
      upcomingRoutines: [],
      runningWorkspaces: [],
      recentArtifactsCount: 0,
      agentsById: {},
      allowedActions: [],
    }, 1);
    expect(stations.some((s) => s.labelKey === "office3d.station.outdoorBench")).toBe(true);
    expect(floor2Stations.some((s) => s.labelKey === "office3d.station.balconyBench")).toBe(true);
  });

  it("allows exiting Floor 1 through South entrance onto outdoor campus and Floor 2 onto the balcony while blocking walls and trees", () => {
    const layout = createPresetDefaultHqLayout("co-outdoor");
    const floor1 = layout.buildings[0]!.floors[0]!;

    // Ground campus: exit via South center door passage is allowed; crossing solid South wall off-center is blocked
    expect(canMoveBetween(floor1, 15.0, 29.8, 15.0, 30.2, "ground_campus")).toBe(true);
    expect(canMoveBetween(floor1, 6.0, 29.3, 6.0, 30.8, "ground_campus")).toBe(false);
    expect(isPointBlocked(floor1, 15.0, 33.0, "ground_campus")).toBe(false);
    // Tree trunk at [-4.5, -4] is blocked outdoors
    expect(isPointBlocked(floor1, -4.5, -4.0, "ground_campus")).toBe(true);
    // Ground Y steps smoothly down to OUTDOOR_GROUND_Y (-0.27)
    expect(computePlayerGroundY(15, 29, 30, 30, "ground_campus")).toBe(0);
    expect(computePlayerGroundY(15, 33, 30, 30, "ground_campus")).toBeLessThan(0);

    // Floor 2 balcony: exit via South doors allowed onto deck, blocked past railing (z > 34)
    expect(canMoveBetween(floor1, 15.0, 29.8, 15.0, 30.2, "balcony")).toBe(true);
    expect(isPointBlocked(floor1, 15.0, 32.0, "balcony")).toBe(false);
    expect(isPointBlocked(floor1, 15.0, 34.1, "balcony")).toBe(true);
    expect(isPointBlocked(floor1, 5.0, 32.0, "balcony")).toBe(true);
    expect(computePlayerGroundY(15, 32, 30, 30, "balcony")).toBe(0);

    // Wall line-of-sight blocks gifting across a glass partition wall but permits open doorway
    expect(hasUnobstructedWallLineOfSight(floor1, 20.5, 4.5, 18.0, 2.5)).toBe(false);
    expect(hasUnobstructedWallLineOfSight(floor1, 19.5, 5.5, 18.0, 5.5)).toBe(true);
  });
});

describe("build mode move and rotate helpers", () => {
  it("rotates grid rotations cleanly in 90-degree increments", () => {
    expect(rotateGridRotation(0)).toBe(90);
    expect(rotateGridRotation(90)).toBe(180);
    expect(rotateGridRotation(180)).toBe(270);
    expect(rotateGridRotation(270)).toBe(0);
    expect(rotateGridRotation(0, -90)).toBe(270);
  });

  it("checks cell occupation and moves desks, furniture, and rooms while preserving invariants", () => {
    const floor: FloorConfig = {
      id: "f-build",
      name: "Build Floor",
      gridSize: [24, 24],
      elevatorCell: [12, 1],
      rooms: [
        {
          id: "room-a",
          name: "Room A",
          floorPalette: "slate",
          wallStyle: "glass",
          bounds: { minX: 2, minZ: 2, maxX: 6, maxZ: 6 },
          doors: [{ x: 6, z: 4 }],
        },
        {
          id: "room-b",
          name: "Room B",
          floorPalette: "sage",
          wallStyle: "wood",
          bounds: { minX: 14, minZ: 2, maxX: 18, maxZ: 6 },
          doors: [{ x: 14, z: 4 }],
        },
      ],
      desks: [
        { id: "d1", x: 4, z: 4, rotation: 0, roomId: "room-a", assignedAgentId: "agent-1" },
        { id: "d2", x: 10, z: 10, rotation: 0, roomId: null, assignedAgentId: null },
      ],
      furniture: [
        { id: "f1", kind: "whiteboard", x: 3, z: 3, rotation: 0, roomId: "room-a" },
      ],
    };

    expect(isBuildCellOccupied(floor, 12, 1)).toBe(true);
    expect(isBuildCellOccupied(floor, 4, 4)).toBe(true);
    expect(isBuildCellOccupied(floor, 4, 4, { kind: "desk", id: "d1" })).toBe(false);
    expect(isBuildCellOccupied(floor, 8, 8)).toBe(false);

    // Move desk onto occupied furniture rejects; empty cell succeeds and updates roomId & rotation
    expect(moveDeskToCell(floor, "d1", 3, 3, 90)).toEqual({ valid: false, reason: "occupied" });
    const movedDesk = moveDeskToCell(floor, "d2", 16, 4, 180);
    expect(movedDesk.valid).toBe(true);
    if (movedDesk.valid) {
      const d2 = movedDesk.floor.desks.find((d) => d.id === "d2")!;
      expect([d2.x, d2.z, d2.rotation, d2.roomId]).toEqual([16, 4, 180, "room-b"]);
    }

    // Move furniture outside rooms clears roomId
    expect(moveFurnitureToCell(floor, "f1", 4, 4)).toEqual({ valid: false, reason: "occupied" });
    const movedFurn = moveFurnitureToCell(floor, "f1", 9, 9, 270);
    expect(movedFurn.valid).toBe(true);
    if (movedFurn.valid) {
      const f1 = movedFurn.floor.furniture.find((f) => f.id === "f1")!;
      expect([f1.x, f1.z, f1.rotation, f1.roomId]).toEqual([9, 9, 270, null]);
    }

    // Move room shifts room bounds, doors, and contained desks/furniture together
    const movedRoom = moveRoomToCell(floor, "room-a", 10, 14);
    expect(movedRoom.valid).toBe(true);
    if (movedRoom.valid) {
      const rA = movedRoom.floor.rooms.find((r) => r.id === "room-a")!;
      expect(rA.bounds).toEqual({ minX: 8, minZ: 12, maxX: 12, maxZ: 16 });
      expect(rA.doors).toEqual([{ x: 12, z: 14 }]);
      const d1Moved = movedRoom.floor.desks.find((d) => d.id === "d1")!;
      expect([d1Moved.x, d1Moved.z, d1Moved.roomId]).toEqual([10, 14, "room-a"]);
      const f1Moved = movedRoom.floor.furniture.find((f) => f.id === "f1")!;
      expect([f1Moved.x, f1Moved.z, f1Moved.roomId]).toEqual([9, 13, "room-a"]);
    }

    // Reject room move overlapping Room B or out of bounds or landing on non-room desk
    expect(moveRoomToCell(floor, "room-a", 15, 4)).toEqual({ valid: false, reason: "overlaps" });
    expect(moveRoomToCell(floor, "room-a", 1, 4)).toEqual({ valid: false, reason: "out_of_bounds" });
    expect(moveRoomToCell(floor, "room-a", 10, 10)).toEqual({ valid: false, reason: "occupied" });
  });
});

describe("dynamic room capacity & smart auto-desk placement with decorations", () => {
  it("splits 6-person teams across 4-desk rooms without dropping any agent", () => {
    const cap = computeRoomDeskCapacity(
      { minX: 19, minZ: 1, maxX: 28, maxZ: 8 },
      { x: 19, z: 4 },
    );
    expect(cap).toBe(4);

    const agents: OrgLayoutAgentInput[] = [
      { agentId: "ceo-1", name: "CEO", role: "ceo", reportsTo: null, status: "active" },
      { agentId: "pm-1", name: "PM Lead", role: "pm", reportsTo: "ceo-1", status: "active" },
      { agentId: "eng-1", name: "Eng 1", role: "engineer", reportsTo: "pm-1", status: "active" },
      { agentId: "eng-2", name: "Eng 2", role: "engineer", reportsTo: "pm-1", status: "active" },
      { agentId: "eng-3", name: "Eng 3", role: "engineer", reportsTo: "pm-1", status: "active" },
      { agentId: "eng-4", name: "Eng 4", role: "engineer", reportsTo: "pm-1", status: "active" },
      { agentId: "eng-5", name: "Eng 5", role: "engineer", reportsTo: "pm-1", status: "active" },
    ];

    const layout = generateLayoutFromOrg("company-cap", agents);
    const seatedIds = new Set(
      layout.buildings
        .flatMap((b) => b.floors)
        .flatMap((f) => f.desks)
        .map((d) => d.assignedAgentId)
        .filter((id): id is string => id !== null),
    );
    for (const a of agents) {
      expect(seatedIds.has(a.agentId)).toBe(true);
    }
  });

  it("places hired agent in their manager's room (avoiding CEO/Meeting rooms) and overflows cleanly when decorated full", () => {
    const layout = createPresetDefaultHqLayout("company-decor");
    const building = layout.buildings[0]!;
    const floor1 = building.floors[0]!;

    // Seat CEO in exec room and PM in ops room, fill remaining empty preset desks first
    floor1.desks = [
      { id: "d-ceo", x: 4, z: 3, rotation: 180, roomId: "room-preset-exec", assignedAgentId: "ceo-1" },
      { id: "d-pm", x: 22, z: 3, rotation: 0, roomId: "room-preset-ops", assignedAgentId: "pm-1" },
    ];

    const existing = [
      { id: "ceo-1", role: "ceo", reportsTo: null },
      { id: "pm-1", role: "pm", reportsTo: "ceo-1" },
    ];

    // 1) Hiring an engineer reporting to pm-1 chooses pm-1's room (NOT CEO's room or Meeting Room)
    const firstHire = autoPlaceDeskInBuilding(
      building,
      floor1.id,
      { id: "eng-new-1", role: "engineer", reportsTo: "pm-1" },
      existing,
      "d-eng-1",
    );
    expect(firstHire.floorId).toBe(floor1.id);
    expect(firstHire.desk.roomId).toBe("room-preset-ops");
    expect(Math.abs(firstHire.desk.x - 22) > 1 || Math.abs(firstHire.desk.z - 3) > 1).toBe(true);

    // 2) Pack room-preset-ops completely with user decorations -> next hire spills out without colliding with decorations
    for (let z = 2; z <= 8; z++) {
      for (let x = 20; x <= 27; x++) {
        if (floor1.desks.some((d) => d.x === x && d.z === z)) continue;
        floor1.furniture.push({
          id: `decor-${x}-${z}`,
          kind: "plant",
          x,
          z,
          rotation: 0,
          roomId: "room-preset-ops",
        });
      }
    }

    const secondHire = autoPlaceDeskInBuilding(
      building,
      floor1.id,
      { id: "eng-new-2", role: "engineer", reportsTo: "pm-1" },
      [...existing, { id: "eng-new-1", role: "engineer", reportsTo: "pm-1" }],
      "d-eng-2",
    );
    expect(secondHire.desk.roomId).not.toBe("room-preset-ops");
    expect(secondHire.desk.roomId).not.toBe("room-meeting-1");
    expect(
      floor1.furniture.some((f) => f.x === secondHire.desk.x && f.z === secondHire.desk.z),
    ).toBe(false);
  });

  it("creates a new overflow floor automatically when every existing floor is 100% packed with decorations", () => {
    const packedBuilding: OfficeLayout["buildings"][number] = {
      id: "b-packed",
      name: "Packed Building",
      floors: [
        {
          id: "floor-1",
          name: "Floor 1",
          gridSize: [12, 12],
          elevatorCell: [6, 1],
          rooms: [],
          desks: [],
          furniture: [],
        },
      ],
    };
    const f1 = packedBuilding.floors[0]!;
    for (let z = 0; z < 12; z++) {
      for (let x = 0; x < 12; x++) {
        if (x === 6 && z === 1) continue;
        f1.furniture.push({
          id: `fill-${x}-${z}`,
          kind: "bookshelf",
          x,
          z,
          rotation: 0,
          roomId: null,
        });
      }
    }

    const res = autoPlaceDeskInBuilding(
      packedBuilding,
      "floor-1",
      { id: "overflow-agent", role: "engineer", reportsTo: null },
      [],
      "d-overflow",
    );
    expect(packedBuilding.floors.length).toBe(2);
    expect(res.floorId).toBe(packedBuilding.floors[1]!.id);
    expect(res.desk.assignedAgentId).toBe("overflow-agent");
  });
});
