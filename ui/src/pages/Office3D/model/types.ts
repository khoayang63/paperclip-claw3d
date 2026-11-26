import type {
  AgentStatus,
  HeartbeatRunStatus,
  OfficeAgentBehaviorConfig,
  PauseReason,
} from "@paperclipai/shared";

export type { OfficeAgentBehaviorConfig };

export type BuildingViewMode = "cutaway" | "full";

export interface FurnitureFootprint {
  width: number;
  depth: number;
}

export type OfficePaletteKey =
  | "slate"
  | "sand"
  | "sage"
  | "sky"
  | "rose"
  | "amber"
  | "graphite";

export interface OfficeLayout {
  schemaVersion: 1;
  companyId: string;
  buildings: BuildingConfig[];
  agentBehaviors?: Record<string, OfficeAgentBehaviorConfig>;
  updatedAt: string;
}

export interface BuildingConfig {
  id: string;
  name: string;
  floors: FloorConfig[];
}

export type GridRotation = 0 | 90 | 180 | 270;

export interface FloorConfig {
  id: string;
  name: string;
  gridSize: [number, number];
  elevatorCell: [number, number] | null;
  rooms: RoomConfig[];
  desks: DeskConfig[];
  furniture: FurnitureItem[];
}

export interface RoomConfig {
  id: string;
  name: string;
  floorPalette: OfficePaletteKey;
  wallStyle: "glass" | "wood" | "none";
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  doors: Array<{ x: number; z: number }>;
}

export interface DeskConfig {
  id: string;
  x: number;
  z: number;
  rotation: GridRotation;
  roomId: string | null;
  assignedAgentId: string | null;
}

export type FurnitureKind =
  | "approval_desk"
  | "server_rack"
  | "hr_reception"
  | "routines_clock"
  | "artifacts_showcase"
  | "whiteboard"
  | "coffee_machine"
  | "meeting_table"
  | "plant"
  | "sofa"
  | "bookshelf"
  | "water_cooler"
  | "printer"
  | "filing_cabinet"
  | "aquarium"
  | "arcade_machine"
  | "floor_lamp"
  | "lounge_table"
  | "vending_machine"
  | "outdoor_sakura_tree"
  | "outdoor_oak_tree"
  | "outdoor_pine_tree"
  | "outdoor_bench"
  | "outdoor_lamp"
  | "outdoor_flower_bed"
  | "kpi_screen";

export type OfficeItemKind =
  | "water_cup"
  | "coffee_cup"
  | "document"
  | "handbook";

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  rotation: GridRotation;
  roomId: string | null;
  targetEntityId?: string;
}

export type AvatarOutfit = "shirt" | "hoodie" | "suit" | "tshirt" | "apron";
export type AvatarHeadwear = "none" | "sunglasses" | "headset" | "hardhat" | "glasses" | "beanie";
export type AvatarSkinTone = "tone1" | "tone2" | "tone3" | "tone4" | "tone5";
export type AvatarHairColor = "black" | "brown" | "blonde" | "red" | "gray" | "blue";

export interface AvatarSkinConfig {
  outfit: AvatarOutfit;
  headwear: AvatarHeadwear;
  skinTone: AvatarSkinTone;
  hairColor: AvatarHairColor;
}

export interface AgentSkinMap {
  companyId: string;
  skins: Record<string, AvatarSkinConfig>;
}

export type EnvironmentTimeMode = "realtime" | "day" | "sunset" | "night" | "custom";
export type WeatherKind = "clear" | "rain" | "snow";
export type DayPhase = "dawn" | "day" | "sunset" | "night";

export interface EnvironmentConfig {
  timeMode: EnvironmentTimeMode;
  customHour: number;
  weather: WeatherKind;
  enableNightAutoLights: boolean;
  enableEndOfDayRecap: boolean;
  weatherAudioVolume: number;
}

export type OfficeColorToken = `--office-${string}`;

export interface ComputedLightingState {
  effectiveHour: number;
  phase: DayPhase;
  isNight: boolean;
  sunPosition: [number, number, number];
  sunColor: OfficeColorToken;
  sunIntensity: number;
  ambientColor: OfficeColorToken;
  ambientIntensity: number;
  skyTopColor: OfficeColorToken;
  skyTopColorNext: OfficeColorToken;
  skyHorizonColor: OfficeColorToken;
  skyHorizonColorNext: OfficeColorToken;
  fogColor: OfficeColorToken;
  fogColorNext: OfficeColorToken;
  blend: number;
  screenEmissiveIntensity: number;
  ceilingLampEmissiveIntensity: number;
  interiorLightFactor: number;
}

export type ComputeLighting = (hour: number) => ComputedLightingState;

export interface EndOfDayRecap {
  date: string;
  issuesCompleted: number;
  runsFailed: number;
  totalCostCents: number;
  pendingApprovals: number;
}

export type InteractiveStationKind =
  | "agent_desk"
  | "empty_chair"
  | "approval_desk"
  | "server_rack"
  | "hr_reception"
  | "routines_clock"
  | "artifacts_showcase"
  | "whiteboard"
  | "elevator"
  | "sofa"
  | "coffee_machine"
  | "water_cooler"
  | "meeting_table"
  | "bookshelf"
  | "printer"
  | "filing_cabinet"
  | "plant"
  | "aquarium"
  | "arcade_machine"
  | "floor_lamp"
  | "lounge_table"
  | "vending_machine"
  | "outdoor_sakura_tree"
  | "outdoor_oak_tree"
  | "outdoor_pine_tree"
  | "outdoor_bench"
  | "outdoor_lamp"
  | "outdoor_flower_bed"
  | "outdoor_dog"
  | "outdoor_cat"
  | "outdoor_rabbit"
  | "outdoor_koi_pond"
  | "outdoor_fountain"
  | "kpi_screen";

