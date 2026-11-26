import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AGENT_ACCEL_MPS2,
  AGENT_DECEL_DIST_M,
  AGENT_GIFT_PROXIMITY_METERS,
  AGENT_SEPARATION_RADIUS_M,
  AGENT_SEPARATION_STRENGTH,
  AGENT_URGENT_SPEED_MPS,
  AGENT_WALK_SPEED_MPS,
  BUILDING_FLOOR_HEIGHT_M,
  CELL_SIZE_METERS,
  ELEVATOR_DOOR_SLIDE_M,
  ELEVATOR_DOOR_TRIGGER_RADIUS_M,
  ELEVATOR_FOOTPRINT,
  HANDOFF_BUBBLE_DURATION_MS,
  HANDOFF_DWELL_MS,
  IDLE_INITIAL_MIN_DWELL_MS,
  IDLE_INITIAL_STAGGER_MS,
  IDLE_MAX_DWELL_MS,
  IDLE_MIN_DWELL_MS,
  INTERACTION_RADIUS_METERS,
  MAX_RAIN_STREAKS,
  MAX_VISIBLE_BUBBLES,
  MAX_VISIBLE_LABELS,
  MAX_WEATHER_PARTICLES,
  OUTDOOR_FURNITURE_KINDS,
  OUTDOOR_GROUND_Y,
  OUTDOOR_WALK_MARGIN_M,
  PLAYER_ACTION_POSE_DURATION_MS,
  PLAYER_GRAVITY_MPS2,
  PLAYER_JUMP_VELOCITY_MPS,
  PLAYER_SPEED_MPS,
  PLAYER_SPRINT_MULTIPLIER,
  POI_MAX_DWELL_MS,
  POI_MIN_DWELL_MS,
  RAIN_DRIFT_X_MPS,
  RAIN_DROPLET_SIZE,
  RAIN_DROPLET_TILT_RAD,
  RAIN_FALL_Y_MPS,
  REDUCED_MOTION_WEATHER_SCALE,
  SNOW_FALL_Y_MPS,
  SNOW_FLAKE_SIZE,
  SNOW_SWAY_X_MPS,
  SOCIAL_CHAT_CHANCE,
  SOCIAL_CHAT_MAX_DWELL_MS,
  SOCIAL_CHAT_MIN_DWELL_MS,
  TOP_HUD_SAFE_PX,
  WALK_STRIDE_RAD_PER_METER,
} from "../model/constants";
import {
  canMoveBetween,
  clampPointForOutdoorMode,
  computePlayerGroundY,
  hasUnobstructedWallLineOfSight,
  isBuildCellOccupied,
  isCellOnRoomBoundary,
  isPointBlocked,
  moveRoomToCell,
  type OutdoorZoneMode,
} from "../model/layout";
import { computeLighting, resolveEffectiveHour } from "../model/lighting";
import {
  buildFloorNavGrid,
  findNearestWalkableCell,
  findPath,
  getDeskSeatCell,
  getIdlePointsOfInterest,
  getMeetingSeatCells,
  pickWeightedIdlePoi,
  smoothPath,
} from "../model/navGrid";
import type {
  AgentMovementTask,
  AgentOfficeSnapshot,
  AgentVisualState,
  AvatarSkinConfig,
  BuildingViewMode,
  CameraControlMode,
  CharacterActionPose,
  EnvironmentConfig,
  FloorConfig,
  FloorNavGrid,
  FurnitureKind,
  GridRotation,
  IdlePointOfInterest,
  InteractiveStation,
  LiveAgentPosition,
  OfficeColorToken,
  OfficeItemKind,
  OfficeKpiSnapshot,
  OfficePaletteKey,
  WorldMarker,
} from "../model/types";
import { OFFICE_COPY, type OfficeCopyKey } from "../officeCopy";
import { OfficeSpatialAudio, type SpatialAudioSource } from "./audio";
import { buildBuildingShell, type BuildingShellHandle } from "./buildingShell";
import { buildDeskAssembly, buildFurnitureAssembly, buildHeldItemMesh } from "./furnitureModels";
import { buildOutdoorLife, type OutdoorInteractionResult, type OutdoorLifeHandle } from "./outdoorLife";
import { OfficePalette } from "./palette";
import {
  computeWeatherVolumeBounds,
  createDefaultWeatherBounds,
  sampleWeatherSpawnPosition,
  stepWeatherParticle,
  type WeatherVolumeBounds,
} from "./weather";
import {
  createVoxelCharacter,
  disposeObjectTree,
  updateVoxelPose,
  type VoxelCharacterRig,
} from "./voxelCharacter";

export type BuildTool = "select" | "move" | "room" | "furniture" | "delete";

export type BuildPlaceableKind = "desk" | "door" | FurnitureKind;

export interface BuildGhostPreview {
  kind: "desk" | "furniture" | "door" | "room";
  furnitureKind?: FurnitureKind;
  rotation: GridRotation;
  roomSize?: { w: number; d: number };
  sourceEntityId?: string;
}

export interface BuildModeState {
  enabled: boolean;
  tool: BuildTool;
  selectedTarget: { kind: "room" | "desk" | "furniture"; id: string } | null;
  ghostPreview?: BuildGhostPreview | null;
}

export interface ProjectedAgentLabel {
  agentId: string;
  name: string;
  visualState: AgentVisualState;
  screenX: number;
  screenY: number;
  bubbleText?: string | null;
}

export interface ProjectedMarker {
  marker: WorldMarker;
  screenX: number;
  screenY: number;
  offScreen: boolean;
  edgeAngleRad: number;
}

export interface HoveredAgentInfo {
  agentId: string;
  screenX: number;
  screenY: number;
}

export interface SceneCallbacks {
  onNearestStation: (station: InteractiveStation | null) => void;
  onNearestAgent?: (agentId: string | null) => void;
  onPlayerSeatedChange?: (seated: boolean) => void;
  onPointerLockChange?: (locked: boolean) => void;
  onFollowAgentChange?: (agentId: string | null) => void;
  onSelectStation: (station: InteractiveStation) => void;
  onHoverAgent: (info: HoveredAgentInfo | null) => void;
  onPlayerPosition: (x: number, z: number) => void;
  onProjectedOverlays: (
    labels: ProjectedAgentLabel[],
    markers: ProjectedMarker[],
    agentPositions: Record<string, LiveAgentPosition>,
  ) => void;
  onBuildCellClick: (cellX: number, cellZ: number) => void;
  onBuildRoomDrag: (bounds: { minX: number; minZ: number; maxX: number; maxZ: number }) => void;
  onBuildSelectEntity: (target: { kind: "room" | "desk" | "furniture"; id: string } | null) => void;
}

const PALETTE_TOKEN_BY_KEY: Record<OfficePaletteKey, OfficeColorToken> = {
  slate: "--office-palette-slate",
  sand: "--office-palette-sand",
  sage: "--office-palette-sage",
  sky: "--office-palette-sky",
  rose: "--office-palette-rose",
  amber: "--office-palette-amber",
  graphite: "--office-palette-graphite",
};

const STATUS_TOKEN_BY_VISUAL: Record<AgentVisualState, OfficeColorToken> = {
  hidden: "--office-status-idle",
  awaiting_hire: "--office-status-warning",
  paused_budget: "--office-status-critical",
  paused: "--office-status-warning",
  error: "--office-status-critical",
  coding: "--office-status-coding",
  thinking: "--office-status-thinking",
  waiting: "--office-status-warning",
  meeting: "--office-status-healthy",
  idle: "--office-status-idle",
};

export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGL2RenderingContext && canvas.getContext("webgl2"),
    ) || Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

type InternalActorPurpose =
  | "idle_desk"
  | "return_desk"
  | "lounge_break"
  | "social_chat"
  | "handoff"
  | "meeting";

type AgentCommutePhase =
  | "none"
  | "departing_elevator"
  | "away_other_floor"
  | "arriving_elevator"
  | "returning_elevator";

interface AgentActorRecord {
  agentId: string;
  rig: VoxelCharacterRig;
  x: number;
  z: number;
  yaw: number;
  homeX: number;
  homeZ: number;
  homeYaw: number;
  homeSeatCell: [number, number];
  hasDesk: boolean;
  isVisitor: boolean;
  commutePhase: AgentCommutePhase;
  commuteReturnAtMs: number;
  seated: boolean;
  isWalking: boolean;
  purpose: InternalActorPurpose;
  waypoints: Array<[number, number]>;
  dwellUntilMs: number;
  faceTarget: { x: number; z: number } | null;
  bubbleText: string | null;
  bubbleExpiresAtMs: number;
  visualState: AgentVisualState;
  monitorScreen: THREE.Mesh | null;
  currentSpeed: number;
  walkPhase: number;
  paceFactor: number;
  phaseOffset: number;
  seatBlend: number;
  turnRate: number;
  actionPose: CharacterActionPose;
  actionStartedAtMs: number;
  actionExpiresAtMs: number;
  transientItemExpiresAtMs: number;
  hasTransientItem: boolean;
  socialPartnerId: string | null;
  lastPoiKey: string | null;
  activePoiKind: FurnitureKind | "corridor" | null;
  activePoiFurnitureId: string | null;
  sofaReturnCell: [number, number] | null;
  sofaSeatSlot: number | null;
  seatYOffset: number;
  isOutdoorStroll: boolean;
  lastGreetedPlayerAtMs: number;
  nextWorkSloganAtMs: number;
  nextStretchAtMs: number;
}

interface PreservedActorMotion {
  x: number;
  z: number;
  yaw: number;
  homeX: number;
  homeZ: number;
  homeYaw: number;
  seated: boolean;
  isWalking: boolean;
  purpose: InternalActorPurpose;
  waypoints: Array<[number, number]>;
  dwellUntilMs: number;
  faceTarget: { x: number; z: number } | null;
  bubbleText: string | null;
  bubbleExpiresAtMs: number;
  currentSpeed: number;
  walkPhase: number;
  seatBlend: number;
  turnRate: number;
  actionPose: CharacterActionPose;
  socialPartnerId: string | null;
  lastPoiKey: string | null;
}

function agentHash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function copyText(key: string): string {
  return (OFFICE_COPY as Record<string, string>)[key] ?? key;
}

interface WeatherParticleField {
  mesh: THREE.InstancedMesh;
  coords: Float32Array;
  count: number;
  tiltZ: number;
}

