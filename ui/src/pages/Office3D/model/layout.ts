import {
  BALCONY_RAIL_MARGIN_M,
  BLOCKING_FURNITURE_KINDS,
  BUILDING_GROUNDS_MARGIN_M,
  CELL_SIZE_METERS,
  CHARACTER_COLLISION_RADIUS_M,
  DEFAULT_ELEVATOR_CELL,
  DEFAULT_GRID_SIZE,
  DEFAULT_MAX_DESKS_PER_FLOOR,
  DESK_COLLISION_PAD_M,
  DESK_FOOTPRINT,
  ELEVATOR_FOOTPRINT,
  ENTRANCE_DOOR_PASSAGE_HALF_WIDTH_M,
  FURNITURE_FOOTPRINTS,
  INTERACTION_RADIUS_METERS,
  NAV_CELL_FOOTPRINT_PAD_M,
  OFFICE_PALETTE_KEYS,
  OFFICE_SCHEMA_VERSION,
  OUTDOOR_FURNITURE_KINDS,
  OUTDOOR_GROUND_Y,
  OUTDOOR_WALK_MARGIN_M,
  getBalconyBenches,
  getBalconyBounds,
  getBalconyObstacleBoxes,
  getCampusBenches,
  getCampusObstacleBoxes,
} from "./constants";
import type {
  AgentOfficeSnapshot,
  BuildingConfig,
  DeskConfig,
  FloorConfig,
  FurnitureFootprint,
  FurnitureItem,
  FurnitureKind,
  GenerateLayoutFromOrg,
  GridRotation,
  InteractiveStation,
  OfficeBlueprintExport,
  OfficeControlPlaneSummary,
  OfficeLayout,
  OfficePaletteKey,
  OrgLayoutAgentInput,
  RoomConfig,
  StationStatusToken,
} from "./types";

function makeId(prefix: string, index: number | string): string {
  return `${prefix}-${index}`;
}

export function roomsOverlap(a: RoomConfig["bounds"], b: RoomConfig["bounds"]): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function isCellOnRoomBoundary(
  bounds: RoomConfig["bounds"],
  cell: { x: number; z: number },
): boolean {
  const onVertical =
    (cell.x === bounds.minX || cell.x === bounds.maxX) &&
    cell.z >= bounds.minZ &&
    cell.z <= bounds.maxZ;
  const onHorizontal =
    (cell.z === bounds.minZ || cell.z === bounds.maxZ) &&
    cell.x >= bounds.minX &&
    cell.x <= bounds.maxX;
  return onVertical || onHorizontal;
}

export type RoomValidationError =
  | "out_of_bounds"
  | "too_small"
  | "overlaps"
  | "missing_door";

export function validateRoom(
  room: RoomConfig,
  existingRooms: readonly RoomConfig[],
  gridSize: [number, number],
): { valid: true } | { valid: false; reason: RoomValidationError } {
  const [width, depth] = gridSize;
  const { minX, minZ, maxX, maxZ } = room.bounds;
  if (minX < 0 || minZ < 0 || maxX >= width || maxZ >= depth) {
    return { valid: false, reason: "out_of_bounds" };
  }
  if (maxX - minX < 2 || maxZ - minZ < 2) {
    return { valid: false, reason: "too_small" };
  }
  for (const other of existingRooms) {
    if (other.id === room.id) continue;
    if (roomsOverlap(room.bounds, other.bounds)) {
      return { valid: false, reason: "overlaps" };
    }
  }
  const hasValidDoor = room.doors.some((door) => isCellOnRoomBoundary(room.bounds, door));
  if (!hasValidDoor) {
    return { valid: false, reason: "missing_door" };
  }
  return { valid: true };
}

function defaultLobbyFurniture(floorNumber: number): FurnitureItem[] {
  if (floorNumber === 1) {
    return [
      { id: "furn-hr-1", kind: "hr_reception", x: 11, z: 3, rotation: 0, roomId: null },
      { id: "furn-approval-1", kind: "approval_desk", x: 16, z: 3, rotation: 0, roomId: null },
      { id: "furn-routines-1", kind: "routines_clock", x: 11, z: 8, rotation: 90, roomId: null },
      { id: "furn-water-1", kind: "water_cooler", x: 13, z: 8, rotation: 0, roomId: null },
      { id: "furn-artifacts-1", kind: "artifacts_showcase", x: 16, z: 8, rotation: 270, roomId: null },
      { id: "furn-filing-1", kind: "filing_cabinet", x: 17, z: 10, rotation: 270, roomId: null },
      { id: "furn-bookshelf-1", kind: "bookshelf", x: 11, z: 13, rotation: 90, roomId: null },
      { id: "furn-kpi-1", kind: "kpi_screen", x: 14, z: 15, rotation: 0, roomId: null },
      { id: "furn-server-1", kind: "server_rack", x: 17, z: 13, rotation: 270, roomId: null },
      { id: "furn-printer-1", kind: "printer", x: 16, z: 15, rotation: 270, roomId: null },
      { id: "furn-coffee-1", kind: "coffee_machine", x: 11, z: 18, rotation: 0, roomId: null },
      { id: "furn-lamp-1", kind: "floor_lamp", x: 12, z: 18, rotation: 0, roomId: null },
      { id: "furn-sofa-1", kind: "sofa", x: 14, z: 19, rotation: 180, roomId: null },
      { id: "furn-lounge-table-1", kind: "lounge_table", x: 14, z: 21, rotation: 0, roomId: null },
      { id: "furn-sofa-2", kind: "sofa", x: 14, z: 23, rotation: 180, roomId: null },
      { id: "furn-aquarium-1", kind: "aquarium", x: 11, z: 21, rotation: 90, roomId: null },
      { id: "furn-vending-1", kind: "vending_machine", x: 11, z: 26, rotation: 90, roomId: null },
      { id: "furn-arcade-1", kind: "arcade_machine", x: 17, z: 26, rotation: 270, roomId: null },
      { id: "furn-plant-1", kind: "plant", x: 12, z: 1, rotation: 0, roomId: null },
      { id: "furn-plant-2", kind: "plant", x: 16, z: 1, rotation: 0, roomId: null },
      { id: "furn-plant-3", kind: "plant", x: 17, z: 19, rotation: 0, roomId: null },
      { id: "furn-plant-4", kind: "plant", x: 11, z: 23, rotation: 0, roomId: null },
    ];
  }
  return [
    { id: `furn-server-${floorNumber}`, kind: "server_rack", x: 17, z: 4, rotation: 270, roomId: null },
    { id: `furn-whiteboard-${floorNumber}`, kind: "whiteboard", x: 14, z: 6, rotation: 0, roomId: null },
    { id: `furn-water-${floorNumber}`, kind: "water_cooler", x: 17, z: 9, rotation: 270, roomId: null },
    { id: `furn-bookshelf-${floorNumber}`, kind: "bookshelf", x: 11, z: 10, rotation: 90, roomId: null },
    { id: `furn-sofa-${floorNumber}`, kind: "sofa", x: 14, z: 12, rotation: 0, roomId: null },
    { id: `furn-coffee-${floorNumber}`, kind: "coffee_machine", x: 12, z: 15, rotation: 0, roomId: null },
    { id: `furn-printer-${floorNumber}`, kind: "printer", x: 16, z: 15, rotation: 270, roomId: null },
    { id: `furn-plant-${floorNumber}-a`, kind: "plant", x: 12, z: 1, rotation: 0, roomId: null },
    { id: `furn-plant-${floorNumber}-b`, kind: "plant", x: 16, z: 1, rotation: 0, roomId: null },
  ];
}

function defaultMeetingRoom(): { room: RoomConfig; furniture: FurnitureItem[] } {
  const room: RoomConfig = {
    id: "room-meeting-1",
    name: "Meeting Room",
    floorPalette: "slate",
    wallStyle: "glass",
    bounds: { minX: 1, minZ: 9, maxX: 9, maxZ: 16 },
    doors: [{ x: 9, z: 12 }],
  };
  const furniture: FurnitureItem[] = [
    { id: "furn-meeting-table-1", kind: "meeting_table", x: 5, z: 12, rotation: 0, roomId: room.id },
    { id: "furn-whiteboard-1", kind: "whiteboard", x: 2, z: 12, rotation: 90, roomId: room.id },
    { id: "furn-plant-m1", kind: "plant", x: 2, z: 10, rotation: 0, roomId: room.id },
    { id: "furn-bookshelf-m1", kind: "bookshelf", x: 7, z: 10, rotation: 0, roomId: room.id },
    { id: "furn-water-m1", kind: "water_cooler", x: 2, z: 15, rotation: 90, roomId: room.id },
  ];
  return { room, furniture };
}

function placeRoomInteriorProps(
  variant: "exec" | "team",
  room: RoomConfig,
  desks: readonly DeskConfig[],
  existingFurniture: readonly FurnitureItem[],
  roomVariantIndex = 0,
): FurnitureItem[] {
  const occupied = new Set<string>();
  for (const item of existingFurniture) {
    occupied.add(`${item.x},${item.z}`);
  }
  for (const desk of desks) {
    occupied.add(`${desk.x},${desk.z}`);
    const rad = (desk.rotation * Math.PI) / 180;
    const chairX = desk.x - Math.round(Math.sin(rad));
    const chairZ = desk.z - Math.round(Math.cos(rad));
    occupied.add(`${chairX},${chairZ}`);
  }

  const isFree = (x: number, z: number) => {
    if (x <= room.bounds.minX || x >= room.bounds.maxX || z <= room.bounds.minZ || z >= room.bounds.maxZ) {
      return false;
    }
    if (occupied.has(`${x},${z}`)) return false;
    for (const door of room.doors) {
      if (Math.abs(x - door.x) <= 1 && Math.abs(z - door.z) <= 1) return false;
    }
    return true;
  };

  const { minX, minZ, maxX, maxZ } = room.bounds;
  const spec: Array<{ kind: FurnitureKind; x: number; z: number; rotation: GridRotation }> =
    variant === "exec"
      ? [
          { kind: "bookshelf", x: minX + 1, z: minZ + 1, rotation: 0 },
          { kind: "plant", x: maxX - 1, z: minZ + 1, rotation: 0 },
          { kind: "sofa", x: minX + 1, z: maxZ - 1, rotation: 180 },
          { kind: "whiteboard", x: maxX - 1, z: maxZ - 1, rotation: 270 },
          { kind: "water_cooler", x: Math.floor((minX + maxX) / 2), z: maxZ - 1, rotation: 180 },
          { kind: "floor_lamp", x: minX + 1, z: maxZ - 2, rotation: 0 },
        ]
      : [
          { kind: "plant", x: minX + 1, z: minZ + 1, rotation: 0 },
          { kind: "bookshelf", x: maxX - 1, z: minZ + 1, rotation: 270 },
          {
            kind: roomVariantIndex % 2 === 0 ? "printer" : "filing_cabinet",
            x: minX + 1,
            z: maxZ - 1,
            rotation: 90,
          },
          { kind: "whiteboard", x: maxX - 1, z: maxZ - 1, rotation: 270 },
          { kind: "water_cooler", x: Math.floor((minX + maxX) / 2), z: maxZ - 1, rotation: 180 },
          { kind: "floor_lamp", x: maxX - 1, z: minZ + 2, rotation: 0 },
        ];

  const added: FurnitureItem[] = [];
  for (let i = 0; i < spec.length; i++) {
    const candidate = spec[i]!;
    if (!isFree(candidate.x, candidate.z)) continue;
    occupied.add(`${candidate.x},${candidate.z}`);
    added.push({
      id: `furn-${room.id}-${candidate.kind}-${i + 1}`,
      kind: candidate.kind,
      x: candidate.x,
      z: candidate.z,
      rotation: candidate.rotation,
      roomId: room.id,
    });
  }
  return added;
}

