import { z } from "zod";

const gridRotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

const officePaletteKeySchema = z.enum([
  "slate",
  "sand",
  "sage",
  "sky",
  "rose",
  "amber",
  "graphite",
]);

const roomSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  floorPalette: officePaletteKeySchema,
  wallStyle: z.enum(["glass", "wood", "none"]),
  bounds: z.object({
    minX: z.number().int().min(0).max(60),
    minZ: z.number().int().min(0).max(60),
    maxX: z.number().int().min(0).max(60),
    maxZ: z.number().int().min(0).max(60),
  }),
  doors: z.array(
    z.object({
      x: z.number().int().min(0).max(60),
      z: z.number().int().min(0).max(60),
    }),
  ),
});

const deskSchema = z.object({
  id: z.string().min(1).max(120),
  x: z.number().int().min(0).max(60),
  z: z.number().int().min(0).max(60),
  rotation: gridRotationSchema,
  roomId: z.string().nullable(),
  assignedAgentId: z.string().nullable(),
});

const furnitureItemSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum([
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
  ]),
  x: z.number().int().min(-24).max(84),
  z: z.number().int().min(-24).max(84),
  rotation: gridRotationSchema,
  roomId: z.string().nullable(),
  targetEntityId: z.string().max(120).optional(),
});

const floorSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  gridSize: z.tuple([z.number().int().min(12).max(60), z.number().int().min(12).max(60)]),
  elevatorCell: z.tuple([z.number().int().min(0).max(60), z.number().int().min(0).max(60)]).nullable(),
  rooms: z.array(roomSchema),
  desks: z.array(deskSchema),
  furniture: z.array(furnitureItemSchema),
});

const buildingSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  floors: z.array(floorSchema).min(1),
});

export const OFFICE_IDLE_PRESETS = ["focused", "balanced", "lively"] as const;
export type OfficeIdlePreset = (typeof OFFICE_IDLE_PRESETS)[number];

export const officeAgentBehaviorSchema = z.object({
  slogans: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  idlePreset: z.enum(OFFICE_IDLE_PRESETS).default("balanced"),
  refreshmentWeight: z.number().min(0).max(3).default(1),
  wanderWeight: z.number().min(0).max(3).default(1),
  sloganFrequency: z.number().min(0).max(1).default(0.35),
});
export type OfficeAgentBehaviorConfig = z.infer<typeof officeAgentBehaviorSchema>;

export const agentBehaviorsMapSchema = z.record(z.string().min(1), officeAgentBehaviorSchema);
export type AgentBehaviorsMapInput = z.infer<typeof agentBehaviorsMapSchema>;

export const officeLayoutDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  companyId: z.string().min(1),
  buildings: z.array(buildingSchema).min(1),
  agentBehaviors: agentBehaviorsMapSchema.optional(),
  updatedAt: z.string(),
});

const avatarSkinSchema = z.object({
  outfit: z.enum(["shirt", "hoodie", "suit", "tshirt", "apron"]),
  headwear: z.enum(["none", "sunglasses", "headset", "hardhat", "glasses", "beanie"]),
  skinTone: z.enum(["tone1", "tone2", "tone3", "tone4", "tone5"]),
  hairColor: z.enum(["black", "brown", "blonde", "red", "gray", "blue"]),
});

export const agentSkinsMapSchema = z.record(z.string().min(1), avatarSkinSchema);

export const upsertCompanyOfficeLayoutSchema = z.object({
  layout: officeLayoutDocumentSchema,
  agentSkins: agentSkinsMapSchema.optional(),
}).strict();

export type OfficeLayoutDocumentInput = z.infer<typeof officeLayoutDocumentSchema>;
export type AgentSkinsMapInput = z.infer<typeof agentSkinsMapSchema>;
export type UpsertCompanyOfficeLayoutInput = z.infer<typeof upsertCompanyOfficeLayoutSchema>;

export const OFFICE_WORKSPACE_MAX_ENTRIES = 200;
export const OFFICE_WORKSPACE_MAX_FILE_BYTES = 128 * 1024;
export const OFFICE_WORKSPACE_SOURCE_KINDS = [
  "execution_workspace",
  "run_workspace",
  "agent_cwd",
] as const;
export type OfficeWorkspaceSourceKind = (typeof OFFICE_WORKSPACE_SOURCE_KINDS)[number];

export interface OfficeWorkspaceTarget {
  id: string;
  label: string;
  sourceKind: OfficeWorkspaceSourceKind;
  cwd: string;
  branchName: string | null;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  executionWorkspaceId: string | null;
  lastUsedAt: string | null;
  exists: boolean;
}

export interface OfficeWorkspaceListResponse {
  workspaces: OfficeWorkspaceTarget[];
}

export interface OfficeWorkspaceEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
  sizeBytes: number | null;
  modifiedAt: string | null;
}

export interface OfficeWorkspaceTreeResponse {
  workspace: OfficeWorkspaceTarget;
  currentPath: string;
  entries: OfficeWorkspaceEntry[];
  truncated: boolean;
}

export interface OfficeWorkspaceFileResponse {
  workspace: OfficeWorkspaceTarget;
  path: string;
  sizeBytes: number;
  modifiedAt: string | null;
  isBinary: boolean;
  truncated: boolean;
  content: string | null;
}