function lerpAngle(from: number, to: number, t: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

export class OfficeSceneEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: SceneCallbacks;
  private readonly palette: OfficePalette;
  private readonly audio: OfficeSpatialAudio;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private readonly sunLight: THREE.DirectionalLight;
  private readonly ambientLight: THREE.HemisphereLight;
  private readonly skyDome: THREE.Mesh;
  private readonly starField: THREE.Points;
  private readonly celestialSunGroup: THREE.Group;
  private readonly celestialMoonGroup: THREE.Group;
  private readonly weatherDummy = new THREE.Object3D();
  private weatherBounds: WeatherVolumeBounds = createDefaultWeatherBounds();
  private readonly rainField: WeatherParticleField;
  private readonly snowField: WeatherParticleField;
  private outdoorLife: OutdoorLifeHandle | null = null;
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpMoveVec = new THREE.Vector3();
  private readonly tmpDesiredTarget = new THREE.Vector3();
  private readonly tmpDelta = new THREE.Vector3();
  private readonly tmpOffset = new THREE.Vector3();
  private lastPlayerPosEmitMs = 0;
  private lastEmittedWalked = false;
  private fpYaw = Math.PI;
  private fpPitch = -0.05;
  private fpDragging = false;
  private pointerLocked = false;
  private fpLastPointer = { x: 0, y: 0 };
  private readonly fpHandGroup: THREE.Group;
  private readonly fpSleeveMesh: THREE.Mesh;
  private readonly fpSkinMesh: THREE.Mesh;
  private readonly fpHeldItemGroup = new THREE.Group();
  private renderedFpItemKind: OfficeItemKind | null = null;

  private readonly worldGroup = new THREE.Group();
  private readonly agentsGroup = new THREE.Group();
  private readonly buildOverlayGroup = new THREE.Group();
  private readonly moveTargetMarker: THREE.Mesh;
  private readonly hoverCellMesh: THREE.Mesh;
  private readonly dragPreviewMesh: THREE.Mesh;
  private readonly selectionRing: THREE.Mesh;
  private readonly placementGhostGroup = new THREE.Group();
  private ghostCacheKey = "";
  private ghostPreviewMat: THREE.MeshStandardMaterial | null = null;
  private lastBuildHoverCell: [number, number] | null = null;

  private playerRig: VoxelCharacterRig;
  private playerX = 14.5;
  private playerZ = 3.5;
  private playerYaw = 0;
  private playerWalkPhase = 0;
  private playerVelY = 0;
  private playerJumpOffsetY = 0;
  private initialPlayerStateApplied = false;
  private followedAgentId: string | null = null;
  private lastComputedIsNight = false;
  private nextStandupTurnAtMs = 0;
  private standupSpeakerIndex = 0;
  private playerWaypoints: Array<[number, number]> = [];
  private finalMoveTarget: { x: number; z: number } | null = null;
  private readonly pressedKeys = new Set<string>();

  private cameraMode: CameraControlMode = "rpg";
  private cameraFocusTarget: THREE.Vector3 | null = null;
  private performanceMode = false;
  private reducedMotion = false;
  private environmentConfig: EnvironmentConfig;

  private floor: FloorConfig | null = null;
  private activeFloorIndex = 0;
  private totalFloorsInBuilding = 1;
  private buildingViewMode: BuildingViewMode = "cutaway";
  private buildingShell: BuildingShellHandle | null = null;
  private elevatorDoors: {
    left: THREE.Mesh;
    right: THREE.Mesh;
    centerX: number;
    centerZ: number;
    openAmount: number;
  } | null = null;
  private navGrid: FloorNavGrid | null = null;
  private stations: InteractiveStation[] = [];
  private agentsById: Record<string, AgentOfficeSnapshot> = {};
  private seatedElsewhereAgentIds: ReadonlySet<string> = new Set();
  private agentSkins: Record<string, AvatarSkinConfig> = {};
  private agentBehaviors: Record<string, import("../model/types").OfficeAgentBehaviorConfig> = {};
  private agentSkinResolver: (agent: AgentOfficeSnapshot) => AvatarSkinConfig;
  private goalCompletionRatio = 0.5;
  private trophyAgentIds: ReadonlySet<string> = new Set();
  private meetingActive = false;
  private replayActive = false;
  private markers: WorldMarker[] = [];
  private buildState: BuildModeState = { enabled: false, tool: "select", selectedTarget: null };

  private readonly agentActors = new Map<string, AgentActorRecord>();
  private pendingVisitorSpawns: Array<{
    spawnAtMs: number;
    agentId: string;
    bubbleText: string;
    goalCell: [number, number];
    faceTarget: { x: number; z: number } | null;
    purpose: "handoff" | "meeting";
    dwellMs: number;
  }> = [];
  private readonly ceilingLamps: THREE.Mesh[] = [];
  private readonly deskLampBulbs: THREE.Mesh[] = [];
  private readonly kpiScreenMeshes: THREE.Mesh[] = [];
  private kpiSnapshot: OfficeKpiSnapshot | null = null;
  private kpiCanvasTexture: THREE.CanvasTexture | null = null;
  private readonly interiorLights: THREE.PointLight[] = [];
  private readonly handoffBeams: Array<{ line: THREE.Line; expiresAtMs: number }> = [];
  private spatialSources: SpatialAudioSource[] = [];
  private clickableObjects: Array<{ object: THREE.Object3D; stationId?: string; agentId?: string; outdoorId?: string; buildTarget?: { kind: "room" | "desk" | "furniture"; id: string } }> = [];

  private rafId: number | null = null;
  private lastFrameTime = 0;
  private lastOverlayEmitTime = 0;
  private lastNearestStationId: string | null = null;
  private lastNearestAgentId: string | null = null;
  private lastHoveredAgentId: string | null = null;
  private lastLightingTick = 0;
  private playerHeldItemKind: OfficeItemKind | null = null;
  private renderedPlayerItemKind: OfficeItemKind | null = null;
  private playerSeat: {
    x: number;
    z: number;
    yaw: number;
    returnX: number;
    returnZ: number;
    stationId: string;
  } | null = null;
  private playerActionPose: {
    pose: CharacterActionPose;
    startedAtMs: number;
    expiresAtMs: number;
    transientItemKind?: OfficeItemKind | null;
  } | null = null;

  private pointerDownClient = { x: 0, y: 0 };
  private dragStartCell: [number, number] | null = null;
  private isDraggingRoom = false;
  private isHidden = false;
  private disposed = false;

  constructor(options: {
    container: HTMLElement;
    playerSkin: AvatarSkinConfig;
    environment: EnvironmentConfig;
    audio: OfficeSpatialAudio;
    agentSkinResolver: (agent: AgentOfficeSnapshot) => AvatarSkinConfig;
    callbacks: SceneCallbacks;
  }) {
    this.container = options.container;
    this.callbacks = options.callbacks;
    this.audio = options.audio;
    this.environmentConfig = options.environment;
    this.agentSkinResolver = options.agentSkinResolver;

    this.palette = new OfficePalette(() => {
      if (this.floor) {
        this.rebuildFloorGeometry();
      }
      this.applyEnvironmentLighting(true);
    });

    const width = Math.max(320, this.container.clientWidth || 800);
    const height = Math.max(240, this.container.clientHeight || 600);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(this.palette.getColor("--office-fog-day"), 60, 175);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.2, 280);
    this.camera.position.set(24, 16, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 95;
    this.controls.minPolarAngle = Math.PI / 10;
    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    // Single shadow-casting directional light + hemisphere ambient light
    this.sunLight = new THREE.DirectionalLight(this.palette.getColor("--office-sun-day"), 1.2);
    this.sunLight.position.set(20, 28, 18);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1536, 1536);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 120;
    this.sunLight.shadow.camera.left = -44;
    this.sunLight.shadow.camera.right = 44;
    this.sunLight.shadow.camera.top = 44;
    this.sunLight.shadow.camera.bottom = -44;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight, this.sunLight.target);

    this.ambientLight = new THREE.HemisphereLight(
      this.palette.getColor("--office-ambient-day"),
      this.palette.getColor("--office-floor-base"),
      0.75,
    );
    this.scene.add(this.ambientLight);

    // Vertex-colored sky dome (zero literal shader hex values) + voxel Sun & Moon
    this.skyDome = this.createSkyDome();
    this.scene.add(this.skyDome);

    this.starField = this.createStarField();
    this.scene.add(this.starField);

    const celestials = this.createCelestialBodies();
    this.celestialSunGroup = celestials.sunGroup;
    this.celestialMoonGroup = celestials.moonGroup;
    this.scene.add(this.celestialSunGroup, this.celestialMoonGroup);

    this.rainField = this.createWeatherField({
      count: MAX_RAIN_STREAKS,
      size: RAIN_DROPLET_SIZE,
      token: "--office-weather-rain",
      opacity: 0.82,
      tiltZ: RAIN_DROPLET_TILT_RAD,
    });
    this.snowField = this.createWeatherField({
      count: MAX_WEATHER_PARTICLES,
      size: SNOW_FLAKE_SIZE,
      token: "--office-weather-snow",
      opacity: 0.92,
      tiltZ: 0,
    });
    this.scene.add(this.rainField.mesh, this.snowField.mesh);

    this.scene.add(this.worldGroup, this.agentsGroup, this.buildOverlayGroup);

    // Move target indicator ring
    this.moveTargetMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.34, 16),
      new THREE.MeshBasicMaterial({
        color: this.palette.getColor("--office-status-healthy"),
        side: THREE.DoubleSide,
      }),
    );
    this.moveTargetMarker.rotation.x = -Math.PI / 2;
    this.moveTargetMarker.position.y = 0.03;
    this.moveTargetMarker.visible = false;
    this.scene.add(this.moveTargetMarker);

    // Build mode helpers
    this.hoverCellMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.94, 0.94),
      new THREE.MeshBasicMaterial({
        color: this.palette.getColor("--office-status-coding"),
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    this.hoverCellMesh.rotation.x = -Math.PI / 2;
    this.hoverCellMesh.position.y = 0.04;
    this.hoverCellMesh.visible = false;

    this.dragPreviewMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.25, 1),
      new THREE.MeshBasicMaterial({
        color: this.palette.getColor("--office-status-healthy"),
        transparent: true,
        opacity: 0.35,
      }),
    );
    this.dragPreviewMesh.visible = false;

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 24),
      new THREE.MeshBasicMaterial({
        color: this.palette.getColor("--office-status-warning"),
        side: THREE.DoubleSide,
      }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.05;
    this.selectionRing.visible = false;

    this.placementGhostGroup.visible = false;
    this.buildOverlayGroup.add(
      this.hoverCellMesh,
      this.dragPreviewMesh,
      this.selectionRing,
      this.placementGhostGroup,
    );

    this.playerRig = createVoxelCharacter(options.playerSkin, this.palette, {
      name: "PlayerAvatar",
      isPlayer: true,
    });
    this.playerRig.root.position.set(this.playerX, 0, this.playerZ);
    this.scene.add(this.playerRig.root);

    // First-person Minecraft-style right forearm + held item attached to camera
    this.fpHandGroup = new THREE.Group();
    this.fpHandGroup.visible = false;
    this.fpHandGroup.position.set(0.34, -0.31, -0.5);
    this.fpHandGroup.rotation.set(0.24, -0.22, 0.08);
    this.fpSleeveMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.11, 0.24),
      new THREE.MeshStandardMaterial({
        color: this.palette.getColor(`--office-outfit-${options.playerSkin.outfit}`),
        roughness: 0.72,
      }),
    );
    this.fpSleeveMesh.position.set(0, -0.02, 0.12);
    this.fpSkinMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.16),
      new THREE.MeshStandardMaterial({
        color: this.palette.getColor(`--office-skin-${options.playerSkin.skinTone}`),
        roughness: 0.68,
      }),
    );
    this.fpSkinMesh.position.set(0, -0.02, -0.08);
    this.fpHeldItemGroup.position.set(-0.04, 0.06, -0.18);
    this.fpHeldItemGroup.rotation.set(-0.25, 0.35, 0);
    this.fpHandGroup.add(this.fpSleeveMesh, this.fpSkinMesh, this.fpHeldItemGroup);
    this.camera.add(this.fpHandGroup);
    this.scene.add(this.camera);

    this.bindEvents();
    this.applyEnvironmentLighting(true);
    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  private createSkyDome(): THREE.Mesh {
    const geom = new THREE.SphereGeometry(160, 24, 14);
    const pos = geom.attributes.position!;
    const colors = new Float32Array(pos.count * 3);
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(15, 0, 15);
    return mesh;
  }

  private createStarField(): THREE.Points {
    const count = 320;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = ((i * 137.5) % 360) * (Math.PI / 180);
      const phi = (((i * 29) % 75) + 10) * (Math.PI / 180);
      const r = 135;
      positions[i * 3] = 15 + r * Math.cos(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi);
      positions[i * 3 + 2] = 15 + r * Math.cos(phi) * Math.sin(theta);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: this.palette.getColor("--office-sun-night"),
      size: 1.0,
      transparent: true,
      opacity: 0,
      fog: false,
    });
    return new THREE.Points(geom, mat);
  }

  private createCelestialBodies(): { sunGroup: THREE.Group; moonGroup: THREE.Group } {
    const sunGroup = new THREE.Group();
    const sunCore = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 7.2, 7.2),
      new THREE.MeshBasicMaterial({
        color: this.palette.getColor("--office-sun-core"),
        fog: false,
      }),
    );
    const sunHalo = new THREE.Mesh(
      new THREE.BoxGeometry(10.6, 10.6, 10.6),
      new THREE.MeshBasicMaterial({
        color: this.palette.getColor("--office-sun-halo"),
        transparent: true,
        opacity: 0.28,
        fog: false,
      }),
    );
    sunGroup.add(sunCore, sunHalo);

    const moonGroup = new THREE.Group();
    const moonBody = new THREE.Mesh(
      new THREE.BoxGeometry(6.0, 6.0, 6.0),
      new THREE.MeshBasicMaterial({
        color: this.palette.getColor("--office-moon-surface"),
        fog: false,
      }),
    );
    const craterMat = new THREE.MeshBasicMaterial({
      color: this.palette.getColor("--office-moon-crater"),
      fog: false,
    });
    for (const [cx, cy, cz, size] of [
      [-1.3, 1.1, 3.05, 1.4],
      [1.2, -1.0, 3.05, 1.1],
      [-0.4, -1.6, -3.05, 1.3],
    ] as const) {
      const crater = new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.2), craterMat);
      crater.position.set(cx, cy, cz);
      moonGroup.add(crater);
    }
    moonGroup.add(moonBody);

    return { sunGroup, moonGroup };
  }

  private createWeatherField(options: {
    count: number;
    size: readonly [number, number, number];
    token: "--office-weather-rain" | "--office-weather-snow";
    opacity: number;
    tiltZ: number;
  }): WeatherParticleField {
    const geom = new THREE.BoxGeometry(options.size[0], options.size[1], options.size[2]);
    const mat = new THREE.MeshBasicMaterial({
      color: this.palette.getColor(options.token),
      transparent: true,
      opacity: options.opacity,
    });
    const mesh = new THREE.InstancedMesh(geom, mat, options.count);
    mesh.visible = false;
    // Prevent Three.js from frustum-culling the entire weather volume when particle coordinates shift dynamically.
    mesh.frustumCulled = false;

    const coords = new Float32Array(options.count * 3);
    const field: WeatherParticleField = { mesh, coords, count: options.count, tiltZ: options.tiltZ };
    this.populateWeatherField(field);
    return field;
  }

  private populateWeatherField(field: WeatherParticleField): void {
    const { mesh, coords, count, tiltZ } = field;
    for (let i = 0; i < count; i++) {
      const p = sampleWeatherSpawnPosition(this.weatherBounds, true);
      coords[i * 3] = p.x;
      coords[i * 3 + 1] = p.y;
      coords[i * 3 + 2] = p.z;
      this.writeWeatherMatrix(mesh, i, p.x, p.y, p.z, tiltZ);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private reconfigureWeatherBounds(): void {
    const gridW = this.floor?.gridSize[0] ?? 30;
    const gridD = this.floor?.gridSize[1] ?? 30;
    this.weatherBounds = computeWeatherVolumeBounds({
      gridW,
      gridD,
      floorIndex: this.activeFloorIndex,
      totalFloors: this.totalFloorsInBuilding,
    });
    this.populateWeatherField(this.rainField);
    this.populateWeatherField(this.snowField);
  }

  private writeWeatherMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    tiltZ: number,
  ): void {
    this.weatherDummy.position.set(x, y, z);
    this.weatherDummy.rotation.set(0, 0, tiltZ);
    this.weatherDummy.updateMatrix();
    mesh.setMatrixAt(index, this.weatherDummy.matrix);
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener("pointerdown", this.handlePointerDown);
    dom.addEventListener("pointermove", this.handlePointerMove);
    dom.addEventListener("pointerup", this.handlePointerUp);
    dom.addEventListener("dblclick", this.handleDoubleClick);
    document.addEventListener("mousemove", this.handleDocumentMouseMove);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    window.addEventListener("resize", this.handleResize);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private unbindEvents(): void {
    const dom = this.renderer.domElement;
    dom.removeEventListener("pointerdown", this.handlePointerDown);
    dom.removeEventListener("pointermove", this.handlePointerMove);
    dom.removeEventListener("pointerup", this.handlePointerUp);
    dom.removeEventListener("dblclick", this.handleDoubleClick);
    document.removeEventListener("mousemove", this.handleDocumentMouseMove);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    window.removeEventListener("resize", this.handleResize);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  exitPointerLock(): void {
    if (typeof document !== "undefined" && document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
  }

  private handlePointerLockChange = (): void => {
    const locked =
      typeof document !== "undefined" && document.pointerLockElement === this.renderer.domElement;
    if (locked === this.pointerLocked) return;
    this.pointerLocked = locked;
    if (locked) {
      this.fpDragging = false;
    }
    this.callbacks.onPointerLockChange?.(locked);
  };

  private handleDocumentMouseMove = (e: MouseEvent): void => {
    if (
      !this.pointerLocked ||
      this.cameraMode !== "first_person" ||
      this.buildState.enabled ||
      typeof document === "undefined" ||
      document.pointerLockElement !== this.renderer.domElement
    ) {
      return;
    }
    const sensitivity = 0.0024;
    this.fpYaw -= e.movementX * sensitivity;
    this.fpPitch = Math.max(-1.25, Math.min(1.15, this.fpPitch - e.movementY * sensitivity));
  };

  private handleVisibilityChange = (): void => {
    this.isHidden = document.hidden;
    if (!this.isHidden && !this.disposed && this.rafId === null) {
      this.lastFrameTime = performance.now();
      this.loop(this.lastFrameTime);
    }
  };

  private handleResize = (): void => {
    if (this.disposed) return;
    const width = Math.max(240, this.container.clientWidth || 800);
    const height = Math.max(180, this.container.clientHeight || 600);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  setSizeInvalidated(): void {
    this.handleResize();
  }

  setKeyPressed(code: string, down: boolean): void {
    if (down) {
      this.pressedKeys.add(code);
      if (code === "Space" && !this.buildState.enabled) {
        if (this.playerSeat) {
          this.standUpPlayer();
        } else if (this.playerJumpOffsetY <= 0.001) {
          this.playerVelY = PLAYER_JUMP_VELOCITY_MPS;
        }
      }
      // Cancel click-to-move & camera follow when user drives directly with WASD/Arrows
      if (
        code === "KeyW" ||
        code === "KeyA" ||
        code === "KeyS" ||
        code === "KeyD" ||
        code === "ArrowUp" ||
        code === "ArrowDown" ||
        code === "ArrowLeft" ||
        code === "ArrowRight"
      ) {
        if (this.playerSeat) {
          this.standUpPlayer();
        }
        if (this.followedAgentId) {
          this.followedAgentId = null;
          this.callbacks.onFollowAgentChange?.(null);
        }
        this.playerWaypoints = [];
        this.finalMoveTarget = null;
        this.moveTargetMarker.visible = false;
      }
    } else {
      this.pressedKeys.delete(code);
    }
  }

  clearPressedKeys(): void {
    this.pressedKeys.clear();
  }

  setCameraMode(mode: CameraControlMode): void {
    const prevMode = this.cameraMode;
    this.cameraMode = mode;

    if (mode === "first_person") {
      if (this.followedAgentId) {
        this.followedAgentId = null;
        this.callbacks.onFollowAgentChange?.(null);
      }
      this.fpDragging = false;
      this.cameraFocusTarget = null;
      if (prevMode !== "first_person") {
        this.fpYaw = this.playerYaw + Math.PI;
        this.fpPitch = -0.05;
      }
      this.controls.enabled = false;
      this.playerRig.root.visible = false;
      this.fpHandGroup.visible = true;
      this.camera.rotation.order = "YXZ";
      this.camera.position.set(
        this.playerX,
        (this.playerSeat ? 1.12 : 1.54) + this.getPlayerGroundY(),
        this.playerZ,
      );
      this.camera.rotation.set(this.fpPitch, this.fpYaw, 0);
      this.camera.updateMatrixWorld();
      return;
    }

    if (prevMode === "first_person") {
      if (typeof document !== "undefined" && document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock?.();
      }
      this.fpDragging = false;
      this.camera.rotation.order = "XYZ";
      this.playerRig.root.visible = true;
      this.fpHandGroup.visible = false;
      this.controls.enabled = true;
      if (mode === "rpg") {
        const gY = this.getPlayerGroundY();
        this.controls.target.set(this.playerX, 0.9 + gY, this.playerZ);
        this.camera.position.set(this.playerX + 5.5, 8.0 + gY, this.playerZ + 6.5);
        this.controls.update();
      }
    }

    if (mode === "overview") {
      this.controls.enabled = true;
      this.playerRig.root.visible = true;
      this.fpHandGroup.visible = false;
      this.controls.enablePan = true;
      if (this.floor) {
        const cx = (this.floor.gridSize[0] * CELL_SIZE_METERS) / 2;
        const cz = (this.floor.gridSize[1] * CELL_SIZE_METERS) / 2;
        this.cameraFocusTarget = new THREE.Vector3(cx, 0.5, cz);
        if (this.reducedMotion) {
          this.controls.target.copy(this.cameraFocusTarget);
          this.camera.position.set(cx + 14, 24, cz + 18);
          this.cameraFocusTarget = null;
        }
      }
    } else if (mode === "rpg") {
      this.controls.enabled = true;
      this.playerRig.root.visible = true;
      this.fpHandGroup.visible = false;
      this.controls.enablePan = false;
    }
  }

  setPerformanceConfig(performanceMode: boolean, reducedMotion: boolean): void {
    this.performanceMode = performanceMode;
    this.reducedMotion = reducedMotion;
    this.renderer.shadowMap.enabled = !performanceMode;
    this.sunLight.castShadow = !performanceMode;
    this.renderer.setPixelRatio(performanceMode ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.applyEnvironmentLighting(true);
  }

  setEnvironmentConfig(config: EnvironmentConfig): void {
    this.environmentConfig = config;
    this.applyEnvironmentLighting(true);
  }

  setPlayerSkin(skin: AvatarSkinConfig): void {
    const pos = this.playerRig.root.position.clone();
    const rot = this.playerRig.root.rotation.y;
    this.scene.remove(this.playerRig.root);
    disposeObjectTree(this.playerRig.root);

    this.playerRig = createVoxelCharacter(skin, this.palette, {
      name: "PlayerAvatar",
      isPlayer: true,
    });
    this.playerRig.root.position.copy(pos);
    this.playerRig.root.rotation.y = rot;
    this.playerRig.root.visible = this.cameraMode !== "first_person";
    this.scene.add(this.playerRig.root);
    (this.fpSleeveMesh.material as THREE.MeshStandardMaterial).color.copy(
      this.palette.getColor(`--office-outfit-${skin.outfit}`),
    );
    (this.fpSkinMesh.material as THREE.MeshStandardMaterial).color.copy(
      this.palette.getColor(`--office-skin-${skin.skinTone}`),
    );
    this.renderedPlayerItemKind = null;
    this.syncPlayerMountedItem();
  }

  private syncPlayerMountedItem(nowMs = performance.now()): void {
    const activeAction =
      this.playerActionPose && nowMs < this.playerActionPose.expiresAtMs
        ? this.playerActionPose
        : null;
    const desiredKind =
      activeAction && activeAction.transientItemKind !== undefined
        ? activeAction.transientItemKind
        : this.playerHeldItemKind;
    if (desiredKind !== this.renderedPlayerItemKind) {
      const mount = this.playerRig.heldItemMount;
      disposeObjectTree(mount);
      mount.clear();
      this.renderedPlayerItemKind = desiredKind;
      if (desiredKind) {
        mount.add(buildHeldItemMesh(desiredKind, this.palette));
      }
    }
    if (desiredKind !== this.renderedFpItemKind) {
      disposeObjectTree(this.fpHeldItemGroup);
      this.fpHeldItemGroup.clear();
      this.renderedFpItemKind = desiredKind;
      if (desiredKind) {
        this.fpHeldItemGroup.add(buildHeldItemMesh(desiredKind, this.palette));
      }
    }
  }

  setPlayerHeldItem(kind: OfficeItemKind | null): void {
    this.playerHeldItemKind = kind;
    this.syncPlayerMountedItem();
  }

  private getOutdoorMode(): OutdoorZoneMode {
    if (this.buildState.enabled) return "none";
    return this.activeFloorIndex === 0 ? "ground_campus" : "balcony";
  }

  private getPlayerGroundY(x = this.playerX, z = this.playerZ): number {
    if (!this.floor) return 0;
    return computePlayerGroundY(
      x,
      z,
      this.floor.gridSize[0],
      this.floor.gridSize[1],
      this.getOutdoorMode(),
    );
  }

  private isInsidePlayableBounds(x: number, z: number): boolean {
    if (!this.floor) return false;
    if (this.isInsideFloor(x, z)) return true;
    const mode = this.getOutdoorMode();
    if (mode === "none") return false;
    return !isPointBlocked(this.floor, x, z, mode);
  }

  standUpPlayer(): void {
    if (!this.playerSeat) return;
    const outdoorMode = this.getOutdoorMode();
    let rx = this.playerSeat.returnX;
    let rz = this.playerSeat.returnZ;
    if (this.floor && isPointBlocked(this.floor, rx, rz, outdoorMode)) {
      const safe = this.navGrid
        ? findNearestWalkableCell(this.navGrid, [Math.floor(rx), Math.floor(rz)])
        : null;
      if (safe) {
        rx = safe[0] + 0.5;
        rz = safe[1] + 0.5;
      }
    }
    this.playerSeat = null;
    this.playerJumpOffsetY = 0;
    this.playerVelY = 0;
    this.playerX = rx;
    this.playerZ = rz;
    this.playerRig.root.position.set(this.playerX, this.getPlayerGroundY(), this.playerZ);
    this.callbacks.onPlayerPosition(this.playerX, this.playerZ);
    this.callbacks.onPlayerSeatedChange?.(false);
  }

  togglePlayerSit(station: InteractiveStation): boolean {
    if (this.playerSeat) {
      this.standUpPlayer();
      return false;
    }

    const rad = (station.rotation * Math.PI) / 180;
    const seatX =
      station.kind === "empty_chair"
        ? station.cell[0] + 0.5 - Math.sin(rad) * 0.52
        : station.cell[0] + 0.5 + Math.sin(rad) * 0.08;
    const seatZ =
      station.kind === "empty_chair"
        ? station.cell[1] + 0.5 - Math.cos(rad) * 0.52
        : station.cell[1] + 0.5 + Math.cos(rad) * 0.08;

    this.playerSeat = {
      x: seatX,
      z: seatZ,
      yaw: rad,
      returnX: this.playerX,
      returnZ: this.playerZ,
      stationId: station.id,
    };
    this.playerX = seatX;
    this.playerZ = seatZ;
    this.playerYaw = rad;
    this.playerWaypoints = [];
    this.finalMoveTarget = null;
    this.moveTargetMarker.visible = false;
    this.playerRig.root.position.set(seatX, 0.14 + this.getPlayerGroundY(seatX, seatZ), seatZ);
    this.playerRig.root.rotation.y = rad;
    this.callbacks.onPlayerPosition(seatX, seatZ);
    this.callbacks.onPlayerSeatedChange?.(true);
    return true;
  }

  triggerPlayerActionPose(
    pose: CharacterActionPose,
    durationMs = PLAYER_ACTION_POSE_DURATION_MS,
    options?: { transientItemKind?: OfficeItemKind | null; faceTarget?: { x: number; z: number } },
  ): void {
    const startedAtMs = performance.now();
    this.playerActionPose = {
      pose,
      startedAtMs,
      expiresAtMs: startedAtMs + durationMs,
      transientItemKind: options?.transientItemKind,
    };
    if (options?.faceTarget && !this.playerSeat) {
      const fx = options.faceTarget.x - this.playerX;
      const fz = options.faceTarget.z - this.playerZ;
      if (Math.hypot(fx, fz) > 0.08) {
        this.playerYaw = Math.atan2(fx, fz);
        this.playerRig.root.rotation.y = this.playerYaw;
      }
    }
    this.syncPlayerMountedItem(startedAtMs);
  }

  triggerPlayerEmote(emote: "waving" | "celebrating" | "clapping" | "stretching"): void {
    this.triggerPlayerActionPose(emote, 2600);
    if (emote !== "waving") return;
    const nowMs = performance.now();
    for (const actor of this.agentActors.values()) {
      if (!actor.rig.root.visible || actor.isWalking || this.isBusyState(actor.visualState)) continue;
      if (Math.hypot(actor.x - this.playerX, actor.z - this.playerZ) > 5.0) continue;
      if (
        this.floor &&
        !hasUnobstructedWallLineOfSight(this.floor, this.playerX, this.playerZ, actor.x, actor.z)
      ) {
        continue;
      }
      actor.faceTarget = { x: this.playerX, z: this.playerZ };
      actor.actionPose = "waving";
      actor.actionStartedAtMs = nowMs;
      actor.actionExpiresAtMs = nowMs + 2400;
      if (!actor.bubbleText) {
        actor.bubbleText =
          this.pickAgentSlogan(actor.agentId, 0.7) ?? OFFICE_COPY["office3d.bubble.waveHi"];
        actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
      }
    }
  }

  getPlayerSnapshot(): { x: number; z: number; yaw: number; fpYaw: number; fpPitch: number } {
    return {
      x: this.playerX,
      z: this.playerZ,
      yaw: this.playerYaw,
      fpYaw: this.fpYaw,
      fpPitch: this.fpPitch,
    };
  }

  restorePlayerState(state: {
    x: number;
    z: number;
    yaw?: number;
    fpYaw?: number;
    fpPitch?: number;
  }): void {
    if (!this.floor) return;
    const outdoorMode = this.getOutdoorMode();
    let rx = state.x;
    let rz = state.z;
    if (!this.isInsidePlayableBounds(rx, rz) || isPointBlocked(this.floor, rx, rz, outdoorMode)) {
      const clamped = clampPointForOutdoorMode(this.floor, rx, rz, outdoorMode);
      if (!isPointBlocked(this.floor, clamped.x, clamped.z, outdoorMode)) {
        rx = clamped.x;
        rz = clamped.z;
      } else if (this.navGrid) {
        const safe = findNearestWalkableCell(this.navGrid, [
          Math.max(0, Math.min(this.floor.gridSize[0] - 1, Math.floor(rx))),
          Math.max(0, Math.min(this.floor.gridSize[1] - 1, Math.floor(rz))),
        ]);
        if (safe) {
          rx = safe[0] + 0.5;
          rz = safe[1] + 0.5;
        }
      }
    }
    this.playerX = rx;
    this.playerZ = rz;
    if (typeof state.yaw === "number" && Number.isFinite(state.yaw)) {
      this.playerYaw = state.yaw;
    }
    if (typeof state.fpYaw === "number" && Number.isFinite(state.fpYaw)) {
      this.fpYaw = state.fpYaw;
    }
    if (typeof state.fpPitch === "number" && Number.isFinite(state.fpPitch)) {
      this.fpPitch = Math.max(-1.25, Math.min(1.15, state.fpPitch));
    }
    this.playerWaypoints = [];
    this.finalMoveTarget = null;
    this.moveTargetMarker.visible = false;
    this.playerRig.root.position.set(rx, this.getPlayerGroundY(rx, rz), rz);
    this.playerRig.root.rotation.y = this.playerYaw;
    if (this.cameraMode === "rpg") {
      const gY = this.getPlayerGroundY(rx, rz);
      this.controls.target.set(rx, 0.9 + gY, rz);
      this.camera.position.set(rx + 5.5, 8.0 + gY, rz + 6.5);
      this.controls.update();
    }
    this.callbacks.onPlayerPosition(rx, rz);
  }

  setFollowAgent(agentId: string | null): void {
    this.followedAgentId = agentId;
    if (agentId && this.cameraMode === "first_person") {
      this.setCameraMode("rpg");
    }
  }

  setKpiSnapshot(snapshot: OfficeKpiSnapshot): void {
    this.kpiSnapshot = snapshot;
    this.refreshKpiScreenTexture();
  }

  private refreshKpiScreenTexture(): void {
    if (typeof document === "undefined" || this.kpiScreenMeshes.length === 0) return;
    const snap = this.kpiSnapshot;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bgColor = this.palette.getCss("--office-sky-night-horizon");
    const cardColor = this.palette.getCss("--office-desk-frame");
    const accentColor = this.palette.getCss("--office-status-healthy");
    const infoColor = this.palette.getCss("--office-status-coding");
    const textColor = this.palette.getCss("--office-outfit-shirt");

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 512, 256);

    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 0, 512, 10);

    ctx.fillStyle = textColor;
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("LIVE COMPANY KPI", 24, 46);

    ctx.fillStyle = infoColor;
    ctx.font = "bold 16px monospace";
    ctx.fillText("REALTIME", 408, 44);

    const cards: Array<{ label: string; value: string; color: string }> = snap
      ? [
          { label: "DONE", value: String(snap.doneIssues), color: accentColor },
          { label: "ACTIVE", value: String(snap.activeIssues), color: infoColor },
          { label: "AGENTS", value: `${snap.runningAgents}/${snap.totalAgents}`, color: textColor },
          { label: "SPEND", value: `$${(snap.costTodayCents / 100).toFixed(2)}`, color: accentColor },
        ]
      : [
          { label: "DONE", value: "0", color: accentColor },
          { label: "ACTIVE", value: "0", color: infoColor },
          { label: "AGENTS", value: "0/0", color: textColor },
          { label: "SPEND", value: "$0.00", color: accentColor },
        ];

    cards.forEach((c, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = 24 + col * 236;
      const y = 66 + row * 72;
      ctx.fillStyle = cardColor;
      ctx.fillRect(x, y, 220, 60);
      ctx.fillStyle = textColor;
      ctx.font = "13px sans-serif";
      ctx.fillText(c.label, x + 14, y + 22);
      ctx.fillStyle = c.color;
      ctx.font = "bold 24px monospace";
      ctx.fillText(c.value, x + 14, y + 50);
    });

    if (snap?.topAgentName) {
      const scoreSuffix =
        typeof snap.topAgentScore === "number" ? ` (${Math.round(snap.topAgentScore)})` : "";
      ctx.fillStyle = textColor;
      ctx.font = "15px sans-serif";
      ctx.fillText(`TOP: ${snap.topAgentName.slice(0, 24)}${scoreSuffix}`, 24, 236);
    }

    if (this.kpiCanvasTexture) {
      this.kpiCanvasTexture.dispose();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.kpiCanvasTexture = tex;

    for (const screen of this.kpiScreenMeshes) {
      const mat = screen.material as THREE.MeshStandardMaterial;
      mat.map = tex;
      mat.emissiveMap = tex;
      mat.emissiveIntensity = 0.72;
      mat.needsUpdate = true;
    }
  }

  triggerAgentGiftReaction(
    agentId: string,
    bubbleText: string,
    pose: CharacterActionPose,
    itemKind?: OfficeItemKind | null,
  ): void {
    const actor = this.agentActors.get(agentId);
    if (!actor) return;
    const nowMs = performance.now();

    if (!this.playerSeat) {
      const px = actor.x - this.playerX;
      const pz = actor.z - this.playerZ;
      if (Math.hypot(px, pz) > 0.08) {
        this.playerYaw = Math.atan2(px, pz);
        this.playerRig.root.rotation.y = this.playerYaw;
      }
    }

    actor.bubbleText = bubbleText;
    actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
    if (!actor.isWalking) {
      actor.actionPose = pose;
      actor.actionStartedAtMs = nowMs;
      actor.actionExpiresAtMs = nowMs + 3500;
      actor.faceTarget = { x: this.playerX, z: this.playerZ };
      actor.dwellUntilMs = Math.max(actor.dwellUntilMs, nowMs + 3500);
      if (itemKind) {
        this.setActorHeldItem(actor, itemKind, 3500, nowMs);
      }
    }
  }

  triggerAgentCelebration(agentId: string, fallbackBubbleText?: string): void {
    const actor = this.agentActors.get(agentId);
    if (!actor || !actor.rig.root.visible) return;
    const nowMs = performance.now();
    actor.actionPose = "celebrating";
    actor.actionStartedAtMs = nowMs;
    actor.actionExpiresAtMs = nowMs + 3400;
    const slogan = this.pickAgentSlogan(agentId, 0.75);
    const bubble = slogan ?? fallbackBubbleText;
    if (bubble) {
      actor.bubbleText = bubble;
      actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
    }
  }

  interactOutdoor(id: string): OutdoorInteractionResult | null {
    if (!this.outdoorLife) return null;
    const res = this.outdoorLife.interact(id, { x: this.playerX, z: this.playerZ });
    if (!res) return null;
    this.triggerPlayerActionPose(res.pose, res.pose === "petting" ? 1600 : 1800, {
      faceTarget: { x: res.x, z: res.z },
    });
    return res;
  }

  private pickAgentSlogan(agentId: string, chanceOverride?: number): string | null {
    const behavior = this.agentBehaviors[agentId];
    const slogans = behavior?.slogans ?? [];
    if (slogans.length === 0) return null;
    const chance = chanceOverride ?? behavior?.sloganFrequency ?? 0.35;
    if (Math.random() < chance) {
      return slogans[Math.floor(Math.random() * slogans.length)] ?? null;
    }
    return null;
  }

  private setActorHeldItem(
    actor: AgentActorRecord,
    itemKind: OfficeItemKind | null,
    durationMs: number,
    nowMs: number,
  ): void {
    disposeObjectTree(actor.rig.heldItemMount);
    actor.rig.heldItemMount.clear();
    if (!itemKind) {
      actor.transientItemExpiresAtMs = 0;
      actor.hasTransientItem = false;
      return;
    }
    actor.rig.heldItemMount.add(buildHeldItemMesh(itemKind, this.palette));
    actor.transientItemExpiresAtMs = nowMs + durationMs;
    actor.hasTransientItem = true;
  }

  showAgentSpeechBubble(
    agentId: string,
    bubbleText: string,
    durationMs = 9000,
  ): void {
    const actor = this.agentActors.get(agentId);
    if (!actor) return;
    const normalized = bubbleText.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const nowMs = performance.now();
    actor.bubbleText = normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
    actor.bubbleExpiresAtMs = nowMs + durationMs;
  }

  setBuildMode(state: BuildModeState): void {
    this.buildState = state;
    if (state.enabled && this.followedAgentId) {
      this.followedAgentId = null;
      this.callbacks.onFollowAgentChange?.(null);
    }
    if (state.enabled && this.playerSeat) {
      this.standUpPlayer();
    }
    this.hoverCellMesh.visible = false;
    this.dragPreviewMesh.visible = false;
    this.isDraggingRoom = false;
    this.dragStartCell = null;
    if (!state.enabled) {
      this.lastBuildHoverCell = null;
    }
    this.syncPlacementGhostMesh();
    if (state.enabled && state.ghostPreview && this.lastBuildHoverCell) {
      this.updatePlacementGhostTransform(this.lastBuildHoverCell[0], this.lastBuildHoverCell[1]);
    } else if (!state.enabled || !state.ghostPreview || state.ghostPreview.kind === "door") {
      this.placementGhostGroup.visible = false;
    }
    this.updateSelectionHighlight();
  }

  setMarkers(markers: WorldMarker[]): void {
    this.markers = markers;
  }

  setReplayActive(active: boolean): void {
    this.replayActive = active;
  }

  setBuildingViewMode(mode: BuildingViewMode): void {
    const changed = this.buildingViewMode !== mode;
    this.buildingViewMode = mode;
    const effectiveMode: BuildingViewMode = this.buildState.enabled ? "cutaway" : mode;
    this.buildingShell?.updateView(this.camera.position, effectiveMode);

    if (changed && this.floor) {
      const cx = (this.floor.gridSize[0] * CELL_SIZE_METERS) / 2;
      const cz = (this.floor.gridSize[1] * CELL_SIZE_METERS) / 2;
      if (effectiveMode === "full") {
        const midY =
          ((this.totalFloorsInBuilding - 2 * this.activeFloorIndex) * BUILDING_FLOOR_HEIGHT_M) / 2;
        this.cameraFocusTarget = null;
        this.controls.target.set(cx, midY, cz);
        this.camera.position.set(
          cx + 22,
          midY + 18 + this.totalFloorsInBuilding * 2.5,
          cz + 26,
        );
        this.controls.update();
        this.buildingShell?.updateView(this.camera.position, "full");
      } else {
        this.setCameraMode(this.cameraMode);
      }
    }
  }

  private getElevatorLandingCell(): [number, number] | null {
    if (!this.floor?.elevatorCell || !this.navGrid) return null;
    const [ex, ez] = this.floor.elevatorCell;
    return (
      findNearestWalkableCell(this.navGrid, [ex, ez + 1]) ??
      findNearestWalkableCell(this.navGrid, [ex, ez])
    );
  }

  private removeVisitorActor(agentId: string): void {
    const actor = this.agentActors.get(agentId);
    if (!actor || !actor.isVisitor) return;
    this.agentsGroup.remove(actor.rig.root);
    disposeObjectTree(actor.rig.root);
    this.agentActors.delete(agentId);
    this.clickableObjects = this.clickableObjects.filter((entry) => entry.agentId !== agentId);
  }

  private sendVisitorBackToElevator(actor: AgentActorRecord, nowMs: number): void {
    const landing = this.getElevatorLandingCell();
    if (!landing || !this.navGrid) {
      this.removeVisitorActor(actor.agentId);
      return;
    }
    this.clearSocialPartner(actor, nowMs);
    const fromCell = this.cellForPosition(actor.x, actor.z, landing);
    const raw = findPath(this.navGrid, fromCell, landing);
    const path = raw ? smoothPath(this.navGrid, raw) : null;
    actor.commutePhase = "returning_elevator";
    actor.purpose = "return_desk";
    actor.seated = false;
    actor.faceTarget = null;
    actor.actionPose = "none";
    actor.dwellUntilMs = 0;
    actor.waypoints = path ? path.slice(1) : [landing];
    actor.bubbleText = OFFICE_COPY["office3d.elevator.returning"];
    actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
  }

  private spawnElevatorVisitor(
    agentId: string,
    bubbleText: string,
    goalCell: [number, number],
    faceTarget: { x: number; z: number } | null,
    purpose: "handoff" | "meeting",
    dwellMs: number,
  ): boolean {
    if (!this.floor?.elevatorCell || !this.navGrid) return false;
    if (this.agentActors.has(agentId)) return false;
    const snapshot = this.agentsById[agentId];
    if (!snapshot || snapshot.visualState === "hidden") return false;
    const landing = this.getElevatorLandingCell();
    if (!landing) return false;

    const rawPath = findPath(this.navGrid, landing, goalCell);
    if (!rawPath) return false;
    const smoothed = smoothPath(this.navGrid, rawPath);

    const [ex, ez] = this.floor.elevatorCell;
    const startX = ex + 0.5;
    const startZ = ez + 0.72;
    const skin = this.agentSkins[snapshot.agentId] ?? this.agentSkinResolver(snapshot);
    const rig = createVoxelCharacter(skin, this.palette, { name: `Visitor_${snapshot.agentId}` });
    rig.root.position.set(startX, 0, startZ);
    rig.root.rotation.y = 0;
    this.agentsGroup.add(rig.root);

    const nowMs = performance.now();
    this.agentActors.set(snapshot.agentId, {
      agentId: snapshot.agentId,
      rig,
      x: startX,
      z: startZ,
      yaw: 0,
      homeX: startX,
      homeZ: startZ,
      homeYaw: 0,
      homeSeatCell: landing,
      hasDesk: false,
      isVisitor: true,
      commutePhase: "arriving_elevator",
      commuteReturnAtMs: 0,
      seated: false,
      isWalking: true,
      purpose,
      waypoints: [landing, ...smoothed.slice(1)],
      dwellUntilMs: dwellMs === Infinity ? Infinity : nowMs + dwellMs,
      faceTarget,
      bubbleText,
      bubbleExpiresAtMs: nowMs + HANDOFF_BUBBLE_DURATION_MS,
      visualState: snapshot.visualState,
      monitorScreen: null,
      currentSpeed: 0,
      walkPhase: 0,
      paceFactor: 0.9 + agentHash01(`${snapshot.agentId}:pace`) * 0.2,
      phaseOffset: agentHash01(`${snapshot.agentId}:phase`) * Math.PI * 2,
      seatBlend: 0,
      turnRate: 0,
      actionPose: "none",
      actionStartedAtMs: 0,
      actionExpiresAtMs: 0,
      transientItemExpiresAtMs: 0,
      hasTransientItem: false,
      socialPartnerId: null,
      lastPoiKey: null,
      activePoiKind: null,
      activePoiFurnitureId: null,
      sofaReturnCell: null,
      sofaSeatSlot: null,
      seatYOffset: 0,
      isOutdoorStroll: false,
      lastGreetedPlayerAtMs: 0,
      nextWorkSloganAtMs: nowMs + 16000 + Math.random() * 18000,
      nextStretchAtMs: nowMs + 35000 + Math.random() * 35000,
    });
    this.clickableObjects.push({
      object: rig.root,
      agentId: snapshot.agentId,
    });
    return true;
  }

  setMeetingActive(active: boolean, participantIds?: string[]): void {
    this.meetingActive = active;
    if (!this.floor || !this.navGrid) return;
    const now = performance.now();

    if (!active) {
      this.pendingVisitorSpawns = this.pendingVisitorSpawns.filter((p) => p.purpose !== "meeting");
      for (const actor of this.agentActors.values()) {
        if (actor.isVisitor) {
          if (actor.purpose === "meeting") {
            this.sendVisitorBackToElevator(actor, now);
          }
          continue;
        }
        if (actor.purpose !== "meeting" || !actor.hasDesk) continue;
        this.clearSocialPartner(actor, now);
        this.leaveSofaIfSeated(actor);
        this.leaveSofaIfSeated(actor);
        const fromCell = this.cellForPosition(actor.x, actor.z, actor.homeSeatCell);
        const rawPath = findPath(this.navGrid, fromCell, actor.homeSeatCell);
        const path = rawPath ? smoothPath(this.navGrid, rawPath) : null;
        actor.purpose = "return_desk";
        actor.commutePhase = "none";
        actor.seated = false;
        actor.faceTarget = null;
        actor.actionPose = "none";
        actor.waypoints = path ? path.slice(1) : [actor.homeSeatCell];
      }
      return;
    }

    const filterSet = participantIds && participantIds.length > 0 ? new Set(participantIds) : null;
    const eligibleLocal = [...this.agentActors.values()].filter((actor) => {
      if (!actor.rig.root.visible) return false;
      if (filterSet && !filterSet.has(actor.agentId)) return false;
      return !this.isBusyState(actor.visualState);
    });
    const visitorIds = this.floor.elevatorCell
      ? [...this.seatedElsewhereAgentIds]
          .filter((id) => {
            const snap = this.agentsById[id];
            if (!snap || snap.visualState === "hidden") return false;
            if (filterSet && !filterSet.has(id)) return false;
            if (this.agentActors.has(id)) return false;
            return !this.isBusyState(snap.visualState);
          })
          .sort((a, b) =>
            (this.agentsById[a]?.name ?? a).localeCompare(this.agentsById[b]?.name ?? b),
          )
      : [];

    const totalWanted = eligibleLocal.length + visitorIds.length;
    if (totalWanted === 0) return;

    const navGrid = this.navGrid;
    const meetingLayout = getMeetingSeatCells(this.floor, navGrid, totalWanted);
    if (!meetingLayout || meetingLayout.seats.length === 0) return;

    const { tableCenter, seats } = meetingLayout;
    const tableLook = { x: tableCenter[0] + 0.5, z: tableCenter[1] + 0.5 };

    for (let idx = 0; idx < eligibleLocal.length; idx++) {
      const actor = eligibleLocal[idx]!;
      const seat = seats[idx % seats.length]!;
      const fromCell = this.cellForPosition(actor.x, actor.z, actor.homeSeatCell);
      const rawPath = findPath(navGrid, fromCell, seat);
      if (!rawPath) continue;
      this.clearSocialPartner(actor, now);
      const path = smoothPath(navGrid, rawPath);
      actor.purpose = "meeting";
      actor.seated = false;
      actor.faceTarget = tableLook;
      actor.actionPose = "none";
      actor.waypoints = path.slice(1);
      actor.bubbleText = OFFICE_COPY["office3d.bubble.meeting"];
      actor.bubbleExpiresAtMs = now + HANDOFF_BUBBLE_DURATION_MS;
    }

    const freeSeatCount = Math.max(0, seats.length - eligibleLocal.length);
    for (let vIdx = 0; vIdx < Math.min(freeSeatCount, visitorIds.length); vIdx++) {
      const visitorId = visitorIds[vIdx]!;
      const seat = seats[eligibleLocal.length + vIdx]!;
      this.pendingVisitorSpawns.push({
        spawnAtMs: now + 350 + vIdx * 900,
        agentId: visitorId,
        bubbleText: OFFICE_COPY["office3d.elevator.meeting"],
        goalCell: seat,
        faceTarget: tableLook,
        purpose: "meeting",
        dwellMs: Infinity,
      });
    }
  }

  enqueueMovementTask(task: AgentMovementTask): void {
    if (!this.floor || !this.navGrid) return;
    const now = performance.now();
    const actor = this.agentActors.get(task.agentId);

    // Visiting arrival from another floor onto this active floor
    if (!actor) {
      if (
        task.targetFloorId === this.floor.id &&
        this.seatedElsewhereAgentIds.has(task.agentId) &&
        this.floor.elevatorCell
      ) {
        const landing = this.getElevatorLandingCell();
        const goal = landing
          ? findNearestWalkableCell(this.navGrid, task.targetCell, landing)
          : null;
        if (goal) {
          this.spawnElevatorVisitor(
            task.agentId,
            task.bubbleText ?? OFFICE_COPY["office3d.elevator.arriving"],
            goal,
            { x: task.targetCell[0] + 0.5, z: task.targetCell[1] + 0.5 },
            "handoff",
            HANDOFF_DWELL_MS,
          );
        }
      }
      return;
    }

    if (task.bubbleText) {
      actor.bubbleText = task.bubbleText;
      actor.bubbleExpiresAtMs = now + HANDOFF_BUBBLE_DURATION_MS;
    }

    if (task.targetFloorId !== this.floor.id) {
      if (this.floor.elevatorCell && !this.isBusyState(actor.visualState)) {
        const landing = this.getElevatorLandingCell();
        const fromCell = this.cellForPosition(actor.x, actor.z, actor.homeSeatCell);
        const raw = landing ? findPath(this.navGrid, fromCell, landing) : null;
        if (raw) {
          this.clearSocialPartner(actor, now);
          const path = smoothPath(this.navGrid, raw);
          actor.purpose = "handoff";
          actor.commutePhase = "departing_elevator";
          actor.seated = false;
          actor.faceTarget = null;
          actor.actionPose = "none";
          actor.waypoints = path.slice(1);
          actor.bubbleText = task.bubbleText ?? OFFICE_COPY["office3d.elevator.departing"];
          actor.bubbleExpiresAtMs = now + HANDOFF_BUBBLE_DURATION_MS;
          return;
        }
      }
      if (task.purpose === "handoff" && this.floor.elevatorCell) {
        const [ex, ez] = this.floor.elevatorCell;
        this.spawnHandoffBeam(actor.x, actor.z, ex + 0.5, ez + 0.5, now + HANDOFF_BUBBLE_DURATION_MS);
      }
      return;
    }

    if (this.isBusyState(actor.visualState) && task.purpose !== "return_desk") {
      return;
    }

    const fromCell = this.cellForPosition(actor.x, actor.z, actor.homeSeatCell);
    const goalCell =
      task.purpose === "return_desk" && actor.hasDesk
        ? actor.homeSeatCell
        : findNearestWalkableCell(this.navGrid, task.targetCell, fromCell);
    if (!goalCell) return;

    const rawPath = findPath(this.navGrid, fromCell, goalCell);
    if (!rawPath) return;
    const path = smoothPath(this.navGrid, rawPath);

    this.clearSocialPartner(actor, now);
    this.leaveSofaIfSeated(actor);
    actor.purpose = task.purpose;
    actor.commutePhase = "none";
    actor.seated = false;
    actor.actionPose = "none";
    actor.dwellUntilMs = 0;
    actor.faceTarget =
      task.purpose === "return_desk"
        ? null
        : { x: task.targetCell[0] + 0.5, z: task.targetCell[1] + 0.5 };
    actor.waypoints = path.slice(1);
  }

  captureScreenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  private spawnHandoffBeam(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    expiresAtMs: number,
  ): void {
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    const dist = Math.hypot(bx - ax, bz - az);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(ax, 1.4, az),
      new THREE.Vector3(midX, 2.2 + Math.min(2.5, dist * 0.25), midZ),
      new THREE.Vector3(bx, 1.4, bz),
    );
    const geom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16));
    const mat = new THREE.LineBasicMaterial({
      color: this.palette.getColor("--office-handoff-beam"),
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    this.handoffBeams.push({ line, expiresAtMs });
  }

  teleportToCell(cell: [number, number], movePlayer = true): void {
    const targetX = cell[0] + 0.5;
    const targetZ = cell[1] >= (this.floor?.gridSize[1] ?? 30) ? cell[1] + 0.5 : cell[1] + 1.4;
    if (movePlayer && this.floor) {
      if (this.playerSeat) {
        this.standUpPlayer();
      }
      const outdoorMode = this.getOutdoorMode();
      const clamped = clampPointForOutdoorMode(this.floor, targetX, targetZ, outdoorMode);
      if (!isPointBlocked(this.floor, clamped.x, clamped.z, outdoorMode)) {
        this.playerX = clamped.x;
        this.playerZ = clamped.z;
      } else {
        const fallback = clampPointForOutdoorMode(this.floor, cell[0] + 0.5, cell[1] + 0.5, outdoorMode);
        this.playerX = fallback.x;
        this.playerZ = fallback.z;
      }
      this.playerRig.root.position.set(this.playerX, this.getPlayerGroundY(), this.playerZ);
      this.playerWaypoints = [];
      this.finalMoveTarget = null;
      this.moveTargetMarker.visible = false;
      this.callbacks.onPlayerPosition(this.playerX, this.playerZ);
    }

    const groundOffset = this.floor
      ? computePlayerGroundY(
          cell[0] + 0.5,
          cell[1] + 0.5,
          this.floor.gridSize[0],
          this.floor.gridSize[1],
          this.getOutdoorMode(),
        )
      : 0;
    const focus = new THREE.Vector3(cell[0] + 0.5, 0.8 + groundOffset, cell[1] + 0.5);
    if (this.reducedMotion) {
      this.controls.target.copy(focus);
      this.camera.position.set(focus.x + 8, 9, focus.z + 8);
      this.cameraFocusTarget = null;
    } else {
      this.cameraFocusTarget = focus;
    }
  }

  setSceneData(params: {
    floor: FloorConfig;
    floorIndex?: number;
    totalFloors?: number;
    stations: InteractiveStation[];
    agentsById: Record<string, AgentOfficeSnapshot>;
    seatedElsewhereAgentIds?: ReadonlySet<string>;
    agentSkins: Record<string, AvatarSkinConfig>;
    agentBehaviors?: Record<string, import("../model/types").OfficeAgentBehaviorConfig>;
    goalCompletionRatio?: number;
    trophyAgentIds?: ReadonlySet<string>;
    resetPlayerPosition?: boolean;
    initialPlayerState?: {
      x: number;
      z: number;
      yaw?: number;
      fpYaw?: number;
      fpPitch?: number;
    } | null;
  }): void {
    const prevFloorId = this.floor?.id ?? null;
    const nextFloorIndex = Math.max(0, params.floorIndex ?? 0);
    const nextTotalFloors = Math.max(1, params.totalFloors ?? 1);
    const shellStackChanged =
      this.activeFloorIndex !== nextFloorIndex || this.totalFloorsInBuilding !== nextTotalFloors;
    const floorChanged = this.floor?.id !== params.floor.id || this.floor !== params.floor;
    const skinsChanged = this.floor !== null && this.agentSkins !== params.agentSkins;
    const nextSeatedElsewhere = params.seatedElsewhereAgentIds ?? new Set<string>();
    const seatedElsewhereChanged =
      nextSeatedElsewhere.size !== this.seatedElsewhereAgentIds.size ||
      [...nextSeatedElsewhere].some((id) => !this.seatedElsewhereAgentIds.has(id));
    const hasHrReception = params.floor.furniture.some((f) => f.kind === "hr_reception");
    const deskAgentIds = new Set(
      params.floor.desks
        .map((d) => d.assignedAgentId)
        .filter((id): id is string => Boolean(id)),
    );
    const shouldAppearOnFloor = (agentId: string): boolean =>
      deskAgentIds.has(agentId) || (hasHrReception && !nextSeatedElsewhere.has(agentId));
    const missingOrNewAgent = Object.values(params.agentsById).some(
      (a) =>
        a.visualState !== "hidden" &&
        shouldAppearOnFloor(a.agentId) &&
        !this.agentActors.has(a.agentId),
    );
    const nextGoalRatio =
      typeof params.goalCompletionRatio === "number"
        ? Math.max(0, Math.min(1, params.goalCompletionRatio))
        : this.goalCompletionRatio;
    const plantGrowthChanged = Math.abs(nextGoalRatio - this.goalCompletionRatio) > 0.02;

    const nextTrophies = params.trophyAgentIds ?? this.trophyAgentIds;
    const trophyChanged =
      nextTrophies.size !== this.trophyAgentIds.size ||
      [...nextTrophies].some((id) => !this.trophyAgentIds.has(id));

    const prevNonDesk = this.stations.filter((s) => s.kind !== "agent_desk");
    const nextNonDesk = params.stations.filter((s) => s.kind !== "agent_desk");
    const nonDeskStationChanged =
      prevNonDesk.length !== nextNonDesk.length ||
      nextNonDesk.some((next, idx) => {
        const prev = prevNonDesk[idx];
        return (
          !prev ||
          prev.id !== next.id ||
          prev.statusToken !== next.statusToken ||
          prev.badgeCount !== next.badgeCount
        );
      });

    this.floor = params.floor;
    this.activeFloorIndex = nextFloorIndex;
    this.totalFloorsInBuilding = nextTotalFloors;
    if (floorChanged || !this.navGrid || this.navGrid.floorId !== params.floor.id) {
      this.navGrid = buildFloorNavGrid(params.floor);
    }
    this.stations = params.stations;
    this.agentsById = params.agentsById;
    this.seatedElsewhereAgentIds = nextSeatedElsewhere;
    this.agentSkins = params.agentSkins;
    this.agentBehaviors = params.agentBehaviors ?? {};
    this.goalCompletionRatio = nextGoalRatio;
    this.trophyAgentIds = nextTrophies;

    const switchedFloor = prevFloorId !== null && prevFloorId !== params.floor.id;
    if (
      params.resetPlayerPosition ||
      switchedFloor ||
      !this.isInsidePlayableBounds(this.playerX, this.playerZ)
    ) {
      if (this.playerSeat) {
        this.playerSeat = null;
        this.callbacks.onPlayerSeatedChange?.(false);
      }
    }

    const shouldApplyInitial = !this.initialPlayerStateApplied;
    const initialStateToApply = shouldApplyInitial ? params.initialPlayerState ?? null : null;
    const needsFallbackSpawn =
      !initialStateToApply &&
      (Boolean(params.resetPlayerPosition) ||
        (switchedFloor && !this.isInsideFloor(this.playerX, this.playerZ)) ||
        !this.isInsidePlayableBounds(this.playerX, this.playerZ));

    if (
      floorChanged ||
      shellStackChanged ||
      skinsChanged ||
      missingOrNewAgent ||
      seatedElsewhereChanged ||
      nonDeskStationChanged ||
      plantGrowthChanged ||
      trophyChanged
    ) {
      const preserveMotion = prevFloorId === params.floor.id && !params.resetPlayerPosition;
      this.rebuildFloorGeometry(preserveMotion);
    } else {
      this.syncAgentsOnly();
    }

    if (shouldApplyInitial) {
      this.initialPlayerStateApplied = true;
    }
    if (initialStateToApply) {
      this.restorePlayerState(initialStateToApply);
    } else if (needsFallbackSpawn) {
      const spawn = params.floor.elevatorCell ?? [
        Math.floor(params.floor.gridSize[0] / 2),
        Math.floor(params.floor.gridSize[1] / 2),
      ];
      this.playerX = spawn[0] + 0.5;
      this.playerZ = Math.min(params.floor.gridSize[1] - 1.5, spawn[1] + 1.6);
      this.playerRig.root.position.set(this.playerX, this.getPlayerGroundY(), this.playerZ);
      this.playerWaypoints = [];
      this.finalMoveTarget = null;
      this.moveTargetMarker.visible = false;
      this.callbacks.onPlayerPosition(this.playerX, this.playerZ);
    }
    this.updateSelectionHighlight();
    this.applyEnvironmentLighting(true);
  }

  private isInsideFloor(x: number, z: number): boolean {
    if (!this.floor) return false;
    return x >= 0.5 && x <= this.floor.gridSize[0] - 0.5 && z >= 0.5 && z <= this.floor.gridSize[1] - 0.5;
  }

  private rebuildFloorGeometry(preserveMotion = false): void {
    if (!this.floor) return;
    if (!this.navGrid || this.navGrid.floorId !== this.floor.id) {
      this.navGrid = buildFloorNavGrid(this.floor);
    }

    this.pendingVisitorSpawns.length = 0;
    const preserved = new Map<string, PreservedActorMotion>();
    if (preserveMotion) {
      for (const [id, actor] of this.agentActors.entries()) {
        if (actor.isVisitor) continue;
        preserved.set(id, {
          x: actor.x,
          z: actor.z,
          yaw: actor.yaw,
          homeX: actor.homeX,
          homeZ: actor.homeZ,
          homeYaw: actor.homeYaw,
          seated: actor.seated,
          isWalking: actor.isWalking,
          purpose: actor.purpose,
          waypoints: [...actor.waypoints],
          dwellUntilMs: actor.dwellUntilMs,
          faceTarget: actor.faceTarget ? { ...actor.faceTarget } : null,
          bubbleText: actor.bubbleText,
          bubbleExpiresAtMs: actor.bubbleExpiresAtMs,
          currentSpeed: actor.currentSpeed,
          walkPhase: actor.walkPhase,
          seatBlend: actor.seatBlend,
          turnRate: actor.turnRate,
          actionPose: actor.actionPose,
          socialPartnerId: actor.socialPartnerId,
          lastPoiKey: actor.lastPoiKey,
        });
      }
    }

    disposeObjectTree(this.worldGroup);
    this.worldGroup.clear();
    this.buildingShell = null;
    this.outdoorLife = null;
    this.elevatorDoors = null;
    disposeObjectTree(this.agentsGroup);
    this.agentsGroup.clear();
    this.agentActors.clear();
    this.ceilingLamps.length = 0;
    this.deskLampBulbs.length = 0;
    this.kpiScreenMeshes.length = 0;
    this.interiorLights.length = 0;
    this.clickableObjects = [];
    this.spatialSources = [];

    const [gridW, gridD] = this.floor.gridSize;
    const baseMat = new THREE.MeshStandardMaterial({
      color: this.palette.getColor("--office-floor-base"),
      roughness: 0.85,
    });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(gridW, 0.3, gridD), baseMat);
    slab.position.set(gridW / 2, -0.15, gridD / 2);
    slab.receiveShadow = true;
    this.worldGroup.add(slab);

    // InstancedMesh floor tiles (single draw call for entire floor grid)
    const tileCount = gridW * gridD;
    const tileGeom = new THREE.PlaneGeometry(0.94, 0.94);
    tileGeom.rotateX(-Math.PI / 2);
    const tileMat = new THREE.MeshStandardMaterial({
      color: this.palette.getColor("--office-floor-base"),
      roughness: 0.9,
    });
    const tileMesh = new THREE.InstancedMesh(tileGeom, tileMat, tileCount);
    tileMesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const baseColor = this.palette.getColor("--office-floor-base");
    const altColor = this.palette.getColor("--office-grid-line");
    const tileColor = new THREE.Color();
    let idx = 0;
    for (let z = 0; z < gridD; z++) {
      for (let x = 0; x < gridW; x++) {
        dummy.position.set(x + 0.5, 0.004, z + 0.5);
        dummy.updateMatrix();
        tileMesh.setMatrixAt(idx, dummy.matrix);
        const checker = (x + z) % 2 === 0;
        tileColor.copy(baseColor).lerp(altColor, checker ? 0.06 : 0.16);
        tileMesh.setColorAt(idx, tileColor);
        idx += 1;
      }
    }
    tileMesh.instanceMatrix.needsUpdate = true;
    if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;
    this.worldGroup.add(tileMesh);

    this.buildingShell = buildBuildingShell({
      gridW,
      gridD,
      floorIndex: this.activeFloorIndex,
      totalFloors: this.totalFloorsInBuilding,
      elevatorCell: this.floor.elevatorCell,
      palette: this.palette,
    });
    this.worldGroup.add(this.buildingShell.root);
    this.outdoorLife = buildOutdoorLife({
      gridW,
      gridD,
      groundY: -this.activeFloorIndex * BUILDING_FLOOR_HEIGHT_M - 0.32,
      palette: this.palette,
    });
    this.worldGroup.add(this.outdoorLife.root);
    if (this.activeFloorIndex === 0) {
      for (const entry of this.outdoorLife.getClickableEntries()) {
        this.clickableObjects.push({
          object: entry.object,
          outdoorId: entry.id,
        });
      }
    }
    this.reconfigureWeatherBounds();
    this.buildingShell.updateView(
      this.camera.position,
      this.buildState.enabled ? "cutaway" : this.buildingViewMode,
      this.buildState.enabled ? undefined : { x: this.playerX, z: this.playerZ },
    );

    // Welcoming lobby runner mat just inside the South entrance glass doors
    const welcomeMat = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.5),
      new THREE.MeshStandardMaterial({
        color: this.palette.getColor("--office-palette-slate"),
        roughness: 0.92,
      }),
    );
    welcomeMat.rotation.x = -Math.PI / 2;
    welcomeMat.position.set(gridW / 2, 0.011, gridD - 1.15);
    welcomeMat.receiveShadow = true;
    this.worldGroup.add(welcomeMat);

    // Rooms & Walls with doorway gaps
    const woodWallMat = new THREE.MeshStandardMaterial({
      color: this.palette.getColor("--office-wall-wood"),
      roughness: 0.7,
    });
    const glassWallMat = new THREE.MeshStandardMaterial({
      color: this.palette.getColor("--office-wall-glass"),
      transparent: true,
      opacity: 0.35,
      roughness: 0.15,
      metalness: 0.1,
    });
    const trimWallMat = new THREE.MeshStandardMaterial({
      color: this.palette.getColor("--office-desk-frame"),
      metalness: 0.35,
      roughness: 0.45,
    });
    const fixtureHousingMat = new THREE.MeshStandardMaterial({
      color: this.palette.getColor("--office-desk-frame"),
      metalness: 0.4,
      roughness: 0.4,
    });
    const lampMat = new THREE.MeshStandardMaterial({
      color: this.palette.getColor("--office-lamp-warm"),
      emissive: this.palette.getColor("--office-lamp-warm"),
      emissiveIntensity: 0.1,
    });

    const addCeilingFixture = (fx: number, fz: number, width: number, depth: number) => {
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, 0.06, depth + 0.14), fixtureHousingMat);
      bezel.position.set(fx, 3.13, fz);
      const diffuser = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), lampMat.clone());
      diffuser.position.set(fx, 3.095, fz);
      this.ceilingLamps.push(diffuser);
      this.worldGroup.add(bezel, diffuser);
    };

    const warmLampColor = this.palette.getColor("--office-lamp-warm");
    const addInteriorPointLight = (x: number, y: number, z: number) => {
      if (this.interiorLights.length >= 6) return;
      const light = new THREE.PointLight(warmLampColor, 0, 28, 1.05);
      light.position.set(x, y, z);
      light.castShadow = false;
      light.visible = false;
      this.worldGroup.add(light);
      this.interiorLights.push(light);
    };

    for (const room of this.floor.rooms) {
      const rw = room.bounds.maxX - room.bounds.minX + 1;
      const rd = room.bounds.maxZ - room.bounds.minZ + 1;
      const cx = room.bounds.minX + rw / 2;
      const cz = room.bounds.minZ + rd / 2;
      const roomColor = this.palette.getColor(PALETTE_TOKEN_BY_KEY[room.floorPalette]);

      const roomPad = new THREE.Mesh(
        new THREE.PlaneGeometry(rw - 0.06, rd - 0.06),
        new THREE.MeshStandardMaterial({
          color: roomColor,
          roughness: 0.85,
        }),
      );
      roomPad.rotation.x = -Math.PI / 2;
      roomPad.position.set(cx, 0.012, cz);
      roomPad.receiveShadow = true;
      this.worldGroup.add(roomPad);
      this.clickableObjects.push({
        object: roomPad,
        buildTarget: { kind: "room", id: room.id },
      });

      // Framed decorative area rug inset inside the room
      if (rw >= 4 && rd >= 4) {
        const rugColor = roomColor.clone().lerp(this.palette.getColor("--office-floor-base"), 0.55);
        const rug = new THREE.Mesh(
          new THREE.PlaneGeometry(rw - 1.6, rd - 1.6),
          new THREE.MeshStandardMaterial({ color: rugColor, roughness: 0.95 }),
        );
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(cx, 0.015, cz);
        rug.receiveShadow = true;
        this.worldGroup.add(rug);
      }

      addCeilingFixture(cx, cz, 1.4, 0.4);

      if (this.interiorLights.length < 3) {
        addInteriorPointLight(cx, 2.95, cz);
      }

      if (room.wallStyle !== "none") {
        const wallMat = room.wallStyle === "glass" ? glassWallMat : woodWallMat;
        const doorSet = new Set(room.doors.map((d) => `${d.x},${d.z}`));
        this.buildRoomWalls(room.bounds, doorSet, wallMat, room.wallStyle, trimWallMat);
      }
    }

    // Central lobby & open South wings ceiling fixtures + non-shadow PointLights for full-floor warmth
    for (const frac of [0.22, 0.5, 0.78]) {
      addCeilingFixture(gridW / 2, gridD * frac, 1.6, 0.42);
    }
    const isCoveredByRoom = (px: number, pz: number) =>
      this.floor!.rooms.some(
        (r) =>
          px >= r.bounds.minX &&
          px <= r.bounds.maxX + 1 &&
          pz >= r.bounds.minZ &&
          pz <= r.bounds.maxZ + 1,
      );
    for (const [fx, fz] of [
      [0.25, 0.75],
      [0.75, 0.75],
    ] as const) {
      const lx = gridW * fx;
      const lz = gridD * fz;
      if (!isCoveredByRoom(lx, lz)) {
        addCeilingFixture(lx, lz, 1.4, 0.42);
      }
    }
    addInteriorPointLight(gridW * 0.5, 2.95, gridD * 0.28);
    addInteriorPointLight(gridW * 0.28, 2.95, gridD * 0.76);
    addInteriorPointLight(gridW * 0.72, 2.95, gridD * 0.76);

    // Elevator shaft with recessed cabin, 2 metallic sliding doors, indicator & call panel
    if (this.floor.elevatorCell) {
      const [ex, ez] = this.floor.elevatorCell;
      const elevGroup = new THREE.Group();
      elevGroup.position.set(ex + 0.5, 0, ez + 0.5);

      const elevMat = new THREE.MeshStandardMaterial({
        color: this.palette.getColor("--office-elevator"),
        metalness: 0.35,
        roughness: 0.4,
      });
      const doorMat = new THREE.MeshStandardMaterial({
        color: this.palette.getColor("--office-printer-body"),
        metalness: 0.45,
        roughness: 0.3,
      });
      const cabinWallMat = new THREE.MeshStandardMaterial({
        color: this.palette.getColor("--office-floor-base"),
        roughness: 0.6,
      });
      const cabinLightMat = new THREE.MeshStandardMaterial({
        color: this.palette.getColor("--office-lamp-warm"),
        emissive: this.palette.getColor("--office-lamp-warm"),
        emissiveIntensity: 0.85,
      });

      const shaftW = ELEVATOR_FOOTPRINT.width;
      const shaftD = ELEVATOR_FOOTPRINT.depth;

      // Back wall, top header, and rear side cheeks (leaving pocket gap for sliding doors)
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(shaftW, 2.75, 0.16), elevMat);
      backWall.position.set(0, 1.375, -shaftD / 2 + 0.08);
      backWall.castShadow = true;

      const header = new THREE.Mesh(new THREE.BoxGeometry(shaftW, 0.58, shaftD), elevMat);
      header.position.set(0, 2.46, 0);
      header.castShadow = true;

      for (const side of [-1, 1] as const) {
        const rearSide = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.75, 0.72), elevMat);
        rearSide.position.set(side * (shaftW / 2 - 0.08), 1.375, -0.14);
        rearSide.castShadow = true;

        const frontJamb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.75, 0.16), elevMat);
        frontJamb.position.set(side * (shaftW / 2 - 0.13), 1.375, shaftD / 2 - 0.08);
        frontJamb.castShadow = true;
        elevGroup.add(rearSide, frontJamb);
      }

      // Warm lit interior cabin visible when doors slide apart
      const cabinBack = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.16, 0.04), cabinWallMat);
      cabinBack.position.set(0, 1.08, -0.32);
      const cabinLight = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.4), cabinLightMat);
      cabinLight.position.set(0, 2.12, 0.0);
      const cabinSill = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.03, 0.8), doorMat);
      cabinSill.position.set(0, 0.015, 0.06);

      // Two sliding elevator door leaves tucked into z = 0.28 pocket behind jambs
      const leftDoor = new THREE.Mesh(new THREE.BoxGeometry(0.48, 2.16, 0.08), doorMat);
      leftDoor.position.set(-0.25, 1.08, 0.28);
      const rightDoor = new THREE.Mesh(new THREE.BoxGeometry(0.48, 2.16, 0.08), doorMat);
      rightDoor.position.set(0.25, 1.08, 0.28);

      // Overhead floor indicator bezel + amber floor LED bar
      const displayBezel = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.22, 0.06),
        new THREE.MeshStandardMaterial({
          color: this.palette.getColor("--office-desk-frame"),
          roughness: 0.4,
        }),
      );
      displayBezel.position.set(0, 2.44, shaftD / 2 + 0.01);
      const floorLed = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.08, 0.03),
        new THREE.MeshStandardMaterial({
          color: this.palette.getColor("--office-trophy-gold"),
          emissive: this.palette.getColor("--office-trophy-gold"),
          emissiveIntensity: 0.9,
        }),
      );
      floorLed.position.set(0, 2.44, shaftD / 2 + 0.04);

      // Right jamb call button panel with Up/Down indicator buttons
      const callPanel = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.34, 0.05),
        new THREE.MeshStandardMaterial({
          color: this.palette.getColor("--office-desk-frame"),
          roughness: 0.35,
        }),
      );
      callPanel.position.set(shaftW / 2 - 0.13, 1.15, shaftD / 2 + 0.02);
      const upBtn = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.02),
        new THREE.MeshStandardMaterial({
          color: this.palette.getColor("--office-status-healthy"),
          emissive: this.palette.getColor("--office-status-healthy"),
          emissiveIntensity: 0.85,
        }),
      );
      upBtn.position.set(shaftW / 2 - 0.13, 1.22, shaftD / 2 + 0.045);
      const downBtn = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.02),
        new THREE.MeshStandardMaterial({
          color: this.palette.getColor("--office-screen-on"),
          emissive: this.palette.getColor("--office-screen-on"),
          emissiveIntensity: 0.85,
        }),
      );
      downBtn.position.set(shaftW / 2 - 0.13, 1.08, shaftD / 2 + 0.045);

      elevGroup.add(
        backWall,
        header,
        cabinBack,
        cabinLight,
        cabinSill,
        leftDoor,
        rightDoor,
        displayBezel,
        floorLed,
        callPanel,
        upBtn,
        downBtn,
      );
      this.worldGroup.add(elevGroup);
      this.clickableObjects.push({
        object: elevGroup,
        stationId: `station-elevator-${this.floor.id}`,
      });
      this.elevatorDoors = {
        left: leftDoor,
        right: rightDoor,
        centerX: ex + 0.5,
        centerZ: ez + 0.5,
        openAmount: 0,
      };
    }

    // Desks + assigned agents
    for (const desk of this.floor.desks) {
      const hasTrophy = Boolean(desk.assignedAgentId && this.trophyAgentIds.has(desk.assignedAgentId));
      const { group: deskGroup, monitorScreen, deskLampBulb } = buildDeskAssembly({
        palette: this.palette,
        hasTrophy,
      });
      deskGroup.position.set(desk.x + 0.5, 0, desk.z + 0.5);
      deskGroup.rotation.y = (desk.rotation * Math.PI) / 180;
      this.deskLampBulbs.push(deskLampBulb);

      this.worldGroup.add(deskGroup);
      this.clickableObjects.push({
        object: deskGroup,
        stationId: desk.assignedAgentId ? `station-desk-${desk.id}` : `station-chair-${desk.id}`,
        buildTarget: { kind: "desk", id: desk.id },
      });

      if (desk.assignedAgentId) {
        const snapshot = this.agentsById[desk.assignedAgentId];
        if (snapshot && snapshot.visualState !== "hidden") {
          const skin = this.agentSkins[snapshot.agentId] ?? this.agentSkinResolver(snapshot);
          const rig = createVoxelCharacter(skin, this.palette, {
            name: `Agent_${snapshot.agentId}`,
          });
          // Position seated in desk local space transformed into world coordinates
          const rad = (desk.rotation * Math.PI) / 180;
          const offsetX = Math.sin(rad) * -0.52;
          const offsetZ = Math.cos(rad) * -0.52;
          const homeX = desk.x + 0.5 + offsetX;
          const homeZ = desk.z + 0.5 + offsetZ;
          const homeSeatCell = getDeskSeatCell(desk, this.navGrid!);
          const prev = preserved.get(snapshot.agentId);
          const actorIdx = this.agentActors.size;
          const initialDwell =
            performance.now() + IDLE_INITIAL_MIN_DWELL_MS + actorIdx * IDLE_INITIAL_STAGGER_MS;

          const deskHomeMoved =
            !prev ||
            Math.hypot(prev.homeX - homeX, prev.homeZ - homeZ) > 0.05 ||
            Math.abs(prev.homeYaw - rad) > 0.01;
          const snapToDesk = prev
            ? prev.seated && !prev.isWalking && (this.buildState.enabled || deskHomeMoved)
            : true;

          const ax = snapToDesk ? homeX : prev!.x;
          const az = snapToDesk ? homeZ : prev!.z;
          const yaw = snapToDesk ? rad : prev!.yaw;
          const actorSeedMs = performance.now();

          rig.root.position.set(ax, 0, az);
          rig.root.rotation.y = yaw;
          this.agentsGroup.add(rig.root);

          this.agentActors.set(snapshot.agentId, {
            agentId: snapshot.agentId,
            rig,
            x: ax,
            z: az,
            yaw,
            homeX,
            homeZ,
            homeYaw: rad,
            homeSeatCell,
            hasDesk: true,
            isVisitor: false,
            commutePhase: "none",
            commuteReturnAtMs: 0,
            seated: prev ? (snapToDesk ? true : prev.seated) : true,
            isWalking: prev ? (deskHomeMoved ? false : prev.isWalking) : false,
            purpose: prev ? (deskHomeMoved ? "idle_desk" : prev.purpose) : "idle_desk",
            waypoints: prev ? (deskHomeMoved ? [] : prev.waypoints) : [],
            dwellUntilMs: prev ? prev.dwellUntilMs : initialDwell,
            faceTarget: prev ? prev.faceTarget : null,
            bubbleText: prev ? prev.bubbleText : null,
            bubbleExpiresAtMs: prev ? prev.bubbleExpiresAtMs : 0,
            visualState: snapshot.visualState,
            monitorScreen,
            currentSpeed: prev ? prev.currentSpeed : 0,
            walkPhase: prev ? prev.walkPhase : 0,
            paceFactor: 0.9 + agentHash01(`${snapshot.agentId}:pace`) * 0.2,
            phaseOffset: agentHash01(`${snapshot.agentId}:phase`) * Math.PI * 2,
            seatBlend: prev ? (snapToDesk ? 1 : prev.seatBlend) : 1,
            turnRate: prev ? prev.turnRate : 0,
            actionPose: prev ? prev.actionPose : "none",
            actionStartedAtMs: 0,
            actionExpiresAtMs: 0,
            transientItemExpiresAtMs: 0,
            hasTransientItem: false,
            socialPartnerId: prev ? prev.socialPartnerId : null,
            lastPoiKey: prev ? prev.lastPoiKey : null,
            activePoiKind: null,
            activePoiFurnitureId: null,
            sofaReturnCell: null,
            sofaSeatSlot: null,
            seatYOffset: 0,
            isOutdoorStroll: false,
            lastGreetedPlayerAtMs: 0,
            nextWorkSloganAtMs: actorSeedMs + 16000 + actorIdx * 4000,
            nextStretchAtMs: actorSeedMs + 32000 + actorIdx * 6000,
          });
          this.clickableObjects.push({
            object: rig.root,
            stationId: `station-desk-${desk.id}`,
            agentId: snapshot.agentId,
            buildTarget: { kind: "desk", id: desk.id },
          });
          if (snapshot.visualState === "coding") {
            this.spatialSources.push({ kind: "keyboard", x: ax, z: az });
          }
        }
      }
    }

    // Furniture & Control Plane Stations
    this.buildFurnitureMeshes();

    // Pending-approval / unassigned agents standing near HR Reception
    this.spawnUnseatedAgents(preserved);
    this.syncAgentVisualBadges();
    this.refreshKpiScreenTexture();
  }

  private buildRoomWalls(
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
    doorSet: Set<string>,
    wallMat: THREE.Material,
    wallStyle: "glass" | "wood",
    trimMat: THREE.Material,
  ): void {
    const wallHeight = 2.1;
    const thickness = 0.12;
    const wallGeoX = new THREE.BoxGeometry(1, wallHeight, thickness);
    const wallGeoZ = new THREE.BoxGeometry(thickness, wallHeight, 1);
    const railGeoX = new THREE.BoxGeometry(1, 0.07, thickness + 0.03);
    const railGeoZ = new THREE.BoxGeometry(thickness + 0.03, 0.07, 1);
    const postGeo = new THREE.BoxGeometry(0.06, wallHeight + 0.04, thickness + 0.02);

    const artColors = ["--office-palette-sky", "--office-palette-amber", "--office-palette-rose"] as const;
    const addSegment = (x: number, z: number, axis: "x" | "z", idx: number) => {
      const mesh = new THREE.Mesh(axis === "x" ? wallGeoX : wallGeoZ, wallMat);
      mesh.position.set(x, wallHeight / 2, z);
      mesh.castShadow = true;
      this.worldGroup.add(mesh);

      const baseRail = new THREE.Mesh(axis === "x" ? railGeoX : railGeoZ, trimMat);
      baseRail.position.set(x, 0.035, z);
      this.worldGroup.add(baseRail);

      if (wallStyle === "glass") {
        const topRail = new THREE.Mesh(axis === "x" ? railGeoX : railGeoZ, trimMat);
        topRail.position.set(x, wallHeight + 0.02, z);
        this.worldGroup.add(topRail);
        if (idx % 2 === 0) {
          const post = new THREE.Mesh(postGeo, trimMat);
          post.position.set(axis === "x" ? x - 0.47 : x, wallHeight / 2, axis === "x" ? z : z - 0.47);
          if (axis === "z") post.rotation.y = Math.PI / 2;
          this.worldGroup.add(post);
        }
      } else if (idx % 4 === 2) {
        // Framed wall art accent on solid wood interior walls
        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(axis === "x" ? 0.64 : thickness + 0.06, 0.46, axis === "x" ? thickness + 0.06 : 0.64),
          trimMat,
        );
        frame.position.set(x, 1.38, z);
        const canvasMat = new THREE.MeshStandardMaterial({
          color: this.palette.getColor(artColors[idx % artColors.length]!),
          roughness: 0.72,
        });
        const art = new THREE.Mesh(
          new THREE.BoxGeometry(axis === "x" ? 0.52 : thickness + 0.08, 0.34, axis === "x" ? thickness + 0.08 : 0.52),
          canvasMat,
        );
        art.position.set(x, 1.38, z);
        this.worldGroup.add(frame, art);
      }
    };

    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (!doorSet.has(`${x},${bounds.minZ}`)) addSegment(x + 0.5, bounds.minZ + 0.06, "x", x);
      if (!doorSet.has(`${x},${bounds.maxZ}`)) addSegment(x + 0.5, bounds.maxZ + 0.94, "x", x + 1);
    }

    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      if (!doorSet.has(`${bounds.minX},${z}`)) addSegment(bounds.minX + 0.06, z + 0.5, "z", z);
      if (!doorSet.has(`${bounds.maxX},${z}`)) addSegment(bounds.maxX + 0.94, z + 0.5, "z", z + 1);
    }
  }

  private buildFurnitureMeshes(): void {
    if (!this.floor) return;

    for (const item of this.floor.furniture) {
      const stationMatch = this.stations.find((s) => s.id === `station-${item.id}`);
      const statusColor = this.palette.getColor(
        stationMatch?.statusToken === "critical"
          ? "--office-status-critical"
          : stationMatch?.statusToken === "warning"
            ? "--office-status-warning"
            : stationMatch?.statusToken === "healthy"
              ? "--office-status-healthy"
              : "--office-status-idle",
      );

      const group = buildFurnitureAssembly({
        kind: item.kind,
        palette: this.palette,
        statusColor,
        goalCompletionRatio: this.goalCompletionRatio,
      });
      const [gridW, gridD] = this.floor.gridSize;
      const isOutsideFloorGrid = item.x < 0 || item.x >= gridW || item.z < 0 || item.z >= gridD;
      const furnY = isOutsideFloorGrid && this.activeFloorIndex === 0 ? OUTDOOR_GROUND_Y : 0;
      group.position.set(item.x + 0.5, furnY, item.z + 0.5);
      group.rotation.y = (item.rotation * Math.PI) / 180;
      for (const child of group.children) {
        if (child.name === "office-lamp-bulb" && child instanceof THREE.Mesh) {
          this.deskLampBulbs.push(child);
        } else if (child.name === "kpi-live-screen" && child instanceof THREE.Mesh) {
          this.kpiScreenMeshes.push(child);
        }
      }

      if (item.kind === "server_rack") {
        this.spatialSources.push({ kind: "server", x: item.x + 0.5, z: item.z + 0.5 });
      } else if (item.kind === "coffee_machine") {
        this.spatialSources.push({ kind: "coffee", x: item.x + 0.5, z: item.z + 0.5 });
      }

      this.worldGroup.add(group);
      this.clickableObjects.push({
        object: group,
        stationId: stationMatch?.id,
        buildTarget: { kind: "furniture", id: item.id },
      });
    }
  }

  private spawnUnseatedAgents(preserved: Map<string, PreservedActorMotion>): void {
    if (!this.floor) return;
    const hrStation = this.floor.furniture.find((f) => f.kind === "hr_reception");
    if (!hrStation) return;

    const unseated = Object.values(this.agentsById).filter(
      (a) =>
        a.visualState !== "hidden" &&
        !this.agentActors.has(a.agentId) &&
        !this.seatedElsewhereAgentIds.has(a.agentId),
    );
    unseated.slice(0, 6).forEach((agent, idx) => {
      const homeX = Math.min(this.floor!.gridSize[0] - 1, hrStation.x + 1.5 + (idx % 3) * 0.9);
      const homeZ = Math.min(this.floor!.gridSize[1] - 1, hrStation.z + 1.4 + Math.floor(idx / 3) * 0.9);
      const prev = preserved.get(agent.agentId);
      const ax = prev ? prev.x : homeX;
      const az = prev ? prev.z : homeZ;
      const yaw = prev ? prev.yaw : 0;

      const skin = this.agentSkins[agent.agentId] ?? this.agentSkinResolver(agent);
      const rig = createVoxelCharacter(skin, this.palette, { name: `Agent_${agent.agentId}` });
      rig.root.position.set(ax, 0, az);
      rig.root.rotation.y = yaw;
      this.agentsGroup.add(rig.root);

      const unseatedNowMs = performance.now();
      this.agentActors.set(agent.agentId, {
        agentId: agent.agentId,
        rig,
        x: ax,
        z: az,
        yaw,
        homeX,
        homeZ,
        homeYaw: 0,
        homeSeatCell: [Math.floor(homeX), Math.floor(homeZ)],
        hasDesk: false,
        isVisitor: false,
        commutePhase: "none",
        commuteReturnAtMs: 0,
        seated: false,
        isWalking: false,
        purpose: "idle_desk",
        waypoints: [],
        dwellUntilMs: Infinity,
        faceTarget: null,
        bubbleText: prev ? prev.bubbleText : null,
        bubbleExpiresAtMs: prev ? prev.bubbleExpiresAtMs : 0,
        visualState: agent.visualState,
        monitorScreen: null,
        currentSpeed: prev ? prev.currentSpeed : 0,
        walkPhase: prev ? prev.walkPhase : 0,
        paceFactor: 0.9 + agentHash01(`${agent.agentId}:pace`) * 0.2,
        phaseOffset: agentHash01(`${agent.agentId}:phase`) * Math.PI * 2,
        seatBlend: 0,
        turnRate: prev ? prev.turnRate : 0,
        actionPose: prev ? prev.actionPose : "none",
        actionStartedAtMs: 0,
        actionExpiresAtMs: 0,
        transientItemExpiresAtMs: 0,
        hasTransientItem: false,
        socialPartnerId: prev ? prev.socialPartnerId : null,
        lastPoiKey: prev ? prev.lastPoiKey : null,
        activePoiKind: null,
        activePoiFurnitureId: null,
        sofaReturnCell: null,
        sofaSeatSlot: null,
        seatYOffset: 0,
        isOutdoorStroll: false,
        lastGreetedPlayerAtMs: 0,
        nextWorkSloganAtMs: unseatedNowMs + 18000 + idx * 4000,
        nextStretchAtMs: Infinity,
      });
      this.clickableObjects.push({
        object: rig.root,
        agentId: agent.agentId,
      });
    });
  }

  private syncAgentsOnly(): void {
    this.spatialSources = this.spatialSources.filter((s) => s.kind !== "keyboard");
    for (const [agentId, actor] of this.agentActors.entries()) {
      const next = this.agentsById[agentId];
      if (!next || next.visualState === "hidden") {
        actor.rig.root.visible = false;
        continue;
      }
      actor.visualState = next.visualState;
      if (actor.commutePhase === "away_other_floor") {
        continue;
      }
      actor.rig.root.visible = true;
      if (next.visualState === "coding") {
        this.spatialSources.push({ kind: "keyboard", x: actor.x, z: actor.z });
      }
    }
    this.syncAgentVisualBadges();
  }

  private syncAgentVisualBadges(): void {
    const lighting = computeLighting(resolveEffectiveHour(this.environmentConfig));
    const isNightLights = lighting.isNight && this.environmentConfig.enableNightAutoLights;

    for (const actor of this.agentActors.values()) {
      const color = this.palette.getColor(STATUS_TOKEN_BY_VISUAL[actor.visualState]);
      const orbMat = actor.rig.statusOrb.material as THREE.MeshStandardMaterial;
      orbMat.color.copy(color);
      orbMat.emissive.copy(color);

      if (actor.monitorScreen) {
        const scrMat = actor.monitorScreen.material as THREE.MeshStandardMaterial;
        const activeWork = actor.visualState === "coding" || actor.visualState === "thinking";
        scrMat.emissiveIntensity = activeWork
          ? isNightLights
            ? 1.15
            : 0.75
          : isNightLights
            ? 0.15
            : 0.05;
      }
    }
  }

  private updateSelectionHighlight(): void {
    const sel = this.buildState.enabled ? this.buildState.selectedTarget : null;
    if (!sel || !this.floor) {
      this.selectionRing.visible = false;
      return;
    }

    if (sel.kind === "desk") {
      const d = this.floor.desks.find((x) => x.id === sel.id);
      if (d) {
        this.selectionRing.position.set(d.x + 0.5, 0.05, d.z + 0.5);
        this.selectionRing.scale.set(1.2, 1.2, 1);
        this.selectionRing.visible = true;
        return;
      }
    } else if (sel.kind === "furniture") {
      const f = this.floor.furniture.find((x) => x.id === sel.id);
      if (f) {
        this.selectionRing.position.set(f.x + 0.5, 0.05, f.z + 0.5);
        this.selectionRing.scale.set(1.3, 1.3, 1);
        this.selectionRing.visible = true;
        return;
      }
    } else if (sel.kind === "room") {
      const r = this.floor.rooms.find((x) => x.id === sel.id);
      if (r) {
        const cx = (r.bounds.minX + r.bounds.maxX + 1) / 2;
        const cz = (r.bounds.minZ + r.bounds.maxZ + 1) / 2;
        this.selectionRing.position.set(cx, 0.05, cz);
        this.selectionRing.scale.set(2, 2, 1);
        this.selectionRing.visible = true;
        return;
      }
    }
    this.selectionRing.visible = false;
  }

  private syncPlacementGhostMesh(): void {
    const ghost = this.buildState.enabled ? this.buildState.ghostPreview ?? null : null;
    if (!ghost || ghost.kind === "door") {
      this.placementGhostGroup.visible = false;
      if (!this.buildState.enabled) {
        disposeObjectTree(this.placementGhostGroup);
        this.placementGhostGroup.clear();
        this.ghostCacheKey = "";
        this.ghostPreviewMat = null;
      }
      return;
    }

    const w = ghost.roomSize?.w ?? 3;
    const d = ghost.roomSize?.d ?? 3;
    const cacheKey =
      ghost.kind === "desk"
        ? "desk"
        : ghost.kind === "room"
          ? `room:${w}x${d}`
          : `furniture:${ghost.furnitureKind ?? "plant"}`;

    if (cacheKey === this.ghostCacheKey && this.ghostPreviewMat) {
      return;
    }

    disposeObjectTree(this.placementGhostGroup);
    this.placementGhostGroup.clear();

    const mat = new THREE.MeshStandardMaterial({
      color: this.palette.getColor("--office-status-coding"),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.ghostPreviewMat = mat;

    if (ghost.kind === "room") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, d), mat);
      box.position.y = 0.18;
      this.placementGhostGroup.add(box);
      this.ghostCacheKey = cacheKey;
      return;
    }

    const model =
      ghost.kind === "desk"
        ? buildDeskAssembly({ palette: this.palette, hasTrophy: false }).group
        : buildFurnitureAssembly({
            kind: ghost.furnitureKind ?? "plant",
            palette: this.palette,
            statusColor: this.palette.getColor("--office-status-healthy"),
            goalCompletionRatio: 0.7,
          });

    const replacedMats = new Set<THREE.Material>();
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (Array.isArray(node.material)) {
        node.material.forEach((m) => replacedMats.add(m));
      } else if (node.material) {
        replacedMats.add(node.material);
      }
      node.material = mat;
      node.castShadow = false;
      node.receiveShadow = false;
    });
    for (const m of replacedMats) {
      m.dispose();
    }

    // Floor orientation chevron pointing along local +Z so rotation is unmistakable
    const chevronGeom = new THREE.BufferGeometry();
    chevronGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0.06, 0.72, 0.14, 0.06, 0.5, -0.14, 0.06, 0.5]), 3),
    );
    chevronGeom.computeVertexNormals();
    const chevron = new THREE.Mesh(chevronGeom, mat);

    this.placementGhostGroup.add(model, chevron);
    this.ghostCacheKey = cacheKey;
  }

  private updatePlacementGhostTransform(cx: number, cz: number): void {
    const hoverMat = this.hoverCellMesh.material as THREE.MeshBasicMaterial;
    const ghost = this.buildState.enabled ? this.buildState.ghostPreview ?? null : null;
    const isOutdoorGhost = Boolean(
      ghost?.kind === "furniture" &&
        ghost.furnitureKind &&
        OUTDOOR_FURNITURE_KINDS.has(ghost.furnitureKind) &&
        this.activeFloorIndex === 0,
    );
    const [gridW, gridD] = this.floor?.gridSize ?? [30, 30];
    const onOutdoorGround =
      isOutdoorGhost && (cx < 0 || cx >= gridW || cz < 0 || cz >= gridD);
    const ghostBaseY = onOutdoorGround ? OUTDOOR_GROUND_Y : 0;

    if (!ghost || !this.floor) {
      hoverMat.color.copy(this.palette.getColor("--office-status-coding"));
      this.placementGhostGroup.visible = false;
      return;
    }

    if (ghost.kind === "door") {
      const validDoor = this.floor.rooms.some((r) => isCellOnRoomBoundary(r.bounds, { x: cx, z: cz }));
      hoverMat.color.copy(
        this.palette.getColor(validDoor ? "--office-status-healthy" : "--office-status-critical"),
      );
      this.placementGhostGroup.visible = false;
      return;
    }

    hoverMat.color.copy(this.palette.getColor("--office-status-coding"));
    if (!this.ghostPreviewMat) {
      this.syncPlacementGhostMesh();
    }
    if (!this.ghostPreviewMat) return;

    if (ghost.kind === "room") {
      const w = ghost.roomSize?.w ?? 3;
      const d = ghost.roomSize?.d ?? 3;
      const minX = cx - Math.floor(w / 2);
      const minZ = cz - Math.floor(d / 2);
      const validRoom = ghost.sourceEntityId
        ? moveRoomToCell(this.floor, ghost.sourceEntityId, cx, cz).valid
        : true;
      this.placementGhostGroup.position.set(minX + w / 2, 0.01, minZ + d / 2);
      this.placementGhostGroup.rotation.y = 0;
      this.ghostPreviewMat.color.copy(
        this.palette.getColor(validRoom ? "--office-status-coding" : "--office-status-critical"),
      );
      this.placementGhostGroup.visible = true;
      return;
    }

    const validCell = !isBuildCellOccupied(
      this.floor,
      cx,
      cz,
      ghost.sourceEntityId ? { kind: ghost.kind, id: ghost.sourceEntityId } : undefined,
      { allowOutdoor: isOutdoorGhost, floorIndex: this.activeFloorIndex },
    );
    this.placementGhostGroup.position.set(cx + 0.5, ghostBaseY + 0.01, cz + 0.5);
    this.placementGhostGroup.rotation.y = (ghost.rotation * Math.PI) / 180;
    this.ghostPreviewMat.color.copy(
      this.palette.getColor(validCell ? "--office-status-coding" : "--office-status-critical"),
    );
    this.placementGhostGroup.visible = true;
  }

  private resolveBuildGridCell(hitX: number, hitZ: number): [number, number] {
    if (!this.floor) return [0, 0];
    const [gridW, gridD] = this.floor.gridSize;
    const ghost = this.buildState.ghostPreview;
    const allowOutdoor = Boolean(
      ghost?.kind === "furniture" &&
        ghost.furnitureKind &&
        OUTDOOR_FURNITURE_KINDS.has(ghost.furnitureKind) &&
        this.activeFloorIndex === 0,
    );
    const pad = allowOutdoor ? Math.floor(OUTDOOR_WALK_MARGIN_M) - 1 : 0;
    const minX = -pad;
    const maxX = gridW - 1 + pad;
    const minZ = -pad;
    const maxZ = gridD - 1 + pad;
    return [
      Math.max(minX, Math.min(maxX, Math.floor(hitX))),
      Math.max(minZ, Math.min(maxZ, Math.floor(hitZ))),
    ];
  }

  private applyEnvironmentLighting(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastLightingTick < 15000 && this.environmentConfig.timeMode === "realtime") {
      return;
    }
    this.lastLightingTick = now;

    const hour = resolveEffectiveHour(this.environmentConfig, new Date());
    const lighting = computeLighting(hour);
    this.lastComputedIsNight = lighting.isNight;

    this.sunLight.position.set(...lighting.sunPosition);
    this.sunLight.target.position.set(15, 0, 15);
    this.sunLight.color.copy(this.palette.getColor(lighting.sunColor));
    this.sunLight.intensity = lighting.sunIntensity;

    this.ambientLight.color.copy(this.palette.getColor(lighting.ambientColor));
    this.ambientLight.intensity = lighting.ambientIntensity;

    const fogColor = this.palette
      .getColor(lighting.fogColor)
      .lerp(this.palette.getColor(lighting.fogColorNext), lighting.blend);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(fogColor);
    }

    // Update gradient sky dome vertex colors
    const skyTop = this.palette
      .getColor(lighting.skyTopColor)
      .lerp(this.palette.getColor(lighting.skyTopColorNext), lighting.blend);
    const skyHorizon = this.palette
      .getColor(lighting.skyHorizonColor)
      .lerp(this.palette.getColor(lighting.skyHorizonColorNext), lighting.blend);

    const posAttr = this.skyDome.geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = this.skyDome.geometry.attributes.color as THREE.BufferAttribute;
    const tmpColor = new THREE.Color();
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const t = Math.max(0, Math.min(1, y / 90));
      tmpColor.copy(skyHorizon).lerp(skyTop, t);
      colAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    }
    colAttr.needsUpdate = true;

    const starMat = this.starField.material as THREE.PointsMaterial;
    starMat.opacity = lighting.isNight ? 0.85 : 0;
    this.starField.visible = lighting.isNight && !this.performanceMode;

    // Position 3D Voxel Sun & Moon across the sky arc in sync with time of day
    const orbitAngle = ((lighting.effectiveHour - 6) / 24) * Math.PI * 2;
    const skyCx = 15;
    const skyCz = 15;
    const sunOrbitY = Math.sin(orbitAngle) * 105;
    this.celestialSunGroup.position.set(
      skyCx + Math.cos(orbitAngle) * 118,
      sunOrbitY,
      skyCz - 38,
    );
    this.celestialSunGroup.visible = sunOrbitY > -12;

    const moonOrbitAngle = orbitAngle + Math.PI;
    const moonOrbitY = Math.sin(moonOrbitAngle) * 105;
    this.celestialMoonGroup.position.set(
      skyCx + Math.cos(moonOrbitAngle) * 118,
      moonOrbitY,
      skyCz + 38,
    );
    this.celestialMoonGroup.visible = moonOrbitY > -12;

    const autoLightFactor = this.environmentConfig.enableNightAutoLights
      ? lighting.interiorLightFactor
      : 0;
    const warmColor = this.palette.getColor("--office-lamp-warm");
    this.ambientLight.groundColor.copy(this.palette.getColor("--office-floor-base"));

    if (autoLightFactor > 0.01) {
      this.ambientLight.intensity = lighting.ambientIntensity + autoLightFactor * 0.82;
      this.ambientLight.color.lerp(warmColor, autoLightFactor * 0.65);
      this.ambientLight.groundColor.lerp(warmColor, autoLightFactor * 0.35);
    }

    const lampIntensity = 0.08 + autoLightFactor * 1.05;
    for (const lamp of this.ceilingLamps) {
      (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = lampIntensity;
    }
    for (const bulb of this.deskLampBulbs) {
      (bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = lampIntensity;
    }
    for (const light of this.interiorLights) {
      light.color.copy(warmColor);
      light.intensity = autoLightFactor * 14;
      light.visible = autoLightFactor > 0.01;
    }
    this.buildingShell?.setNightLights(autoLightFactor);

    const weatherVisible =
      this.environmentConfig.weather !== "clear" && !this.performanceMode;
    this.rainField.mesh.visible = weatherVisible && this.environmentConfig.weather === "rain";
    this.snowField.mesh.visible = weatherVisible && this.environmentConfig.weather === "snow";
    if (this.rainField.mesh.visible) {
      const rMat = this.rainField.mesh.material as THREE.MeshBasicMaterial;
      rMat.color.copy(this.palette.getColor("--office-weather-rain"));
    }
    if (this.snowField.mesh.visible) {
      const sMat = this.snowField.mesh.material as THREE.MeshBasicMaterial;
      sMat.color.copy(this.palette.getColor("--office-weather-snow"));
    }

    this.syncAgentVisualBadges();
  }

  private getFloorHit(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, out);
  }

  private pickClickableAtNdc(
    ndcX: number,
    ndcY: number,
  ): { stationId?: string; agentId?: string; outdoorId?: string; buildTarget?: { kind: "room" | "desk" | "furniture"; id: string } } | null {
    const ndc = new THREE.Vector2(ndcX, ndcY);
    this.raycaster.setFromCamera(ndc, this.camera);

    const roots = this.clickableObjects.map((c) => c.object);
    const hits = this.raycaster.intersectObjects(roots, true);
    if (hits.length === 0) return null;

    let current: THREE.Object3D | null = hits[0]!.object;
    while (current) {
      const match = this.clickableObjects.find((c) => c.object === current);
      if (match) return match;
      current = current.parent;
    }
    return null;
  }

  private pickClickableCenter(): { stationId?: string; agentId?: string; outdoorId?: string; buildTarget?: { kind: "room" | "desk" | "furniture"; id: string } } | null {
    return this.pickClickableAtNdc(0, 0);
  }

  private pickClickable(
    clientX: number,
    clientY: number,
  ): { stationId?: string; agentId?: string; outdoorId?: string; buildTarget?: { kind: "room" | "desk" | "furniture"; id: string } } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    return this.pickClickableAtNdc(ndcX, ndcY);
  }

  private handleDoubleClick = (): void => {
    if (this.cameraMode !== "first_person" || this.buildState.enabled) return;
    const dom = this.renderer.domElement;
    if (typeof document !== "undefined" && document.pointerLockElement !== dom) {
      try {
        const res = dom.requestPointerLock?.() as unknown as Promise<void> | undefined;
        if (res && typeof res.catch === "function") res.catch(() => undefined);
      } catch {
        // Ignore security/gesture errors
      }
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownClient = { x: e.clientX, y: e.clientY };
    if (!this.buildState.enabled && this.cameraMode === "first_person" && e.button === 0) {
      this.fpDragging = true;
      this.fpLastPointer = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!this.buildState.enabled || e.button !== 0 || !this.floor) return;

    if (this.buildState.tool === "room") {
      const hit = this.getFloorHit(e.clientX, e.clientY);
      if (hit) {
        const cx = Math.max(0, Math.min(this.floor.gridSize[0] - 1, Math.floor(hit.x)));
        const cz = Math.max(0, Math.min(this.floor.gridSize[1] - 1, Math.floor(hit.z)));
        this.dragStartCell = [cx, cz];
        this.isDraggingRoom = true;
        this.controls.enabled = false;
      }
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.floor) return;
    if (this.buildState.enabled) {
      const hit = this.getFloorHit(e.clientX, e.clientY);
      if (hit) {
        const [cx, cz] = this.resolveBuildGridCell(hit.x, hit.z);
        const [gridW, gridD] = this.floor.gridSize;
        const outsideGrid = cx < 0 || cx >= gridW || cz < 0 || cz >= gridD;
        this.lastBuildHoverCell = [cx, cz];
        this.hoverCellMesh.position.set(
          cx + 0.5,
          (outsideGrid && this.activeFloorIndex === 0 ? OUTDOOR_GROUND_Y : 0) + 0.04,
          cz + 0.5,
        );
        this.hoverCellMesh.visible = true;

        if (this.isDraggingRoom && this.dragStartCell) {
          this.placementGhostGroup.visible = false;
          const minX = Math.min(this.dragStartCell[0], cx);
          const maxX = Math.max(this.dragStartCell[0], cx);
          const minZ = Math.min(this.dragStartCell[1], cz);
          const maxZ = Math.max(this.dragStartCell[1], cz);
          const w = maxX - minX + 1;
          const d = maxZ - minZ + 1;
          this.dragPreviewMesh.scale.set(w, 0.25, d);
          this.dragPreviewMesh.position.set(minX + w / 2, 0.14, minZ + d / 2);
          this.dragPreviewMesh.visible = true;
        } else if (this.buildState.ghostPreview) {
          this.updatePlacementGhostTransform(cx, cz);
        } else {
          (this.hoverCellMesh.material as THREE.MeshBasicMaterial).color.copy(
            this.palette.getColor("--office-status-coding"),
          );
          this.placementGhostGroup.visible = false;
        }
      } else {
        this.lastBuildHoverCell = null;
        this.hoverCellMesh.visible = false;
        this.placementGhostGroup.visible = false;
      }
      return;
    }

    if (this.cameraMode === "first_person") {
      if (this.pointerLocked) return;
      if (this.fpDragging) {
        const dx = e.clientX - this.fpLastPointer.x;
        const dy = e.clientY - this.fpLastPointer.y;
        this.fpLastPointer = { x: e.clientX, y: e.clientY };
        const sensitivity = 0.0046;
        this.fpYaw -= dx * sensitivity;
        this.fpPitch = Math.max(-1.25, Math.min(1.15, this.fpPitch - dy * sensitivity));
        return;
      }
    }

    // Hover raycast for Hover Info Card
    const hit = this.pickClickable(e.clientX, e.clientY);
    const agentId = hit?.agentId ?? null;
    if (agentId) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.lastHoveredAgentId = agentId;
      this.callbacks.onHoverAgent({
        agentId,
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
      });
    } else if (this.lastHoveredAgentId !== null) {
      this.lastHoveredAgentId = null;
      this.callbacks.onHoverAgent(null);
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.fpDragging = false;
    if (this.isDraggingRoom) {
      this.controls.enabled = true;
      this.isDraggingRoom = false;
      this.dragPreviewMesh.visible = false;
      if (this.dragStartCell && this.floor) {
        const hit = this.getFloorHit(e.clientX, e.clientY);
        if (hit) {
          const cx = Math.max(0, Math.min(this.floor.gridSize[0] - 1, Math.floor(hit.x)));
          const cz = Math.max(0, Math.min(this.floor.gridSize[1] - 1, Math.floor(hit.z)));
          const minX = Math.min(this.dragStartCell[0], cx);
          const maxX = Math.max(this.dragStartCell[0], cx);
          const minZ = Math.min(this.dragStartCell[1], cz);
          const maxZ = Math.max(this.dragStartCell[1], cz);
          this.callbacks.onBuildRoomDrag({ minX, minZ, maxX, maxZ });
        }
      }
      this.dragStartCell = null;
      return;
    }

    if (e.button !== 0) return;
    const movedPx = Math.hypot(
      e.clientX - this.pointerDownClient.x,
      e.clientY - this.pointerDownClient.y,
    );
    if (movedPx > 6 || !this.floor) return;

    if (this.buildState.enabled) {
      if (this.buildState.tool === "select") {
        const picked = this.pickClickable(e.clientX, e.clientY);
        this.callbacks.onBuildSelectEntity(picked?.buildTarget ?? null);
        return;
      }
      if (this.buildState.tool === "move" && !this.buildState.ghostPreview) {
        const picked = this.pickClickable(e.clientX, e.clientY);
        this.callbacks.onBuildSelectEntity(picked?.buildTarget ?? null);
        return;
      }
      const hit = this.getFloorHit(e.clientX, e.clientY);
      if (hit) {
        const [cx, cz] = this.resolveBuildGridCell(hit.x, hit.z);
        this.callbacks.onBuildCellClick(cx, cz);
      }
      return;
    }

    // Play mode First-Person: 1-click locks cursor cleanly; when locked, left-click raycasts center '+' crosshair
    if (this.cameraMode === "first_person") {
      if (!this.pointerLocked) {
        const dom = this.renderer.domElement;
        if (typeof document !== "undefined" && document.pointerLockElement !== dom) {
          try {
            const res = dom.requestPointerLock?.() as unknown as Promise<void> | undefined;
            if (res && typeof res.catch === "function") res.catch(() => undefined);
          } catch {
            // Ignore pointer lock rejection
          }
        }
        return;
      }
      const picked = this.pickClickableCenter();
      if (picked?.stationId) {
        const station = this.stations.find((s) => s.id === picked.stationId);
        if (station) {
          this.callbacks.onSelectStation(station);
        }
      } else if (picked?.outdoorId && this.outdoorLife) {
        const target = this.resolveOutdoorStationById(picked.outdoorId);
        if (target) this.callbacks.onSelectStation(target);
      }
      return;
    }

    // Play mode click: interact directly with clicked station or outdoor animal/landmark, or Click-to-Move in RPG mode
    const picked = this.pickClickable(e.clientX, e.clientY);
    if (picked?.stationId) {
      const station = this.stations.find((s) => s.id === picked.stationId);
      if (station) {
        this.callbacks.onSelectStation(station);
        return;
      }
    }
    if (picked?.outdoorId) {
      const target = this.resolveOutdoorStationById(picked.outdoorId);
      if (target) {
        this.callbacks.onSelectStation(target);
        return;
      }
    }

    if (this.cameraMode === "rpg") {
      const hit = this.getFloorHit(e.clientX, e.clientY);
      if (hit) {
        const outdoorMode = this.getOutdoorMode();
        const [gridW, gridD] = this.floor.gridSize;
        const clamped = clampPointForOutdoorMode(this.floor, hit.x, hit.z, outdoorMode);
        const tx = clamped.x;
        const tz = clamped.z;
        const playerIndoors = this.isInsideFloor(this.playerX, this.playerZ);
        const targetIndoors = tx >= 0 && tx <= gridW && tz >= 0 && tz <= gridD;
        const doorCellX = Math.max(0, Math.min(gridW - 1, Math.floor(gridW / 2 - 0.5)));
        const doorInsideCell: [number, number] = [doorCellX, gridD - 1];
        const doorOutsideCell: [number, number] = [doorCellX, gridD];

        const outdoorDetourToTarget = (
          startX: number,
          endX: number,
          endZ: number,
        ): Array<[number, number]> => {
          if (outdoorMode !== "ground_campus" || endZ >= gridD + 0.6) return [];
          const sideX = endX < gridW / 2 && startX <= gridW / 2 ? -2 : endX >= gridW / 2 ? gridW + 1 : -2;
          const pts: Array<[number, number]> = [[sideX, gridD + 1]];
          if (endZ < 0) pts.push([sideX, -2]);
          return pts;
        };

        if (!playerIndoors && !targetIndoors) {
          if (!isPointBlocked(this.floor, tx, tz, outdoorMode)) {
            this.playerWaypoints = outdoorDetourToTarget(this.playerX, tx, tz);
            this.finalMoveTarget = { x: tx, z: tz };
            this.moveTargetMarker.position.set(tx, 0.03 + this.getPlayerGroundY(tx, tz), tz);
            this.moveTargetMarker.visible = true;
          }
          return;
        }

        if (this.navGrid) {
          if (playerIndoors && !targetIndoors) {
            if (!isPointBlocked(this.floor, tx, tz, outdoorMode)) {
              const fromCell = this.cellForPosition(this.playerX, this.playerZ, doorInsideCell);
              const toDoor = findPath(this.navGrid, fromCell, doorInsideCell);
              const smoothed = toDoor ? smoothPath(this.navGrid, toDoor).slice(1) : [];
              this.playerWaypoints = [
                ...smoothed,
                doorOutsideCell,
                ...outdoorDetourToTarget(gridW / 2, tx, tz),
              ];
              this.finalMoveTarget = { x: tx, z: tz };
              this.moveTargetMarker.position.set(tx, 0.03 + this.getPlayerGroundY(tx, tz), tz);
              this.moveTargetMarker.visible = true;
            }
            return;
          }

          if (!playerIndoors && targetIndoors) {
            const clickedCell: [number, number] = [
              Math.max(0, Math.min(gridW - 1, Math.floor(tx))),
              Math.max(0, Math.min(gridD - 1, Math.floor(tz))),
            ];
            const destCell = findNearestWalkableCell(this.navGrid, clickedCell, doorInsideCell);
            const fromDoor = destCell ? findPath(this.navGrid, doorInsideCell, destCell) : null;
            if (destCell && fromDoor) {
              const smoothed = smoothPath(this.navGrid, fromDoor);
              const returnDetour: Array<[number, number]> = [];
              if (this.playerZ < gridD + 0.5) {
                const sideX = this.playerX < gridW / 2 ? -2 : gridW + 1;
                if (this.playerZ < 0) returnDetour.push([sideX, -2]);
                returnDetour.push([sideX, gridD + 1]);
              }
              this.playerWaypoints = [...returnDetour, doorOutsideCell, ...smoothed];
              const exactSameCell =
                destCell[0] === clickedCell[0] &&
                destCell[1] === clickedCell[1] &&
                !isPointBlocked(this.floor, tx, tz, outdoorMode);
              const markerTarget = exactSameCell
                ? { x: tx, z: tz }
                : { x: destCell[0] + 0.5, z: destCell[1] + 0.5 };
              this.finalMoveTarget = markerTarget;
              this.moveTargetMarker.position.set(markerTarget.x, 0.03, markerTarget.z);
              this.moveTargetMarker.visible = true;
            }
            return;
          }

          const fromCell = this.cellForPosition(this.playerX, this.playerZ, [0, 0]);
          const clickedCell: [number, number] = [
            Math.max(0, Math.min(gridW - 1, Math.floor(tx))),
            Math.max(0, Math.min(gridD - 1, Math.floor(tz))),
          ];
          const destCell = findNearestWalkableCell(this.navGrid, clickedCell, fromCell);
          const rawPath = destCell ? findPath(this.navGrid, fromCell, destCell) : null;
          if (destCell && rawPath) {
            const path = smoothPath(this.navGrid, rawPath);
            this.playerWaypoints = path.slice(1);
            const exactSameCell =
              destCell[0] === clickedCell[0] &&
              destCell[1] === clickedCell[1] &&
              !isPointBlocked(this.floor, tx, tz, outdoorMode);
            const markerTarget = exactSameCell
              ? { x: tx, z: tz }
              : { x: destCell[0] + 0.5, z: destCell[1] + 0.5 };
            this.finalMoveTarget = markerTarget;
            this.moveTargetMarker.position.set(markerTarget.x, 0.03, markerTarget.z);
            this.moveTargetMarker.visible = true;
          }
        } else if (!isPointBlocked(this.floor, tx, tz, outdoorMode)) {
          this.playerWaypoints = [];
          this.finalMoveTarget = { x: tx, z: tz };
          this.moveTargetMarker.position.set(tx, 0.03 + this.getPlayerGroundY(tx, tz), tz);
          this.moveTargetMarker.visible = true;
        }
      }
    }
  };

  private updatePlayerMovement(dt: number, elapsedSec: number): void {
    if (!this.floor || this.buildState.enabled) {
      updateVoxelPose(this.playerRig, "idle", elapsedSec, {
        isWalking: false,
        seated: false,
        reducedMotion: this.reducedMotion,
      });
      return;
    }

    let dirX = 0;
    let dirZ = 0;
    if (this.pressedKeys.has("KeyW") || this.pressedKeys.has("ArrowUp")) dirZ -= 1;
    if (this.pressedKeys.has("KeyS") || this.pressedKeys.has("ArrowDown")) dirZ += 1;
    if (this.pressedKeys.has("KeyA") || this.pressedKeys.has("ArrowLeft")) dirX -= 1;
    if (this.pressedKeys.has("KeyD") || this.pressedKeys.has("ArrowRight")) dirX += 1;

    let isWalking = false;
    const prevX = this.playerX;
    const prevZ = this.playerZ;
    const wantsMove =
      dirX !== 0 ||
      dirZ !== 0 ||
      this.playerWaypoints.length > 0 ||
      this.finalMoveTarget !== null;

    if (this.playerSeat && wantsMove) {
      this.standUpPlayer();
    }

    if (dirX !== 0 || dirZ !== 0) {
      // Align WASD to camera horizontal forward vector using zero per-frame allocations
      const forward = this.tmpForward;
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 0.0001) forward.normalize();
      const right = this.tmpRight.set(-forward.z, 0, forward.x);

      const moveVec = this.tmpMoveVec
        .set(0, 0, 0)
        .addScaledVector(right, dirX)
        .addScaledVector(forward, -dirZ);
      if (moveVec.lengthSq() > 0.0001) {
        moveVec.normalize();
        const sprinting =
          this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight");
        const step = PLAYER_SPEED_MPS * (sprinting ? PLAYER_SPRINT_MULTIPLIER : 1) * dt;
        this.trySlideMove(moveVec.x * step, moveVec.z * step);
        this.playerYaw = lerpAngle(this.playerYaw, Math.atan2(moveVec.x, moveVec.z), Math.min(1, dt * 12));
        isWalking = true;
      }
    } else if (this.playerWaypoints.length > 0 || this.finalMoveTarget) {
      const nextWp = this.playerWaypoints[0];
      const goal = nextWp
        ? { x: nextWp[0] + 0.5, z: nextWp[1] + 0.5 }
        : this.finalMoveTarget!;
      const dx = goal.x - this.playerX;
      const dz = goal.z - this.playerZ;
      const dist = Math.hypot(dx, dz);

      if (nextWp && dist < 0.24) {
        this.playerWaypoints.shift();
        isWalking = true;
      } else if (!nextWp && dist < 0.14) {
        this.finalMoveTarget = null;
        this.moveTargetMarker.visible = false;
      } else {
        const step = Math.min(dist, PLAYER_SPEED_MPS * dt);
        const moved = this.trySlideMove((dx / dist) * step, (dz / dist) * step);
        if (!moved) {
          this.playerWaypoints = [];
          this.finalMoveTarget = null;
          this.moveTargetMarker.visible = false;
        } else {
          this.playerYaw = lerpAngle(this.playerYaw, Math.atan2(dx, dz), Math.min(1, dt * 12));
          isWalking = true;
        }
      }
    }

    if (this.playerJumpOffsetY > 0 || this.playerVelY > 0) {
      this.playerJumpOffsetY += this.playerVelY * dt;
      this.playerVelY -= PLAYER_GRAVITY_MPS2 * dt;
      if (this.playerJumpOffsetY <= 0) {
        this.playerJumpOffsetY = 0;
        this.playerVelY = 0;
      }
    }

    const movedDist = Math.hypot(this.playerX - prevX, this.playerZ - prevZ);
    if (movedDist > 0.0001) {
      this.playerWalkPhase += movedDist * WALK_STRIDE_RAD_PER_METER;
    }

    const nowMs = performance.now();
    if (this.playerActionPose && nowMs >= this.playerActionPose.expiresAtMs) {
      this.playerActionPose = null;
      this.syncPlayerMountedItem(nowMs);
    } else if (isWalking && this.playerActionPose) {
      this.playerActionPose = null;
      this.syncPlayerMountedItem(nowMs);
    }

    const actionSpan = this.playerActionPose
      ? Math.max(1, this.playerActionPose.expiresAtMs - this.playerActionPose.startedAtMs)
      : 1;
    const actionProgress = this.playerActionPose
      ? Math.min(1, Math.max(0, (nowMs - this.playerActionPose.startedAtMs) / actionSpan))
      : undefined;

    const groundY = this.getPlayerGroundY();
    const sprintingNow =
      isWalking && (this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight"));
    this.playerRig.root.position.set(
      this.playerX,
      (this.playerSeat ? 0.14 : 0) + groundY + this.playerJumpOffsetY,
      this.playerZ,
    );
    this.playerRig.root.rotation.y = this.playerYaw;
    updateVoxelPose(this.playerRig, "idle", elapsedSec, {
      isWalking,
      seated: Boolean(this.playerSeat),
      reducedMotion: this.reducedMotion,
      walkPhase: this.playerWalkPhase,
      speedRatio: isWalking ? (sprintingNow ? 1.25 : 1) : 0,
      actionPose: isWalking ? "none" : (this.playerActionPose?.pose ?? "none"),
      actionProgress: isWalking ? undefined : actionProgress,
      hasHeldItem: Boolean(this.renderedPlayerItemKind),
    });

    if (isWalking) {
      this.lastEmittedWalked = true;
      if (nowMs - this.lastPlayerPosEmitMs >= 85) {
        this.lastPlayerPosEmitMs = nowMs;
        this.callbacks.onPlayerPosition(this.playerX, this.playerZ);
      }
    } else if (this.lastEmittedWalked) {
      this.lastEmittedWalked = false;
      this.lastPlayerPosEmitMs = nowMs;
      this.callbacks.onPlayerPosition(this.playerX, this.playerZ);
    }

    if (this.cameraMode === "first_person") {
      const bobAmp = isWalking && !this.reducedMotion ? 0.018 : 0.004;
      const bobFreq = isWalking ? this.playerWalkPhase * 2.2 : elapsedSec * 1.6;
      const actionSwing =
        this.playerActionPose && !isWalking
          ? Math.sin((actionProgress ?? 0) * Math.PI * 2) * 0.28
          : 0;
      this.fpHandGroup.position.set(
        0.34 + Math.cos(bobFreq * 0.5) * bobAmp * 0.6,
        -0.31 + Math.sin(bobFreq) * bobAmp,
        -0.5,
      );
      this.fpHandGroup.rotation.set(0.24 - actionSwing, -0.22, 0.08);
    }
  }

  private trySlideMove(dx: number, dz: number): boolean {
    if (!this.floor) return false;
    const outdoorMode = this.getOutdoorMode();
    let moved = false;
    if (
      dx !== 0 &&
      canMoveBetween(this.floor, this.playerX, this.playerZ, this.playerX + dx, this.playerZ, outdoorMode)
    ) {
      this.playerX += dx;
      moved = true;
    }
    if (
      dz !== 0 &&
      canMoveBetween(this.floor, this.playerX, this.playerZ, this.playerX, this.playerZ + dz, outdoorMode)
    ) {
      this.playerZ += dz;
      moved = true;
    }
    return moved;
  }

  private updateProximityAndCamera(dt: number): void {
    // Camera follow / focus lerp using pooled scratch vectors
    if (this.cameraMode === "first_person" && !this.buildState.enabled) {
      const groundY = this.getPlayerGroundY();
      const eyeY = (this.playerSeat ? 1.12 : 1.54) + groundY + this.playerJumpOffsetY;
      this.camera.position.set(this.playerX, eyeY, this.playerZ);
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.set(this.fpPitch, this.fpYaw, 0);
      this.camera.updateMatrixWorld();
      this.playerYaw = lerpAngle(this.playerYaw, this.fpYaw + Math.PI, Math.min(1, dt * 18));
    } else if (this.followedAgentId && !this.buildState.enabled) {
      const followed = this.agentActors.get(this.followedAgentId);
      if (followed && followed.rig.root.visible) {
        const fGroundY =
          this.activeFloorIndex === 0 && !this.isInsideFloor(followed.x, followed.z)
            ? OUTDOOR_GROUND_Y
            : 0;
        this.tmpDesiredTarget.set(followed.x, 0.95 + fGroundY + followed.seatYOffset, followed.z);
        this.tmpDelta.copy(this.tmpDesiredTarget).sub(this.controls.target);
        const factor = this.reducedMotion ? 1 : Math.min(1, dt * 6);
        this.tmpDelta.multiplyScalar(factor);
        this.controls.target.add(this.tmpDelta);
        this.camera.position.add(this.tmpDelta);
        this.controls.update();
      } else {
        this.controls.update();
      }
    } else if (this.cameraFocusTarget) {
      this.tmpOffset.set(8, 9, 8);
      const desiredCamPos = this.tmpDelta.copy(this.cameraFocusTarget).add(this.tmpOffset);
      this.controls.target.lerp(this.cameraFocusTarget, Math.min(1, dt * 6));
      this.camera.position.lerp(desiredCamPos, Math.min(1, dt * 5));
      if (this.controls.target.distanceTo(this.cameraFocusTarget) < 0.15) {
        this.cameraFocusTarget = null;
      }
      this.controls.update();
    } else if (this.cameraMode === "rpg" && !this.buildState.enabled) {
      this.tmpDesiredTarget.set(this.playerX, 0.9 + this.getPlayerGroundY(), this.playerZ);
      this.tmpDelta.copy(this.tmpDesiredTarget).sub(this.controls.target);
      const factor = this.reducedMotion ? 1 : Math.min(1, dt * 7);
      this.tmpDelta.multiplyScalar(factor);
      this.controls.target.add(this.tmpDelta);
      this.camera.position.add(this.tmpDelta);
      this.controls.update();
    } else {
      this.controls.update();
    }

    // Nearest station proximity detection
    let nearest: InteractiveStation | null = null;
    let bestDist = Infinity;
    for (const station of this.stations) {
      const sx = station.cell[0] + 0.5;
      const sz = station.cell[1] + 0.5;
      const d = Math.hypot(this.playerX - sx, this.playerZ - sz);
      const radius = station.interactionRadius || INTERACTION_RADIUS_METERS;
      if (d <= radius && d < bestDist) {
        if (
          this.floor &&
          !hasUnobstructedWallLineOfSight(this.floor, this.playerX, this.playerZ, sx, sz)
        ) {
          continue;
        }
        bestDist = d;
        nearest = station;
      }
    }

    if (
      !nearest &&
      this.activeFloorIndex === 0 &&
      this.outdoorLife &&
      this.floor &&
      !this.isInsideFloor(this.playerX, this.playerZ)
    ) {
      const outdoorTarget = this.outdoorLife.findNearestInteractable(this.playerX, this.playerZ);
      if (outdoorTarget) {
        nearest = {
          id: outdoorTarget.id,
          kind: outdoorTarget.kind,
          floorId: this.floor.id,
          cell: [Math.floor(outdoorTarget.x), Math.floor(outdoorTarget.z)],
          rotation: 0,
          interactionRadius: outdoorTarget.interactionRadius,
          labelKey: outdoorTarget.following ? "office3d.prompt.petFollow" : "office3d.prompt.pet",
          labelFallback: outdoorTarget.label,
          badgeCount: outdoorTarget.following ? 1 : 0,
        };
      }
    }

    const nextId = nearest?.id ?? null;
    if (nextId !== this.lastNearestStationId) {
      this.lastNearestStationId = nextId;
      this.callbacks.onNearestStation(nearest);
    }

    // Closest visible agent within unobstructed line-of-sight gifting/handover distance
    let nearestAgentId: string | null = null;
    let bestAgentDist = AGENT_GIFT_PROXIMITY_METERS;
    for (const actor of this.agentActors.values()) {
      if (!actor.rig.root.visible) continue;
      const dist = Math.hypot(this.playerX - actor.x, this.playerZ - actor.z);
      if (dist <= bestAgentDist) {
        if (
          this.floor &&
          !hasUnobstructedWallLineOfSight(this.floor, this.playerX, this.playerZ, actor.x, actor.z)
        ) {
          continue;
        }
        bestAgentDist = dist;
        nearestAgentId = actor.agentId;
      }
    }
    if (nearestAgentId !== this.lastNearestAgentId) {
      this.lastNearestAgentId = nearestAgentId;
      this.callbacks.onNearestAgent?.(nearestAgentId);
    }
  }

  private resolveOutdoorStationById(id: string): InteractiveStation | null {
    if (!this.floor) return null;
    const nearest = this.outdoorLife?.findNearestInteractable(this.playerX, this.playerZ);
    if (nearest && nearest.id === id) {
      return {
        id: nearest.id,
        kind: nearest.kind,
        floorId: this.floor.id,
        cell: [Math.floor(nearest.x), Math.floor(nearest.z)],
        rotation: 0,
        interactionRadius: nearest.interactionRadius,
        labelKey: nearest.following ? "office3d.prompt.petFollow" : "office3d.prompt.pet",
        labelFallback: nearest.label,
        badgeCount: nearest.following ? 1 : 0,
      };
    }
    const kind = id.startsWith("outdoor-dog-")
      ? "outdoor_dog"
      : id.startsWith("outdoor-cat-")
        ? "outdoor_cat"
        : id.startsWith("outdoor-rabbit-")
          ? "outdoor_rabbit"
          : id === "outdoor-koi-pond"
            ? "outdoor_koi_pond"
            : id === "outdoor-fountain"
              ? "outdoor_fountain"
              : null;
    if (!kind) return null;
    return {
      id,
      kind,
      floorId: this.floor.id,
      cell: [Math.floor(this.playerX), Math.floor(this.playerZ)],
      rotation: 0,
      interactionRadius: 3,
      labelKey: "office3d.prompt.pet",
    };
  }

  private isBusyState(state: AgentVisualState): boolean {
    return (
      state === "coding" ||
      state === "thinking" ||
      state === "waiting" ||
      state === "error" ||
      state === "paused_budget"
    );
  }

  private cellForPosition(x: number, z: number, fallback: [number, number]): [number, number] {
    if (!this.floor || !this.navGrid) return fallback;
    const cx = Math.max(0, Math.min(this.navGrid.width - 1, Math.floor(x)));
    const cz = Math.max(0, Math.min(this.navGrid.depth - 1, Math.floor(z)));
    if (this.navGrid.blockedCells[cz * this.navGrid.width + cx] !== 0) {
      return findNearestWalkableCell(this.navGrid, [cx, cz]) ?? fallback;
    }
    return [cx, cz];
  }

  private clearSocialPartner(actor: AgentActorRecord, nowMs: number): void {
    const partnerId = actor.socialPartnerId;
    actor.socialPartnerId = null;
    if (!partnerId) return;

    const partner = this.agentActors.get(partnerId);
    if (partner && partner.socialPartnerId === actor.agentId) {
      partner.socialPartnerId = null;
      partner.actionPose = "none";
      if (partner.purpose === "idle_desk") {
        partner.faceTarget = null;
      }
      partner.dwellUntilMs = Math.min(partner.dwellUntilMs, nowMs + 1200);
    }
  }

  private leaveSofaIfSeated(actor: AgentActorRecord): void {
    if (actor.sofaReturnCell) {
      actor.x = actor.sofaReturnCell[0] + 0.5;
      actor.z = actor.sofaReturnCell[1] + 0.5;
      actor.sofaReturnCell = null;
    }
    actor.sofaSeatSlot = null;
    actor.seatYOffset = 0;
    actor.seated = false;
  }

  private sendActorHome(actor: AgentActorRecord, nowMs: number, showBubble = false): void {
    if (!this.navGrid || !this.floor) return;
    this.clearSocialPartner(actor, nowMs);
    this.leaveSofaIfSeated(actor);
    const [gridW, gridD] = this.floor.gridSize;
    const isOutside = actor.z >= gridD - 0.1 || actor.isOutdoorStroll;
    let waypoints: Array<[number, number]>;
    if (isOutside && this.activeFloorIndex === 0) {
      const doorCellX = Math.max(0, Math.min(gridW - 1, Math.floor(gridW / 2 - 0.5)));
      const doorOutsideCell: [number, number] = [doorCellX, gridD];
      const doorInsideCell: [number, number] = [doorCellX, gridD - 1];
      const rawInside = findPath(this.navGrid, doorInsideCell, actor.homeSeatCell);
      const smoothedInside = rawInside ? smoothPath(this.navGrid, rawInside) : [actor.homeSeatCell];
      const prefix: Array<[number, number]> = [];
      if (actor.z > gridD + 2.0 && Math.abs(actor.x - (doorCellX + 0.5)) > 3.5) {
        prefix.push([doorCellX, gridD + 2]);
      }
      waypoints = [...prefix, doorOutsideCell, doorInsideCell, ...smoothedInside.slice(1)];
    } else {
      const fromCell = this.cellForPosition(actor.x, actor.z, actor.homeSeatCell);
      const rawPath = findPath(this.navGrid, fromCell, actor.homeSeatCell);
      const path = rawPath ? smoothPath(this.navGrid, rawPath) : null;
      waypoints = path ? path.slice(1) : [actor.homeSeatCell];
    }
    actor.purpose = "return_desk";
    actor.activePoiKind = null;
    actor.activePoiFurnitureId = null;
    actor.isOutdoorStroll = false;
    actor.faceTarget = null;
    actor.actionPose = "none";
    actor.actionStartedAtMs = 0;
    actor.actionExpiresAtMs = 0;
    actor.waypoints = waypoints;
    if (showBubble && !actor.bubbleText) {
      actor.bubbleText = OFFICE_COPY["office3d.bubble.returning"];
      actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
    }
  }

  private tryStartSocialChat(
    actor: AgentActorRecord,
    occupiedCells: Set<string>,
    nowMs: number,
  ): boolean {
    if (!this.floor || !this.navGrid) return false;
    const grid = this.navGrid;
    const candidates = [...this.agentActors.values()].filter(
      (other) =>
        other.agentId !== actor.agentId &&
        other.rig.root.visible &&
        !other.isWalking &&
        !other.socialPartnerId &&
        (other.visualState === "idle" || other.visualState === "paused") &&
        (other.purpose === "lounge_break" || other.purpose === "idle_desk"),
    );
    if (candidates.length === 0) return false;

    // Prefer joining someone already out at a POI before visiting a seated coworker
    candidates.sort((a, b) => {
      const aLounge = a.purpose === "lounge_break" ? 0 : 1;
      const bLounge = b.purpose === "lounge_break" ? 0 : 1;
      return aLounge - bLounge;
    });

    const startOffset = Math.floor(Math.random() * candidates.length);
    for (let idx = 0; idx < candidates.length; idx++) {
      const partner = candidates[(startOffset + idx) % candidates.length]!;
      const partnerCell: [number, number] =
        partner.purpose === "idle_desk"
          ? partner.homeSeatCell
          : [Math.floor(partner.x), Math.floor(partner.z)];

      for (const [dx, dz] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ] as const) {
        const spot: [number, number] = [partnerCell[0] + dx, partnerCell[1] + dz];
        const key = `${spot[0]},${spot[1]}`;
        if (occupiedCells.has(key)) continue;
        if (spot[0] === actor.homeSeatCell[0] && spot[1] === actor.homeSeatCell[1]) continue;

        // Check spot is reachable cleanly through doors/corridors
        const rawPath = findPath(grid, actor.homeSeatCell, spot);
        if (!rawPath || rawPath.length < 2) continue;

        // Also verify no wall separates the chat spot from the partner's cell
        const adjPath = findPath(grid, spot, partnerCell);
        if (!adjPath || adjPath.length > 2) continue;

        occupiedCells.add(key);
        const smoothed = smoothPath(grid, rawPath);
        actor.purpose = "social_chat";
        actor.socialPartnerId = partner.agentId;
        partner.socialPartnerId = actor.agentId;
        actor.seated = false;
        actor.actionPose = "chatting";
        actor.faceTarget = { x: partner.x, z: partner.z };
        actor.dwellUntilMs = 0;
        actor.waypoints = smoothed.slice(1);
        actor.bubbleText =
          this.pickAgentSlogan(actor.agentId) ?? OFFICE_COPY["office3d.bubble.socialStart"];
        actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
        return true;
      }
    }

    return false;
  }

  private tryStartIdleAction(
    actor: AgentActorRecord,
    pois: readonly IdlePointOfInterest[],
    occupiedCells: Set<string>,
    nowMs: number,
  ): void {
    if (!this.floor || !this.navGrid) return;

    const behavior = this.agentBehaviors[actor.agentId];
    const preset = behavior?.idlePreset ?? "balanced";
    const slogans = behavior?.slogans ?? [];
    const sloganFreq = behavior?.sloganFrequency ?? 0.35;
    const pickSloganOrFallback = (fallback: string): string => {
      if (slogans.length > 0 && Math.random() < sloganFreq) {
        return slogans[Math.floor(Math.random() * slogans.length)] ?? fallback;
      }
      return fallback;
    };

    if (preset === "focused" && Math.random() < 0.65) {
      actor.dwellUntilMs = nowMs + IDLE_MIN_DWELL_MS * 1.6;
      if (slogans.length > 0 && Math.random() < sloganFreq) {
        actor.bubbleText = slogans[Math.floor(Math.random() * slogans.length)] ?? null;
        actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
      }
      return;
    }

    const socialChance =
      preset === "lively"
        ? SOCIAL_CHAT_CHANCE * 1.4
        : preset === "focused"
          ? SOCIAL_CHAT_CHANCE * 0.4
          : SOCIAL_CHAT_CHANCE;
    if (Math.random() < socialChance && this.tryStartSocialChat(actor, occupiedCells, nowMs)) {
      return;
    }

    // Ground-floor agents occasionally stroll out the South glass doors to enjoy the courtyard
    const [gridW, gridD] = this.floor.gridSize;
    const outdoorChance = preset === "lively" ? 0.28 : preset === "focused" ? 0.08 : 0.18;
    if (
      this.activeFloorIndex === 0 &&
      this.environmentConfig.weather === "clear" &&
      Math.random() < outdoorChance
    ) {
      const doorCellX = Math.max(0, Math.min(gridW - 1, Math.floor(gridW / 2 - 0.5)));
      const doorInsideCell: [number, number] = [doorCellX, gridD - 1];
      const doorOutsideCell: [number, number] = [doorCellX, gridD];
      const toDoor = findPath(this.navGrid, actor.homeSeatCell, doorInsideCell);
      if (toDoor && toDoor.length > 0) {
        const courtyardSpots: ReadonlyArray<{ cell: [number, number]; lookAt: { x: number; z: number } }> = [
          { cell: [doorCellX - 3, gridD + 4], lookAt: { x: gridW / 2, z: gridD + 12 } },
          { cell: [doorCellX + 3, gridD + 4], lookAt: { x: gridW / 2, z: gridD + 12 } },
          { cell: [doorCellX - 2, gridD + 9], lookAt: { x: gridW / 2, z: gridD + 12 } },
          { cell: [doorCellX + 2, gridD + 9], lookAt: { x: gridW / 2, z: gridD + 12 } },
          { cell: [-5, gridD + 4], lookAt: { x: -10.5, z: gridD / 2 + 6.5 } },
        ];
        const spot = courtyardSpots[Math.floor(Math.random() * courtyardSpots.length)]!;
        const smoothedInside = smoothPath(this.navGrid, toDoor);
        actor.purpose = "lounge_break";
        actor.lastPoiKey = `poi-outdoor-${spot.cell[0]}-${spot.cell[1]}`;
        actor.activePoiKind = "corridor";
        actor.activePoiFurnitureId = null;
        actor.isOutdoorStroll = true;
        actor.seated = false;
        actor.faceTarget = spot.lookAt;
        actor.actionPose = "inspecting";
        actor.dwellUntilMs = 0;
        actor.waypoints = [
          ...smoothedInside.slice(1),
          doorOutsideCell,
          [doorCellX, gridD + 2],
          spot.cell,
        ];
        actor.bubbleText = pickSloganOrFallback(OFFICE_COPY["office3d.bubble.outdoorStroll"]);
        actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
        return;
      }
    }

    if (pois.length === 0) {
      actor.dwellUntilMs = nowMs + IDLE_MIN_DWELL_MS;
      return;
    }

    const role = this.agentsById[actor.agentId]?.role ?? "";
    const fromCell = actor.homeSeatCell;
    const triedKeys = new Set<string>();

    for (let attempt = 0; attempt < Math.min(4, pois.length); attempt++) {
      const excludeKey = attempt === 0 ? actor.lastPoiKey : null;
      const candidatePool = pois.filter((p) => !triedKeys.has(p.key));
      const picked = pickWeightedIdlePoi(candidatePool, {
        role,
        occupiedCells,
        excludeKey,
        behavior,
      });
      if (!picked) break;
      triedKeys.add(picked.key);

      const rawPath = findPath(this.navGrid, fromCell, picked.cell);
      if (rawPath && rawPath.length > 1) {
        const smoothed = smoothPath(this.navGrid, rawPath);
        occupiedCells.add(`${picked.cell[0]},${picked.cell[1]}`);
        actor.purpose = "lounge_break";
        actor.lastPoiKey = picked.key;
        actor.activePoiKind = picked.kind;
        actor.activePoiFurnitureId = picked.furnitureId ?? null;
        actor.isOutdoorStroll = false;
        actor.seated = false;
        actor.faceTarget = picked.lookAt;
        actor.actionPose = picked.actionPose;
        actor.dwellUntilMs = 0;
        actor.waypoints = smoothed.slice(1);
        actor.bubbleText = pickSloganOrFallback(copyText(picked.bubbleKey));
        actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
        return;
      }
    }

    actor.dwellUntilMs = nowMs + (preset === "lively" ? IDLE_MIN_DWELL_MS * 0.6 : IDLE_MIN_DWELL_MS);
  }

  private computeRemainingWaypointDist(actor: AgentActorRecord): number {
    if (actor.waypoints.length === 0) {
      return actor.purpose === "return_desk" ? Math.hypot(actor.homeX - actor.x, actor.homeZ - actor.z) : 0;
    }
    let total = 0;
    let cx = actor.x;
    let cz = actor.z;
    for (const wp of actor.waypoints) {
      const wx = wp[0] + 0.5;
      const wz = wp[1] + 0.5;
      total += Math.hypot(wx - cx, wz - cz);
      cx = wx;
      cz = wz;
    }
    if (actor.purpose === "return_desk" && actor.hasDesk) {
      total += Math.hypot(actor.homeX - cx, actor.homeZ - cz);
    }
    return total;
  }

  private computeSeparationOffset(actor: AgentActorRecord): { sx: number; sz: number } {
    let sx = 0;
    let sz = 0;
    for (const other of this.agentActors.values()) {
      if (other.agentId === actor.agentId || !other.rig.root.visible || other.seated) continue;
      if (other.agentId === actor.socialPartnerId) continue;
      const dx = actor.x - other.x;
      const dz = actor.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < AGENT_SEPARATION_RADIUS_M) {
        const push = (AGENT_SEPARATION_RADIUS_M - d) / AGENT_SEPARATION_RADIUS_M;
        sx += (dx / d) * push;
        sz += (dz / d) * push;
      }
    }
    return { sx, sz };
  }

  private stepActorTowards(
    actor: AgentActorRecord,
    tx: number,
    tz: number,
    maxSpeed: number,
    remainingDist: number,
    dt: number,
    withSeparation: boolean,
  ): number {
    const dx = tx - actor.x;
    const dz = tz - actor.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.0001) return 0;

    const desiredYaw = Math.atan2(dx, dz);
    let yawDiff = ((desiredYaw - actor.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

    const cornerScale = Math.abs(yawDiff) > 0.6 ? 0.72 : 1.0;
    const decelScale =
      remainingDist < AGENT_DECEL_DIST_M
        ? Math.max(0.35, remainingDist / AGENT_DECEL_DIST_M)
        : 1.0;
    const targetSpeed = maxSpeed * cornerScale * decelScale;

    if (actor.currentSpeed < targetSpeed) {
      actor.currentSpeed = Math.min(targetSpeed, actor.currentSpeed + AGENT_ACCEL_MPS2 * dt);
    } else {
      actor.currentSpeed = Math.max(targetSpeed, actor.currentSpeed - AGENT_ACCEL_MPS2 * dt);
    }

    const step = Math.min(dist, Math.max(0.4, actor.currentSpeed) * dt);
    let stepX = (dx / dist) * step;
    let stepZ = (dz / dist) * step;

    if (withSeparation && this.floor) {
      const { sx, sz } = this.computeSeparationOffset(actor);
      if (sx !== 0 || sz !== 0) {
        const candidateX = actor.x + stepX + sx * AGENT_SEPARATION_STRENGTH * dt;
        const candidateZ = actor.z + stepZ + sz * AGENT_SEPARATION_STRENGTH * dt;
        if (canMoveBetween(this.floor, actor.x, actor.z, candidateX, candidateZ)) {
          stepX = candidateX - actor.x;
          stepZ = candidateZ - actor.z;
        }
      }
    }

    actor.x += stepX;
    actor.z += stepZ;
    const nextYaw = lerpAngle(actor.yaw, desiredYaw, Math.min(1, dt * 10));
    let appliedDiff = ((nextYaw - actor.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (appliedDiff < -Math.PI) appliedDiff += Math.PI * 2;
    const stepTurn = dt > 0 ? appliedDiff / dt : 0;
    actor.turnRate += (stepTurn - actor.turnRate) * Math.min(1, dt * 8);
    actor.yaw = nextYaw;

    const moved = Math.hypot(stepX, stepZ);
    actor.walkPhase += moved * WALK_STRIDE_RAD_PER_METER;
    return moved;
  }

  private updateAgentMovement(dt: number, nowMs: number, elapsedSec: number): void {
    if (!this.floor || !this.navGrid) return;

    if (!this.buildState.enabled && this.pendingVisitorSpawns.length > 0) {
      const remaining: typeof this.pendingVisitorSpawns = [];
      for (const req of this.pendingVisitorSpawns) {
        if (nowMs >= req.spawnAtMs) {
          this.spawnElevatorVisitor(
            req.agentId,
            req.bubbleText,
            req.goalCell,
            req.faceTarget,
            req.purpose,
            req.dwellMs,
          );
        } else {
          remaining.push(req);
        }
      }
      this.pendingVisitorSpawns = remaining;
    }

    const visitorsToRemove: string[] = [];
    const idlePois =
      !this.meetingActive && !this.replayActive && !this.buildState.enabled
        ? getIdlePointsOfInterest(this.floor, this.navGrid)
        : [];
    const occupiedCells = new Set<string>();
    for (const actor of this.agentActors.values()) {
      const target = actor.waypoints[actor.waypoints.length - 1];
      if (target) {
        occupiedCells.add(`${target[0]},${target[1]}`);
      } else if (!actor.seated) {
        occupiedCells.add(`${Math.floor(actor.x)},${Math.floor(actor.z)}`);
      }
    }

    if (!this.buildState.enabled && this.meetingActive && nowMs >= this.nextStandupTurnAtMs) {
      this.nextStandupTurnAtMs = nowMs + 4800;
      const participants = [...this.agentActors.values()].filter(
        (a) => a.rig.root.visible && a.purpose === "meeting" && a.waypoints.length === 0,
      );
      if (participants.length > 0) {
        const speaker = participants[this.standupSpeakerIndex % participants.length]!;
        this.standupSpeakerIndex += 1;
        const snap = this.agentsById[speaker.agentId];
        const ref = snap?.currentIssueIdentifier
          ? `${snap.currentIssueIdentifier}${snap.currentIssueTitle ? `: ${snap.currentIssueTitle}` : ""}`
          : null;
        const slogan = this.pickAgentSlogan(speaker.agentId, 0.45);
        speaker.bubbleText =
          slogan ??
          (ref
            ? OFFICE_COPY["office3d.bubble.standupWorking"].replace("{{ref}}", ref.slice(0, 46))
            : OFFICE_COPY["office3d.bubble.standupReady"]);
        speaker.bubbleExpiresAtMs = nowMs + 4200;
        speaker.actionPose = "chatting";
        speaker.actionStartedAtMs = nowMs;
        speaker.actionExpiresAtMs = nowMs + 3200;
        const listener = participants.find((p) => p.agentId !== speaker.agentId);
        if (listener && listener.actionPose === "none") {
          listener.actionPose = "clapping";
          listener.actionStartedAtMs = nowMs;
          listener.actionExpiresAtMs = nowMs + 1800;
        }
      }
    }

    for (const actor of this.agentActors.values()) {
      if (actor.commutePhase === "away_other_floor") {
        if (nowMs >= actor.commuteReturnAtMs && !this.buildState.enabled) {
          const landing = this.getElevatorLandingCell();
          actor.rig.root.visible = true;
          actor.commutePhase = "arriving_elevator";
          actor.purpose = "return_desk";
          actor.faceTarget = null;
          actor.actionPose = "none";
          actor.bubbleText = OFFICE_COPY["office3d.elevator.returning"];
          actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
          if (landing) {
            const raw = findPath(this.navGrid, landing, actor.homeSeatCell);
            const path = raw ? smoothPath(this.navGrid, raw) : null;
            actor.waypoints = path ? path.slice(1) : [actor.homeSeatCell];
          } else {
            actor.waypoints = [actor.homeSeatCell];
          }
        }
        continue;
      }

      if (!actor.rig.root.visible) continue;

      if (actor.bubbleText && actor.bubbleExpiresAtMs <= nowMs) {
        actor.bubbleText = null;
      }

      if (this.buildState.enabled) {
        if (actor.isVisitor) {
          visitorsToRemove.push(actor.agentId);
          continue;
        }
        this.clearSocialPartner(actor, nowMs);
        actor.isWalking = false;
        actor.currentSpeed = 0;
        actor.actionPose = "none";
        actor.rig.root.position.set(actor.x, 0, actor.z);
        actor.rig.root.rotation.y = actor.yaw;
        updateVoxelPose(actor.rig, actor.visualState, elapsedSec, {
          isWalking: false,
          seated: actor.seated,
          reducedMotion: this.reducedMotion,
          phaseOffset: actor.phaseOffset,
          seatBlend: actor.seatBlend,
        });
        continue;
      }

      const busy = this.isBusyState(actor.visualState);
      if (busy && actor.hasDesk && actor.commutePhase === "none") {
        const distToHome = Math.hypot(actor.x - actor.homeX, actor.z - actor.homeZ);
        if ((!actor.seated || distToHome > 0.25) && actor.purpose !== "return_desk") {
          this.sendActorHome(actor, nowMs, true);
        } else if (actor.socialPartnerId) {
          this.clearSocialPartner(actor, nowMs);
        }
        if (nowMs >= actor.nextWorkSloganAtMs) {
          actor.nextWorkSloganAtMs = nowMs + 22000 + Math.random() * 22000;
          if (!actor.bubbleText) {
            const workSlogan = this.pickAgentSlogan(actor.agentId);
            if (workSlogan) {
              actor.bubbleText = workSlogan;
              actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
            }
          }
        }
      } else if (
        !busy &&
        !this.meetingActive &&
        !this.replayActive &&
        actor.hasDesk &&
        actor.commutePhase === "none" &&
        actor.waypoints.length === 0 &&
        (actor.visualState === "idle" || actor.visualState === "paused")
      ) {
        if (nowMs >= actor.dwellUntilMs) {
          if (actor.purpose === "idle_desk" && !actor.socialPartnerId) {
            this.tryStartIdleAction(actor, idlePois, occupiedCells, nowMs);
          } else if (
            (actor.purpose === "lounge_break" && actor.dwellUntilMs > 0) ||
            (actor.purpose === "social_chat" && actor.dwellUntilMs > 0) ||
            actor.purpose === "handoff"
          ) {
            this.sendActorHome(actor, nowMs, false);
          } else if (actor.purpose === "idle_desk" && actor.socialPartnerId) {
            this.clearSocialPartner(actor, nowMs);
          }
        } else if (
          actor.purpose === "idle_desk" &&
          actor.seated &&
          actor.actionPose === "none" &&
          nowMs >= actor.nextStretchAtMs
        ) {
          actor.nextStretchAtMs = nowMs + 45000 + Math.random() * 45000;
          actor.actionPose = "stretching";
          actor.actionStartedAtMs = nowMs;
          actor.actionExpiresAtMs = nowMs + 2600;
          if (!actor.bubbleText) {
            actor.bubbleText =
              this.pickAgentSlogan(actor.agentId) ?? OFFICE_COPY["office3d.bubble.stretch"];
            actor.bubbleExpiresAtMs = nowMs + 3200;
          }
        }
      }

      if (
        !busy &&
        !this.buildState.enabled &&
        !this.meetingActive &&
        !this.replayActive &&
        !actor.isWalking &&
        actor.actionPose === "none" &&
        nowMs - actor.lastGreetedPlayerAtMs > 28000 &&
        Math.hypot(this.playerX - actor.x, this.playerZ - actor.z) <= 2.4 &&
        hasUnobstructedWallLineOfSight(this.floor, this.playerX, this.playerZ, actor.x, actor.z)
      ) {
        actor.lastGreetedPlayerAtMs = nowMs;
        actor.faceTarget = { x: this.playerX, z: this.playerZ };
        actor.actionPose = "waving";
        actor.actionStartedAtMs = nowMs;
        actor.actionExpiresAtMs = nowMs + 2400;
        if (!actor.bubbleText) {
          const behavior = this.agentBehaviors[actor.agentId];
          const greetChance = Math.max(0.65, behavior?.sloganFrequency ?? 0.35);
          actor.bubbleText =
            this.pickAgentSlogan(actor.agentId, greetChance) ??
            OFFICE_COPY["office3d.bubble.waveHi"];
          actor.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
        }
      }

      actor.isWalking = false;
      const baseMaxSpeed =
        (actor.purpose === "return_desk" && busy ? AGENT_URGENT_SPEED_MPS : AGENT_WALK_SPEED_MPS) *
        actor.paceFactor;

      if (actor.waypoints.length > 0) {
        const nextWp = actor.waypoints[0]!;
        const tx = nextWp[0] + 0.5;
        const tz = nextWp[1] + 0.5;
        const dist = Math.hypot(tx - actor.x, tz - actor.z);
        const reachDist = actor.waypoints.length > 1 ? 0.28 : 0.08;

        if (dist <= reachDist) {
          if (actor.waypoints.length === 1) {
            actor.x = tx;
            actor.z = tz;
          }
          actor.waypoints.shift();
          actor.isWalking = actor.waypoints.length > 0 || actor.purpose === "return_desk";
        } else {
          const remainingDist = this.computeRemainingWaypointDist(actor);
          this.stepActorTowards(actor, tx, tz, baseMaxSpeed, remainingDist, dt, !actor.isVisitor);
          actor.isWalking = true;
        }
      } else if (
        (actor.commutePhase === "departing_elevator" || actor.commutePhase === "returning_elevator") &&
        this.floor.elevatorCell
      ) {
        const cabinX = this.floor.elevatorCell[0] + 0.5;
        const cabinZ = this.floor.elevatorCell[1] + 0.72;
        const dist = Math.hypot(cabinX - actor.x, cabinZ - actor.z);
        if (dist > 0.2) {
          this.stepActorTowards(actor, cabinX, cabinZ, baseMaxSpeed, dist, dt, false);
          actor.isWalking = true;
        } else if (actor.isVisitor) {
          visitorsToRemove.push(actor.agentId);
          continue;
        } else {
          actor.rig.root.visible = false;
          actor.commutePhase = "away_other_floor";
          actor.commuteReturnAtMs = nowMs + 6500;
          actor.isWalking = false;
          continue;
        }
      } else if (actor.purpose === "return_desk" && actor.hasDesk) {
        actor.commutePhase = "none";
        const dist = Math.hypot(actor.homeX - actor.x, actor.homeZ - actor.z);
        if (dist > 0.06) {
          this.stepActorTowards(actor, actor.homeX, actor.homeZ, baseMaxSpeed, dist, dt, false);
          actor.isWalking = true;
        } else {
          actor.x = actor.homeX;
          actor.z = actor.homeZ;
          actor.yaw = actor.homeYaw;
          actor.currentSpeed = 0;
          actor.turnRate = 0;
          actor.seated = true;
          actor.isWalking = false;
          actor.purpose = "idle_desk";
          actor.actionPose = "none";
          actor.dwellUntilMs =
            nowMs + IDLE_MIN_DWELL_MS + Math.random() * (IDLE_MAX_DWELL_MS - IDLE_MIN_DWELL_MS);
        }
      } else {
        if (actor.commutePhase === "arriving_elevator") {
          actor.commutePhase = "none";
        }
        actor.currentSpeed = 0;
        actor.turnRate *= Math.max(0, 1 - dt * 10);

        if (actor.purpose === "social_chat" && actor.dwellUntilMs <= nowMs) {
          const partner = actor.socialPartnerId ? this.agentActors.get(actor.socialPartnerId) : null;
          if (
            partner &&
            partner.rig.root.visible &&
            !this.isBusyState(partner.visualState) &&
            Math.hypot(partner.x - actor.x, partner.z - actor.z) <= 2.6
          ) {
            const chatDwell =
              SOCIAL_CHAT_MIN_DWELL_MS +
              Math.random() * (SOCIAL_CHAT_MAX_DWELL_MS - SOCIAL_CHAT_MIN_DWELL_MS);
            actor.faceTarget = { x: partner.x, z: partner.z };
            actor.actionPose = "chatting";
            actor.dwellUntilMs = nowMs + chatDwell;
            partner.faceTarget = { x: actor.x, z: actor.z };
            partner.actionPose = "chatting";
            partner.dwellUntilMs = nowMs + chatDwell;
            if (!partner.bubbleText) {
              partner.bubbleText =
                partner.purpose === "lounge_break"
                  ? OFFICE_COPY["office3d.bubble.socialLounge"]
                  : OFFICE_COPY["office3d.bubble.socialReply"];
              partner.bubbleExpiresAtMs = nowMs + HANDOFF_BUBBLE_DURATION_MS;
            }
          } else {
            this.sendActorHome(actor, nowMs, false);
          }
        } else if (actor.purpose === "lounge_break" && actor.dwellUntilMs <= nowMs) {
          const dwellMs = POI_MIN_DWELL_MS + Math.random() * (POI_MAX_DWELL_MS - POI_MIN_DWELL_MS);
          actor.dwellUntilMs = nowMs + dwellMs;
          actor.actionStartedAtMs = nowMs;
          actor.actionExpiresAtMs = nowMs + dwellMs;
          if (actor.activePoiKind === "coffee_machine" || actor.activePoiKind === "vending_machine") {
            this.setActorHeldItem(actor, "coffee_cup", dwellMs + 9500, nowMs);
          } else if (actor.activePoiKind === "water_cooler") {
            this.setActorHeldItem(actor, "water_cup", dwellMs + 6500, nowMs);
          } else if (actor.activePoiKind === "bookshelf" || actor.activePoiKind === "lounge_table") {
            this.setActorHeldItem(actor, "handbook", dwellMs, nowMs);
          } else if (actor.activePoiKind === "printer" || actor.activePoiKind === "filing_cabinet") {
            this.setActorHeldItem(actor, "document", dwellMs, nowMs);
          } else if (actor.activePoiKind === "sofa" && this.floor) {
            const sofaItem =
              (actor.activePoiFurnitureId
                ? this.floor.furniture.find((f) => f.id === actor.activePoiFurnitureId)
                : null) ??
              this.floor.furniture.find(
                (f) =>
                  f.kind === "sofa" &&
                  Math.hypot(f.x + 0.5 - actor.x, f.z + 0.5 - actor.z) <= 2.4,
              );
            if (sofaItem) {
              const takenSlots = new Set<number>();
              for (const other of this.agentActors.values()) {
                if (
                  other.agentId !== actor.agentId &&
                  other.sofaSeatSlot !== null &&
                  Math.hypot(other.x - (sofaItem.x + 0.5), other.z - (sofaItem.z + 0.5)) <= 1.6
                ) {
                  takenSlots.add(other.sofaSeatSlot);
                }
              }
              const slot = takenSlots.has(0) ? 1 : 0;
              const lateral = slot === 0 ? -0.36 : 0.36;
              const rad = (sofaItem.rotation * Math.PI) / 180;
              actor.sofaReturnCell = [Math.floor(actor.x), Math.floor(actor.z)];
              actor.sofaSeatSlot = slot;
              actor.x = sofaItem.x + 0.5 + Math.cos(rad) * lateral + Math.sin(rad) * 0.08;
              actor.z = sofaItem.z + 0.5 - Math.sin(rad) * lateral + Math.cos(rad) * 0.08;
              actor.yaw = rad;
              actor.faceTarget = null;
              actor.seated = true;
              actor.seatYOffset = 0.14;
            }
          }
        } else if (actor.purpose === "handoff" && actor.dwellUntilMs <= nowMs) {
          if (actor.isVisitor) {
            this.sendVisitorBackToElevator(actor, nowMs);
          } else {
            actor.dwellUntilMs = nowMs + HANDOFF_DWELL_MS;
          }
        }
      }

      if (!actor.isWalking) {
        if (actor.faceTarget) {
          const fx = actor.faceTarget.x - actor.x;
          const fz = actor.faceTarget.z - actor.z;
          if (Math.hypot(fx, fz) > 0.1) {
            actor.yaw = lerpAngle(actor.yaw, Math.atan2(fx, fz), Math.min(1, dt * 8));
          }
        } else if (actor.purpose === "idle_desk" && actor.seated) {
          actor.yaw = lerpAngle(actor.yaw, actor.homeYaw, Math.min(1, dt * 8));
        }
      }

      if (actor.transientItemExpiresAtMs > 0 && nowMs >= actor.transientItemExpiresAtMs) {
        disposeObjectTree(actor.rig.heldItemMount);
        actor.rig.heldItemMount.clear();
        actor.transientItemExpiresAtMs = 0;
        actor.hasTransientItem = false;
      }
      if (actor.actionExpiresAtMs > 0 && nowMs >= actor.actionExpiresAtMs) {
        actor.actionExpiresAtMs = 0;
        actor.actionStartedAtMs = 0;
        actor.actionPose = "none";
      }

      const actorActionProgress =
        actor.actionExpiresAtMs > actor.actionStartedAtMs
          ? Math.min(
              1,
              Math.max(
                0,
                (nowMs - actor.actionStartedAtMs) /
                  (actor.actionExpiresAtMs - actor.actionStartedAtMs),
              ),
            )
          : undefined;

      const seatTarget = actor.seated ? 1 : 0;
      actor.seatBlend += (seatTarget - actor.seatBlend) * Math.min(1, dt * 10);

      const actorGroundY =
        this.activeFloorIndex === 0 && !this.isInsideFloor(actor.x, actor.z)
          ? OUTDOOR_GROUND_Y
          : 0;
      actor.rig.root.position.set(actor.x, actor.seatYOffset + actorGroundY, actor.z);
      actor.rig.root.rotation.y = actor.yaw;
      updateVoxelPose(actor.rig, actor.visualState, elapsedSec, {
        isWalking: actor.isWalking,
        seated: actor.seated,
        reducedMotion: this.reducedMotion,
        walkPhase: actor.walkPhase,
        speedRatio:
          actor.isWalking && baseMaxSpeed > 0
            ? Math.max(0.35, actor.currentSpeed / baseMaxSpeed)
            : 0,
        turnRate: actor.turnRate,
        phaseOffset: actor.phaseOffset,
        actionPose: actor.actionPose,
        actionProgress: actorActionProgress,
        hasHeldItem: actor.hasTransientItem,
        seatBlend: actor.seatBlend,
      });
    }

    for (const deadId of visitorsToRemove) {
      this.removeVisitorActor(deadId);
    }
  }

  private updateWeather(dt: number): void {
    const scaledDt = this.reducedMotion ? dt * REDUCED_MOTION_WEATHER_SCALE : dt;

    if (this.rainField.mesh.visible) {
      this.stepWeatherField(
        this.rainField,
        () => -RAIN_DRIFT_X_MPS * scaledDt,
        -RAIN_FALL_Y_MPS * scaledDt,
        () => 0,
      );
    }

    if (this.snowField.mesh.visible) {
      const t = performance.now() * 0.001;
      this.stepWeatherField(
        this.snowField,
        (i) => Math.sin(t + i) * SNOW_SWAY_X_MPS * scaledDt,
        -SNOW_FALL_Y_MPS * scaledDt,
        (i) => Math.cos(t * 0.8 + i) * SNOW_SWAY_X_MPS * 0.5 * scaledDt,
      );
    }
  }

  private stepWeatherField(
    field: WeatherParticleField,
    dxFn: (index: number) => number,
    dy: number,
    dzFn: (index: number) => number,
  ): void {
    const { mesh, coords, count, tiltZ } = field;
    const arr = mesh.instanceMatrix.array as Float32Array;
    const cos = Math.cos(tiltZ);
    const sin = Math.sin(tiltZ);
    for (let i = 0; i < count; i++) {
      const base = i * 3;
      const step = stepWeatherParticle(
        coords[base]!,
        coords[base + 1]!,
        coords[base + 2]!,
        dxFn(i),
        dy,
        dzFn(i),
        this.weatherBounds,
      );
      coords[base] = step.x;
      coords[base + 1] = step.y;
      coords[base + 2] = step.z;

      const offset = i * 16;
      arr[offset] = cos;
      arr[offset + 1] = sin;
      arr[offset + 2] = 0;
      arr[offset + 3] = 0;
      arr[offset + 4] = -sin;
      arr[offset + 5] = cos;
      arr[offset + 6] = 0;
      arr[offset + 7] = 0;
      arr[offset + 8] = 0;
      arr[offset + 9] = 0;
      arr[offset + 10] = 1;
      arr[offset + 11] = 0;
      arr[offset + 12] = step.x;
      arr[offset + 13] = step.y;
      arr[offset + 14] = step.z;
      arr[offset + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private updateElevatorDoors(dt: number): void {
    if (!this.elevatorDoors) return;
    let minDist = Math.hypot(
      this.playerX - this.elevatorDoors.centerX,
      this.playerZ - this.elevatorDoors.centerZ,
    );
    for (const actor of this.agentActors.values()) {
      if (!actor.rig.root.visible || actor.commutePhase === "none") continue;
      const d = Math.hypot(
        actor.x - this.elevatorDoors.centerX,
        actor.z - this.elevatorDoors.centerZ,
      );
      if (d < minDist) minDist = d;
    }
    const shouldOpen = !this.buildState.enabled && minDist <= ELEVATOR_DOOR_TRIGGER_RADIUS_M;
    const target = shouldOpen ? 1 : 0;
    const speed = this.reducedMotion ? 4 : 6;
    this.elevatorDoors.openAmount +=
      (target - this.elevatorDoors.openAmount) * Math.min(1, dt * speed);
    const slide = this.elevatorDoors.openAmount * ELEVATOR_DOOR_SLIDE_M;
    this.elevatorDoors.left.position.x = -0.25 - slide;
    this.elevatorDoors.right.position.x = 0.25 + slide;
  }

  private emitProjectedOverlays(nowMs: number): void {
    if (nowMs - this.lastOverlayEmitTime < 80) return;
    this.lastOverlayEmitTime = nowMs;

    const width = this.renderer.domElement.clientWidth || 800;
    const height = this.renderer.domElement.clientHeight || 600;
    const tmp = new THREE.Vector3();

    const agentPositions: Record<string, LiveAgentPosition> = {};
    const candidates: Array<{
      dist: number;
      label: ProjectedAgentLabel;
      hasActiveBubble: boolean;
    }> = [];

    for (const actor of this.agentActors.values()) {
      if (!actor.rig.root.visible) continue;
      agentPositions[actor.agentId] = {
        x: actor.x,
        z: actor.z,
        moving: actor.isWalking,
      };
      const snapshot = this.agentsById[actor.agentId];
      if (!snapshot) continue;

      tmp.set(actor.x, 2.08, actor.z);
      const dist = tmp.distanceTo(this.camera.position);
      tmp.project(this.camera);
      if (tmp.z > 1) continue;

      const screenX = (tmp.x * 0.5 + 0.5) * width;
      const screenY = (-tmp.y * 0.5 + 0.5) * height;
      if (screenX < -80 || screenX > width + 80 || screenY < TOP_HUD_SAFE_PX || screenY > height + 30) {
        continue;
      }
      const hasActiveBubble = Boolean(actor.bubbleText && actor.bubbleExpiresAtMs > nowMs);
      candidates.push({
        dist,
        hasActiveBubble,
        label: {
          agentId: snapshot.agentId,
          name: snapshot.name,
          visualState: snapshot.visualState,
          screenX,
          screenY,
          bubbleText: hasActiveBubble ? actor.bubbleText : null,
        },
      });
    }

    candidates.sort((a, b) => a.dist - b.dist);
    let bubbleSlots = MAX_VISIBLE_BUBBLES;
    const visibleLabels: ProjectedAgentLabel[] = [];
    for (const candidate of candidates.slice(0, MAX_VISIBLE_LABELS)) {
      const next = { ...candidate.label };
      if (next.bubbleText) {
        if (bubbleSlots > 0) bubbleSlots -= 1;
        else next.bubbleText = null;
      }
      // Nudge vertically if overlapping an already placed closer label
      for (const placed of visibleLabels) {
        if (
          Math.abs(placed.screenX - next.screenX) < 95 &&
          Math.abs(placed.screenY - next.screenY) < 22
        ) {
          next.screenY = Math.max(TOP_HUD_SAFE_PX, placed.screenY - 24);
        }
      }
      visibleLabels.push(next);
    }

    const projectedMarkers: ProjectedMarker[] = [];
    for (const marker of this.markers) {
      if (!this.floor || marker.floorId !== this.floor.id) continue;
      tmp.set(marker.cell[0] + 0.5, 2.25, marker.cell[1] + 0.5);
      tmp.project(this.camera);
      const behind = tmp.z > 1;
      let sx = (tmp.x * 0.5 + 0.5) * width;
      let sy = (-tmp.y * 0.5 + 0.5) * height;
      if (behind) {
        sx = width - sx;
        sy = height - sy;
      }
      const margin = 28;
      const topMin = Math.max(margin, TOP_HUD_SAFE_PX);
      const offScreen =
        behind || sx < margin || sx > width - margin || sy < topMin || sy > height - margin;
      const clampedX = Math.max(margin, Math.min(width - margin, sx));
      const clampedY = Math.max(topMin, Math.min(height - margin, sy));
      const edgeAngleRad = Math.atan2(sy - height / 2, sx - width / 2);

      projectedMarkers.push({
        marker,
        screenX: clampedX,
        screenY: clampedY,
        offScreen,
        edgeAngleRad,
      });
    }

    this.callbacks.onProjectedOverlays(visibleLabels, projectedMarkers, agentPositions);
  }

  private loop = (nowMs: number): void => {
    if (this.disposed || this.isHidden) {
      this.rafId = null;
      return;
    }

    // Throttle to ~15 FPS when shrunk into Picture-in-Picture corner
    const minInterval = this.cameraMode === "pip" ? 66 : 0;
    const elapsedMs = nowMs - this.lastFrameTime;
    if (elapsedMs < minInterval) {
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    const dt = Math.min(0.05, Math.max(0.001, elapsedMs / 1000));
    this.lastFrameTime = nowMs;
    const elapsedSec = nowMs / 1000;

    for (let i = this.handoffBeams.length - 1; i >= 0; i--) {
      const beam = this.handoffBeams[i]!;
      if (nowMs >= beam.expiresAtMs) {
        this.scene.remove(beam.line);
        beam.line.geometry.dispose();
        (beam.line.material as THREE.Material).dispose();
        this.handoffBeams.splice(i, 1);
      }
    }

    this.applyEnvironmentLighting(false);
    this.updatePlayerMovement(dt, elapsedSec);
    this.updateAgentMovement(dt, nowMs, elapsedSec);

    this.updateWeather(dt);
    this.outdoorLife?.update(
      dt,
      elapsedSec,
      this.environmentConfig.weather,
      this.reducedMotion,
      {
        x: this.playerX,
        z: this.playerZ,
        isIndoors: this.isInsideFloor(this.playerX, this.playerZ),
      },
      this.lastComputedIsNight,
    );
    this.updateElevatorDoors(dt);
    const entranceWalkers: Array<{ x: number; z: number }> = [{ x: this.playerX, z: this.playerZ }];
    if (this.floor) {
      const gridD = this.floor.gridSize[1];
      for (const actor of this.agentActors.values()) {
        if (actor.rig.root.visible && actor.z >= gridD - 4) {
          entranceWalkers.push({ x: actor.x, z: actor.z });
        }
      }
    }
    this.buildingShell?.updateEntranceDoors(dt, entranceWalkers);
    this.updateProximityAndCamera(dt);
    this.buildingShell?.updateView(
      this.camera.position,
      this.buildState.enabled ? "cutaway" : this.buildingViewMode,
      this.buildState.enabled ? undefined : { x: this.playerX, z: this.playerZ },
    );
    this.audio.tickPositionalAmbient(
      nowMs,
      this.playerX,
      this.playerZ,
      this.spatialSources,
      this.environmentConfig.weather,
      this.environmentConfig.weatherAudioVolume,
    );
    this.emitProjectedOverlays(nowMs);

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    this.disposed = true;
    this.exitPointerLock();
    if (this.kpiCanvasTexture) {
      this.kpiCanvasTexture.dispose();
      this.kpiCanvasTexture = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.unbindEvents();
    this.controls.dispose();
    disposeObjectTree(this.scene);
    this.palette.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
