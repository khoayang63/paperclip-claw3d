import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { officeLayoutApi } from "@/api/office-layout";
import { performanceApi } from "@/api/performance";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useDialogActions } from "@/context/DialogContext";
import { useOptionalToastActions } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { useSearchParams } from "@/lib/router";
import { deriveDefaultAgentSkin } from "./model/agentState";
import {
  BLOCKED_GLOBAL_SHORTCUT_KEYS,
  BUILD_UNDO_HISTORY_LIMIT,
  DEFAULT_ELEVATOR_CELL,
  HOTBAR_SLOT_COUNT,
  OUTDOOR_FURNITURE_KINDS,
} from "./model/constants";
import {
  addItemToHotbar,
  createEmptyHotbar,
  getSelectedHotbarItem,
  removeHotbarSlot,
  selectHotbarSlot,
  swapHotbarSlots,
} from "./model/hotbar";
import {
  autoPlaceDeskInBuilding,
  buildInteractiveStations,
  createBlankFloor,
  createBlueprintExport,
  createNewBuilding,
  createPresetDefaultHqLayout,
  findAgentDeskLocation,
  findContainingRoomId,
  generateLayoutFromOrg,
  getAgentIdsSeatedOnOtherFloors,
  isBuildCellOccupied,
  isCellOnRoomBoundary,
  moveDeskToCell,
  moveFurnitureToCell,
  moveRoomToCell,
  parseBlueprintImport,
  rotateGridRotation,
  validateAndSanitizeLayout,
  validateRoom,
} from "./model/layout";
import type { ReplaySample } from "./model/replay";
import {
  loadAgentSkins,
  loadEnvironmentConfig,
  loadOfficeHotbar,
  loadOfficeLayout,
  loadOfficePlayerState,
  loadPerformanceMode,
  loadPlayerSkin,
  loadShowMinimap,
  saveAgentSkins,
  saveEnvironmentConfig,
  saveOfficeHotbar,
  saveOfficeLayout,
  saveOfficePlayerState,
  savePerformanceMode,
  savePlayerSkin,
  saveShowMinimap,
} from "./model/storage";
import type {
  AgentMovementTask,
  AgentSkinMap,
  AvatarSkinConfig,
  BuildingViewMode,
  CameraControlMode,
  EnvironmentConfig,
  FloorConfig,
  GridRotation,
  InteractiveStation,
  LiveAgentPosition,
  OfficeHotbarState,
  OfficeItemKind,
  OfficeKpiSnapshot,
  OfficeLayout,
  RoomConfig,
} from "./model/types";
import { useOfficeT } from "./officeCopy";
import { OfficeSpatialAudio } from "./scene/audio";
import {
  isWebGLAvailable,
  OfficeSceneEngine,
  type BuildGhostPreview,
  type BuildPlaceableKind,
  type BuildTool,
  type HoveredAgentInfo,
  type ProjectedAgentLabel,
  type ProjectedMarker,
} from "./scene/OfficeSceneEngine";
import { useOfficeControlPlaneBridge } from "./useOfficeControlPlaneBridge";
import { ArcadeMiniGameModal } from "./components/ArcadeMiniGameModal";
import { BuildModeBar } from "./components/BuildModeBar";
import { HeldIssueModal } from "./components/HeldIssueModal";
import { OfficeChatDrawer } from "./components/OfficeChatDrawer";
import { OfficeHireAgentModal, type OfficeHireResult } from "./components/OfficeHireAgentModal";
import { OfficeHud } from "./components/OfficeHud";
import { OfficePlaybookDrawer } from "./components/OfficePlaybookDrawer";
import { OfficeTeamChatDrawer } from "./components/OfficeTeamChatDrawer";
import { ReplayBar } from "./components/ReplayBar";
import { StationModal, type TakeItemMeta } from "./components/StationModal";
import { WardrobeModal } from "./components/WardrobeModal";
import { WebGLFallback } from "./components/WebGLFallback";

function cloneLayout(layout: OfficeLayout): OfficeLayout {
  return JSON.parse(JSON.stringify(layout)) as OfficeLayout;
}