function pickPalette(index: number): OfficePaletteKey {
  return OFFICE_PALETTE_KEYS[index % OFFICE_PALETTE_KEYS.length] ?? "slate";
}

function buildOrgClusters(agents: OrgLayoutAgentInput[]): Array<{
  title: string;
  lead: OrgLayoutAgentInput | null;
  members: OrgLayoutAgentInput[];
}> {
  const seatable = agents.filter(
    (a) => a.status !== "terminated" && a.status !== "pending_approval",
  );
  const byId = new Map(seatable.map((a) => [a.agentId, a]));
  const childrenByManager = new Map<string, OrgLayoutAgentInput[]>();
  const roots: OrgLayoutAgentInput[] = [];

  for (const agent of seatable) {
    if (agent.reportsTo && agent.reportsTo !== agent.agentId && byId.has(agent.reportsTo)) {
      const list = childrenByManager.get(agent.reportsTo) ?? [];
      list.push(agent);
      childrenByManager.set(agent.reportsTo, list);
    } else {
      roots.push(agent);
    }
  }

  roots.sort((a, b) => {
    const aIsCeo = a.role.toLowerCase().includes("ceo") ? 0 : 1;
    const bIsCeo = b.role.toLowerCase().includes("ceo") ? 0 : 1;
    if (aIsCeo !== bIsCeo) return aIsCeo - bIsCeo;
    const aCount = childrenByManager.get(a.agentId)?.length ?? 0;
    const bCount = childrenByManager.get(b.agentId)?.length ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    return a.name.localeCompare(b.name);
  });

  const assigned = new Set<string>();
  const clusters: Array<{
    title: string;
    lead: OrgLayoutAgentInput | null;
    members: OrgLayoutAgentInput[];
  }> = [];

  const ceo = roots[0] ?? null;
  if (ceo) {
    assigned.add(ceo.agentId);
    clusters.push({ title: "Executive Suite", lead: ceo, members: [] });
  }

  const queue: OrgLayoutAgentInput[] = [];
  if (ceo) {
    for (const child of (childrenByManager.get(ceo.agentId) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      queue.push(child);
    }
  }
  for (const root of roots.slice(1)) {
    queue.push(root);
  }

  const looseMembers: OrgLayoutAgentInput[] = [];

  while (queue.length > 0) {
    const person = queue.shift()!;
    if (assigned.has(person.agentId)) continue;
    const reports = (childrenByManager.get(person.agentId) ?? [])
      .filter((r) => !assigned.has(r.agentId))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (reports.length > 0) {
      assigned.add(person.agentId);
      const leafReports: OrgLayoutAgentInput[] = [];
      for (const rep of reports) {
        if ((childrenByManager.get(rep.agentId)?.length ?? 0) > 0) {
          queue.push(rep);
        } else {
          assigned.add(rep.agentId);
          leafReports.push(rep);
        }
      }
      clusters.push({
        title: `${person.name} Team`,
        lead: person,
        members: leafReports,
      });
    } else {
      assigned.add(person.agentId);
      looseMembers.push(person);
    }
  }

  if (looseMembers.length > 0) {
    clusters.push({
      title: "Operations & Engineering",
      lead: null,
      members: looseMembers,
    });
  }

  return clusters;
}

const FLOOR1_ROOM_SLOTS: ReadonlyArray<RoomConfig["bounds"] & { door: { x: number; z: number } }> = [
  { minX: 19, minZ: 1, maxX: 28, maxZ: 8, door: { x: 19, z: 4 } },
  { minX: 19, minZ: 10, maxX: 28, maxZ: 17, door: { x: 19, z: 13 } },
  { minX: 19, minZ: 19, maxX: 28, maxZ: 27, door: { x: 19, z: 22 } },
  { minX: 1, minZ: 18, maxX: 9, maxZ: 27, door: { x: 9, z: 22 } },
];

const EXTRA_FLOOR_ROOM_SLOTS: ReadonlyArray<RoomConfig["bounds"] & { door: { x: number; z: number } }> = [
  { minX: 1, minZ: 1, maxX: 9, maxZ: 8, door: { x: 9, z: 4 } },
  { minX: 19, minZ: 1, maxX: 28, maxZ: 8, door: { x: 19, z: 4 } },
  { minX: 1, minZ: 10, maxX: 9, maxZ: 17, door: { x: 9, z: 13 } },
  { minX: 19, minZ: 10, maxX: 28, maxZ: 17, door: { x: 19, z: 13 } },
  { minX: 1, minZ: 19, maxX: 9, maxZ: 27, door: { x: 9, z: 22 } },
  { minX: 19, minZ: 19, maxX: 28, maxZ: 27, door: { x: 19, z: 22 } },
];

export function getRoomDeskSlots(
  bounds: RoomConfig["bounds"],
  door: { x: number; z: number },
): Array<[number, number]> {
  const slots: Array<[number, number]> = [];
  for (let z = bounds.minZ + 2; z <= bounds.maxZ - 2; z += 2) {
    for (let x = bounds.minX + 2; x <= bounds.maxX - 2; x += 3) {
      if (Math.abs(x - door.x) <= 1 && Math.abs(z - door.z) <= 1) continue;
      slots.push([x, z]);
    }
  }
  return slots;
}

export function computeRoomDeskCapacity(
  bounds: RoomConfig["bounds"],
  door: { x: number; z: number },
): number {
  return getRoomDeskSlots(bounds, door).length;
}

function placeDesksInBounds(
  bounds: RoomConfig["bounds"],
  roomId: string,
  agentIds: Array<string | null>,
  startDeskIndex: number,
  door: { x: number; z: number },
): DeskConfig[] {
  const slots = getRoomDeskSlots(bounds, door);
  const count = Math.min(slots.length, agentIds.length);
  const desks: DeskConfig[] = [];
  for (let idx = 0; idx < count; idx++) {
    const [x, z] = slots[idx]!;
    desks.push({
      id: makeId("desk", startDeskIndex + idx),
      x,
      z,
      rotation: 0,
      roomId,
      assignedAgentId: agentIds[idx] ?? null,
    });
  }
  return desks;
}

/**
 * Pure, deterministic generator creating an initial multi-floor office layout
 * directly from a company's OrgChart (`reportsTo` hierarchy).
 */
export const generateLayoutFromOrg: GenerateLayoutFromOrg = (
  companyId: string,
  agents: OrgLayoutAgentInput[],
  options = {},
): OfficeLayout => {
  const gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
  const maxDesksPerFloor = Math.max(4, options.maxDesksPerFloor ?? DEFAULT_MAX_DESKS_PER_FLOOR);
  const clusters = buildOrgClusters(agents);

  const floors: FloorConfig[] = [];
  let globalDeskSeq = 1;
  let clusterCursor = 0;

  // Always create Floor 1 (Executive + Meeting + Reception + first clusters)
  const floor1Rooms: RoomConfig[] = [];
  const floor1Desks: DeskConfig[] = [];
  const floor1Furniture: FurnitureItem[] = [...defaultLobbyFurniture(1)];

  const execCluster = clusters[0]?.lead && clusters[0].title === "Executive Suite" ? clusters[0] : null;
  if (execCluster) {
    clusterCursor = 1;
  }

  const execBounds = { minX: 1, minZ: 1, maxX: 9, maxZ: 7 };
  const execRoom: RoomConfig = {
    id: "room-exec-1",
    name: execCluster?.title ?? "Executive Suite",
    floorPalette: "amber",
    wallStyle: "glass",
    bounds: execBounds,
    doors: [{ x: 9, z: 4 }],
  };
  floor1Rooms.push(execRoom);
  floor1Desks.push({
    id: makeId("desk", globalDeskSeq++),
    x: 4,
    z: 3,
    rotation: 180,
    roomId: execRoom.id,
    assignedAgentId: execCluster?.lead?.agentId ?? null,
  });
  floor1Furniture.push(...placeRoomInteriorProps("exec", execRoom, floor1Desks, floor1Furniture));

  const meeting = defaultMeetingRoom();
  floor1Rooms.push(meeting.room);
  floor1Furniture.push(...meeting.furniture);

  // Stream remaining people into rooms sized to each target room slot's real desk capacity
  const teamQueues: Array<{
    baseTitle: string;
    remainingIds: string[];
    partIndex: number;
    paletteBase: number;
  }> = [];
  for (let i = clusterCursor; i < clusters.length; i++) {
    const c = clusters[i]!;
    const ids = [...(c.lead ? [c.lead.agentId] : []), ...c.members.map((m) => m.agentId)];
    if (ids.length === 0) continue;
    teamQueues.push({
      baseTitle: c.title,
      remainingIds: ids,
      partIndex: 1,
      paletteBase: teamQueues.length + 1,
    });
  }

  let queueCursor = 0;
  let roomColorSeq = 1;
  const hasRemainingTeamAgents = (): boolean => {
    while (queueCursor < teamQueues.length && teamQueues[queueCursor]!.remainingIds.length === 0) {
      queueCursor += 1;
    }
    return queueCursor < teamQueues.length;
  };
  const takeRoomBatchForSlot = (
    slot: RoomConfig["bounds"] & { door: { x: number; z: number } },
    remainingFloorBudget: number,
  ): { title: string; agentIds: string[]; paletteIdx: number } | null => {
    if (!hasRemainingTeamAgents() || remainingFloorBudget <= 0) return null;
    const q = teamQueues[queueCursor]!;
    const slotCap = Math.max(1, computeRoomDeskCapacity(slot, slot.door));
    const takeCount = Math.min(slotCap, remainingFloorBudget, q.remainingIds.length);
    const slice = q.remainingIds.splice(0, takeCount);
    const suffix = q.partIndex > 1 ? ` (${q.partIndex})` : "";
    q.partIndex += 1;
    const paletteIdx = roomColorSeq++;
    if (q.remainingIds.length === 0) {
      queueCursor += 1;
    }
    return {
      title: `${q.baseTitle}${suffix}`,
      agentIds: slice,
      paletteIdx,
    };
  };

  for (let slotIdx = 0; slotIdx < FLOOR1_ROOM_SLOTS.length; slotIdx++) {
    const remainingBudget = maxDesksPerFloor - floor1Desks.length;
    if (remainingBudget <= 0) break;
    const slot = FLOOR1_ROOM_SLOTS[slotIdx]!;
    const batch = takeRoomBatchForSlot(slot, remainingBudget);
    if (!batch && slotIdx > 0) break;
    const roomId = makeId("room-f1", slotIdx + 1);
    const room: RoomConfig = {
      id: roomId,
      name: batch?.title ?? "Workspace Studio",
      floorPalette: pickPalette(batch?.paletteIdx ?? slotIdx + 2),
      wallStyle: "glass",
      bounds: { minX: slot.minX, minZ: slot.minZ, maxX: slot.maxX, maxZ: slot.maxZ },
      doors: [slot.door],
    };
    floor1Rooms.push(room);
    if (batch) {
      const placed = placeDesksInBounds(
        room.bounds,
        room.id,
        batch.agentIds,
        globalDeskSeq,
        slot.door,
      );
      globalDeskSeq += placed.length;
      floor1Desks.push(...placed);
      floor1Furniture.push(
        ...placeRoomInteriorProps("team", room, placed, floor1Furniture, slotIdx),
      );
    } else {
      // At least 2 empty starter desks when company has few agents
      const placed = placeDesksInBounds(
        room.bounds,
        room.id,
        [null, null],
        globalDeskSeq,
        slot.door,
      );
      globalDeskSeq += placed.length;
      floor1Desks.push(...placed);
      floor1Furniture.push(
        ...placeRoomInteriorProps("team", room, placed, floor1Furniture, slotIdx),
      );
    }
  }

  floors.push({
    id: "floor-1",
    name: "Floor 1 — HQ & Operations",
    gridSize,
    elevatorCell: DEFAULT_ELEVATOR_CELL,
    rooms: floor1Rooms,
    desks: floor1Desks,
    furniture: floor1Furniture,
  });

  // Overflow into Floor 2, 3, ... when remaining agents exceed Floor 1 room/desk capacity
  let floorNumber = 2;
  while (hasRemainingTeamAgents()) {
    const rooms: RoomConfig[] = [];
    const desks: DeskConfig[] = [];
    const furniture = defaultLobbyFurniture(floorNumber);

    for (let slotIdx = 0; slotIdx < EXTRA_FLOOR_ROOM_SLOTS.length; slotIdx++) {
      const remainingBudget = maxDesksPerFloor - desks.length;
      if (!hasRemainingTeamAgents() || remainingBudget <= 0) break;
      const slot = EXTRA_FLOOR_ROOM_SLOTS[slotIdx]!;
      const batch = takeRoomBatchForSlot(slot, remainingBudget);
      if (!batch) break;
      const roomId = makeId(`room-f${floorNumber}`, slotIdx + 1);
      const room: RoomConfig = {
        id: roomId,
        name: batch.title,
        floorPalette: pickPalette(batch.paletteIdx),
        wallStyle: "glass",
        bounds: { minX: slot.minX, minZ: slot.minZ, maxX: slot.maxX, maxZ: slot.maxZ },
        doors: [slot.door],
      };
      rooms.push(room);
      const placed = placeDesksInBounds(
        room.bounds,
        room.id,
        batch.agentIds,
        globalDeskSeq,
        slot.door,
      );
      globalDeskSeq += placed.length;
      desks.push(...placed);
      furniture.push(...placeRoomInteriorProps("team", room, placed, furniture, slotIdx));
    }

    floors.push({
      id: `floor-${floorNumber}`,
      name: `Floor ${floorNumber} — Studio Wing`,
      gridSize,
      elevatorCell: DEFAULT_ELEVATOR_CELL,
      rooms,
      desks,
      furniture,
    });
    floorNumber += 1;
  }

  return {
    schemaVersion: OFFICE_SCHEMA_VERSION,
    companyId,
    buildings: [
      {
        id: "building-hq",
        name: "Main Headquarters",
        floors,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Creates a clean 2-floor template HQ with zero hardcoded agent names or assignments.
 */
export function createPresetDefaultHqLayout(companyId: string): OfficeLayout {
  const execRoom: RoomConfig = {
    id: "room-preset-exec",
    name: "Executive Office",
    floorPalette: "amber",
    wallStyle: "glass",
    bounds: { minX: 1, minZ: 1, maxX: 9, maxZ: 7 },
    doors: [{ x: 9, z: 4 }],
  };
  const meeting = defaultMeetingRoom();
  const pmRoom: RoomConfig = {
    id: "room-preset-ops",
    name: "Project & Ops Room",
    floorPalette: "sky",
    wallStyle: "glass",
    bounds: { minX: 19, minZ: 1, maxX: 28, maxZ: 9 },
    doors: [{ x: 19, z: 5 }],
  };
  const engRoom: RoomConfig = {
    id: "room-preset-eng",
    name: "Engineering Bay",
    floorPalette: "slate",
    wallStyle: "glass",
    bounds: { minX: 1, minZ: 1, maxX: 10, maxZ: 11 },
    doors: [{ x: 10, z: 6 }],
  };
  const qaRoom: RoomConfig = {
    id: "room-preset-qa",
    name: "QA & Verification Lab",
    floorPalette: "sage",
    wallStyle: "wood",
    bounds: { minX: 19, minZ: 1, maxX: 28, maxZ: 11 },
    doors: [{ x: 19, z: 6 }],
  };

  return {
    schemaVersion: OFFICE_SCHEMA_VERSION,
    companyId,
    buildings: [
      {
        id: "building-hq",
        name: "Main Headquarters",
        floors: [
          {
            id: "floor-1",
            name: "Floor 1 — Executive & Ops",
            gridSize: DEFAULT_GRID_SIZE,
            elevatorCell: DEFAULT_ELEVATOR_CELL,
            rooms: [execRoom, meeting.room, pmRoom],
            desks: [
              { id: "desk-p-1", x: 4, z: 3, rotation: 180, roomId: execRoom.id, assignedAgentId: null },
              { id: "desk-p-2", x: 22, z: 3, rotation: 0, roomId: pmRoom.id, assignedAgentId: null },
              { id: "desk-p-3", x: 25, z: 3, rotation: 0, roomId: pmRoom.id, assignedAgentId: null },
              { id: "desk-p-4", x: 22, z: 6, rotation: 180, roomId: pmRoom.id, assignedAgentId: null },
            ],
            furniture: [
              ...defaultLobbyFurniture(1),
              ...meeting.furniture,
              ...placeRoomInteriorProps(
                "exec",
                execRoom,
                [{ id: "desk-p-1", x: 4, z: 3, rotation: 180, roomId: execRoom.id, assignedAgentId: null }],
                [],
              ),
              ...placeRoomInteriorProps(
                "team",
                pmRoom,
                [
                  { id: "desk-p-2", x: 22, z: 3, rotation: 0, roomId: pmRoom.id, assignedAgentId: null },
                  { id: "desk-p-3", x: 25, z: 3, rotation: 0, roomId: pmRoom.id, assignedAgentId: null },
                  { id: "desk-p-4", x: 22, z: 6, rotation: 180, roomId: pmRoom.id, assignedAgentId: null },
                ],
                [],
                0,
              ),
            ],
          },
          {
            id: "floor-2",
            name: "Floor 2 — Engineering & QA",
            gridSize: DEFAULT_GRID_SIZE,
            elevatorCell: DEFAULT_ELEVATOR_CELL,
            rooms: [engRoom, qaRoom],
            desks: [
              { id: "desk-p-5", x: 3, z: 3, rotation: 0, roomId: engRoom.id, assignedAgentId: null },
              { id: "desk-p-6", x: 6, z: 3, rotation: 0, roomId: engRoom.id, assignedAgentId: null },
              { id: "desk-p-7", x: 3, z: 7, rotation: 180, roomId: engRoom.id, assignedAgentId: null },
              { id: "desk-p-8", x: 6, z: 7, rotation: 180, roomId: engRoom.id, assignedAgentId: null },
              { id: "desk-p-9", x: 22, z: 3, rotation: 0, roomId: qaRoom.id, assignedAgentId: null },
              { id: "desk-p-10", x: 25, z: 3, rotation: 0, roomId: qaRoom.id, assignedAgentId: null },
            ],
            furniture: [
              ...defaultLobbyFurniture(2),
              ...placeRoomInteriorProps(
                "team",
                engRoom,
                [
                  { id: "desk-p-5", x: 3, z: 3, rotation: 0, roomId: engRoom.id, assignedAgentId: null },
                  { id: "desk-p-6", x: 6, z: 3, rotation: 0, roomId: engRoom.id, assignedAgentId: null },
                  { id: "desk-p-7", x: 3, z: 7, rotation: 180, roomId: engRoom.id, assignedAgentId: null },
                  { id: "desk-p-8", x: 6, z: 7, rotation: 180, roomId: engRoom.id, assignedAgentId: null },
                ],
                [],
                0,
              ),
              ...placeRoomInteriorProps(
                "team",
                qaRoom,
                [
                  { id: "desk-p-9", x: 22, z: 3, rotation: 0, roomId: qaRoom.id, assignedAgentId: null },
                  { id: "desk-p-10", x: 25, z: 3, rotation: 0, roomId: qaRoom.id, assignedAgentId: null },
                ],
                [],
                1,
              ),
            ],
          },
        ],
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function createBlankFloor(
  floorIndex: number,
  elevatorCell: [number, number] | null = DEFAULT_ELEVATOR_CELL,
  gridSize: [number, number] = DEFAULT_GRID_SIZE,
): FloorConfig {
  return {
    id: `floor-${Date.now()}-${floorIndex}`,
    name: `Floor ${floorIndex}`,
    gridSize,
    elevatorCell,
    rooms: [],
    desks: [],
    furniture: [
      {
        id: `furn-coffee-${Date.now()}`,
        kind: "coffee_machine",
        x: 12,
        z: 6,
        rotation: 0,
        roomId: null,
      },
    ],
  };
}

export function createNewBuilding(
  name: string,
  elevatorCell: [number, number] = DEFAULT_ELEVATOR_CELL,
): BuildingConfig {
  return {
    id: `building-${Date.now()}`,
    name: name.trim() || "New Building",
    floors: [
      {
        id: `floor-${Date.now()}-1`,
        name: "Floor 1",
        gridSize: DEFAULT_GRID_SIZE,
        elevatorCell,
        rooms: [],
        desks: [],
        furniture: [
          {
            id: `furn-wb-${Date.now()}`,
            kind: "whiteboard",
            x: 11,
            z: 6,
            rotation: 90,
            roomId: null,
          },
        ],
      },
    ],
  };
}

const VALID_ROTATIONS: ReadonlySet<number> = new Set([0, 90, 180, 270]);
function normalizeRotation(rot: unknown): GridRotation {
  return typeof rot === "number" && VALID_ROTATIONS.has(rot) ? (rot as GridRotation) : 0;
}

/**
 * Validates and migrates a stored/imported OfficeLayout.
 * Enforces desk assignment invariants (max 1 desk per active non-terminated agent)
 * and cleans up invalid rooms or dangling references.
 */
export function validateAndSanitizeLayout(
  raw: unknown,
  companyId: string,
  activeAgentIds: ReadonlySet<string>,
): { layout: OfficeLayout; repaired: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Partial<OfficeLayout>;
  if (candidate.schemaVersion !== OFFICE_SCHEMA_VERSION) return null;
  if (!Array.isArray(candidate.buildings) || candidate.buildings.length === 0) return null;

  let repaired = candidate.companyId !== companyId;
  const seenAgentIds = new Set<string>();
  const buildings: BuildingConfig[] = [];

  for (const rawBuilding of candidate.buildings) {
    if (!rawBuilding || typeof rawBuilding !== "object" || !Array.isArray(rawBuilding.floors)) {
      repaired = true;
      continue;
    }
    const rawFloors = rawBuilding.floors;
    if (rawFloors.length === 0) {
      repaired = true;
      continue;
    }

    const buildingElevator =
      Array.isArray(rawFloors[0]?.elevatorCell) && rawFloors[0].elevatorCell.length === 2
        ? ([Number(rawFloors[0].elevatorCell[0]), Number(rawFloors[0].elevatorCell[1])] as [number, number])
        : DEFAULT_ELEVATOR_CELL;

    const floors: FloorConfig[] = [];
    for (let fIdx = 0; fIdx < rawFloors.length; fIdx++) {
      const rf = rawFloors[fIdx];
      if (!rf || typeof rf !== "object") {
        repaired = true;
        continue;
      }
      const gridSize: [number, number] =
        Array.isArray(rf.gridSize) && rf.gridSize.length === 2
          ? [
              Math.max(12, Math.min(60, Math.round(Number(rf.gridSize[0]) || DEFAULT_GRID_SIZE[0]))),
              Math.max(12, Math.min(60, Math.round(Number(rf.gridSize[1]) || DEFAULT_GRID_SIZE[1]))),
            ]
          : DEFAULT_GRID_SIZE;

      const rooms: RoomConfig[] = [];
      for (const rr of Array.isArray(rf.rooms) ? rf.rooms : []) {
        if (!rr || typeof rr !== "object" || !rr.bounds) {
          repaired = true;
          continue;
        }
        const room: RoomConfig = {
          id: typeof rr.id === "string" && rr.id ? rr.id : makeId("room", rooms.length + 1),
          name: typeof rr.name === "string" && rr.name.trim() ? rr.name.trim() : "Room",
          floorPalette: OFFICE_PALETTE_KEYS.includes(rr.floorPalette) ? rr.floorPalette : "slate",
          wallStyle: rr.wallStyle === "wood" || rr.wallStyle === "none" ? rr.wallStyle : "glass",
          bounds: {
            minX: Math.round(Number(rr.bounds.minX) || 0),
            minZ: Math.round(Number(rr.bounds.minZ) || 0),
            maxX: Math.round(Number(rr.bounds.maxX) || 0),
            maxZ: Math.round(Number(rr.bounds.maxZ) || 0),
          },
          doors: Array.isArray(rr.doors)
            ? rr.doors
                .filter((d) => d && typeof d.x === "number" && typeof d.z === "number")
                .map((d) => ({ x: Math.round(d.x), z: Math.round(d.z) }))
            : [],
        };
        const check = validateRoom(room, rooms, gridSize);
        if (!check.valid) {
          if (check.reason === "missing_door") {
            room.doors = [{ x: room.bounds.maxX, z: Math.floor((room.bounds.minZ + room.bounds.maxZ) / 2) }];
            repaired = true;
            if (validateRoom(room, rooms, gridSize).valid) {
              rooms.push(room);
              continue;
            }
          }
          repaired = true;
          continue;
        }
        rooms.push(room);
      }

      const roomIds = new Set(rooms.map((r) => r.id));
      const desks: DeskConfig[] = [];
      for (const rd of Array.isArray(rf.desks) ? rf.desks : []) {
        if (!rd || typeof rd !== "object") {
          repaired = true;
          continue;
        }
        let assignedAgentId = typeof rd.assignedAgentId === "string" ? rd.assignedAgentId : null;
        if (assignedAgentId && (!activeAgentIds.has(assignedAgentId) || seenAgentIds.has(assignedAgentId))) {
          assignedAgentId = null;
          repaired = true;
        }
        if (assignedAgentId) seenAgentIds.add(assignedAgentId);

        const x = Math.max(0, Math.min(gridSize[0] - 1, Math.round(Number(rd.x) || 0)));
        const z = Math.max(0, Math.min(gridSize[1] - 1, Math.round(Number(rd.z) || 0)));
        desks.push({
          id: typeof rd.id === "string" && rd.id ? rd.id : makeId("desk", desks.length + 1),
          x,
          z,
          rotation: normalizeRotation(rd.rotation),
          roomId: typeof rd.roomId === "string" && roomIds.has(rd.roomId) ? rd.roomId : null,
          assignedAgentId,
        });
      }

      const furniture: FurnitureItem[] = [];
      for (const rfu of Array.isArray(rf.furniture) ? rf.furniture : []) {
        if (!rfu || typeof rfu !== "object" || typeof rfu.kind !== "string") {
          repaired = true;
          continue;
        }
        const kind = rfu.kind as FurnitureKind;
        const allowOutdoor = OUTDOOR_FURNITURE_KINDS.has(kind);
        const minXBound = allowOutdoor ? -BUILDING_GROUNDS_MARGIN_M : 0;
        const maxXBound = allowOutdoor ? gridSize[0] + BUILDING_GROUNDS_MARGIN_M : gridSize[0] - 1;
        const minZBound = allowOutdoor ? -BUILDING_GROUNDS_MARGIN_M : 0;
        const maxZBound = allowOutdoor ? gridSize[1] + BUILDING_GROUNDS_MARGIN_M : gridSize[1] - 1;
        furniture.push({
          id: typeof rfu.id === "string" && rfu.id ? rfu.id : makeId("furn", furniture.length + 1),
          kind,
          x: Math.max(minXBound, Math.min(maxXBound, Math.round(Number(rfu.x) || 0))),
          z: Math.max(minZBound, Math.min(maxZBound, Math.round(Number(rfu.z) || 0))),
          rotation: normalizeRotation(rfu.rotation),
          roomId: typeof rfu.roomId === "string" && roomIds.has(rfu.roomId) ? rfu.roomId : null,
          ...(typeof rfu.targetEntityId === "string" ? { targetEntityId: rfu.targetEntityId } : {}),
        });
      }

      const floorElevator =
        rawFloors.length > 1 ? buildingElevator : rf.elevatorCell ?? buildingElevator;

      floors.push({
        id: typeof rf.id === "string" && rf.id ? rf.id : `floor-${fIdx + 1}`,
        name: typeof rf.name === "string" && rf.name.trim() ? rf.name.trim() : `Floor ${fIdx + 1}`,
        gridSize,
        elevatorCell: floorElevator,
        rooms,
        desks,
        furniture,
      });
    }

    if (floors.length > 0) {
      buildings.push({
        id: typeof rawBuilding.id === "string" && rawBuilding.id ? rawBuilding.id : makeId("building", buildings.length + 1),
        name: typeof rawBuilding.name === "string" && rawBuilding.name.trim() ? rawBuilding.name.trim() : "Office Building",
        floors,
      });
    }
  }

  if (buildings.length === 0) return null;

  return {
    layout: {
      schemaVersion: OFFICE_SCHEMA_VERSION,
      companyId,
      buildings,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
    },
    repaired,
  };
}

/**
 * Returns the axis-aligned half-extents of a rectangular furniture footprint after 90-deg rotation.
 */
export function getRotatedHalfExtents(
  footprint: FurnitureFootprint,
  rotation: GridRotation,
): { halfW: number; halfD: number } {
  const quarterTurn = rotation === 90 || rotation === 270;
  return {
    halfW: (quarterTurn ? footprint.depth : footprint.width) / 2,
    halfD: (quarterTurn ? footprint.width : footprint.depth) / 2,
  };
}

export type OutdoorZoneMode = "none" | "ground_campus" | "balcony";

export function isInSouthEntrancePassage(x: number, gridW: number): boolean {
  return Math.abs(x - gridW / 2) <= ENTRANCE_DOOR_PASSAGE_HALF_WIDTH_M;
}

/**
 * Computes smoothly interpolated ground elevation `Y` for the player based on
 * whether they are indoors (`0`), descending the South threshold steps (`0 -> -0.27`),
 * on the ground-floor campus (`-0.27`), or on an upper-floor balcony (`0`).
 */
export function computePlayerGroundY(
  x: number,
  z: number,
  gridW: number,
  gridD: number,
  outdoorMode: OutdoorZoneMode,
): number {
  if (outdoorMode !== "ground_campus") return 0;
  const maxW = gridW * CELL_SIZE_METERS;
  const maxD = gridD * CELL_SIZE_METERS;
  if (x >= 0 && x <= maxW && z >= 0 && z <= maxD) {
    return 0;
  }
  if (isInSouthEntrancePassage(x, maxW) && z > maxD && z < maxD + 1.2) {
    const t = Math.max(0, Math.min(1, (z - maxD) / 1.2));
    return OUTDOOR_GROUND_Y * t;
  }
  return OUTDOOR_GROUND_Y;
}

/**
 * Clamps an arbitrary floor-plane click point into the permitted playable zone
 * for the active outdoor mode (`ground_campus`, `balcony`, or interior-only).
 */
export function clampPointForOutdoorMode(
  floor: FloorConfig,
  x: number,
  z: number,
  outdoorMode: OutdoorZoneMode,
): { x: number; z: number } {
  const maxW = floor.gridSize[0] * CELL_SIZE_METERS;
  const maxD = floor.gridSize[1] * CELL_SIZE_METERS;
  if (outdoorMode === "ground_campus") {
    return {
      x: Math.max(-OUTDOOR_WALK_MARGIN_M + 0.5, Math.min(maxW + OUTDOOR_WALK_MARGIN_M - 0.5, x)),
      z: Math.max(-OUTDOOR_WALK_MARGIN_M + 0.5, Math.min(maxD + OUTDOOR_WALK_MARGIN_M - 0.5, z)),
    };
  }
  if (outdoorMode === "balcony" && z > maxD) {
    const bounds = getBalconyBounds(maxW, maxD);
    return {
      x: Math.max(bounds.minX + BALCONY_RAIL_MARGIN_M, Math.min(bounds.maxX - BALCONY_RAIL_MARGIN_M, x)),
      z: Math.max(maxD + 0.6, Math.min(bounds.maxZ - BALCONY_RAIL_MARGIN_M, z)),
    };
  }
  return {
    x: Math.max(0.7, Math.min(maxW - 0.7, x)),
    z: Math.max(0.7, Math.min(maxD - 0.7, z)),
  };
}

function hitsObstacleBoxes(
  x: number,
  z: number,
  boxes: ReadonlyArray<{ cx: number; cz: number; halfW: number; halfD: number }>,
): boolean {
  for (const box of boxes) {
    if (
      Math.abs(x - box.cx) < box.halfW + CHARACTER_COLLISION_RADIUS_M &&
      Math.abs(z - box.cz) < box.halfD + CHARACTER_COLLISION_RADIUS_M
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a continuous world position (in meters, where 1 cell = 1 meter)
 * collides with floor borders, desks, oriented furniture footprints, or outdoor
 * campus / balcony fixtures.
 */
export function isPointBlocked(
  floor: FloorConfig,
  x: number,
  z: number,
  outdoorMode: OutdoorZoneMode = "none",
): boolean {
  const [width, depth] = floor.gridSize;
  const maxW = width * CELL_SIZE_METERS;
  const maxD = depth * CELL_SIZE_METERS;
  const margin = 0.55;
  const strictlyInsideInterior =
    x >= margin && x <= maxW - margin && z >= margin && z <= maxD - margin;
  const inSouthDoorway =
    outdoorMode !== "none" &&
    isInSouthEntrancePassage(x, maxW) &&
    z >= maxD - margin &&
    z <= maxD + 0.65;

  if (outdoorMode === "none") {
    if (!strictlyInsideInterior) return true;
  } else if (outdoorMode === "ground_campus") {
    const inOuterBounds =
      x >= -OUTDOOR_WALK_MARGIN_M &&
      x <= maxW + OUTDOOR_WALK_MARGIN_M &&
      z >= -OUTDOOR_WALK_MARGIN_M &&
      z <= maxD + OUTDOOR_WALK_MARGIN_M;
    if (!inOuterBounds) return true;

    const strictlyOutsideBuilding =
      x <= -0.5 || x >= maxW + 0.5 || z <= -0.5 || z >= maxD + 0.6;
    if (!strictlyInsideInterior && !inSouthDoorway && !strictlyOutsideBuilding) {
      return true;
    }
    if (strictlyOutsideBuilding && hitsObstacleBoxes(x, z, getCampusObstacleBoxes(maxW, maxD))) {
      return true;
    }
    if (strictlyOutsideBuilding) {
      for (const item of floor.furniture) {
        if (!BLOCKING_FURNITURE_KINDS.has(item.kind)) continue;
        if (item.x >= 0 && item.x < width && item.z >= 0 && item.z < depth) continue;
        const footprint = FURNITURE_FOOTPRINTS[item.kind];
        const { halfW, halfD } = getRotatedHalfExtents(footprint, item.rotation);
        if (
          Math.abs(x - (item.x + 0.5)) < halfW + CHARACTER_COLLISION_RADIUS_M &&
          Math.abs(z - (item.z + 0.5)) < halfD + CHARACTER_COLLISION_RADIUS_M
        ) {
          return true;
        }
      }
    }
  } else {
    const balcony = getBalconyBounds(maxW, maxD);
    const onBalconyDeck =
      x >= balcony.minX + BALCONY_RAIL_MARGIN_M &&
      x <= balcony.maxX - BALCONY_RAIL_MARGIN_M &&
      z >= maxD + 0.55 &&
      z <= balcony.maxZ - BALCONY_RAIL_MARGIN_M;
    if (!strictlyInsideInterior && !inSouthDoorway && !onBalconyDeck) {
      return true;
    }
    if (onBalconyDeck && hitsObstacleBoxes(x, z, getBalconyObstacleBoxes(maxW, maxD))) {
      return true;
    }
  }

  // Interior fixtures check (only relevant inside/near building footprint)
  if (x >= -1 && x <= maxW + 1 && z >= -1 && z <= maxD + 1) {
    if (floor.elevatorCell) {
      const halfW = ELEVATOR_FOOTPRINT.width / 2;
      const halfD = ELEVATOR_FOOTPRINT.depth / 2;
      if (
        Math.abs(x - (floor.elevatorCell[0] + 0.5)) < halfW + CHARACTER_COLLISION_RADIUS_M &&
        Math.abs(z - (floor.elevatorCell[1] + 0.5)) < halfD + CHARACTER_COLLISION_RADIUS_M
      ) {
        return true;
      }
    }
    for (const desk of floor.desks) {
      const { halfW, halfD } = getRotatedHalfExtents(DESK_FOOTPRINT, desk.rotation);
      if (
        Math.abs(x - (desk.x + 0.5)) < halfW + DESK_COLLISION_PAD_M &&
        Math.abs(z - (desk.z + 0.5)) < halfD + DESK_COLLISION_PAD_M
      ) {
        return true;
      }
    }
    for (const item of floor.furniture) {
      if (!BLOCKING_FURNITURE_KINDS.has(item.kind)) continue;
      const footprint = FURNITURE_FOOTPRINTS[item.kind];
      const { halfW, halfD } = getRotatedHalfExtents(footprint, item.rotation);
      if (
        Math.abs(x - (item.x + 0.5)) < halfW + CHARACTER_COLLISION_RADIUS_M &&
        Math.abs(z - (item.z + 0.5)) < halfD + CHARACTER_COLLISION_RADIUS_M
      ) {
        return true;
      }
    }
  }
  return false;
}

function crossesLine(a: number, b: number, line: number): boolean {
  return (a < line && b >= line) || (a >= line && b < line);
}

function intersectVerticalWall(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  wx: number,
  minZ: number,
  maxZ: number,
): number | null {
  if (!crossesLine(ax, bx, wx) || bx === ax) return null;
  const t = (wx - ax) / (bx - ax);
  const iz = az + t * (bz - az);
  return iz >= minZ && iz <= maxZ ? iz : null;
}

function intersectHorizontalWall(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  wz: number,
  minX: number,
  maxX: number,
): number | null {
  if (!crossesLine(az, bz, wz) || bz === az) return null;
  const t = (wz - az) / (bz - az);
  const ix = ax + t * (bx - ax);
  return ix >= minX && ix <= maxX ? ix : null;
}

/**
 * Checks whether the straight line between `(ax, az)` and `(bx, bz)` is unobstructed
 * by solid interior room walls or exterior perimeter walls (respecting open doors).
 */
export function hasUnobstructedWallLineOfSight(
  floor: FloorConfig,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const [width, depth] = floor.gridSize;
  const maxW = width * CELL_SIZE_METERS;
  const maxD = depth * CELL_SIZE_METERS;

  // Exterior building perimeter walls (South has automatic sliding doors)
  if (intersectVerticalWall(ax, az, bx, bz, 0, 0, maxD) !== null) return false;
  if (intersectVerticalWall(ax, az, bx, bz, maxW, 0, maxD) !== null) return false;
  if (intersectHorizontalWall(ax, az, bx, bz, 0, 0, maxW) !== null) return false;
  const southX = intersectHorizontalWall(ax, az, bx, bz, maxD, 0, maxW);
  if (southX !== null && !isInSouthEntrancePassage(southX, maxW)) return false;

  for (const room of floor.rooms) {
    if (room.wallStyle === "none") continue;
    const { minX, minZ, maxX, maxZ } = room.bounds;
    const doorSet = new Set(room.doors.map((d) => `${d.x},${d.z}`));

    const westZ = intersectVerticalWall(ax, az, bx, bz, minX, minZ, maxZ + 1);
    if (westZ !== null && !doorSet.has(`${minX},${Math.floor(westZ)}`)) return false;

    const eastZ = intersectVerticalWall(ax, az, bx, bz, maxX + 1, minZ, maxZ + 1);
    if (eastZ !== null && !doorSet.has(`${maxX},${Math.floor(eastZ)}`)) return false;

    const northX = intersectHorizontalWall(ax, az, bx, bz, minZ, minX, maxX + 1);
    if (northX !== null && !doorSet.has(`${Math.floor(northX)},${minZ}`)) return false;

    const southRoomX = intersectHorizontalWall(ax, az, bx, bz, maxZ + 1, minX, maxX + 1);
    if (southRoomX !== null && !doorSet.has(`${Math.floor(southRoomX)},${maxZ}`)) return false;
  }

  return true;
}

/**
 * Prevents walking through solid room walls (`wallStyle !== "none"`) and
 * exterior walls except through declared door cells / the South entrance passage,
 * while enforcing desk, furniture, and outdoor obstacle collisions.
 */
export function canMoveBetween(
  floor: FloorConfig,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  outdoorMode: OutdoorZoneMode = "none",
): boolean {
  if (isPointBlocked(floor, toX, toZ, outdoorMode)) return false;

  const [width, depth] = floor.gridSize;
  const maxW = width * CELL_SIZE_METERS;
  const maxD = depth * CELL_SIZE_METERS;

  if (outdoorMode !== "none") {
    if (intersectVerticalWall(fromX, fromZ, toX, toZ, 0, 0, maxD) !== null) return false;
    if (intersectVerticalWall(fromX, fromZ, toX, toZ, maxW, 0, maxD) !== null) return false;
    if (intersectHorizontalWall(fromX, fromZ, toX, toZ, 0, 0, maxW) !== null) return false;
    const southCrossX = intersectHorizontalWall(fromX, fromZ, toX, toZ, maxD, 0, maxW);
    if (southCrossX !== null && !isInSouthEntrancePassage(southCrossX, maxW)) return false;
  }

  const cellX = Math.floor(toX);
  const cellZ = Math.floor(toZ);
  const prevCellX = Math.floor(fromX);
  const prevCellZ = Math.floor(fromZ);

  for (const room of floor.rooms) {
    if (room.wallStyle === "none") continue;
    const { minX, minZ, maxX, maxZ } = room.bounds;
    const doorSet = new Set(room.doors.map((d) => `${d.x},${d.z}`));
    const hasDoorAt = (x: number, z: number) => doorSet.has(`${x},${z}`);

    // West wall at x = minX
    if (crossesLine(fromX, toX, minX) && cellZ >= minZ && cellZ <= maxZ) {
      if (!hasDoorAt(minX, cellZ) && !hasDoorAt(minX, prevCellZ)) return false;
    }
    // East wall at x = maxX + 1
    if (crossesLine(fromX, toX, maxX + 1) && cellZ >= minZ && cellZ <= maxZ) {
      if (!hasDoorAt(maxX, cellZ) && !hasDoorAt(maxX, prevCellZ)) return false;
    }
    // North wall at z = minZ
    if (crossesLine(fromZ, toZ, minZ) && cellX >= minX && cellX <= maxX) {
      if (!hasDoorAt(cellX, minZ) && !hasDoorAt(prevCellX, minZ)) return false;
    }
    // South wall at z = maxZ + 1
    if (crossesLine(fromZ, toZ, maxZ + 1) && cellX >= minX && cellX <= maxX) {
      if (!hasDoorAt(cellX, maxZ) && !hasDoorAt(prevCellX, maxZ)) return false;
    }
  }

  return true;
}

function stationStatusForAgent(agent: AgentOfficeSnapshot | undefined): StationStatusToken {
  if (!agent) return "idle";
  if (agent.visualState === "error" || agent.visualState === "paused_budget") return "critical";
  if (agent.visualState === "waiting" || agent.visualState === "paused") return "warning";
  if (agent.visualState === "coding" || agent.visualState === "thinking") return "healthy";
  return "idle";
}

export function buildInteractiveStations(
  floor: FloorConfig,
  summary: OfficeControlPlaneSummary,
  floorIndex = 0,
): InteractiveStation[] {
  const stations: InteractiveStation[] = [];

  for (const desk of floor.desks) {
    if (!desk.assignedAgentId) {
      stations.push({
        id: `station-chair-${desk.id}`,
        kind: "empty_chair",
        floorId: floor.id,
        cell: [desk.x, desk.z],
        rotation: desk.rotation,
        interactionRadius: INTERACTION_RADIUS_METERS,
        labelKey: "office3d.station.emptyChair",
        statusToken: "idle",
      });
      continue;
    }
    const snapshot = summary.agentsById[desk.assignedAgentId];
    if (!snapshot || snapshot.visualState === "hidden") continue;
    stations.push({
      id: `station-desk-${desk.id}`,
      kind: "agent_desk",
      floorId: floor.id,
      cell: [desk.x, desk.z],
      rotation: desk.rotation,
      interactionRadius: INTERACTION_RADIUS_METERS,
      labelKey: "office3d.station.agentDesk",
      labelFallback: snapshot.name,
      statusToken: stationStatusForAgent(snapshot),
      targetEntityId: snapshot.agentId,
    });
  }

  for (const item of floor.furniture) {
    switch (item.kind) {
      case "approval_desk":
        stations.push({
          id: `station-${item.id}`,
          kind: "approval_desk",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.approvalDesk",
          badgeCount: summary.pendingApprovalsCount,
          statusToken: summary.pendingApprovalsCount > 0 ? "warning" : "idle",
        });
        break;
      case "server_rack": {
        const hasUnhealthy = summary.runningWorkspaces.some((w) => w.status === "unhealthy");
        stations.push({
          id: `station-${item.id}`,
          kind: "server_rack",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.serverRack",
          badgeCount: summary.runningWorkspaces.length,
          statusToken: hasUnhealthy ? "critical" : summary.runningWorkspaces.length > 0 ? "healthy" : "idle",
          targetEntityId: item.targetEntityId,
        });
        break;
      }
      case "hr_reception": {
        const awaitingCount = Object.values(summary.agentsById).filter(
          (a) => a.visualState === "awaiting_hire",
        ).length;
        stations.push({
          id: `station-${item.id}`,
          kind: "hr_reception",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.hrReception",
          badgeCount: awaitingCount,
          statusToken: awaitingCount > 0 ? "warning" : "idle",
        });
        break;
      }
      case "routines_clock":
        stations.push({
          id: `station-${item.id}`,
          kind: "routines_clock",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.routinesClock",
          badgeCount: summary.upcomingRoutines.length,
          statusToken: summary.upcomingRoutines.length > 0 ? "healthy" : "idle",
        });
        break;
      case "artifacts_showcase":
        stations.push({
          id: `station-${item.id}`,
          kind: "artifacts_showcase",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.artifactsShowcase",
          badgeCount: summary.recentArtifactsCount,
          statusToken: summary.recentArtifactsCount > 0 ? "healthy" : "idle",
        });
        break;
      case "whiteboard":
        stations.push({
          id: `station-${item.id}`,
          kind: "whiteboard",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.whiteboard",
          targetEntityId: item.targetEntityId,
          statusToken: "idle",
        });
        break;
      case "sofa":
        stations.push({
          id: `station-${item.id}`,
          kind: "sofa",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.sofa",
          statusToken: "idle",
        });
        break;
      case "coffee_machine":
        stations.push({
          id: `station-${item.id}`,
          kind: "coffee_machine",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.coffeeMachine",
          statusToken: "healthy",
        });
        break;
      case "water_cooler":
        stations.push({
          id: `station-${item.id}`,
          kind: "water_cooler",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.waterCooler",
          statusToken: "healthy",
        });
        break;
      case "meeting_table":
        stations.push({
          id: `station-${item.id}`,
          kind: "meeting_table",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: Math.max(INTERACTION_RADIUS_METERS, 2.3),
          labelKey: "office3d.station.meetingTable",
          statusToken: "idle",
        });
        break;
      case "bookshelf":
        stations.push({
          id: `station-${item.id}`,
          kind: "bookshelf",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.bookshelf",
          statusToken: "idle",
        });
        break;
      case "printer":
        stations.push({
          id: `station-${item.id}`,
          kind: "printer",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.printer",
          statusToken: "healthy",
        });
        break;
      case "filing_cabinet":
        stations.push({
          id: `station-${item.id}`,
          kind: "filing_cabinet",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.filingCabinet",
          statusToken: "idle",
        });
        break;
      case "plant":
        stations.push({
          id: `station-${item.id}`,
          kind: "plant",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.plant",
          statusToken: "healthy",
        });
        break;
      case "aquarium":
        stations.push({
          id: `station-${item.id}`,
          kind: "aquarium",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.aquarium",
          statusToken: "healthy",
        });
        break;
      case "arcade_machine":
        stations.push({
          id: `station-${item.id}`,
          kind: "arcade_machine",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.arcadeMachine",
          statusToken: "healthy",
        });
        break;
      case "floor_lamp":
        stations.push({
          id: `station-${item.id}`,
          kind: "floor_lamp",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.floorLamp",
          statusToken: "idle",
        });
        break;
      case "lounge_table":
        stations.push({
          id: `station-${item.id}`,
          kind: "lounge_table",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.loungeTable",
          statusToken: "idle",
        });
        break;
      case "vending_machine":
        stations.push({
          id: `station-${item.id}`,
          kind: "vending_machine",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.vendingMachine",
          statusToken: "healthy",
        });
        break;
      case "outdoor_sakura_tree":
      case "outdoor_oak_tree":
      case "outdoor_pine_tree":
      case "outdoor_flower_bed":
        stations.push({
          id: `station-${item.id}`,
          kind: item.kind,
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.outdoorNature",
          statusToken: "healthy",
        });
        break;
      case "outdoor_bench":
        stations.push({
          id: `station-${item.id}`,
          kind: "outdoor_bench",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.outdoorBench",
          statusToken: "idle",
        });
        break;
      case "outdoor_lamp":
        stations.push({
          id: `station-${item.id}`,
          kind: "outdoor_lamp",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.outdoorLamp",
          statusToken: "idle",
        });
        break;
      case "kpi_screen":
        stations.push({
          id: `station-${item.id}`,
          kind: "kpi_screen",
          floorId: floor.id,
          cell: [item.x, item.z],
          rotation: item.rotation,
          interactionRadius: INTERACTION_RADIUS_METERS,
          labelKey: "office3d.station.kpiScreen",
          statusToken: "healthy",
        });
        break;
      default:
        break;
    }
  }

  if (floor.elevatorCell) {
    stations.push({
      id: `station-elevator-${floor.id}`,
      kind: "elevator",
      floorId: floor.id,
      cell: floor.elevatorCell,
      rotation: 0,
      interactionRadius: INTERACTION_RADIUS_METERS,
      labelKey: "office3d.station.elevator",
      statusToken: "idle",
    });
  }

  const [gridW, gridD] = floor.gridSize;
  const outdoorBenches =
    floorIndex === 0 ? getCampusBenches(gridW, gridD) : getBalconyBenches(gridW, gridD);
  const benchLabelKey =
    floorIndex === 0 ? "office3d.station.outdoorBench" : "office3d.station.balconyBench";
  for (const bench of outdoorBenches) {
    stations.push({
      id: `station-${bench.id}-${floor.id}`,
      kind: "sofa",
      floorId: floor.id,
      cell: bench.cell,
      rotation: bench.rotation,
      interactionRadius: INTERACTION_RADIUS_METERS,
      labelKey: benchLabelKey,
      statusToken: "idle",
    });
  }

  return stations;
}

export function createBlueprintExport(
  layout: OfficeLayout,
  sourceCompanyName: string,
): OfficeBlueprintExport {
  return {
    kind: "paperclip.office-blueprint",
    exportedAt: new Date().toISOString(),
    sourceCompanyName,
    layout,
  };
}

export function parseBlueprintImport(
  jsonText: string,
  targetCompanyId: string,
  activeAgentIds: ReadonlySet<string>,
): { layout: OfficeLayout; strippedForeignAgents: boolean } | null {
  try {
    const parsed = JSON.parse(jsonText) as Partial<OfficeBlueprintExport> | OfficeLayout;
    const rawLayout =
      parsed && typeof parsed === "object" && "kind" in parsed && parsed.kind === "paperclip.office-blueprint"
        ? parsed.layout
        : parsed;

    const validated = validateAndSanitizeLayout(rawLayout, targetCompanyId, activeAgentIds);
    if (!validated) return null;
    return { layout: validated.layout, strippedForeignAgents: validated.repaired };
  } catch {
    return null;
  }
}

export function findAgentDeskLocation(
  layout: OfficeLayout,
  agentId: string,
): { buildingId: string; floorId: string; cell: [number, number] } | null {
  for (const building of layout.buildings) {
    for (const floor of building.floors) {
      const desk = floor.desks.find((d) => d.assignedAgentId === agentId);
      if (desk) {
        return { buildingId: building.id, floorId: floor.id, cell: [desk.x, desk.z] };
      }
    }
  }
  return null;
}

/**
 * Returns the set of agent IDs currently seated at desks on any floor other
 * than `activeFloorId`, so HR reception on the active floor does not treat them
 * as unseated hires.
 */
export function getAgentIdsSeatedOnOtherFloors(
  layout: OfficeLayout,
  activeFloorId: string,
): Set<string> {
  const seatedElsewhere = new Set<string>();
  for (const building of layout.buildings) {
    for (const floor of building.floors) {
      if (floor.id === activeFloorId) continue;
      for (const desk of floor.desks) {
        if (desk.assignedAgentId) {
          seatedElsewhere.add(desk.assignedAgentId);
        }
      }
    }
  }
  return seatedElsewhere;
}

/**
 * Steps a discrete grid orientation (0/90/180/270 deg) cleanly in 90-degree increments.
 */
export function rotateGridRotation(rot: GridRotation, step: 90 | -90 = 90): GridRotation {
  return ((((rot + step) % 360) + 360) % 360) as GridRotation;
}

/**
 * Finds the ID of the room whose bounds inclusively contain cell `(x, z)`, or null.
 */
export function findContainingRoomId(floor: FloorConfig, x: number, z: number): string | null {
  const room = floor.rooms.find(
    (r) => x >= r.bounds.minX && x <= r.bounds.maxX && z >= r.bounds.minZ && z <= r.bounds.maxZ,
  );
  return room?.id ?? null;
}

/**
 * Checks whether a discrete grid cell `(x, z)` is out of bounds, reserved for the elevator,
 * or occupied by another desk/furniture item.
 */
export function isBuildCellOccupied(
  floor: FloorConfig,
  x: number,
  z: number,
  exclude?: { kind: "desk" | "furniture"; id: string },
  options?: { allowOutdoor?: boolean; floorIndex?: number },
): boolean {
  const [gridW, gridD] = floor.gridSize;
  const allowOutdoor = Boolean(options?.allowOutdoor && (options.floorIndex ?? 0) === 0);
  const inInteriorGrid = x >= 0 && z >= 0 && x < gridW && z < gridD;

  if (!inInteriorGrid) {
    if (!allowOutdoor) return true;
    const yardMargin = Math.floor(OUTDOOR_WALK_MARGIN_M) - 1;
    if (x < -yardMargin || z < -yardMargin || x >= gridW + yardMargin || z >= gridD + yardMargin) {
      return true;
    }
    // Keep perimeter facade apron, roof overhang strip, and South entrance steps clear
    const onWallPerimeter =
      ((x === -1 || x === gridW) && z >= -1 && z <= gridD) ||
      ((z === -1 || z === gridD) && x >= -1 && x <= gridW);
    if (onWallPerimeter) return true;
    if (Math.abs(x + 0.5 - gridW / 2) <= 2.4 && (z === gridD || z === gridD + 1)) {
      return true;
    }
    if (hitsObstacleBoxes(x + 0.5, z + 0.5, getCampusObstacleBoxes(gridW, gridD))) {
      return true;
    }
  }
  if (floor.elevatorCell && floor.elevatorCell[0] === x && floor.elevatorCell[1] === z) {
    return true;
  }
  if (floor.desks.some((d) => !(exclude?.kind === "desk" && d.id === exclude.id) && d.x === x && d.z === z)) {
    return true;
  }
  if (
    floor.furniture.some(
      (f) => !(exclude?.kind === "furniture" && f.id === exclude.id) && f.x === x && f.z === z,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Moves an existing desk to `(x, z)` (optionally updating rotation) and refreshes `roomId`.
 */
export function moveDeskToCell(
  floor: FloorConfig,
  deskId: string,
  x: number,
  z: number,
  rotation?: GridRotation,
): { valid: true; floor: FloorConfig } | { valid: false; reason: "occupied" | "not_found" } {
  const target = floor.desks.find((d) => d.id === deskId);
  if (!target) return { valid: false, reason: "not_found" };
  if (isBuildCellOccupied(floor, x, z, { kind: "desk", id: deskId })) {
    return { valid: false, reason: "occupied" };
  }
  const roomId = findContainingRoomId(floor, x, z);
  return {
    valid: true,
    floor: {
      ...floor,
      desks: floor.desks.map((d) =>
        d.id === deskId ? { ...d, x, z, rotation: rotation ?? d.rotation, roomId } : d,
      ),
    },
  };
}

/**
 * Moves an existing furniture item to `(x, z)` (optionally updating rotation) and refreshes `roomId`.
 */
export function moveFurnitureToCell(
  floor: FloorConfig,
  furnitureId: string,
  x: number,
  z: number,
  rotation?: GridRotation,
  floorIndex = 0,
): { valid: true; floor: FloorConfig } | { valid: false; reason: "occupied" | "not_found" } {
  const target = floor.furniture.find((f) => f.id === furnitureId);
  if (!target) return { valid: false, reason: "not_found" };
  if (
    isBuildCellOccupied(
      floor,
      x,
      z,
      { kind: "furniture", id: furnitureId },
      { allowOutdoor: OUTDOOR_FURNITURE_KINDS.has(target.kind), floorIndex },
    )
  ) {
    return { valid: false, reason: "occupied" };
  }
  const roomId = findContainingRoomId(floor, x, z);
  return {
    valid: true,
    floor: {
      ...floor,
      furniture: floor.furniture.map((f) =>
        f.id === furnitureId ? { ...f, x, z, rotation: rotation ?? f.rotation, roomId } : f,
      ),
    },
  };
}

/**
 * Shifts a room along with its doors and interior desks/furniture to a new center cell.
 */
export function moveRoomToCell(
  floor: FloorConfig,
  roomId: string,
  centerX: number,
  centerZ: number,
):
  | { valid: true; floor: FloorConfig }
  | { valid: false; reason: "overlaps" | "out_of_bounds" | "occupied" | "not_found" } {
  const room = floor.rooms.find((r) => r.id === roomId);
  if (!room) return { valid: false, reason: "not_found" };

  const w = room.bounds.maxX - room.bounds.minX + 1;
  const d = room.bounds.maxZ - room.bounds.minZ + 1;
  const newMinX = centerX - Math.floor(w / 2);
  const newMinZ = centerZ - Math.floor(d / 2);
  const dx = newMinX - room.bounds.minX;
  const dz = newMinZ - room.bounds.minZ;

  const shiftedRoom: RoomConfig = {
    ...room,
    bounds: {
      minX: newMinX,
      minZ: newMinZ,
      maxX: newMinX + w - 1,
      maxZ: newMinZ + d - 1,
    },
    doors: room.doors.map((door) => ({ x: door.x + dx, z: door.z + dz })),
  };

  const roomCheck = validateRoom(
    shiftedRoom,
    floor.rooms.filter((r) => r.id !== roomId),
    floor.gridSize,
  );
  if (!roomCheck.valid) {
    return {
      valid: false,
      reason: roomCheck.reason === "overlaps" ? "overlaps" : "out_of_bounds",
    };
  }

  const staticOccupied = new Set<string>();
  if (floor.elevatorCell) {
    staticOccupied.add(`${floor.elevatorCell[0]},${floor.elevatorCell[1]}`);
  }
  for (const desk of floor.desks) {
    if (desk.roomId !== roomId) staticOccupied.add(`${desk.x},${desk.z}`);
  }
  for (const furn of floor.furniture) {
    if (furn.roomId !== roomId) staticOccupied.add(`${furn.x},${furn.z}`);
  }

  const collidesAfterShift = (x: number, z: number): boolean =>
    x < 0 ||
    z < 0 ||
    x >= floor.gridSize[0] ||
    z >= floor.gridSize[1] ||
    staticOccupied.has(`${x},${z}`);

  for (const desk of floor.desks) {
    if (desk.roomId === roomId && collidesAfterShift(desk.x + dx, desk.z + dz)) {
      return { valid: false, reason: "occupied" };
    }
  }
  for (const furn of floor.furniture) {
    if (furn.roomId === roomId && collidesAfterShift(furn.x + dx, furn.z + dz)) {
      return { valid: false, reason: "occupied" };
    }
  }

  const updatedRooms = floor.rooms.map((r) => (r.id === roomId ? shiftedRoom : r));
  const floorWithRooms: FloorConfig = { ...floor, rooms: updatedRooms };

  return {
    valid: true,
    floor: {
      ...floorWithRooms,
      desks: floor.desks.map((desk) => {
        const nx = desk.roomId === roomId ? desk.x + dx : desk.x;
        const nz = desk.roomId === roomId ? desk.z + dz : desk.z;
        return {
          ...desk,
          x: nx,
          z: nz,
          roomId: findContainingRoomId(floorWithRooms, nx, nz),
        };
      }),
      furniture: floor.furniture.map((furn) => {
        const nx = furn.roomId === roomId ? furn.x + dx : furn.x;
        const nz = furn.roomId === roomId ? furn.z + dz : furn.z;
        return {
          ...furn,
          x: nx,
          z: nz,
          roomId: findContainingRoomId(floorWithRooms, nx, nz),
        };
      }),
    },
  };
}

export interface AutoDeskAgentContext {
  id: string;
  role: string;
  reportsTo?: string | null;
}

function chairCellForDesk(x: number, z: number, rotation: GridRotation): [number, number] {
  const rad = (rotation * Math.PI) / 180;
  return [x - Math.round(Math.sin(rad)), z - Math.round(Math.cos(rad))];
}

function collectFloorBlockedDeskCells(floor: FloorConfig, floorIndex: number): Set<string> {
  const blocked = new Set<string>();
  const [gridW, gridD] = floor.gridSize;

  if (floor.elevatorCell) {
    const [ex, ez] = floor.elevatorCell;
    for (let dz = -1; dz <= 2; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        blocked.add(`${ex + dx},${ez + dz}`);
      }
    }
  }

  // Keep ground-floor South entrance vestibule clear
  if (floorIndex === 0) {
    const midX = Math.floor(gridW / 2);
    for (let x = midX - 2; x <= midX + 2; x++) {
      for (let z = gridD - 3; z < gridD; z++) {
        blocked.add(`${x},${z}`);
      }
    }
  }

  // Keep room doorways & immediate entry tiles clear
  for (const room of floor.rooms) {
    for (const door of room.doors) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          blocked.add(`${door.x + dx},${door.z + dz}`);
        }
      }
    }
  }

  for (const desk of floor.desks) {
    blocked.add(`${desk.x},${desk.z}`);
    const [cx, cz] = chairCellForDesk(desk.x, desk.z, desk.rotation);
    blocked.add(`${cx},${cz}`);
  }

  // Block all indoor furniture cells (including decorative lamps/plants/tables and multi-tile footprints)
  for (const item of floor.furniture) {
    if (OUTDOOR_FURNITURE_KINDS.has(item.kind)) continue;
    blocked.add(`${item.x},${item.z}`);
    const fp = FURNITURE_FOOTPRINTS[item.kind];
    const { halfW, halfD } = getRotatedHalfExtents(fp, item.rotation);
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
          blocked.add(`${cx},${cz}`);
        }
      }
    }
  }

  return blocked;
}

export function findSmartDeskSlotOnFloor(
  floor: FloorConfig,
  agent: AutoDeskAgentContext,
  existingAgents: readonly AutoDeskAgentContext[] = [],
  floorIndex = 0,
): { x: number; z: number; rotation: GridRotation; roomId: string | null } | null {
  const [gridW, gridD] = floor.gridSize;
  const blocked = collectFloorBlockedDeskCells(floor, floorIndex);
  const agentsById = new Map(existingAgents.map((a) => [a.id, a]));

  const meetingRoomIds = new Set<string>();
  for (const item of floor.furniture) {
    if (item.kind === "meeting_table") {
      const rId = item.roomId ?? findContainingRoomId(floor, item.x, item.z);
      if (rId) meetingRoomIds.add(rId);
    }
  }

  const execRoomIds = new Set<string>();
  for (const r of floor.rooms) {
    if (r.id.includes("exec")) execRoomIds.add(r.id);
  }
  for (const d of floor.desks) {
    if (!d.roomId || !d.assignedAgentId) continue;
    const occupant = agentsById.get(d.assignedAgentId);
    if (occupant?.role === "ceo") {
      execRoomIds.add(d.roomId);
    }
  }

  const isCellValidForZone = (cx: number, cz: number, room: RoomConfig | null, strict: boolean): boolean => {
    if (cx < 1 || cz < 1 || cx > gridW - 2 || cz > gridD - 2) return false;
    if (blocked.has(`${cx},${cz}`)) return false;
    if (room) {
      return (
        cx > room.bounds.minX &&
        cx < room.bounds.maxX &&
        cz > room.bounds.minZ &&
        cz < room.bounds.maxZ
      );
    }
    if (findContainingRoomId(floor, cx, cz) !== null) return false;
    if (strict) {
      for (const r of floor.rooms) {
        if (
          cx >= r.bounds.minX - 1 &&
          cx <= r.bounds.maxX + 1 &&
          cz >= r.bounds.minZ - 1 &&
          cz <= r.bounds.maxZ + 1
        ) {
          return false;
        }
      }
    }
    return true;
  };

  const canPlaceAt = (
    x: number,
    z: number,
    rotation: GridRotation,
    room: RoomConfig | null,
    strict: boolean,
  ): boolean => {
    const [chairX, chairZ] = chairCellForDesk(x, z, rotation);
    if (!isCellValidForZone(x, z, room, strict)) return false;
    if (!isCellValidForZone(chairX, chairZ, room, strict)) return false;

    // Ensure the wide desk wings do not clip into room walls or furniture cells
    const { halfW, halfD } = getRotatedHalfExtents(DESK_FOOTPRINT, rotation);
    const minWingX = Math.floor(x + 0.5 - halfW + 0.05);
    const maxWingX = Math.floor(x + 0.5 + halfW - 0.05);
    const minWingZ = Math.floor(z + 0.5 - halfD + 0.05);
    const maxWingZ = Math.floor(z + 0.5 + halfD - 0.05);
    for (let wz = minWingZ; wz <= maxWingZ; wz++) {
      for (let wx = minWingX; wx <= maxWingX; wx++) {
        if (wx === chairX && wz === chairZ) continue;
        if (!isCellValidForZone(wx, wz, room, false)) return false;
      }
    }

    // Chair must have at least one walkable neighbor (other than the desk) so the agent isn't boxed in
    const neighbors: Array<[number, number]> = [
      [chairX - 1, chairZ],
      [chairX + 1, chairZ],
      [chairX, chairZ - 1],
      [chairX, chairZ + 1],
    ];
    const hasAccess = neighbors.some(
      ([nx, nz]) => !(nx === x && nz === z) && isCellValidForZone(nx, nz, room, false),
    );
    if (!hasAccess) return false;

    if (strict) {
      for (const d of floor.desks) {
        if (Math.abs(d.x - x) <= 1 && Math.abs(d.z - z) <= 1) return false;
      }
      for (const f of floor.furniture) {
        if (OUTDOOR_FURNITURE_KINDS.has(f.kind)) continue;
        if (Math.abs(f.x - x) + Math.abs(f.z - z) <= 1) return false;
        if (Math.abs(f.x - chairX) + Math.abs(f.z - chairZ) <= 1) return false;
      }
    }
    return true;
  };

  const scanRoom = (room: RoomConfig, strict: boolean): { x: number; z: number; rotation: GridRotation; roomId: string } | null => {
    const primaryDoor = room.doors[0] ?? { x: room.bounds.minX, z: Math.floor((room.bounds.minZ + room.bounds.maxZ) / 2) };
    const preferredSlots = getRoomDeskSlots(room.bounds, primaryDoor);
    const rotations: readonly GridRotation[] = [0, 180, 90, 270];

    for (const [sx, sz] of preferredSlots) {
      for (const rot of rotations) {
        if (canPlaceAt(sx, sz, rot, room, strict)) {
          return { x: sx, z: sz, rotation: rot, roomId: room.id };
        }
      }
    }

    for (let z = room.bounds.minZ + 2; z <= room.bounds.maxZ - 2; z++) {
      for (let x = room.bounds.minX + 2; x <= room.bounds.maxX - 2; x++) {
        for (const rot of rotations) {
          if (canPlaceAt(x, z, rot, room, strict)) {
            return { x, z, rotation: rot, roomId: room.id };
          }
        }
      }
    }

    if (!strict) {
      for (let z = room.bounds.minZ + 1; z <= room.bounds.maxZ - 1; z++) {
        for (let x = room.bounds.minX + 1; x <= room.bounds.maxX - 1; x++) {
          for (const rot of rotations) {
            if (canPlaceAt(x, z, rot, room, false)) {
              return { x, z, rotation: rot, roomId: room.id };
            }
          }
        }
      }
    }
    return null;
  };

  const scanOpenFloor = (strict: boolean): { x: number; z: number; rotation: GridRotation; roomId: null } | null => {
    const rotations: readonly GridRotation[] = [0, 180];
    for (let z = 3; z <= gridD - 3; z += strict ? 2 : 1) {
      for (let x = 2; x <= gridW - 3; x += 1) {
        for (const rot of rotations) {
          if (canPlaceAt(x, z, rot, null, strict)) {
            return { x, z, rotation: rot, roomId: null };
          }
        }
      }
    }
    return null;
  };

  const roomDeskCounts = new Map<string, number>();
  const roomAffinity = new Map<string, number>();
  for (const r of floor.rooms) {
    roomDeskCounts.set(r.id, 0);
    roomAffinity.set(r.id, 0);
  }
  for (const d of floor.desks) {
    if (!d.roomId) continue;
    roomDeskCounts.set(d.roomId, (roomDeskCounts.get(d.roomId) ?? 0) + 1);
    if (!d.assignedAgentId) continue;
    const occ = agentsById.get(d.assignedAgentId);
    if (!occ) continue;
    let bonus = 0;
    if (agent.reportsTo && occ.id === agent.reportsTo) bonus = Math.max(bonus, 100);
    if (agent.reportsTo && occ.reportsTo === agent.reportsTo) bonus = Math.max(bonus, 60);
    if (occ.role === agent.role) bonus = Math.max(bonus, 30);
    roomAffinity.set(d.roomId, Math.max(roomAffinity.get(d.roomId) ?? 0, bonus));
  }

  const eligibleTeamRooms = floor.rooms
    .filter((r) => !meetingRoomIds.has(r.id) && (agent.role === "ceo" || !execRoomIds.has(r.id)))
    .sort((a, b) => {
      const affDiff = (roomAffinity.get(b.id) ?? 0) - (roomAffinity.get(a.id) ?? 0);
      if (affDiff !== 0) return affDiff;
      return (roomDeskCounts.get(a.id) ?? 0) - (roomDeskCounts.get(b.id) ?? 0);
    });

  const fallbackExecRooms =
    agent.role === "ceo"
      ? []
      : floor.rooms.filter((r) => !meetingRoomIds.has(r.id) && execRoomIds.has(r.id));

  // Pass 1: Spacious placement in team rooms, then open floor
  for (const room of eligibleTeamRooms) {
    const hit = scanRoom(room, true);
    if (hit) return hit;
  }
  const openSpacious = scanOpenFloor(true);
  if (openSpacious) return openSpacious;

  // Pass 2: Snug-but-valid placement (never overlapping decorations/chairs/doors)
  for (const room of eligibleTeamRooms) {
    const hit = scanRoom(room, false);
    if (hit) return hit;
  }
  const openSnug = scanOpenFloor(false);
  if (openSnug) return openSnug;

  for (const room of fallbackExecRooms) {
    const hit = scanRoom(room, false);
    if (hit) return hit;
  }

  return null;
}

/**
 * Finds a clean, non-overlapping desk spot for a newly hired agent on `preferredFloorId`
 * (prioritizing their team's room and respecting all decorations), overflowing to another
 * floor or appending a new studio floor if the target floor is 100% packed.
 */
export function autoPlaceDeskInBuilding(
  building: BuildingConfig,
  preferredFloorId: string,
  agent: AutoDeskAgentContext,
  existingAgents: readonly AutoDeskAgentContext[] = [],
  deskId = `desk-${Date.now()}`,
): { floorId: string; desk: DeskConfig } {
  const orderedFloors = [
    ...building.floors.filter((f) => f.id === preferredFloorId),
    ...building.floors.filter((f) => f.id !== preferredFloorId),
  ];

  for (const floor of orderedFloors) {
    const floorIdx = building.floors.findIndex((f) => f.id === floor.id);
    const slot = findSmartDeskSlotOnFloor(floor, agent, existingAgents, Math.max(0, floorIdx));
    if (slot) {
      const desk: DeskConfig = {
        id: deskId,
        x: slot.x,
        z: slot.z,
        rotation: slot.rotation,
        roomId: slot.roomId,
        assignedAgentId: agent.id,
      };
      floor.desks.push(desk);
      return { floorId: floor.id, desk };
    }
  }

  // Every existing floor is completely full -> create an overflow floor with a starter team room
  const nextFloorNum = building.floors.length + 1;
  const baseFloor = building.floors[0];
  const gridSize: [number, number] = baseFloor?.gridSize ?? DEFAULT_GRID_SIZE;
  const elevatorCell = baseFloor?.elevatorCell ?? DEFAULT_ELEVATOR_CELL;
  const slotSpec = EXTRA_FLOOR_ROOM_SLOTS[0]!;
  const newRoomId = `room-f${nextFloorNum}-1`;
  const newRoom: RoomConfig = {
    id: newRoomId,
    name: `Team Studio ${nextFloorNum}`,
    floorPalette: pickPalette(nextFloorNum),
    wallStyle: "glass",
    bounds: {
      minX: slotSpec.minX,
      minZ: slotSpec.minZ,
      maxX: slotSpec.maxX,
      maxZ: slotSpec.maxZ,
    },
    doors: [slotSpec.door],
  };
  const firstSlot = getRoomDeskSlots(newRoom.bounds, slotSpec.door)[0] ?? [
    newRoom.bounds.minX + 2,
    newRoom.bounds.minZ + 2,
  ];
  const desk: DeskConfig = {
    id: deskId,
    x: firstSlot[0],
    z: firstSlot[1],
    rotation: 0,
    roomId: newRoomId,
    assignedAgentId: agent.id,
  };
  const newFloorId = `floor-${nextFloorNum}`;
  const existingIds = new Set(building.floors.map((f) => f.id));
  const safeFloorId = existingIds.has(newFloorId) ? `floor-${nextFloorNum}-${Date.now()}` : newFloorId;
  const furniture = defaultLobbyFurniture(nextFloorNum);
  furniture.push(...placeRoomInteriorProps("team", newRoom, [desk], furniture, 0));

  building.floors.push({
    id: safeFloorId,
    name: `Floor ${nextFloorNum} — Studio Wing`,
    gridSize,
    elevatorCell,
    rooms: [newRoom],
    desks: [desk],
    furniture,
  });
  return { floorId: safeFloorId, desk };
}
