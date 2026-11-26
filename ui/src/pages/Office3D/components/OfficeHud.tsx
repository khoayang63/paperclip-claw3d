import { useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Camera,
  CloudRain,
  Compass,
  Eye,
  EyeOff,
  Gauge,
  Hammer,
  History,
  ImageDown,
  Map as MapIcon,
  MessageSquare,
  MessagesSquare,
  Moon,
  Plus,
  RotateCcw,
  Shirt,
  SlidersHorizontal,
  Smile,
  Snowflake,
  Sun,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { cn, formatCents, formatDurationMs } from "@/lib/utils";
import type {
  AgentOfficeSnapshot,
  BuildingConfig,
  BuildingViewMode,
  CameraControlMode,
  EndOfDayRecap,
  EnvironmentConfig,
  EnvironmentTimeMode,
  FloorConfig,
  InteractiveStation,
  LiveAgentPosition,
  OfficeActionCapability,
  OfficeHotbarState,
  WeatherKind,
} from "../model/types";
import type {
  HoveredAgentInfo,
  ProjectedAgentLabel,
  ProjectedMarker,
} from "../scene/OfficeSceneEngine";
import { useOfficeT } from "../officeCopy";
import { OfficeHotbar } from "./OfficeHotbar";
import { OfficeMinimap } from "./OfficeMinimap";

export interface OfficeHudProps {
  buildings: BuildingConfig[];
  activeBuilding: BuildingConfig;
  activeFloor: FloorConfig;
  onSelectBuilding: (buildingId: string) => void;
  onSelectFloor: (floorId: string) => void;
  onCreateBuilding: (name: string) => void;
  onResetOrgLayout: () => void;
  onUsePresetLayout: () => void;
  cameraMode: CameraControlMode;
  onToggleCameraMode: () => void;
  isBuildMode: boolean;
  onEnterBuildMode: () => void;
  allowedActions: OfficeActionCapability[];
  onOpenWardrobe: () => void;
  environment: EnvironmentConfig;
  onChangeEnvironment: (next: EnvironmentConfig) => void;
  audioMuted: boolean;
  audioVolume: number;
  onToggleMute: () => void;
  onChangeVolume: (vol: number) => void;
  performanceMode: boolean;
  onTogglePerformanceMode: () => void;
  agents: AgentOfficeSnapshot[];
  agentsById: Record<string, AgentOfficeSnapshot>;
  pendingApprovalsCount: number;
  playerPos: { x: number; z: number };
  liveAgentPositions?: Record<string, LiveAgentPosition>;
  nearestStation: InteractiveStation | null;
  onInteractStation: (station: InteractiveStation) => void;
  hoveredAgent: HoveredAgentInfo | null;
  projectedLabels: ProjectedAgentLabel[];
  projectedMarkers: ProjectedMarker[];
  onTeleportToAgent: (agentId: string) => void;
  onTeleportToCell: (cell: [number, number]) => void;
  meetingActive: boolean;
  onToggleMeeting: () => void;
  replayOpen: boolean;
  onToggleReplay: () => void;
  onCaptureScreenshot: () => void;
  buildingViewMode: BuildingViewMode;
  onToggleBuildingView: () => void;
  endOfDayRecap: EndOfDayRecap | null;
  onDismissRecap: () => void;
  isTouchDevice: boolean;
  hotbar: OfficeHotbarState;
  onSelectHotbarSlot: (slotIndex: number) => void;
  onSwapHotbarSlots?: (fromIndex: number, toIndex: number) => void;
  onUseHotbarItem: () => void;
  onDropHotbarItem: () => void;
  hotbarFeedback?: string | null;
  playerSeated: boolean;
  canGiveToAgent: boolean;
  giveTargetAgentName?: string | null;
  onOpenHireAgent?: () => void;
  onOpenChatDrawer?: (agentId: string) => void;
  teamChatOpen?: boolean;
  unreadTeamChatCount?: number;
  onToggleTeamChat?: () => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  pointerLocked?: boolean;
  followedAgent?: AgentOfficeSnapshot | null;
  onFollowAgent?: (agentId: string | null) => void;
  emoteBarOpen?: boolean;
  onToggleEmoteBar?: () => void;
  onTriggerEmote?: (emote: "waving" | "celebrating" | "clapping" | "stretching") => void;
}

export function OfficeHud({
  buildings,
  activeBuilding,
  activeFloor,
  onSelectBuilding,
  onSelectFloor,
  onCreateBuilding,
  onResetOrgLayout,
  onUsePresetLayout,
  cameraMode,
  onToggleCameraMode,
  isBuildMode,
  onEnterBuildMode,
  allowedActions,
  onOpenWardrobe,
  environment,
  onChangeEnvironment,
  audioMuted,
  audioVolume,
  onToggleMute,
  onChangeVolume,
  performanceMode,
  onTogglePerformanceMode,
  agents,
  agentsById,
  pendingApprovalsCount,
  playerPos,
  liveAgentPositions,
  nearestStation,
  onInteractStation,
  hoveredAgent,
  projectedLabels,
  projectedMarkers,
  onTeleportToAgent,
  onTeleportToCell,
  meetingActive,
  onToggleMeeting,
  replayOpen,
  onToggleReplay,
  onCaptureScreenshot,
  buildingViewMode,
  onToggleBuildingView,
  endOfDayRecap,
  onDismissRecap,
  isTouchDevice,
  hotbar,
  onSelectHotbarSlot,
  onSwapHotbarSlots,
  onUseHotbarItem,
  onDropHotbarItem,
  hotbarFeedback,
  playerSeated,
  canGiveToAgent,
  giveTargetAgentName,
  onOpenHireAgent,
  onOpenChatDrawer,
  teamChatOpen = false,
  unreadTeamChatCount = 0,
  onToggleTeamChat,
  showMinimap,
  onToggleMinimap,
  pointerLocked = false,
  followedAgent = null,
  onFollowAgent,
  emoteBarOpen = false,
  onToggleEmoteBar,
  onTriggerEmote,
}: OfficeHudProps) {
  const ot = useOfficeT();
  const [newBuildingName, setNewBuildingName] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterSearch, setRosterSearch] = useState("");

  const canEditLayout = allowedActions.includes("edit_layout");
  const canHire = allowedActions.includes("hire_agent");
  const visibleAgents = useMemo(
    () =>
      agents
        .filter((a) => a.visualState !== "hidden")
        .filter((a) =>
          rosterSearch.trim()
            ? a.name.toLowerCase().includes(rosterSearch.toLowerCase()) ||
              a.role.toLowerCase().includes(rosterSearch.toLowerCase())
            : true,
        ),
    [agents, rosterSearch],
  );

  const hoveredSnapshot = hoveredAgent ? agentsById[hoveredAgent.agentId] ?? null : null;
  const errorCount = agents.filter(
    (a) => a.visualState === "error" || a.visualState === "paused_budget",
  ).length;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Projected 2D agent nameplates + chat bubbles */}
      {!isBuildMode
        ? projectedLabels.map((lbl) => (
            <div
              key={lbl.agentId}
              style={{
                transform: `translate(${Math.round(lbl.screenX)}px, ${Math.round(lbl.screenY)}px) translate(-50%, -100%)`,
              }}
              className="pointer-events-none absolute left-0 top-0 flex flex-col items-center gap-1"
            >
              {lbl.bubbleText ? (
                <div className="office-chat-bubble truncate rounded-md border border-border bg-popover/95 px-2 py-1 text-popover-foreground shadow-md backdrop-blur-xs">
                  {lbl.bubbleText}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => onTeleportToAgent(lbl.agentId)}
                className="office-hud-label pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card/85 px-2 py-0.5 font-medium text-foreground shadow-sm backdrop-blur-xs transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    lbl.visualState === "error" || lbl.visualState === "paused_budget"
                      ? "bg-destructive"
                      : lbl.visualState === "coding" || lbl.visualState === "thinking"
                        ? "bg-primary"
                        : "bg-muted-foreground",
                  )}
                />
                <span className="max-w-28 truncate">{lbl.name}</span>
              </button>
            </div>
          ))
        : null}

      {/* World markers (errors, budget pause, pending approvals) */}
      {!isBuildMode
        ? projectedMarkers.map(({ marker, screenX, screenY, offScreen }) => (
            <button
              key={marker.id}
              type="button"
              onClick={() => onTeleportToCell(marker.cell)}
              style={{ transform: `translate(${Math.round(screenX)}px, ${Math.round(screenY)}px) translate(-50%, -50%)` }}
              className={cn(
                "office-hud-label pointer-events-auto absolute left-0 top-0 flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold shadow-md",
                marker.kind === "approval_pending"
                  ? "border-border bg-card text-foreground"
                  : "border-destructive/50 bg-destructive text-destructive-foreground",
                offScreen && "ring-2 ring-ring",
              )}
            >
              <AlertCircle className="size-3 shrink-0" aria-hidden />
              <span>{marker.label}</span>
            </button>
          ))
        : null}

      {/* Hover Info Card */}
      {hoveredAgent && hoveredSnapshot && !isBuildMode ? (
        <div
          style={{
            transform: `translate(${Math.round(hoveredAgent.screenX + 14)}px, ${Math.round(hoveredAgent.screenY + 14)}px)`,
          }}
          className="pointer-events-none absolute left-0 top-0 z-20 w-56 rounded-lg border border-border bg-popover/95 p-2.5 text-popover-foreground shadow-lg backdrop-blur-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold">{hoveredSnapshot.name}</span>
            <Badge variant="outline">{hoveredSnapshot.visualState}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{hoveredSnapshot.role}</p>
          {hoveredSnapshot.currentIssueIdentifier ? (
            <p className="mt-1.5 truncate text-xs font-medium text-foreground">
              {hoveredSnapshot.currentIssueIdentifier}
              {hoveredSnapshot.currentIssueTitle ? ` · ${hoveredSnapshot.currentIssueTitle}` : ""}
            </p>
          ) : null}
          <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {hoveredSnapshot.runStartedAt
                ? formatDurationMs(Math.max(0, Date.now() - Date.parse(hoveredSnapshot.runStartedAt)))
                : "—"}
            </span>
            <span>
              {hoveredSnapshot.costTodayCents !== null
                ? formatCents(hoveredSnapshot.costTodayCents)
                : "—"}
            </span>
          </div>
        </div>
      ) : null}

      {/* First-Person Crosshair & Pointer Lock Hint */}
      {cameraMode === "first_person" && !isBuildMode ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
          >
            <Plus className="size-5 text-foreground/85 drop-shadow-sm" />
          </div>
          <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2">
            <div className="rounded-md border border-border bg-card/85 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
              {pointerLocked ? ot("office3d.fp.lockedHint") : ot("office3d.fp.clickToLock")}
            </div>
          </div>
        </>
      ) : null}

      {/* Active Follow Agent Banner */}
      {followedAgent && !isBuildMode && onFollowAgent ? (
        <div className="pointer-events-auto absolute left-1/2 top-16 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1 text-xs shadow-lg backdrop-blur-sm">
          <Eye className="size-3.5 text-primary" aria-hidden />
          <span className="font-semibold text-foreground">
            {ot("office3d.controls.followingBanner", { name: followedAgent.name })}
          </span>
          {followedAgent.currentIssueIdentifier ? (
            <Badge variant="outline" className="font-mono">
              {followedAgent.currentIssueIdentifier}
            </Badge>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => onFollowAgent(null)}
          >
            <X className="size-3" aria-hidden />
            {ot("office3d.controls.stopFollow")}
          </Button>
        </div>
      ) : null}

      {/* Top Toolbar (Compact primary controls + Office Options drawer) */}
      <div className="pointer-events-auto relative z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1.5 pr-1">
            <Building2 className="size-4 text-muted-foreground" aria-hidden />
            <select
              id="office-building-select"
              name="officeBuilding"
              aria-label="Building"
              value={activeBuilding.id}
              onChange={(e) => onSelectBuilding(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground"
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <select
            id="office-floor-select"
            name="officeFloor"
            aria-label="Floor"
            value={activeFloor.id}
            onChange={(e) => onSelectFloor(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground"
          >
            {activeBuilding.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          {!isTouchDevice && !isBuildMode ? (
            <Button type="button" size="xs" variant="outline" onClick={onToggleCameraMode}>
              <Camera className="size-3.5" aria-hidden />
              {cameraMode === "overview"
                ? ot("office3d.controls.overviewMode")
                : cameraMode === "first_person"
                  ? ot("office3d.controls.firstPersonMode")
                  : ot("office3d.controls.rpgMode")}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Accessible Agent Roster & Quick Finder */}
          <Popover open={rosterOpen} onOpenChange={setRosterOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="xs" variant="outline">
                <Users className="size-3.5" aria-hidden />
                {ot("office3d.controls.roster")} ({agents.filter((a) => a.visualState !== "hidden").length})
                {errorCount > 0 || pendingApprovalsCount > 0 ? (
                  <Badge variant="destructive">{errorCount + pendingApprovalsCount}</Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-2 p-3" align="end">
              <div className="flex items-center gap-1.5">
                <Input
                  id="office-roster-search"
                  name="officeRosterSearch"
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  placeholder="Find agent…"
                  className="flex-1"
                />
                {canHire && onOpenHireAgent ? (
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => {
                      setRosterOpen(false);
                      onOpenHireAgent();
                    }}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Hire
                  </Button>
                ) : null}
              </div>
              <div className="max-h-60 space-y-1 overflow-auto">
                {visibleAgents.map((agent) => (
                  <div
                    key={agent.agentId}
                    className="flex items-center justify-between gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-accent"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setRosterOpen(false);
                        onTeleportToAgent(agent.agentId);
                      }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-1.5 text-left text-xs"
                    >
                      <span className="truncate font-medium">{agent.name}</span>
                      <Badge variant="outline">{agent.visualState}</Badge>
                    </button>
                    {onFollowAgent && !isBuildMode ? (
                      <Button
                        type="button"
                        size="icon-xs"
                        variant={followedAgent?.agentId === agent.agentId ? "default" : "ghost"}
                        title={ot("office3d.controls.followAgent")}
                        onClick={() => {
                          setRosterOpen(false);
                          onFollowAgent(
                            followedAgent?.agentId === agent.agentId ? null : agent.agentId,
                          );
                        }}
                      >
                        <Eye className="size-3.5" aria-hidden />
                      </Button>
                    ) : null}
                    {onOpenChatDrawer ? (
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        title={ot("office3d.chat.title")}
                        onClick={() => {
                          setRosterOpen(false);
                          onOpenChatDrawer(agent.agentId);
                        }}
                      >
                        <MessageSquare className="size-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {!isBuildMode && onToggleTeamChat ? (
            <Button
              type="button"
              size="xs"
              variant={teamChatOpen ? "default" : "outline"}
              onClick={onToggleTeamChat}
            >
              <MessagesSquare className="size-3.5" aria-hidden />
              <span>{ot("office3d.controls.teamChat")}</span>
              {unreadTeamChatCount > 0 && !teamChatOpen ? (
                <Badge variant="secondary" className="ml-0.5 px-1.5 text-xs">
                  {unreadTeamChatCount > 99 ? "99+" : unreadTeamChatCount}
                </Badge>
              ) : null}
            </Button>
          ) : null}

          {/* Realtime Environment Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="xs" variant="outline">
                {environment.timeMode === "night" ? (
                  <Moon className="size-3.5" aria-hidden />
                ) : environment.weather === "rain" ? (
                  <CloudRain className="size-3.5" aria-hidden />
                ) : environment.weather === "snow" ? (
                  <Snowflake className="size-3.5" aria-hidden />
                ) : (
                  <Sun className="size-3.5" aria-hidden />
                )}
                {ot("office3d.controls.environment")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3" align="end">
              <p className="text-xs font-semibold">{ot("office3d.env.title")}</p>
              <div className="flex flex-wrap gap-1">
                {(["realtime", "day", "sunset", "night", "custom"] as EnvironmentTimeMode[]).map(
                  (mode) => (
                    <Button
                      key={mode}
                      type="button"
                      size="xs"
                      variant={environment.timeMode === mode ? "default" : "outline"}
                      onClick={() => onChangeEnvironment({ ...environment, timeMode: mode })}
                    >
                      {mode}
                    </Button>
                  ),
                )}
              </div>

              {environment.timeMode === "custom" ? (
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">
                    {ot("office3d.env.hourLabel", { hour: environment.customHour.toFixed(1) })}
                  </span>
                  <input
                    id="office-custom-hour"
                    name="officeCustomHour"
                    type="range"
                    min={0}
                    max={24}
                    step={0.5}
                    value={environment.customHour}
                    onChange={(e) =>
                      onChangeEnvironment({ ...environment, customHour: Number(e.target.value) })
                    }
                    className="w-full"
                  />
                </label>
              ) : null}

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{ot("office3d.env.weather")}</p>
                <div className="flex gap-1">
                  {(["clear", "rain", "snow"] as WeatherKind[]).map((w) => (
                    <Button
                      key={w}
                      type="button"
                      size="xs"
                      variant={environment.weather === w ? "default" : "outline"}
                      onClick={() => onChangeEnvironment({ ...environment, weather: w })}
                    >
                      {w}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span>{ot("office3d.env.nightLights")}</span>
                <ToggleSwitch
                  checked={environment.enableNightAutoLights}
                  onCheckedChange={(checked) =>
                    onChangeEnvironment({ ...environment, enableNightAutoLights: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span>{ot("office3d.env.endOfDayRecap")}</span>
                <ToggleSwitch
                  checked={environment.enableEndOfDayRecap}
                  onCheckedChange={(checked) =>
                    onChangeEnvironment({ ...environment, enableEndOfDayRecap: checked })
                  }
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* Consolidated Office Options Popover */}
          <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="xs" variant="outline">
                <SlidersHorizontal className="size-3.5" aria-hidden />
                {ot("office3d.controls.officeOptions")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3 p-3" align="end">
              {!isBuildMode ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant={meetingActive ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => {
                      onToggleMeeting();
                      setOptionsOpen(false);
                    }}
                  >
                    <MessageSquare className="size-3.5" aria-hidden />
                    {meetingActive
                      ? ot("office3d.controls.meetingEnd")
                      : ot("office3d.controls.meetingCall")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={replayOpen ? "default" : "outline"}
                    className="justify-start"
                    onClick={() => {
                      onToggleReplay();
                      setOptionsOpen(false);
                    }}
                  >
                    <History className="size-3.5" aria-hidden />
                    {ot("office3d.controls.replay")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={buildingViewMode === "full" ? "default" : "outline"}
                    className="justify-start"
                    onClick={onToggleBuildingView}
                  >
                    <Building2 className="size-3.5" aria-hidden />
                    {buildingViewMode === "full"
                      ? ot("office3d.controls.buildingCutaway")
                      : ot("office3d.controls.buildingFull")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="justify-start"
                    onClick={() => {
                      onCaptureScreenshot();
                      setOptionsOpen(false);
                    }}
                  >
                    <ImageDown className="size-3.5" aria-hidden />
                    {ot("office3d.controls.screenshot")}
                  </Button>
                  {onToggleEmoteBar ? (
                    <Button
                      type="button"
                      size="xs"
                      variant={emoteBarOpen ? "default" : "outline"}
                      className="justify-start"
                      onClick={() => {
                        onToggleEmoteBar();
                        setOptionsOpen(false);
                      }}
                    >
                      <Smile className="size-3.5" aria-hidden />
                      {ot("office3d.controls.emotes")}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <Button
                type="button"
                size="xs"
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setOptionsOpen(false);
                  onOpenWardrobe();
                }}
              >
                <Shirt className="size-3.5" aria-hidden />
                {ot("office3d.controls.customizeAvatar")}
              </Button>

              <div className="space-y-2 border-t border-border/60 pt-2">
                {!isBuildMode ? (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <MapIcon className="size-3.5 text-muted-foreground" aria-hidden />
                      {ot("office3d.controls.showMinimap")}
                    </span>
                    <ToggleSwitch
                      checked={showMinimap}
                      onCheckedChange={onToggleMinimap}
                    />
                  </div>
                ) : null}

                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <Gauge className="size-3.5 text-muted-foreground" aria-hidden />
                    {ot("office3d.controls.performanceMode")}
                  </span>
                  <ToggleSwitch
                    checked={performanceMode}
                    onCheckedChange={onTogglePerformanceMode}
                  />
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{ot("office3d.env.audioVolume")}</span>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant={audioMuted ? "outline" : "default"}
                      onClick={onToggleMute}
                      title={
                        audioMuted
                          ? ot("office3d.controls.unmuteAudio")
                          : ot("office3d.controls.muteAudio")
                      }
                    >
                      {audioMuted ? (
                        <VolumeX className="size-3.5" aria-hidden />
                      ) : (
                        <Volume2 className="size-3.5" aria-hidden />
                      )}
                    </Button>
                  </div>
                  <input
                    id="office-audio-volume"
                    name="officeAudioVolume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={audioVolume}
                    onChange={(e) => onChangeVolume(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              {canEditLayout ? (
                <div className="space-y-2 border-t border-border/60 pt-2">
                  {!isBuildMode ? (
                    <div className="space-y-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => {
                          onResetOrgLayout();
                          setOptionsOpen(false);
                        }}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        {ot("office3d.controls.resetOrgLayout")}
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => {
                          onUsePresetLayout();
                          setOptionsOpen(false);
                        }}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        {ot("office3d.controls.resetPresetLayout")}
                      </Button>
                    </div>
                  ) : null}

                  <div className="space-y-1.5 border-t border-border/60 pt-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {ot("office3d.controls.newBuildingPrompt")}
                    </p>
                    <div className="flex gap-1.5">
                      <Input
                        id="office-new-building-name"
                        name="officeNewBuildingName"
                        value={newBuildingName}
                        onChange={(e) => setNewBuildingName(e.target.value)}
                        placeholder="AI Research Lab"
                        className="h-7 text-xs"
                      />
                      <Button
                        type="button"
                        size="xs"
                        onClick={() => {
                          if (!newBuildingName.trim()) return;
                          onCreateBuilding(newBuildingName.trim());
                          setNewBuildingName("");
                          setOptionsOpen(false);
                        }}
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </PopoverContent>
          </Popover>

          {canEditLayout && !isBuildMode ? (
            <Button type="button" size="xs" onClick={onEnterBuildMode}>
              <Hammer className="size-3.5" aria-hidden />
              {ot("office3d.controls.buildMode")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* End-of-day Sunset Recap Card */}
      {endOfDayRecap ? (
        <div className="pointer-events-auto absolute right-4 top-16 z-20 w-72 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">{ot("office3d.recap.title")}</span>
            <Button type="button" size="icon-xs" variant="ghost" onClick={onDismissRecap}>
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-muted/60 p-2">
              <div className="text-muted-foreground">{ot("office3d.recap.completed")}</div>
              <div className="text-sm font-semibold">{endOfDayRecap.issuesCompleted}</div>
            </div>
            <div className="rounded-md bg-muted/60 p-2">
              <div className="text-muted-foreground">{ot("office3d.recap.failed")}</div>
              <div className="text-sm font-semibold">{endOfDayRecap.runsFailed}</div>
            </div>
            <div className="rounded-md bg-muted/60 p-2">
              <div className="text-muted-foreground">{ot("office3d.recap.cost")}</div>
              <div className="text-sm font-semibold">{formatCents(endOfDayRecap.totalCostCents)}</div>
            </div>
            <div className="rounded-md bg-muted/60 p-2">
              <div className="text-muted-foreground">{ot("office3d.recap.pending")}</div>
              <div className="text-sm font-semibold">{endOfDayRecap.pendingApprovals}</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Bottom-left Minimap (collapsible via button or M) */}
      {!isBuildMode ? (
        <div className="pointer-events-auto absolute bottom-4 left-4 z-20">
          {showMinimap ? (
            <div className="relative">
              <Button
                type="button"
                size="icon-xs"
                variant="secondary"
                onClick={onToggleMinimap}
                title={ot("office3d.controls.hideMinimap")}
                aria-label={ot("office3d.controls.hideMinimap")}
                className="absolute right-1 top-1 z-10 h-5 w-5 rounded-sm bg-background/85 opacity-85 hover:opacity-100"
              >
                <EyeOff className="size-3" aria-hidden />
              </Button>
              <OfficeMinimap
                floor={activeFloor}
                playerPos={playerPos}
                agentsById={agentsById}
                agentPositions={liveAgentPositions}
                onTeleportCell={onTeleportToCell}
              />
            </div>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={onToggleMinimap}
              className="bg-card/90 shadow-md backdrop-blur-sm"
            >
              <MapIcon className="size-3.5" aria-hidden />
              {ot("office3d.controls.minimapButton")}
            </Button>
          )}
        </div>
      ) : null}

      {/* Centered Bottom Interaction Stack (Prompt + Hotbar + Compact Control Hint) */}
      {!isBuildMode && !replayOpen ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex max-w-full -translate-x-1/2 flex-col items-center gap-1.5 px-2">
          {(() => {
            const selectedItem = hotbar.slots[hotbar.selectedSlot] ?? null;
            const heldBoundIssue =
              !playerSeated &&
              !nearestStation &&
              !canGiveToAgent &&
              selectedItem?.kind === "document" &&
              selectedItem.entityKind === "issue" &&
              Boolean(selectedItem.entityId)
                ? selectedItem
                : null;
            if (!playerSeated && !nearestStation && !heldBoundIssue) return null;
            return (
              <div className="pointer-events-auto">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (playerSeated) {
                      onInteractStation(
                        nearestStation ?? {
                          id: "seat",
                          kind: "sofa",
                          floorId: activeFloor.id,
                          cell: [Math.floor(playerPos.x), Math.floor(playerPos.z)],
                          rotation: 0,
                          interactionRadius: 2,
                          labelKey: "office3d.station.sofa",
                        },
                      );
                      return;
                    }
                    if (nearestStation) {
                      onInteractStation(nearestStation);
                      return;
                    }
                    if (heldBoundIssue) {
                      onUseHotbarItem();
                    }
                  }}
                  className="shadow-lg"
                >
                  {(() => {
                    if (playerSeated) {
                      return ot("office3d.prompt.stand");
                    }
                    if (nearestStation) {
                      const label =
                        nearestStation.labelFallback ??
                        ot(nearestStation.labelKey as Parameters<typeof ot>[0]);
                      if (
                        nearestStation.kind === "sofa" ||
                        nearestStation.kind === "empty_chair" ||
                        nearestStation.kind === "outdoor_bench"
                      ) {
                        return ot("office3d.prompt.sit", { label });
                      }
                      if (nearestStation.kind === "water_cooler") {
                        return ot("office3d.prompt.pickup", { item: ot("office3d.item.water_cup") });
                      }
                      if (nearestStation.kind === "coffee_machine") {
                        return ot("office3d.prompt.pickup", { item: ot("office3d.item.coffee_cup") });
                      }
                      if (nearestStation.kind === "meeting_table") {
                        return ot("office3d.prompt.toggleMeeting");
                      }
                      if (nearestStation.kind === "outdoor_dog") {
                        return nearestStation.badgeCount === 1
                          ? ot("office3d.prompt.petFollow", { label })
                          : ot("office3d.prompt.pet", { label });
                      }
                      if (
                        nearestStation.kind === "outdoor_cat" ||
                        nearestStation.kind === "outdoor_rabbit"
                      ) {
                        return ot("office3d.prompt.pet", { label });
                      }
                      if (nearestStation.kind === "outdoor_koi_pond") {
                        return ot("office3d.prompt.feedKoi");
                      }
                      if (nearestStation.kind === "outdoor_fountain") {
                        return ot("office3d.prompt.tossCoin");
                      }
                      return ot("office3d.prompt.interact", { label });
                    }
                    if (heldBoundIssue) {
                      return ot("office3d.prompt.inspectHeldIssue", { label: heldBoundIssue.label });
                    }
                    return "";
                  })()}
                </Button>
              </div>
            );
          })()}

          {emoteBarOpen && onTriggerEmote ? (
            <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-lg backdrop-blur-sm">
              {(
                [
                  { id: "waving", labelKey: "office3d.emote.wave" },
                  { id: "celebrating", labelKey: "office3d.emote.celebrate" },
                  { id: "clapping", labelKey: "office3d.emote.clap" },
                  { id: "stretching", labelKey: "office3d.emote.stretch" },
                ] as const
              ).map((em) => (
                <Button
                  key={em.id}
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => onTriggerEmote(em.id)}
                >
                  {ot(em.labelKey)}
                </Button>
              ))}
            </div>
          ) : null}

          <OfficeHotbar
            hotbar={hotbar}
            onSelectSlot={onSelectHotbarSlot}
            onSwapSlots={onSwapHotbarSlots}
            onUseSelected={onUseHotbarItem}
            onDropSelected={onDropHotbarItem}
            canGiveToAgent={canGiveToAgent}
            giveTargetAgentName={giveTargetAgentName}
            feedback={hotbarFeedback}
          />

          {!isTouchDevice ? (
            <div className="office-hud-label hidden max-w-full flex-wrap items-center justify-center gap-1.5 rounded-md border border-border bg-background/85 px-2.5 py-0.5 text-center text-muted-foreground backdrop-blur-sm sm:flex">
              <Compass className="size-3.5 shrink-0" aria-hidden />
              <span>
                {cameraMode === "first_person"
                  ? ot("office3d.controls.firstPersonHint")
                  : ot("office3d.controls.hint")}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