export function Office3D() {
  const ot = useOfficeT();
  const queryClient = useQueryClient();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { openNewIssue } = useDialogActions();
  const pushToast = useOptionalToastActions()?.pushToast ?? null;
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    setBreadcrumbs([{ label: ot("office3d.nav.title") }]);
  }, [ot, setBreadcrumbs]);

  const webglSupported = useMemo(() => isWebGLAvailable(), []);
  const isTouchDevice = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true,
    [],
  );

  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const [environment, setEnvironment] = useState<EnvironmentConfig>(() => loadEnvironmentConfig());
  const [playerSkin, setPlayerSkin] = useState<AvatarSkinConfig>(() => loadPlayerSkin());
  const [performanceMode, setPerformanceMode] = useState<boolean>(() => loadPerformanceMode());

  const audioRef = useRef<OfficeSpatialAudio | null>(null);
  if (!audioRef.current) {
    audioRef.current = new OfficeSpatialAudio();
    audioRef.current.setVolume(environment.weatherAudioVolume);
  }
  const [audioMuted, setAudioMuted] = useState(true);

  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);

  const [layout, setLayout] = useState<OfficeLayout | null>(null);
  const [agentSkins, setAgentSkins] = useState<AgentSkinMap>({ companyId: "", skins: {} });
  const [meetingActive, setMeetingActive] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replaySample, setReplaySample] = useState<ReplaySample | null>(null);
  const engineRef = useRef<OfficeSceneEngine | null>(null);

  const handleMovementTask = useCallback((task: AgentMovementTask) => {
    engineRef.current?.enqueueMovementTask(task);
  }, []);

  const bridge = useOfficeControlPlaneBridge({
    layout,
    environment,
    meetingActive,
    onMovementTask: handleMovementTask,
    onRunCompleted: (agentId) => {
      audioRef.current?.playTaskCompleted();
      if (agentId) {
        engineRef.current?.triggerAgentCelebration(agentId, ot("office3d.bubble.celebrate"));
      }
    },
    onRunFailed: () => audioRef.current?.playErrorAlert(),
  });

  const companyId = selectedCompanyId ?? "";
  const [showMinimap, setShowMinimap] = useState<boolean>(() => loadShowMinimap(companyId));

  useEffect(() => {
    setShowMinimap(loadShowMinimap(companyId));
  }, [companyId]);

  const persistLayout = useCallback(
    (nextLayout: OfficeLayout, nextSkins?: AgentSkinMap) => {
      saveOfficeLayout(nextLayout);
      if (nextSkins) saveAgentSkins(nextSkins);
      if (nextLayout.companyId) {
        void officeLayoutApi
          .save(nextLayout.companyId, {
            layout: nextLayout,
            ...(nextSkins ? { agentSkins: nextSkins.skins } : {}),
          })
          .catch(() => undefined);
      }
    },
    [],
  );

  const activeAgentIds = useMemo(
    () =>
      new Set(
        bridge.agents
          .filter((a) => a.status !== "terminated" && a.status !== "pending_approval")
          .map((a) => a.id),
      ),
    [bridge.agents],
  );

  // Load or generate layout when company or active roster initializes, then sync server state if available
  useEffect(() => {
    if (!companyId || bridge.agentsLoading) return;
    let cancelled = false;
    const localSkins = loadAgentSkins(companyId);
    setAgentSkins(localSkins);

    const stored = loadOfficeLayout(companyId, activeAgentIds);
    let initialLayout: OfficeLayout;
    if (stored) {
      initialLayout = stored.layout;
      if (stored.repaired) {
        saveOfficeLayout(stored.layout);
      }
    } else {
      initialLayout = generateLayoutFromOrg(
        companyId,
        bridge.agents.map((a) => ({
          agentId: a.id,
          name: a.name,
          role: a.role,
          reportsTo: a.reportsTo,
          status: a.status,
        })),
      );
      saveOfficeLayout(initialLayout);
    }
    setLayout(initialLayout);

    void officeLayoutApi
      .get(companyId)
      .then((remote) => {
        if (cancelled || !remote) return;
        if (remote.layout) {
          const remoteTs = Date.parse(remote.layout.updatedAt ?? "");
          const localTs = Date.parse(initialLayout.updatedAt ?? "");
          if (!stored || (Number.isFinite(remoteTs) && (!Number.isFinite(localTs) || remoteTs > localTs))) {
            const sanitized = validateAndSanitizeLayout(remote.layout, companyId, activeAgentIds);
            if (sanitized) {
              saveOfficeLayout(sanitized.layout);
              setLayout(sanitized.layout);
            }
          }
        }
        if (remote.agentSkins && Object.keys(remote.agentSkins).length > 0 && Object.keys(localSkins.skins).length === 0) {
          const merged: AgentSkinMap = { companyId, skins: remote.agentSkins };
          saveAgentSkins(merged);
          setAgentSkins(merged);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [companyId, bridge.agentsLoading]);

  // Enforce desk invariants live when agents change status (e.g. terminated)
  useEffect(() => {
    if (!layout || !companyId || bridge.agentsLoading) return;
    const check = validateAndSanitizeLayout(layout, companyId, activeAgentIds);
    if (check && check.repaired) {
      setLayout(check.layout);
      persistLayout(check.layout);
    }
  }, [activeAgentIds, bridge.agentsLoading, companyId, layout, persistLayout]);

  // Navigation & interaction state
  const [activeBuildingId, setActiveBuildingId] = useState("");
  const [activeFloorId, setActiveFloorId] = useState("");
  const [cameraMode, setCameraMode] = useState<CameraControlMode>(() =>
    isTouchDevice ? "overview" : "rpg",
  );
  const [buildingViewMode, setBuildingViewMode] = useState<BuildingViewMode>("cutaway");
  const [playerPos, setPlayerPos] = useState({ x: 14.5, z: 3.5 });
  const [liveAgentPositions, setLiveAgentPositions] = useState<Record<string, LiveAgentPosition>>({});
  const [nearestStation, setNearestStation] = useState<InteractiveStation | null>(null);
  const [activeStation, setActiveStation] = useState<InteractiveStation | null>(null);
  const [isPip, setIsPip] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<HoveredAgentInfo | null>(null);
  const [projectedLabels, setProjectedLabels] = useState<ProjectedAgentLabel[]>([]);
  const [projectedMarkers, setProjectedMarkers] = useState<ProjectedMarker[]>([]);
  const [playerSeated, setPlayerSeated] = useState(false);
  const [nearestAgentId, setNearestAgentId] = useState<string | null>(null);
  const [hotbar, setHotbar] = useState<OfficeHotbarState>(() => createEmptyHotbar());
  const [hotbarFeedback, setHotbarFeedback] = useState<string | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [followedAgentId, setFollowedAgentId] = useState<string | null>(null);
  const [emoteBarOpen, setEmoteBarOpen] = useState(false);
  const [arcadeOpen, setArcadeOpen] = useState(false);
  const [inspectedIssueItem, setInspectedIssueItem] = useState<{
    issueId: string;
    identifier?: string;
    label: string;
  } | null>(null);
  const savedPlayerState = useMemo(
    () => (companyId ? loadOfficePlayerState(companyId) : null),
    [companyId],
  );
  const playerStateRestoredRef = useRef<string>("");
  const initialFloorSyncedRef = useRef<string>("");
  const latestSavedRef = useRef<{
    companyId: string;
    buildingId: string;
    floorId: string;
    cameraMode: "rpg" | "first_person" | "overview";
    buildingViewMode: BuildingViewMode;
  } | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  // Wardrobe & in-office drawer/modal state
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [wardrobeAgentId, setWardrobeAgentId] = useState<string | null>(null);
  const [hireModalState, setHireModalState] = useState<{
    open: boolean;
    floorId?: string;
    deskId?: string;
  }>({ open: false });
  const [chatDrawerAgentId, setChatDrawerAgentId] = useState<string | null>(null);
  const [playbookDrawerState, setPlaybookDrawerState] = useState<{
    open: boolean;
    agentId: string | null;
  }>({ open: false, agentId: null });
  const [teamChatDrawerOpen, setTeamChatDrawerOpen] = useState(false);
  const [teamChatTargetDmAgentId, setTeamChatTargetDmAgentId] = useState<string | null>(null);
  const [unreadTeamChatCount, setUnreadTeamChatCount] = useState(0);

  useCompanyLiveEvent((event) => {
    if (!selectedCompanyId || event.type !== "activity.logged") return;
    const payload = event.payload as Record<string, unknown> | undefined;
    if (payload?.action !== "team_chat.message_posted") return;
    const details =
      payload.details && typeof payload.details === "object"
        ? (payload.details as Record<string, unknown>)
        : null;
    const authorAgentId =
      typeof details?.authorAgentId === "string"
        ? details.authorAgentId
        : typeof payload.agentId === "string"
          ? payload.agentId
          : null;
    const bodyPreview = typeof details?.bodyPreview === "string" ? details.bodyPreview : null;
    if (authorAgentId && bodyPreview) {
      engineRef.current?.showAgentSpeechBubble(authorAgentId, bodyPreview, 9000);
    }
    if (!teamChatDrawerOpen && authorAgentId) {
      setUnreadTeamChatCount((prev) => prev + 1);
    }
  });

  // Build Mode state
  const [buildDraft, setBuildDraft] = useState<OfficeLayout | null>(null);
  const [undoStack, setUndoStack] = useState<OfficeLayout[]>([]);
  const [redoStack, setRedoStack] = useState<OfficeLayout[]>([]);
  const [buildTool, setBuildTool] = useState<BuildTool>("select");
  const [buildPlaceableKind, setBuildPlaceableKind] = useState<BuildPlaceableKind>("desk");
  const [buildPlacementRotation, setBuildPlacementRotation] = useState<GridRotation>(0);
  const [selectedBuildTarget, setSelectedBuildTarget] = useState<{
    kind: "room" | "desk" | "furniture";
    id: string;
  } | null>(null);
  const [movingBuildTarget, setMovingBuildTarget] = useState<{
    kind: "room" | "desk" | "furniture";
    id: string;
  } | null>(null);
  const [movingRotation, setMovingRotation] = useState<GridRotation>(0);
  const [buildError, setBuildError] = useState<string | null>(null);

  const isBuildMode = buildDraft !== null;
  const effectiveLayout = buildDraft ?? layout;

  const activeBuilding = useMemo(() => {
    if (!effectiveLayout) return null;
    return (
      effectiveLayout.buildings.find((b) => b.id === activeBuildingId) ??
      effectiveLayout.buildings[0] ??
      null
    );
  }, [activeBuildingId, effectiveLayout]);

  const activeFloor = useMemo(() => {
    if (!activeBuilding) return null;
    return (
      activeBuilding.floors.find((f) => f.id === activeFloorId) ??
      activeBuilding.floors[0] ??
      null
    );
  }, [activeBuilding, activeFloorId]);

  const activeFloorIndex = useMemo(() => {
    if (!activeBuilding || !activeFloor) return 0;
    const idx = activeBuilding.floors.findIndex((f) => f.id === activeFloor.id);
    return idx >= 0 ? idx : 0;
  }, [activeBuilding, activeFloor]);

  // Keep active building/floor IDs synced + restore saved player floor/camera state
  useEffect(() => {
    if (!effectiveLayout || !companyId) return;
    const deepLinked = Boolean(searchParams.get("agent") || searchParams.get("floor"));
    if (playerStateRestoredRef.current !== companyId) {
      playerStateRestoredRef.current = companyId;
      if (!deepLinked && savedPlayerState) {
        const b = effectiveLayout.buildings.find((x) => x.id === savedPlayerState.buildingId);
        const fl = b?.floors.find((x) => x.id === savedPlayerState.floorId);
        if (!isTouchDevice) {
          setCameraMode(savedPlayerState.cameraMode);
        }
        setBuildingViewMode(savedPlayerState.buildingViewMode);
        setPlayerPos({ x: savedPlayerState.x, z: savedPlayerState.z });
        if (b && fl && (b.id !== activeBuilding?.id || fl.id !== activeFloor?.id)) {
          setActiveBuildingId(b.id);
          setActiveFloorId(fl.id);
          return;
        }
      }
      initialFloorSyncedRef.current = companyId;
    } else if (initialFloorSyncedRef.current !== companyId) {
      initialFloorSyncedRef.current = companyId;
    }
    if (activeBuilding && activeBuilding.id !== activeBuildingId) {
      setActiveBuildingId(activeBuilding.id);
    }
    if (activeFloor && activeFloor.id !== activeFloorId) {
      setActiveFloorId(activeFloor.id);
    }
  }, [
    activeBuilding,
    activeBuildingId,
    activeFloor,
    activeFloorId,
    companyId,
    effectiveLayout,
    isTouchDevice,
    savedPlayerState,
    searchParams,
  ]);

  const displayedAgentsById =
    replayOpen && replaySample ? replaySample.agentsById : bridge.summary.agentsById;

  const performanceKpiQuery = useQuery({
    queryKey: companyId ? queryKeys.performance.company(companyId, "30d") : ["performance", "none"],
    queryFn: () => performanceApi.getCompanyPerformance(companyId, "30d"),
    enabled: Boolean(companyId),
  });

  const kpiSnapshot = useMemo<OfficeKpiSnapshot>(() => {
    let doneIssues = 0;
    let activeIssues = 0;
    for (const iss of bridge.issues) {
      if (iss.status === "done") doneIssues += 1;
      else if (iss.status !== "cancelled") activeIssues += 1;
    }
    const agentList = Object.values(displayedAgentsById).filter((a) => a.visualState !== "hidden");
    const runningAgents = agentList.filter(
      (a) => a.visualState === "coding" || a.visualState === "thinking",
    ).length;
    const costTodayCents = agentList.reduce((acc, a) => acc + (a.costTodayCents ?? 0), 0);

    const perfRows = (performanceKpiQuery.data?.agents ?? []).filter(
      (row) => row.performanceScore !== null || row.tasksDone > 0,
    );
    perfRows.sort((a, b) => {
      const sa = a.performanceScore ?? -1;
      const sb = b.performanceScore ?? -1;
      if (sb !== sa) return sb - sa;
      if (b.tasksDone !== a.tasksDone) return b.tasksDone - a.tasksDone;
      return a.name.localeCompare(b.name);
    });
    const topPerf = perfRows[0] ?? null;
    const activeCodingLead = agentList.find((a) => a.visualState === "coding") ?? null;

    return {
      doneIssues,
      activeIssues,
      runningAgents,
      totalAgents: agentList.length,
      costTodayCents,
      topAgentName: topPerf?.name ?? activeCodingLead?.name ?? null,
      topAgentScore: topPerf?.performanceScore ?? null,
    };
  }, [bridge.issues, displayedAgentsById, performanceKpiQuery.data?.agents]);

  const displayedSummary = useMemo(
    () =>
      displayedAgentsById === bridge.summary.agentsById
        ? bridge.summary
        : { ...bridge.summary, agentsById: displayedAgentsById },
    [bridge.summary, displayedAgentsById],
  );

  const goalCompletionRatio = useMemo(() => {
    const activeGoals = bridge.goals.filter((g) => g.status !== "cancelled");
    if (activeGoals.length === 0) return 0.5;
    const achieved = activeGoals.filter((g) => g.status === "achieved").length;
    return achieved / activeGoals.length;
  }, [bridge.goals]);

  const activeFloorStations = useMemo(
    () =>
      activeFloor
        ? buildInteractiveStations(activeFloor, displayedSummary, Math.max(0, activeFloorIndex))
        : [],
    [activeFloor, activeFloorIndex, displayedSummary],
  );

  const seatedElsewhereAgentIds = useMemo(
    () =>
      effectiveLayout && activeFloor
        ? getAgentIdsSeatedOnOtherFloors(effectiveLayout, activeFloor.id)
        : new Set<string>(),
    [effectiveLayout, activeFloor],
  );

  // Refs for Three.js engine callbacks
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportFocusRef = useRef<HTMLDivElement | null>(null);

  const handleCaptureScreenshot = useCallback(() => {
    const dataUrl = engineRef.current?.captureScreenshot();
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `office-3d-${selectedCompany?.issuePrefix ?? "snapshot"}.png`;
    link.click();
  }, [selectedCompany?.issuePrefix]);

  const showHotbarFeedback = useCallback((message: string) => {
    setHotbarFeedback(message);
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      setHotbarFeedback(null);
      feedbackTimerRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    setHotbar(loadOfficeHotbar(companyId));
  }, [companyId]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const selectedHotbarItem = useMemo(() => getSelectedHotbarItem(hotbar), [hotbar]);
  useEffect(() => {
    engineRef.current?.setPlayerHeldItem(selectedHotbarItem?.kind ?? null);
  }, [selectedHotbarItem?.kind, webglSupported]);

  const giveTargetAgentId = useMemo(
    () =>
      nearestAgentId ??
      (nearestStation?.kind === "agent_desk" ? (nearestStation.targetEntityId ?? null) : null),
    [nearestAgentId, nearestStation],
  );
  const giveTargetAgentSnapshot = giveTargetAgentId ? displayedAgentsById[giveTargetAgentId] ?? null : null;
  const canGiveToAgent = Boolean(selectedHotbarItem && giveTargetAgentSnapshot);

  const handleOpenHireModal = useCallback((options?: { floorId?: string; deskId?: string }) => {
    engineRef.current?.clearPressedKeys();
    setActiveStation(null);
    setHireModalState({ open: true, floorId: options?.floorId, deskId: options?.deskId });
  }, []);

  const handleOpenChatDrawer = useCallback((agentId: string) => {
    engineRef.current?.clearPressedKeys();
    setActiveStation(null);
    setPlaybookDrawerState({ open: false, agentId: null });
    setTeamChatDrawerOpen(false);
    setChatDrawerAgentId(agentId);
  }, []);

  const handleOpenPlaybookDrawer = useCallback((agentId?: string) => {
    engineRef.current?.clearPressedKeys();
    setActiveStation(null);
    setChatDrawerAgentId(null);
    setTeamChatDrawerOpen(false);
    setPlaybookDrawerState({ open: true, agentId: agentId ?? null });
  }, []);

  const handleToggleTeamChatDrawer = useCallback(() => {
    engineRef.current?.clearPressedKeys();
    setActiveStation(null);
    setChatDrawerAgentId(null);
    setPlaybookDrawerState({ open: false, agentId: null });
    setTeamChatDrawerOpen((prev) => {
      const next = !prev;
      if (next) setUnreadTeamChatCount(0);
      return next;
    });
  }, []);

  const handleAgentHired = useCallback(
    async (res: OfficeHireResult) => {
      if (!companyId) return;
      queryClient.setQueryData<Agent[]>(queryKeys.agents.list(companyId), (old) =>
        old
          ? old.some((a) => a.id === res.agent.id)
            ? old
            : [...old, res.agent]
          : [res.agent],
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(companyId, "pending") });

      if (res.approvalPending) {
        pushToast?.({
          title: ot("office3d.hire.successApproval", { name: res.agent.name }),
          tone: "info",
        });
        return;
      }

      const canEdit = bridge.summary.allowedActions.includes("edit_layout");
      if (layout && canEdit && res.targetFloorId && (res.targetDeskId || res.autoPlaceDesk)) {
        const next = cloneLayout(layout);
        const building = next.buildings.find((b) =>
          b.floors.some((f) => f.id === res.targetFloorId),
        );
        const floor = building?.floors.find((f) => f.id === res.targetFloorId);
        if (building && floor) {
          for (const b of next.buildings) {
            for (const f of b.floors) {
              for (const d of f.desks) {
                if (d.assignedAgentId === res.agent.id) d.assignedAgentId = null;
              }
            }
          }
          let seatedFloor = floor;
          if (res.targetDeskId) {
            const desk = floor.desks.find((d) => d.id === res.targetDeskId);
            if (desk) desk.assignedAgentId = res.agent.id;
          } else if (res.autoPlaceDesk) {
            const existingAgentContexts = bridge.agents
              .filter((a) => a.status !== "terminated")
              .map((a) => ({
                id: a.id,
                role: a.role,
                reportsTo: a.reportsTo,
              }));
            const placed = autoPlaceDeskInBuilding(
              building,
              floor.id,
              {
                id: res.agent.id,
                role: res.agent.role,
                reportsTo: res.agent.reportsTo,
              },
              existingAgentContexts,
            );
            seatedFloor =
              building.floors.find((f) => f.id === placed.floorId) ?? floor;
          }
          next.updatedAt = new Date().toISOString();
          setLayout(next);
          persistLayout(next);
          setActiveBuildingId(building.id);
          setActiveFloorId(seatedFloor.id);
          pushToast?.({
            title: ot("office3d.hire.successSeated", {
              name: res.agent.name,
              floor: seatedFloor.name,
            }),
            tone: "info",
          });
          return;
        }
      }

      pushToast?.({
        title: ot("office3d.hire.successSeated", {
          name: res.agent.name,
          floor: activeFloor?.name ?? "Office",
        }),
        tone: "info",
      });
    },
    [
      activeFloor?.name,
      bridge.summary.allowedActions,
      companyId,
      layout,
      ot,
      persistLayout,
      pushToast,
      queryClient,
    ],
  );

  const handleSelectHotbarSlot = useCallback(
    (slotIndex: number) => {
      setHotbar((prev) => {
        const next = selectHotbarSlot(prev, slotIndex);
        saveOfficeHotbar(companyId, next);
        return next;
      });
    },
    [companyId],
  );

  const handleSwapHotbarSlots = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      setHotbar((prev) => {
        const next = swapHotbarSlots(prev, fromIndex, toIndex);
        saveOfficeHotbar(companyId, next);
        return next;
      });
      showHotbarFeedback(ot("office3d.hotbar.swappedSlot", { slot: toIndex + 1 }));
    },
    [companyId, ot, showHotbarFeedback],
  );

  const handleToggleMinimap = useCallback(() => {
    setShowMinimap((prev) => {
      const next = !prev;
      saveShowMinimap(companyId, next);
      return next;
    });
  }, [companyId]);

  const handleTakeItem = useCallback(
    (
      kind: OfficeItemKind,
      label: string,
      sourceStationId?: string,
      meta?: TakeItemMeta,
    ) => {
      setHotbar((prev) => {
        const res = addItemToHotbar(prev, {
          id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind,
          label,
          sourceStationId,
          ...(meta?.entityKind ? { entityKind: meta.entityKind } : {}),
          ...(meta?.entityId ? { entityId: meta.entityId } : {}),
          ...(meta?.entityIdentifier ? { entityIdentifier: meta.entityIdentifier } : {}),
        });
        if (res.full || res.addedSlot === null) {
          showHotbarFeedback(ot("office3d.hotbar.slotFull"));
          return prev;
        }
        saveOfficeHotbar(companyId, res.next);
        audioRef.current?.playApprovalStamp();
        showHotbarFeedback(
          ot("office3d.hotbar.pickedUp", { label, slot: res.addedSlot + 1 }),
        );
        return res.next;
      });
    },
    [companyId, ot, showHotbarFeedback],
  );

  const handleDropHotbarItem = useCallback(() => {
    if (!getSelectedHotbarItem(hotbar)) return;
    setHotbar((prev) => {
      const next = removeHotbarSlot(prev, prev.selectedSlot);
      saveOfficeHotbar(companyId, next);
      return next;
    });
  }, [companyId, hotbar]);

  const handleUseHotbarItem = useCallback(() => {
    const current = getSelectedHotbarItem(hotbar);
    if (!current) {
      if (nearestStation?.kind === "water_cooler") {
        handleTakeItem("water_cup", ot("office3d.item.water_cup"), nearestStation.id);
      } else if (nearestStation?.kind === "coffee_machine" || nearestStation?.kind === "vending_machine") {
        handleTakeItem("coffee_cup", ot("office3d.item.coffee_cup"), nearestStation.id);
      } else if (nearestStation?.kind === "bookshelf") {
        handleTakeItem("handbook", ot("office3d.item.handbook"), nearestStation.id);
      } else if (nearestStation?.kind === "printer" || nearestStation?.kind === "filing_cabinet") {
        handleTakeItem("document", ot("office3d.item.document"), nearestStation.id);
      }
      return;
    }

    if (giveTargetAgentId && displayedAgentsById[giveTargetAgentId]) {
      const targetAgent = displayedAgentsById[giveTargetAgentId]!;
      if (current.kind === "document") {
        if (!bridge.summary.allowedActions.includes("assign_issue")) {
          showHotbarFeedback(ot("office3d.hotbar.assignDenied"));
          return;
        }
        if (current.entityKind === "issue" && current.entityId) {
          const slotToConsume = hotbar.selectedSlot;
          engineRef.current?.triggerPlayerActionPose("giving", 900, {
            transientItemKind: current.kind,
          });
          bridge.assignIssueToAgent.mutate(
            { issueId: current.entityId, agentId: targetAgent.agentId },
            {
              onSuccess: () => {
                engineRef.current?.triggerAgentGiftReaction(
                  giveTargetAgentId,
                  ot("office3d.hotbar.agentAssignedDoc", { label: current.label }),
                  "reading",
                  current.kind,
                );
                setHotbar((prev) => {
                  const next = removeHotbarSlot(prev, slotToConsume);
                  saveOfficeHotbar(companyId, next);
                  return next;
                });
                audioRef.current?.playTaskCompleted();
                showHotbarFeedback(
                  ot("office3d.hotbar.assignedIssue", {
                    label: current.label,
                    name: targetAgent.name,
                  }),
                );
              },
              onError: () => {
                showHotbarFeedback(ot("office3d.hotbar.assignFailed"));
              },
            },
          );
          return;
        }

        // Unbound blank document opens In-Office Assign Task dialog for target agent
        engineRef.current?.triggerPlayerActionPose("giving", 900, {
          transientItemKind: current.kind,
        });
        setHotbar((prev) => {
          const next = removeHotbarSlot(prev, prev.selectedSlot);
          saveOfficeHotbar(companyId, next);
          return next;
        });
        engineRef.current?.clearPressedKeys();
        openNewIssue({ assigneeAgentId: targetAgent.agentId });
        return;
      }

      const isDrink = current.kind === "water_cup" || current.kind === "coffee_cup";
      engineRef.current?.triggerAgentGiftReaction(
        giveTargetAgentId,
        isDrink
          ? ot("office3d.hotbar.agentThanks", { label: current.label })
          : ot("office3d.hotbar.agentReceivedDoc", { label: current.label }),
        isDrink ? "drinking" : "reading",
        current.kind,
      );
      engineRef.current?.triggerPlayerActionPose("giving", 900, {
        transientItemKind: current.kind,
      });
      setHotbar((prev) => {
        const next = removeHotbarSlot(prev, prev.selectedSlot);
        saveOfficeHotbar(companyId, next);
        return next;
      });
      audioRef.current?.playTaskCompleted();
      showHotbarFeedback(
        ot("office3d.hotbar.gaveItem", { label: current.label, name: targetAgent.name }),
      );
      return;
    }

    if (current.kind === "water_cup" || current.kind === "coffee_cup") {
      engineRef.current?.triggerPlayerActionPose("drinking", 2200, {
        transientItemKind: current.kind,
      });
      setHotbar((prev) => {
        const next = removeHotbarSlot(prev, prev.selectedSlot);
        saveOfficeHotbar(companyId, next);
        return next;
      });
      audioRef.current?.playApprovalStamp();
      showHotbarFeedback(ot("office3d.hotbar.drank", { label: current.label }));
    } else if (current.kind === "handbook") {
      engineRef.current?.triggerPlayerActionPose("reading", 2600);
      engineRef.current?.exitPointerLock();
      handleOpenPlaybookDrawer(current.entityKind === "agent" ? current.entityId : undefined);
      showHotbarFeedback(ot("office3d.hotbar.readItem", { label: current.label }));
    } else if (current.kind === "document" && current.entityKind === "issue" && current.entityId) {
      engineRef.current?.triggerPlayerActionPose("reading", 2400);
      engineRef.current?.clearPressedKeys();
      engineRef.current?.exitPointerLock();
      setInspectedIssueItem({
        issueId: current.entityId,
        identifier: current.entityIdentifier,
        label: current.label,
      });
    } else {
      engineRef.current?.triggerPlayerActionPose("reading", 2600);
      showHotbarFeedback(ot("office3d.hotbar.readItem", { label: current.label }));
    }
  }, [
    bridge.assignIssueToAgent,
    bridge.summary.allowedActions,
    companyId,
    displayedAgentsById,
    giveTargetAgentId,
    handleOpenPlaybookDrawer,
    handleTakeItem,
    hotbar,
    nearestStation,
    openNewIssue,
    ot,
    showHotbarFeedback,
  ]);

  const handleInteractStation = useCallback(
    (station: InteractiveStation) => {
      if (playerSeated) {
        engineRef.current?.standUpPlayer();
        return;
      }
      switch (station.kind) {
        case "sofa":
        case "empty_chair":
        case "outdoor_bench":
          engineRef.current?.togglePlayerSit(station);
          return;
        case "meeting_table":
          setMeetingActive((prev) => {
            const next = !prev;
            setTeamChatDrawerOpen(next);
            showHotbarFeedback(
              ot(next ? "office3d.hotbar.meetingStarted" : "office3d.hotbar.meetingEnded"),
            );
            return next;
          });
          return;
        case "water_cooler":
          engineRef.current?.triggerPlayerActionPose("inspecting", 750, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          handleTakeItem("water_cup", ot("office3d.item.water_cup"), station.id);
          return;
        case "coffee_machine":
          engineRef.current?.triggerPlayerActionPose("inspecting", 750, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          handleTakeItem("coffee_cup", ot("office3d.item.coffee_cup"), station.id);
          return;
        case "plant":
          engineRef.current?.triggerPlayerActionPose("inspecting", 1600, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          audioRef.current?.playApprovalStamp();
          showHotbarFeedback(ot("office3d.hotbar.wateredPlant"));
          return;
        case "aquarium":
          engineRef.current?.triggerPlayerActionPose("inspecting", 1800, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          audioRef.current?.playApprovalStamp();
          showHotbarFeedback(ot("office3d.hotbar.admiredAquarium"));
          return;
        case "arcade_machine":
          engineRef.current?.triggerPlayerActionPose("playing_arcade", 2200, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          engineRef.current?.clearPressedKeys();
          engineRef.current?.exitPointerLock();
          setArcadeOpen(true);
          audioRef.current?.playTaskCompleted();
          showHotbarFeedback(ot("office3d.hotbar.playedArcade"));
          return;
        case "floor_lamp":
          engineRef.current?.triggerPlayerActionPose("inspecting", 900, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          showHotbarFeedback(ot("office3d.hotbar.toggledLamp"));
          return;
        case "lounge_table":
          engineRef.current?.triggerPlayerActionPose("reading", 1200, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          showHotbarFeedback(ot("office3d.hotbar.browsedTable"));
          return;
        case "vending_machine":
          engineRef.current?.triggerPlayerActionPose("inspecting", 900, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          handleTakeItem("coffee_cup", ot("office3d.item.coffee_cup"), station.id);
          return;
        case "outdoor_sakura_tree":
        case "outdoor_oak_tree":
        case "outdoor_pine_tree":
        case "outdoor_flower_bed":
          engineRef.current?.triggerPlayerActionPose("inspecting", 1400, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          audioRef.current?.playApprovalStamp();
          showHotbarFeedback(ot("office3d.hotbar.admiredNature"));
          return;
        case "outdoor_lamp":
          engineRef.current?.triggerPlayerActionPose("inspecting", 900, {
            faceTarget: { x: station.cell[0] + 0.5, z: station.cell[1] + 0.5 },
          });
          showHotbarFeedback(ot("office3d.hotbar.checkedOutdoorLamp"));
          return;
        case "outdoor_dog":
        case "outdoor_cat":
        case "outdoor_rabbit":
        case "outdoor_koi_pond":
        case "outdoor_fountain": {
          const res = engineRef.current?.interactOutdoor(station.id);
          if (!res) return;
          if (res.feedbackKind === "pet_dog_follow" || res.feedbackKind === "toss_coin") {
            audioRef.current?.playTaskCompleted();
          } else {
            audioRef.current?.playApprovalStamp();
          }
          if (res.feedbackKind === "pet_dog_follow") {
            showHotbarFeedback(ot("office3d.outdoor.petDogFollow", { name: res.label }));
          } else if (res.feedbackKind === "pet_dog_stay") {
            showHotbarFeedback(ot("office3d.outdoor.petDogStay", { name: res.label }));
          } else if (res.feedbackKind === "pet_cat") {
            showHotbarFeedback(ot("office3d.outdoor.petCat", { name: res.label }));
          } else if (res.feedbackKind === "pet_rabbit") {
            showHotbarFeedback(ot("office3d.outdoor.petRabbit", { name: res.label }));
          } else if (res.feedbackKind === "feed_koi") {
            showHotbarFeedback(ot("office3d.outdoor.feedKoi"));
          } else {
            showHotbarFeedback(ot("office3d.outdoor.tossCoin"));
          }
          return;
        }
        default:
          engineRef.current?.clearPressedKeys();
          setActiveStation(station);
      }
    },
    [handleTakeItem, ot, playerSeated, showHotbarFeedback],
  );

  const interactStationRef = useRef(handleInteractStation);
  interactStationRef.current = handleInteractStation;

  const handleExportLayoutBlueprint = useCallback(
    (source: OfficeLayout | null) => {
      if (!source) return;
      const payload = createBlueprintExport(source, selectedCompany?.name ?? "Company");
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `office-blueprint-${selectedCompany?.issuePrefix ?? "office"}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    [selectedCompany?.issuePrefix, selectedCompany?.name],
  );

  const pushBuildDraft = useCallback((next: OfficeLayout) => {
    setBuildDraft((prev) => {
      if (prev) {
        setUndoStack((u) => [...u.slice(-(BUILD_UNDO_HISTORY_LIMIT - 1)), prev]);
        setRedoStack([]);
      }
      return next;
    });
    setBuildError(null);
  }, []);

  const handleTeleportToCell = useCallback((cell: [number, number]) => {
    engineRef.current?.teleportToCell(cell, cameraMode === "rpg");
  }, [cameraMode]);

  const handleFollowAgent = useCallback(
    (agentId: string | null) => {
      setFollowedAgentId(agentId);
      engineRef.current?.setFollowAgent(agentId);
      if (agentId) {
        if (cameraMode === "first_person" && !isTouchDevice) {
          setCameraMode("rpg");
        }
        if (effectiveLayout) {
          const loc = findAgentDeskLocation(effectiveLayout, agentId);
          if (loc && (loc.buildingId !== activeBuildingId || loc.floorId !== activeFloorId)) {
            setActiveBuildingId(loc.buildingId);
            setActiveFloorId(loc.floorId);
          }
        }
      }
    },
    [activeBuildingId, activeFloorId, cameraMode, effectiveLayout, isTouchDevice],
  );

  const handleTriggerEmote = useCallback(
    (emote: "waving" | "celebrating" | "clapping" | "stretching") => {
      engineRef.current?.triggerPlayerEmote(emote);
      setEmoteBarOpen(false);
    },
    [],
  );

  const handleTeleportToAgent = useCallback(
    (agentId: string) => {
      if (!effectiveLayout) return;
      const loc = findAgentDeskLocation(effectiveLayout, agentId);
      if (!loc) {
        const hr = activeFloor?.furniture.find((f) => f.kind === "hr_reception");
        if (hr) engineRef.current?.teleportToCell([hr.x, hr.z], cameraMode === "rpg");
        return;
      }
      setActiveBuildingId(loc.buildingId);
      setActiveFloorId(loc.floorId);
      window.setTimeout(() => {
        engineRef.current?.teleportToCell(loc.cell, cameraMode === "rpg");
      }, 40);
    },
    [activeFloor, cameraMode, effectiveLayout],
  );

  // Handle deep-link query parameters ?agent=...&floor=...
  useEffect(() => {
    if (!effectiveLayout) return;
    const targetAgent = searchParams.get("agent");
    const targetFloor = searchParams.get("floor");
    if (targetFloor) {
      for (const b of effectiveLayout.buildings) {
        if (b.floors.some((f) => f.id === targetFloor)) {
          setActiveBuildingId(b.id);
          setActiveFloorId(targetFloor);
          break;
        }
      }
    }
    if (targetAgent) {
      handleTeleportToAgent(targetAgent);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("agent");
          next.delete("floor");
          return next;
        },
        { replace: true },
      );
    }
  }, [effectiveLayout, handleTeleportToAgent, searchParams, setSearchParams]);

  // Build Mode callbacks wired through refs so SceneEngine stays stable
  const buildHandlersRef = useRef({
    onCellClick: (_x: number, _z: number) => {},
    onRoomDrag: (_bounds: { minX: number; minZ: number; maxX: number; maxZ: number }) => {},
    onSelectEntity: (_target: { kind: "room" | "desk" | "furniture"; id: string } | null) => {},
  });

  const updateCurrentFloorInDraft = useCallback(
    (updater: (floor: FloorConfig) => FloorConfig | null) => {
      if (!buildDraft || !activeBuilding || !activeFloor) return;
      const next = cloneLayout(buildDraft);
      const b = next.buildings.find((item) => item.id === activeBuilding.id);
      if (!b) return;
      const fIdx = b.floors.findIndex((item) => item.id === activeFloor.id);
      if (fIdx === -1) return;
      const updated = updater(b.floors[fIdx]!);
      if (!updated) return;
      b.floors[fIdx] = updated;
      next.updatedAt = new Date().toISOString();
      pushBuildDraft(next);
    },
    [activeBuilding, activeFloor, buildDraft, pushBuildDraft],
  );

  buildHandlersRef.current.onSelectEntity = (target) => {
    setSelectedBuildTarget(target);
    setBuildError(null);
    if (buildTool === "move") {
      setMovingBuildTarget(target);
      if (target && activeFloor) {
        if (target.kind === "desk") {
          const d = activeFloor.desks.find((item) => item.id === target.id);
          setMovingRotation(d?.rotation ?? 0);
        } else if (target.kind === "furniture") {
          const f = activeFloor.furniture.find((item) => item.id === target.id);
          setMovingRotation(f?.rotation ?? 0);
        } else {
          setMovingRotation(0);
        }
      }
    }
  };

  buildHandlersRef.current.onRoomDrag = (bounds) => {
    if (!activeFloor) return;
    const midZ = Math.floor((bounds.minZ + bounds.maxZ) / 2);
    const candidate: RoomConfig = {
      id: `room-${Date.now()}`,
      name: `Room ${activeFloor.rooms.length + 1}`,
      floorPalette: "slate",
      wallStyle: "glass",
      bounds,
      doors: [{ x: bounds.maxX, z: midZ }],
    };
    const check = validateRoom(candidate, activeFloor.rooms, activeFloor.gridSize);
    if (!check.valid) {
      const msgKey =
        check.reason === "overlaps"
          ? "office3d.build.errOverlap"
          : check.reason === "too_small"
            ? "office3d.build.errTooSmall"
            : check.reason === "out_of_bounds"
              ? "office3d.build.errOutOfBounds"
              : "office3d.build.errMissingDoor";
      setBuildError(ot(msgKey));
      return;
    }
    updateCurrentFloorInDraft((floor) => ({
      ...floor,
      rooms: [...floor.rooms, candidate],
    }));
    setSelectedBuildTarget({ kind: "room", id: candidate.id });
  };

  buildHandlersRef.current.onCellClick = (cx, cz) => {
    if (!activeFloor) return;

    if (buildTool === "move" && movingBuildTarget) {
      const res =
        movingBuildTarget.kind === "desk"
          ? moveDeskToCell(activeFloor, movingBuildTarget.id, cx, cz, movingRotation)
          : movingBuildTarget.kind === "furniture"
            ? moveFurnitureToCell(activeFloor, movingBuildTarget.id, cx, cz, movingRotation, activeFloorIndex)
            : moveRoomToCell(activeFloor, movingBuildTarget.id, cx, cz);

      if (!res.valid) {
        if (res.reason === "occupied") {
          setBuildError(ot("office3d.build.errOccupied"));
        } else if (res.reason === "overlaps") {
          setBuildError(ot("office3d.build.errOverlap"));
        } else if (res.reason === "out_of_bounds") {
          setBuildError(ot("office3d.build.errOutOfBounds"));
        }
        return;
      }
      updateCurrentFloorInDraft(() => res.floor);
      setSelectedBuildTarget(movingBuildTarget);
      setMovingBuildTarget(null);
      return;
    }

    if (buildTool === "furniture") {
      if (buildPlaceableKind === "door") {
        const targetRoom = activeFloor.rooms.find((r) => isCellOnRoomBoundary(r.bounds, { x: cx, z: cz }));
        if (!targetRoom) {
          setBuildError(ot("office3d.build.errDoorWall"));
          return;
        }
        const exists = targetRoom.doors.some((d) => d.x === cx && d.z === cz);
        if (exists && targetRoom.doors.length <= 1) {
          setBuildError(ot("office3d.build.errMissingDoor"));
          return;
        }
        updateCurrentFloorInDraft((floor) => ({
          ...floor,
          rooms: floor.rooms.map((r) =>
            r.id !== targetRoom.id
              ? r
              : {
                  ...r,
                  doors: exists
                    ? r.doors.filter((d) => !(d.x === cx && d.z === cz))
                    : [...r.doors, { x: cx, z: cz }],
                },
          ),
        }));
        return;
      }

      const allowOutdoorPlace =
        buildPlaceableKind !== "desk" &&
        OUTDOOR_FURNITURE_KINDS.has(buildPlaceableKind);
      if (
        isBuildCellOccupied(activeFloor, cx, cz, undefined, {
          allowOutdoor: allowOutdoorPlace,
          floorIndex: activeFloorIndex,
        })
      ) {
        setBuildError(ot("office3d.build.errOccupied"));
        return;
      }

      const roomId = findContainingRoomId(activeFloor, cx, cz);
      if (buildPlaceableKind === "desk") {
        const deskId = `desk-${Date.now()}`;
        updateCurrentFloorInDraft((floor) => ({
          ...floor,
          desks: [
            ...floor.desks,
            {
              id: deskId,
              x: cx,
              z: cz,
              rotation: buildPlacementRotation,
              roomId,
              assignedAgentId: null,
            },
          ],
        }));
        setSelectedBuildTarget({ kind: "desk", id: deskId });
        return;
      }

      const furnId = `furn-${Date.now()}`;
      updateCurrentFloorInDraft((floor) => ({
        ...floor,
        furniture: [
          ...floor.furniture,
          {
            id: furnId,
            kind: buildPlaceableKind,
            x: cx,
            z: cz,
            rotation: buildPlacementRotation,
            roomId,
          },
        ],
      }));
      setSelectedBuildTarget({ kind: "furniture", id: furnId });
      return;
    }

    if (buildTool === "delete") {
      updateCurrentFloorInDraft((floor) => {
        const deskHit = floor.desks.find((d) => d.x === cx && d.z === cz);
        if (deskHit) {
          return { ...floor, desks: floor.desks.filter((d) => d.id !== deskHit.id) };
        }
        const furnHit = floor.furniture.find((f) => f.x === cx && f.z === cz);
        if (furnHit) {
          return { ...floor, furniture: floor.furniture.filter((f) => f.id !== furnHit.id) };
        }
        const roomHit = floor.rooms.find(
          (r) =>
            cx >= r.bounds.minX &&
            cx <= r.bounds.maxX &&
            cz >= r.bounds.minZ &&
            cz <= r.bounds.maxZ,
        );
        if (roomHit) {
          return {
            ...floor,
            rooms: floor.rooms.filter((r) => r.id !== roomHit.id),
            desks: floor.desks.map((d) => (d.roomId === roomHit.id ? { ...d, roomId: null } : d)),
            furniture: floor.furniture.map((f) =>
              f.roomId === roomHit.id ? { ...f, roomId: null } : f,
            ),
          };
        }
        return null;
      });
      setSelectedBuildTarget(null);
      setMovingBuildTarget(null);
    }
  };

  // Mount Three.js engine once container and WebGL are ready
  useEffect(() => {
    if (!webglSupported || !containerRef.current) return;
    const engine = new OfficeSceneEngine({
      container: containerRef.current,
      playerSkin,
      environment,
      audio: audioRef.current!,
      agentSkinResolver: (agent) => deriveDefaultAgentSkin(agent.agentId, agent.role, agent.icon),
      callbacks: {
        onNearestStation: setNearestStation,
        onNearestAgent: setNearestAgentId,
        onPlayerSeatedChange: setPlayerSeated,
        onPointerLockChange: setPointerLocked,
        onFollowAgentChange: setFollowedAgentId,
        onSelectStation: (station) => interactStationRef.current(station),
        onHoverAgent: setHoveredAgent,
        onPlayerPosition: (x, z) => setPlayerPos({ x, z }),
        onProjectedOverlays: (labels, markers, agentPositions) => {
          setProjectedLabels(labels);
          setProjectedMarkers(markers);
          setLiveAgentPositions(agentPositions);
        },
        onBuildCellClick: (cx, cz) => buildHandlersRef.current.onCellClick(cx, cz),
        onBuildRoomDrag: (bounds) => buildHandlersRef.current.onRoomDrag(bounds),
        onBuildSelectEntity: (target) => buildHandlersRef.current.onSelectEntity(target),
      },
    });
    engineRef.current = engine;

    return () => {
      const latest = latestSavedRef.current;
      if (latest && initialFloorSyncedRef.current === latest.companyId) {
        const snap = engine.getPlayerSnapshot();
        saveOfficePlayerState(latest.companyId, {
          buildingId: latest.buildingId,
          floorId: latest.floorId,
          x: snap.x,
          z: snap.z,
          yaw: snap.yaw,
          fpYaw: snap.fpYaw,
          fpPitch: snap.fpPitch,
          cameraMode: latest.cameraMode,
          buildingViewMode: latest.buildingViewMode,
        });
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, [webglSupported]);

  const handleEnterBuildMode = useCallback(() => {
    if (!layout) return;
    setReplayOpen(false);
    setMeetingActive(false);
    setBuildDraft(cloneLayout(layout));
    setUndoStack([]);
    setRedoStack([]);
    setBuildTool("select");
    setBuildPlacementRotation(0);
    setSelectedBuildTarget(null);
    setMovingBuildTarget(null);
    setBuildError(null);
  }, [layout]);

  const handleBuildToolChange = useCallback((nextTool: BuildTool) => {
    setBuildTool(nextTool);
    if (nextTool !== "move") {
      setMovingBuildTarget(null);
    }
    setBuildError(null);
  }, []);

  const handleRotateBuild = useCallback(() => {
    if (buildTool === "furniture") {
      if (buildPlaceableKind !== "door") {
        setBuildPlacementRotation((r) => rotateGridRotation(r));
      }
      return;
    }
    if (buildTool === "move" && movingBuildTarget && movingBuildTarget.kind !== "room") {
      setMovingRotation((r) => rotateGridRotation(r));
      return;
    }
    if (selectedBuildTarget?.kind === "desk") {
      updateCurrentFloorInDraft((floor) => ({
        ...floor,
        desks: floor.desks.map((d) =>
          d.id === selectedBuildTarget.id ? { ...d, rotation: rotateGridRotation(d.rotation) } : d,
        ),
      }));
      return;
    }
    if (selectedBuildTarget?.kind === "furniture") {
      updateCurrentFloorInDraft((floor) => ({
        ...floor,
        furniture: floor.furniture.map((f) =>
          f.id === selectedBuildTarget.id
            ? { ...f, rotation: rotateGridRotation(f.rotation) }
            : f,
        ),
      }));
    }
  }, [
    buildPlaceableKind,
    buildTool,
    movingBuildTarget,
    selectedBuildTarget,
    updateCurrentFloorInDraft,
  ]);

  const handleStartMoveSelected = useCallback(() => {
    setBuildTool("move");
    setBuildError(null);
    if (selectedBuildTarget && activeFloor) {
      setMovingBuildTarget(selectedBuildTarget);
      if (selectedBuildTarget.kind === "desk") {
        const d = activeFloor.desks.find((item) => item.id === selectedBuildTarget.id);
        setMovingRotation(d?.rotation ?? 0);
      } else if (selectedBuildTarget.kind === "furniture") {
        const f = activeFloor.furniture.find((item) => item.id === selectedBuildTarget.id);
        setMovingRotation(f?.rotation ?? 0);
      } else {
        setMovingRotation(0);
      }
    } else {
      setMovingBuildTarget(null);
    }
  }, [activeFloor, selectedBuildTarget]);

  // Sync scene data & settings into engine
  useEffect(() => {
    if (!engineRef.current || !activeFloor) return;
    if (companyId && initialFloorSyncedRef.current !== companyId) return;
    const deepLinked = Boolean(searchParams.get("agent") || searchParams.get("floor"));
    engineRef.current.setSceneData({
      floor: activeFloor,
      floorIndex: activeFloorIndex,
      totalFloors: activeBuilding?.floors.length ?? 1,
      stations: activeFloorStations,
      agentsById: displayedAgentsById,
      seatedElsewhereAgentIds,
      agentSkins: agentSkins.skins,
      agentBehaviors: effectiveLayout?.agentBehaviors,
      goalCompletionRatio,
      trophyAgentIds: bridge.trophyAgentIds,
      initialPlayerState:
        !deepLinked && savedPlayerState
          ? {
              x: savedPlayerState.x,
              z: savedPlayerState.z,
              yaw: savedPlayerState.yaw,
              fpYaw: savedPlayerState.fpYaw,
              fpPitch: savedPlayerState.fpPitch,
            }
          : null,
    });
  }, [
    activeBuilding?.floors.length,
    activeFloor,
    activeFloorIndex,
    activeFloorStations,
    agentSkins.skins,
    bridge.trophyAgentIds,
    displayedAgentsById,
    effectiveLayout?.agentBehaviors,
    goalCompletionRatio,
    savedPlayerState,
    searchParams,
    seatedElsewhereAgentIds,
  ]);

  useEffect(() => {
    engineRef.current?.setKpiSnapshot(kpiSnapshot);
  }, [kpiSnapshot]);

  // Persist player coordinates, floor, and camera preferences across route navigation
  useEffect(() => {
    if (!companyId || !activeBuilding || !activeFloor) return;
    if (initialFloorSyncedRef.current !== companyId) return;
    const persistedCam =
      cameraMode === "first_person" || cameraMode === "overview" ? cameraMode : "rpg";
    latestSavedRef.current = {
      companyId,
      buildingId: activeBuilding.id,
      floorId: activeFloor.id,
      cameraMode: persistedCam,
      buildingViewMode,
    };
    const snap = engineRef.current?.getPlayerSnapshot();
    saveOfficePlayerState(companyId, {
      buildingId: activeBuilding.id,
      floorId: activeFloor.id,
      x: snap?.x ?? playerPos.x,
      z: snap?.z ?? playerPos.z,
      yaw: snap?.yaw ?? 0,
      ...(snap ? { fpYaw: snap.fpYaw, fpPitch: snap.fpPitch } : {}),
      cameraMode: persistedCam,
      buildingViewMode,
    });
  }, [activeBuilding, activeFloor, buildingViewMode, cameraMode, companyId, playerPos.x, playerPos.z]);

  useEffect(() => {
    engineRef.current?.setMeetingActive(meetingActive);
  }, [meetingActive]);

  useEffect(() => {
    engineRef.current?.setReplayActive(replayOpen);
  }, [replayOpen]);

  useEffect(() => {
    engineRef.current?.setMarkers(bridge.markers);
  }, [bridge.markers]);

  useEffect(() => {
    engineRef.current?.setEnvironmentConfig(environment);
  }, [environment]);

  useEffect(() => {
    engineRef.current?.setPlayerSkin(playerSkin);
  }, [playerSkin]);

  useEffect(() => {
    engineRef.current?.setPerformanceConfig(performanceMode, reducedMotion);
  }, [performanceMode, reducedMotion]);

  useEffect(() => {
    const mode: CameraControlMode = isPip
      ? "pip"
      : isBuildMode || isTouchDevice
        ? "overview"
        : cameraMode;
    engineRef.current?.setCameraMode(mode);
    engineRef.current?.setSizeInvalidated();
  }, [cameraMode, isBuildMode, isPip, isTouchDevice]);

  const effectiveBuildingView: BuildingViewMode =
    isBuildMode || isPip ? "cutaway" : buildingViewMode;

  useEffect(() => {
    engineRef.current?.setBuildingViewMode(effectiveBuildingView);
  }, [effectiveBuildingView]);

  const buildGhostPreview = useMemo<BuildGhostPreview | null>(() => {
    if (!isBuildMode) return null;
    if (buildTool === "furniture") {
      if (buildPlaceableKind === "desk") {
        return { kind: "desk", rotation: buildPlacementRotation };
      }
      if (buildPlaceableKind === "door") {
        return { kind: "door", rotation: 0 };
      }
      return {
        kind: "furniture",
        furnitureKind: buildPlaceableKind,
        rotation: buildPlacementRotation,
      };
    }
    if (buildTool === "move" && movingBuildTarget && activeFloor) {
      if (movingBuildTarget.kind === "desk") {
        return {
          kind: "desk",
          rotation: movingRotation,
          sourceEntityId: movingBuildTarget.id,
        };
      }
      if (movingBuildTarget.kind === "furniture") {
        const item = activeFloor.furniture.find((f) => f.id === movingBuildTarget.id);
        if (!item) return null;
        return {
          kind: "furniture",
          furnitureKind: item.kind,
          rotation: movingRotation,
          sourceEntityId: item.id,
        };
      }
      const room = activeFloor.rooms.find((r) => r.id === movingBuildTarget.id);
      if (!room) return null;
      return {
        kind: "room",
        rotation: 0,
        roomSize: {
          w: room.bounds.maxX - room.bounds.minX + 1,
          d: room.bounds.maxZ - room.bounds.minZ + 1,
        },
        sourceEntityId: room.id,
      };
    }
    return null;
  }, [
    activeFloor,
    buildPlaceableKind,
    buildPlacementRotation,
    buildTool,
    isBuildMode,
    movingBuildTarget,
    movingRotation,
  ]);

  useEffect(() => {
    engineRef.current?.setBuildMode({
      enabled: isBuildMode,
      tool: buildTool,
      selectedTarget: selectedBuildTarget,
      ghostPreview: buildGhostPreview,
    });
  }, [buildGhostPreview, buildTool, isBuildMode, selectedBuildTarget]);

  useEffect(() => {
    const anyOverlayOpen = Boolean(
      activeStation ||
        inspectedIssueItem ||
        arcadeOpen ||
        wardrobeOpen ||
        hireModalState.open ||
        chatDrawerAgentId ||
        playbookDrawerState.open ||
        teamChatDrawerOpen ||
        isBuildMode,
    );
    if (anyOverlayOpen) {
      engineRef.current?.exitPointerLock();
    }
  }, [
    activeStation,
    arcadeOpen,
    chatDrawerAgentId,
    hireModalState.open,
    inspectedIssueItem,
    isBuildMode,
    playbookDrawerState.open,
    teamChatDrawerOpen,
    wardrobeOpen,
  ]);

  // Keyboard handling & global shortcut isolation when canvas is focused
  const handleKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (activeStation || inspectedIssueItem || arcadeOpen || wardrobeOpen || hireModalState.open) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        if (emoteBarOpen) {
          setEmoteBarOpen(false);
          return;
        }
        if (followedAgentId) {
          handleFollowAgent(null);
          return;
        }
        if (chatDrawerAgentId) {
          setChatDrawerAgentId(null);
          return;
        }
        if (playbookDrawerState.open) {
          setPlaybookDrawerState({ open: false, agentId: null });
          return;
        }
        if (teamChatDrawerOpen) {
          setTeamChatDrawerOpen(false);
          return;
        }
      }

      const lower = e.key.toLowerCase();
      if (BLOCKED_GLOBAL_SHORTCUT_KEYS.has(lower) || e.key.startsWith("Arrow")) {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation?.();
      }

      if (lower === "e" && !isBuildMode) {
        if (playerSeated) {
          engineRef.current?.standUpPlayer();
          return;
        }
        if (nearestStation) {
          handleInteractStation(nearestStation);
          return;
        }
        const selectedItem = getSelectedHotbarItem(hotbar);
        if (
          selectedItem &&
          !canGiveToAgent &&
          ((selectedItem.kind === "document" &&
            selectedItem.entityKind === "issue" &&
            Boolean(selectedItem.entityId)) ||
            selectedItem.kind === "handbook")
        ) {
          handleUseHotbarItem();
          return;
        }
      }

      if (!isBuildMode && !replayOpen) {
        const digitMatch = /^Digit([1-6])$/.exec(e.code);
        if (digitMatch) {
          const slotIdx = Number(digitMatch[1]) - 1;
          if (slotIdx >= 0 && slotIdx < HOTBAR_SLOT_COUNT) {
            if (e.shiftKey) {
              e.preventDefault();
              handleSwapHotbarSlots(hotbar.selectedSlot, slotIdx);
              return;
            }
            handleSelectHotbarSlot(slotIdx);
            return;
          }
        }
        if (lower === "m") {
          e.preventDefault();
          handleToggleMinimap();
          return;
        }
        if (lower === "g") {
          e.preventDefault();
          setEmoteBarOpen((prev) => !prev);
          return;
        }
        if (lower === "f") {
          handleUseHotbarItem();
          return;
        }
        if (lower === "q") {
          handleDropHotbarItem();
          return;
        }
      }

      if (isBuildMode) {
        if (lower === "r") {
          e.preventDefault();
          handleRotateBuild();
          return;
        }
        if (lower === "m") {
          e.preventDefault();
          handleStartMoveSelected();
          return;
        }
      }

      if (lower === "v" && !isTouchDevice && !isBuildMode) {
        setCameraMode((prev) => {
          const next =
            prev === "rpg"
              ? "first_person"
              : prev === "first_person"
                ? "overview"
                : "rpg";
          if (next === "rpg") setBuildingViewMode("cutaway");
          return next;
        });
        return;
      }

      if (e.key === "Escape") {
        if (isBuildMode) {
          if (movingBuildTarget) {
            setMovingBuildTarget(null);
            setBuildError(null);
            return;
          }
          setBuildDraft(null);
          setUndoStack([]);
          setRedoStack([]);
          setSelectedBuildTarget(null);
          setMovingBuildTarget(null);
          setBuildError(null);
          return;
        }
        viewportFocusRef.current?.blur();
        return;
      }

      engineRef.current?.setKeyPressed(e.code, true);
    },
    [
      activeStation,
      arcadeOpen,
      canGiveToAgent,
      chatDrawerAgentId,
      emoteBarOpen,
      followedAgentId,
      handleDropHotbarItem,
      handleFollowAgent,
      handleInteractStation,
      handleRotateBuild,
      handleSelectHotbarSlot,
      handleStartMoveSelected,
      handleSwapHotbarSlots,
      handleToggleMinimap,
      handleUseHotbarItem,
      hireModalState.open,
      hotbar,
      inspectedIssueItem,
      isBuildMode,
      isTouchDevice,
      movingBuildTarget,
      nearestStation,
      playbookDrawerState.open,
      playerSeated,
      replayOpen,
      teamChatDrawerOpen,
      wardrobeOpen,
    ],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    engineRef.current?.setKeyPressed(e.code, false);
  }, []);

  if (!webglSupported) {
    return <WebGLFallback agents={Object.values(bridge.summary.agentsById)} />;
  }

  const wardrobeCurrentSkin = wardrobeAgentId
    ? agentSkins.skins[wardrobeAgentId] ??
      (bridge.summary.agentsById[wardrobeAgentId]
        ? deriveDefaultAgentSkin(
            wardrobeAgentId,
            bridge.summary.agentsById[wardrobeAgentId]!.role,
            bridge.summary.agentsById[wardrobeAgentId]!.icon,
          )
        : playerSkin)
    : playerSkin;

  const wardrobeTargetLabel = wardrobeAgentId
    ? bridge.summary.agentsById[wardrobeAgentId]?.name
    : undefined;

  return (
    <div
      ref={viewportFocusRef}
      tabIndex={0}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyUp={handleKeyUp}
      onBlur={() => engineRef.current?.clearPressedKeys()}
      className="office-viewport relative bg-background"
    >
      <div
        ref={containerRef}
        className={cn(
          isPip && activeStation ? "office-pip-frame" : "absolute inset-0 h-full w-full",
        )}
      />

      {effectiveLayout && activeBuilding && activeFloor && !isPip ? (
        <OfficeHud
          buildings={effectiveLayout.buildings}
          activeBuilding={activeBuilding}
          activeFloor={activeFloor}
          onSelectBuilding={(id) => {
            setActiveBuildingId(id);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
            const b = effectiveLayout.buildings.find((x) => x.id === id);
            if (b?.floors[0]) setActiveFloorId(b.floors[0].id);
          }}
          onSelectFloor={(id) => {
            setActiveFloorId(id);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
            const fl = activeBuilding.floors.find((x) => x.id === id);
            if (fl?.elevatorCell) {
              engineRef.current?.teleportToCell(fl.elevatorCell, cameraMode === "rpg");
            }
          }}
          onCreateBuilding={(name) => {
            if (!effectiveLayout) return;
            const newB = createNewBuilding(name);
            const next: OfficeLayout = {
              ...cloneLayout(effectiveLayout),
              buildings: [...effectiveLayout.buildings, newB],
              updatedAt: new Date().toISOString(),
            };
            persistLayout(next);
            setLayout(next);
            setActiveBuildingId(newB.id);
            setActiveFloorId(newB.floors[0]!.id);
          }}
          onResetOrgLayout={() => {
            if (!companyId) return;
            const next = generateLayoutFromOrg(
              companyId,
              bridge.agents.map((a) => ({
                agentId: a.id,
                name: a.name,
                role: a.role,
                reportsTo: a.reportsTo,
                status: a.status,
              })),
            );
            persistLayout(next);
            setLayout(next);
            setActiveBuildingId(next.buildings[0]!.id);
            setActiveFloorId(next.buildings[0]!.floors[0]!.id);
          }}
          onUsePresetLayout={() => {
            if (!companyId) return;
            const next = createPresetDefaultHqLayout(companyId);
            persistLayout(next);
            setLayout(next);
            setActiveBuildingId(next.buildings[0]!.id);
            setActiveFloorId(next.buildings[0]!.floors[0]!.id);
          }}
          cameraMode={cameraMode}
          onToggleCameraMode={() =>
            setCameraMode((prev) => {
              const next =
                prev === "rpg"
                  ? "first_person"
                  : prev === "first_person"
                    ? "overview"
                    : "rpg";
              if (next === "rpg") setBuildingViewMode("cutaway");
              return next;
            })
          }
          isBuildMode={isBuildMode}
          onEnterBuildMode={handleEnterBuildMode}
          allowedActions={bridge.summary.allowedActions}
          onOpenWardrobe={() => {
            setWardrobeAgentId(null);
            setWardrobeOpen(true);
          }}
          environment={environment}
          onChangeEnvironment={(next) => {
            setEnvironment(next);
            saveEnvironmentConfig(next);
            audioRef.current?.setVolume(next.weatherAudioVolume);
          }}
          audioMuted={audioMuted}
          audioVolume={environment.weatherAudioVolume}
          onToggleMute={() => {
            const nextMuted = !audioMuted;
            audioRef.current?.setMuted(nextMuted);
            setAudioMuted(nextMuted);
          }}
          onChangeVolume={(vol) => {
            const next = { ...environment, weatherAudioVolume: vol };
            setEnvironment(next);
            saveEnvironmentConfig(next);
            audioRef.current?.setVolume(vol);
          }}
          performanceMode={performanceMode}
          onTogglePerformanceMode={() => {
            const next = !performanceMode;
            setPerformanceMode(next);
            savePerformanceMode(next);
          }}
          agents={Object.values(displayedAgentsById)}
          agentsById={displayedAgentsById}
          pendingApprovalsCount={bridge.summary.pendingApprovalsCount}
          playerPos={playerPos}
          liveAgentPositions={liveAgentPositions}
          nearestStation={nearestStation}
          onInteractStation={handleInteractStation}
          hoveredAgent={hoveredAgent}
          projectedLabels={projectedLabels}
          projectedMarkers={projectedMarkers}
          onTeleportToAgent={handleTeleportToAgent}
          onTeleportToCell={handleTeleportToCell}
          meetingActive={meetingActive}
          onToggleMeeting={() =>
            setMeetingActive((m) => {
              const next = !m;
              setTeamChatDrawerOpen(next);
              return next;
            })
          }
          replayOpen={replayOpen}
          onToggleReplay={() => setReplayOpen((r) => !r)}
          onCaptureScreenshot={handleCaptureScreenshot}
          buildingViewMode={effectiveBuildingView}
          onToggleBuildingView={() => {
            const next: BuildingViewMode = buildingViewMode === "cutaway" ? "full" : "cutaway";
            setBuildingViewMode(next);
            if (next === "full" && !isTouchDevice) {
              setCameraMode("overview");
            }
          }}
          endOfDayRecap={bridge.endOfDayRecap}
          onDismissRecap={bridge.dismissRecap}
          isTouchDevice={isTouchDevice}
          hotbar={hotbar}
          onSelectHotbarSlot={handleSelectHotbarSlot}
          onSwapHotbarSlots={handleSwapHotbarSlots}
          onUseHotbarItem={handleUseHotbarItem}
          onDropHotbarItem={handleDropHotbarItem}
          hotbarFeedback={hotbarFeedback}
          playerSeated={playerSeated}
          canGiveToAgent={canGiveToAgent}
          giveTargetAgentName={giveTargetAgentSnapshot?.name ?? null}
          onOpenHireAgent={() => handleOpenHireModal()}
          onOpenChatDrawer={handleOpenChatDrawer}
          teamChatOpen={teamChatDrawerOpen}
          unreadTeamChatCount={unreadTeamChatCount}
          onToggleTeamChat={handleToggleTeamChatDrawer}
          showMinimap={showMinimap}
          onToggleMinimap={handleToggleMinimap}
          pointerLocked={pointerLocked}
          followedAgent={followedAgentId ? displayedAgentsById[followedAgentId] ?? null : null}
          onFollowAgent={handleFollowAgent}
          emoteBarOpen={emoteBarOpen}
          onToggleEmoteBar={() => setEmoteBarOpen((prev) => !prev)}
          onTriggerEmote={handleTriggerEmote}
        />
      ) : null}

      {isBuildMode && activeBuilding && activeFloor ? (
        <BuildModeBar
          floor={activeFloor}
          activeFloorIndex={activeFloorIndex}
          tool={buildTool}
          onToolChange={handleBuildToolChange}
          placeableKind={buildPlaceableKind}
          onPlaceableKindChange={setBuildPlaceableKind}
          placementRotation={
            buildTool === "move" && movingBuildTarget ? movingRotation : buildPlacementRotation
          }
          isMovingEntity={Boolean(movingBuildTarget)}
          onRotate={handleRotateBuild}
          onStartMoveSelected={handleStartMoveSelected}
          selectedTarget={selectedBuildTarget}
          agents={Object.values(bridge.summary.agentsById)}
          projects={bridge.projects}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          errorMessage={buildError}
          onApplyPresetTemplate={() => {
            if (!companyId) return;
            const next = createPresetDefaultHqLayout(companyId);
            pushBuildDraft(next);
            setActiveBuildingId(next.buildings[0]!.id);
            setActiveFloorId(next.buildings[0]!.floors[0]!.id);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
          }}
          onApplyOrgTemplate={() => {
            if (!companyId) return;
            const next = generateLayoutFromOrg(
              companyId,
              bridge.agents.map((a) => ({
                agentId: a.id,
                name: a.name,
                role: a.role,
                reportsTo: a.reportsTo,
                status: a.status,
              })),
            );
            pushBuildDraft(next);
            setActiveBuildingId(next.buildings[0]!.id);
            setActiveFloorId(next.buildings[0]!.floors[0]!.id);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
          }}
          onAddFloor={() => {
            if (!buildDraft) return;
            const next = cloneLayout(buildDraft);
            const b = next.buildings.find((item) => item.id === activeBuilding.id);
            if (!b) return;
            const elev = b.floors[0]?.elevatorCell ?? DEFAULT_ELEVATOR_CELL;
            const newFloor = createBlankFloor(b.floors.length + 1, elev);
            b.floors.push(newFloor);
            pushBuildDraft(next);
            setActiveFloorId(newFloor.id);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
          }}
          onRemoveFloor={() => {
            if (!buildDraft) return;
            if (activeBuilding.floors.length <= 1) {
              setBuildError(ot("office3d.build.errNeedOneFloor"));
              return;
            }
            if (activeFloor.desks.some((d) => Boolean(d.assignedAgentId))) {
              setBuildError(ot("office3d.build.errFloorHasAgents"));
              return;
            }
            const next = cloneLayout(buildDraft);
            const b = next.buildings.find((item) => item.id === activeBuilding.id);
            if (!b) return;
            b.floors = b.floors.filter((f) => f.id !== activeFloor.id);
            pushBuildDraft(next);
            setActiveFloorId(b.floors[0]!.id);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
          }}
          onUndo={() => {
            if (undoStack.length === 0 || !buildDraft) return;
            const prev = undoStack[undoStack.length - 1]!;
            setUndoStack((s) => s.slice(0, -1));
            setRedoStack((s) => [...s, buildDraft]);
            setBuildDraft(prev);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
          }}
          onRedo={() => {
            if (redoStack.length === 0 || !buildDraft) return;
            const next = redoStack[redoStack.length - 1]!;
            setRedoStack((s) => s.slice(0, -1));
            setUndoStack((s) => [...s, buildDraft]);
            setBuildDraft(next);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
          }}
          onCancel={() => {
            setBuildDraft(null);
            setUndoStack([]);
            setRedoStack([]);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
            setBuildError(null);
          }}
          onSave={() => {
            if (!buildDraft || !companyId) return;
            const check = validateAndSanitizeLayout(buildDraft, companyId, activeAgentIds);
            const finalLayout = check?.layout ?? buildDraft;
            persistLayout(finalLayout);
            setLayout(finalLayout);
            setBuildDraft(null);
            setUndoStack([]);
            setRedoStack([]);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
            setBuildError(null);
          }}
          onUpdateRoom={(roomId, patch) => {
            updateCurrentFloorInDraft((floor) => ({
              ...floor,
              rooms: floor.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
            }));
          }}
          onUpdateFurniture={(furnitureId, patch) => {
            updateCurrentFloorInDraft((floor) => ({
              ...floor,
              furniture: floor.furniture.map((f) => (f.id === furnitureId ? { ...f, ...patch } : f)),
            }));
          }}
          onAssignDesk={(deskId, agentId) => {
            if (!buildDraft) return;
            const next = cloneLayout(buildDraft);
            for (const b of next.buildings) {
              for (const f of b.floors) {
                for (const d of f.desks) {
                  if (agentId && d.assignedAgentId === agentId && d.id !== deskId) {
                    d.assignedAgentId = null;
                  }
                  if (d.id === deskId) {
                    d.assignedAgentId = agentId;
                  }
                }
              }
            }
            pushBuildDraft(next);
          }}
          onDeleteSelected={() => {
            if (!selectedBuildTarget) return;
            updateCurrentFloorInDraft((floor) => {
              if (selectedBuildTarget.kind === "desk") {
                return {
                  ...floor,
                  desks: floor.desks.filter((d) => d.id !== selectedBuildTarget.id),
                };
              }
              if (selectedBuildTarget.kind === "furniture") {
                return {
                  ...floor,
                  furniture: floor.furniture.filter((f) => f.id !== selectedBuildTarget.id),
                };
              }
              return {
                ...floor,
                rooms: floor.rooms.filter((r) => r.id !== selectedBuildTarget.id),
                desks: floor.desks.map((d) =>
                  d.roomId === selectedBuildTarget.id ? { ...d, roomId: null } : d,
                ),
                furniture: floor.furniture.map((f) =>
                  f.roomId === selectedBuildTarget.id ? { ...f, roomId: null } : f,
                ),
              };
            });
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
          }}
          onExportBlueprint={() => handleExportLayoutBlueprint(buildDraft)}
          onImportBlueprint={(jsonText) => {
            if (!companyId) return;
            const imported = parseBlueprintImport(jsonText, companyId, activeAgentIds);
            if (!imported) {
              setBuildError(ot("office3d.build.importFailed"));
              return;
            }
            pushBuildDraft(imported.layout);
            setSelectedBuildTarget(null);
            setMovingBuildTarget(null);
            const firstB = imported.layout.buildings[0];
            if (firstB) {
              setActiveBuildingId(firstB.id);
              if (firstB.floors[0]) setActiveFloorId(firstB.floors[0].id);
            }
            if (imported.strippedForeignAgents) {
              pushToast?.({
                title: ot("office3d.build.repairedNotice"),
                tone: "info",
              });
            }
          }}
        />
      ) : null}

      {activeBuilding && activeFloor ? (
        <StationModal
          station={activeStation}
          onClose={() => {
            setActiveStation(null);
            setIsPip(false);
          }}
          companyId={companyId}
          activeBuilding={activeBuilding}
          activeFloorId={activeFloor.id}
          onSwitchFloor={(floorId) => {
            setActiveFloorId(floorId);
            const fl = activeBuilding.floors.find((x) => x.id === floorId);
            if (fl?.elevatorCell) {
              engineRef.current?.teleportToCell(fl.elevatorCell, cameraMode === "rpg");
            }
          }}
          agentsById={bridge.summary.agentsById}
          recentRuns={bridge.recentRuns}
          pendingApprovals={bridge.pendingApprovals}
          routines={bridge.routines}
          workspaces={bridge.workspaces}
          issues={bridge.issues}
          goals={bridge.goals}
          projects={bridge.projects}
          allowedActions={bridge.summary.allowedActions}
          isPip={isPip}
          onTogglePip={() => setIsPip((p) => !p)}
          onPauseAgent={(id) => bridge.pauseAgent.mutate(id)}
          onResumeAgent={(id) => bridge.resumeAgent.mutate(id)}
          onApproveItem={(id) => {
            bridge.approveItem.mutate(id, {
              onSuccess: () => audioRef.current?.playApprovalStamp(),
            });
          }}
          onRejectItem={(id) => bridge.rejectItem.mutate(id)}
          onRunRoutine={(id) => bridge.runRoutine.mutate(id)}
          onCustomizeAgentSkin={(agentId) => {
            setActiveStation(null);
            setIsPip(false);
            setWardrobeAgentId(agentId);
            setWardrobeOpen(true);
          }}
          onOpenBuildMode={handleEnterBuildMode}
          onTakeItem={handleTakeItem}
          onCaptureScreenshot={handleCaptureScreenshot}
          onExportBlueprint={() => handleExportLayoutBlueprint(effectiveLayout)}
          onOpenHireAgent={(opts) => handleOpenHireModal(opts)}
          onOpenChatDrawer={handleOpenChatDrawer}
          onOpenAgentDm={(agentId) => {
            setChatDrawerAgentId(null);
            setTeamChatTargetDmAgentId(agentId);
            setTeamChatDrawerOpen(true);
          }}
          onOpenPlaybookDrawer={(aid) => handleOpenPlaybookDrawer(aid)}
          onAssignIssue={(issueId, agentId) =>
            bridge.assignIssueToAgent.mutate({ issueId, agentId })
          }
          agentBehaviors={effectiveLayout?.agentBehaviors}
          onSaveAgentBehavior={(agentId, nextBehavior) => {
            if (!effectiveLayout) return;
            const nextLayout: OfficeLayout = {
              ...effectiveLayout,
              agentBehaviors: {
                ...(effectiveLayout.agentBehaviors ?? {}),
                [agentId]: nextBehavior,
              },
              updatedAt: new Date().toISOString(),
            };
            setLayout(nextLayout);
            persistLayout(nextLayout);
          }}
          onPreviewAgentSlogan={(agentId, text) => {
            engineRef.current?.showAgentSpeechBubble(agentId, text, 6000);
          }}
          kpiSnapshot={kpiSnapshot}
          onFollowAgent={handleFollowAgent}
        />
      ) : null}

      {activeBuilding && activeFloor ? (
        <OfficeHireAgentModal
          open={hireModalState.open}
          onOpenChange={(open) => setHireModalState((s) => ({ ...s, open }))}
          companyId={companyId}
          agents={bridge.agents}
          activeBuilding={activeBuilding}
          activeFloorId={activeFloor.id}
          preselectedFloorId={hireModalState.floorId}
          preselectedDeskId={hireModalState.deskId}
          canEditLayout={bridge.summary.allowedActions.includes("edit_layout")}
          onHired={handleAgentHired}
        />
      ) : null}

      {!isBuildMode && !isPip && chatDrawerAgentId ? (
        <OfficeChatDrawer
          agent={bridge.summary.agentsById[chatDrawerAgentId] ?? null}
          companyId={companyId}
          allowedActions={bridge.summary.allowedActions}
          onClose={() => setChatDrawerAgentId(null)}
          onPauseAgent={(id) => bridge.pauseAgent.mutate(id)}
          onResumeAgent={(id) => bridge.resumeAgent.mutate(id)}
          onWakeAgent={(id) => bridge.wakeAgent.mutate(id)}
          wakingAgent={bridge.wakeAgent.isPending}
          onOpenPlaybook={(id) => handleOpenPlaybookDrawer(id)}
        />
      ) : null}

      {!isBuildMode && !isPip ? (
        <OfficePlaybookDrawer
          open={playbookDrawerState.open}
          initialAgentId={playbookDrawerState.agentId}
          companyId={companyId}
          agents={Object.values(bridge.summary.agentsById)}
          canEdit={bridge.summary.allowedActions.includes("hire_agent") || bridge.summary.allowedActions.includes("edit_layout")}
          onClose={() => setPlaybookDrawerState({ open: false, agentId: null })}
        />
      ) : null}

      {!isBuildMode && !isPip ? (
        <OfficeTeamChatDrawer
          open={teamChatDrawerOpen}
          companyId={companyId}
          agents={bridge.agents}
          onClose={() => setTeamChatDrawerOpen(false)}
          onAgentMessageSpoken={(agentId, text) => {
            engineRef.current?.showAgentSpeechBubble(agentId, text, 8000);
          }}
          targetDmAgentId={teamChatTargetDmAgentId}
          onDmTargetHandled={() => setTeamChatTargetDmAgentId(null)}
        />
      ) : null}

      <WardrobeModal
        open={wardrobeOpen}
        onOpenChange={setWardrobeOpen}
        skin={wardrobeCurrentSkin}
        targetLabel={wardrobeTargetLabel}
        onChange={(nextSkin) => {
          if (wardrobeAgentId && companyId) {
            const nextMap: AgentSkinMap = {
              companyId,
              skins: { ...agentSkins.skins, [wardrobeAgentId]: nextSkin },
            };
            setAgentSkins(nextMap);
            saveAgentSkins(nextMap);
            if (layout) {
              persistLayout(layout, nextMap);
            }
          } else {
            setPlayerSkin(nextSkin);
            savePlayerSkin(nextSkin);
          }
        }}
      />

      <HeldIssueModal
        open={Boolean(inspectedIssueItem)}
        issueId={inspectedIssueItem?.issueId ?? null}
        fallbackLabel={inspectedIssueItem?.label ?? null}
        fallbackIdentifier={inspectedIssueItem?.identifier ?? null}
        compactIssue={
          inspectedIssueItem
            ? bridge.issues.find((i) => i.id === inspectedIssueItem.issueId) ?? null
            : null
        }
        agentsById={bridge.summary.agentsById}
        onClose={() => setInspectedIssueItem(null)}
      />

      <ArcadeMiniGameModal
        open={arcadeOpen}
        companyId={companyId}
        onClose={() => setArcadeOpen(false)}
        onScoreMilestone={() => audioRef.current?.playApprovalStamp()}
      />

      <ReplayBar
        open={replayOpen && !isBuildMode}
        companyId={companyId}
        baseAgentsById={bridge.summary.agentsById}
        onReplaySample={setReplaySample}
        onClose={() => {
          setReplayOpen(false);
          setReplaySample(null);
        }}
      />
    </div>
  );
}