export interface HotbarItem {
  id: string;
  kind: OfficeItemKind;
  label: string;
  sourceStationId?: string;
  entityKind?: "issue" | "agent";
  entityId?: string;
  entityIdentifier?: string;
}

export interface OfficeHotbarState {
  selectedSlot: number;
  slots: Array<HotbarItem | null>;
}

export type StationStatusToken = "healthy" | "warning" | "critical" | "idle";

export interface InteractiveStation {
  id: string;
  kind: InteractiveStationKind;
  floorId: string;
  cell: [number, number];
  rotation: GridRotation;
  interactionRadius: number;
  labelKey: string;
  labelFallback?: string;
  badgeCount?: number;
  statusToken?: StationStatusToken;
  targetEntityId?: string;
}

export type AgentVisualState =
  | "hidden"
  | "awaiting_hire"
  | "paused_budget"
  | "paused"
  | "error"
  | "coding"
  | "thinking"
  | "waiting"
  | "meeting"
  | "idle";

export interface AgentVisualStateInput {
  agentStatus: AgentStatus;
  pauseReason: PauseReason | null;
  currentRunStatus: HeartbeatRunStatus | null;
  lastRunFailedAt: string | null;
  lastRunEventKind: "tool_call" | "message" | "unknown" | null;
  inMeeting: boolean;
  now: number;
}

export type MapAgentVisualState = (input: AgentVisualStateInput) => AgentVisualState;

export interface AgentOfficeSnapshot {
  agentId: string;
  name: string;
  urlKey: string;
  role: string;
  title: string | null;
  icon: string | null;
  reportsTo: string | null;
  visualState: AgentVisualState;
  currentRunId: string | null;
  currentIssueIdentifier: string | null;
  currentIssueTitle: string | null;
  runStartedAt: string | null;
  costTodayCents: number | null;
  budgetUtilizationPct: number | null;
}

export type OfficeActionCapability =
  | "approve"
  | "pause_resume_agent"
  | "assign_issue"
  | "hire_agent"
  | "edit_layout";

export interface OfficeControlPlaneSummary {
  companyId: string;
  pendingApprovalsCount: number;
  upcomingRoutines: Array<{ routineId: string; name: string; nextRunAt: string | null; status: string }>;
  runningWorkspaces: Array<{
    workspaceId: string;
    name: string;
    status: "healthy" | "unhealthy" | "stopped";
    previewUrl?: string;
  }>;
  recentArtifactsCount: number;
  agentsById: Record<string, AgentOfficeSnapshot>;
  allowedActions: OfficeActionCapability[];
}

export type CameraControlMode = "rpg" | "first_person" | "overview" | "follow_agent" | "pip";

export interface OfficeNavigationState {
  cameraMode: CameraControlMode;
  activeBuildingId: string;
  activeFloorId: string;
  focusedAgentId: string | null;
  hoveredAgentId: string | null;
  showMinimap: boolean;
}

export interface OfficeDeepLinkParams {
  agent?: string;
  floor?: string;
}

export interface WorldMarker {
  id: string;
  kind: "run_error" | "approval_pending" | "task_completed" | "budget_paused";
  floorId: string;
  cell: [number, number];
  targetEntityId: string;
  label: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface OrgLayoutAgentInput {
  agentId: string;
  name: string;
  role: string;
  reportsTo: string | null;
  status: AgentStatus;
}

export type GenerateLayoutFromOrg = (
  companyId: string,
  agents: OrgLayoutAgentInput[],
  options?: { maxDesksPerFloor?: number; gridSize?: [number, number] },
) => OfficeLayout;

export interface OfficeBlueprintExport {
  kind: "paperclip.office-blueprint";
  exportedAt: string;
  sourceCompanyName: string;
  layout: OfficeLayout;
}

export interface FloorNavGrid {
  floorId: string;
  width: number;
  depth: number;
  blockedCells: Uint8Array;
  wallEdges: Uint8Array;
}

export type FindPath = (
  grid: FloorNavGrid,
  from: [number, number],
  to: [number, number],
) => Array<[number, number]> | null;

export type AgentMovementPurpose =
  | "return_desk"
  | "handoff"
  | "meeting"
  | "lounge_break"
  | "social_chat";

export type CharacterActionPose =
  | "none"
  | "chatting"
  | "drinking"
  | "inspecting"
  | "reading"
  | "giving"
  | "waving"
  | "stretching"
  | "celebrating"
  | "playing_arcade"
  | "petting"
  | "feeding"
  | "clapping";

export interface SavedOfficePlayerState {
  buildingId: string;
  floorId: string;
  x: number;
  z: number;
  yaw: number;
  fpYaw?: number;
  fpPitch?: number;
  cameraMode: "rpg" | "first_person" | "overview";
  buildingViewMode: BuildingViewMode;
}

export interface OfficeKpiSnapshot {
  doneIssues: number;
  activeIssues: number;
  runningAgents: number;
  totalAgents: number;
  costTodayCents: number;
  topAgentName: string | null;
  topAgentScore?: number | null;
}

export interface IdlePointOfInterest {
  key: string;
  cell: [number, number];
  lookAt: { x: number; z: number } | null;
  kind: FurnitureKind | "corridor";
  actionPose: CharacterActionPose;
  bubbleKey: string;
  furnitureId?: string;
  roomId?: string | null;
}

export interface AgentMovementTask {
  id: string;
  agentId: string;
  purpose: AgentMovementPurpose;
  targetFloorId: string;
  targetCell: [number, number];
  pathWaypoints?: Array<[number, number]>;
  bubbleText?: string;
  targetAgentId?: string;
  startedAt: number;
}

export interface LiveAgentPosition {
  x: number;
  z: number;
  moving: boolean;
}
