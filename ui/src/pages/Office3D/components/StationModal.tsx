import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ExternalLink,
  Eye,
  FileText,
  FolderCode,
  Maximize2,
  MessageCircle,
  MessagesSquare,
  Minimize2,
  Pause,
  Play,
  Plus,
  Shirt,
  Sliders,
  Terminal,
  X,
} from "lucide-react";
import type {
  Approval,
  CompactIssue,
  Goal,
  HeartbeatRun,
  Project,
  RoutineListItem,
  WorkspaceOverviewItem,
} from "@paperclipai/shared";
import { artifactsApi } from "@/api/artifacts";
import { heartbeatsApi } from "@/api/heartbeats";
import { performanceApi } from "@/api/performance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDialogActions } from "@/context/DialogContext";
import { useTranscriptLiveStream } from "@/context/LiveUpdatesProvider";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { agentRouteRef, formatCents, formatDateTime, issueUrl } from "@/lib/utils";
import type {
  AgentOfficeSnapshot,
  BuildingConfig,
  InteractiveStation,
  OfficeActionCapability,
  OfficeAgentBehaviorConfig,
  OfficeItemKind,
  OfficeKpiSnapshot,
} from "../model/types";
import { useOfficeT } from "../officeCopy";
import { OfficeAgentBehaviorPanel } from "./OfficeAgentBehaviorPanel";
import { OfficeWorkspaceCodeBrowser } from "./OfficeWorkspaceCodeBrowser";

export interface TakeItemMeta {
  entityKind?: "issue" | "agent";
  entityId?: string;
  entityIdentifier?: string;
}

export interface StationModalProps {
  station: InteractiveStation | null;
  onClose: () => void;
  companyId: string;
  activeBuilding: BuildingConfig;
  activeFloorId: string;
  onSwitchFloor: (floorId: string) => void;
  agentsById: Record<string, AgentOfficeSnapshot>;
  recentRuns: HeartbeatRun[];
  pendingApprovals: Approval[];
  routines: RoutineListItem[];
  workspaces: WorkspaceOverviewItem[];
  issues: CompactIssue[];
  goals: Goal[];
  projects: Project[];
  allowedActions: OfficeActionCapability[];
  isPip: boolean;
  onTogglePip: () => void;
  onPauseAgent: (agentId: string) => void;
  onResumeAgent: (agentId: string) => void;
  onApproveItem: (approvalId: string) => void;
  onRejectItem: (approvalId: string) => void;
  onRunRoutine: (routineId: string) => void;
  onCustomizeAgentSkin: (agentId: string) => void;
  onOpenBuildMode?: () => void;
  onTakeItem?: (
    kind: OfficeItemKind,
    label: string,
    sourceStationId?: string,
    meta?: TakeItemMeta,
  ) => void;
  onCaptureScreenshot?: () => void;
  onExportBlueprint?: () => void;
  onOpenHireAgent?: (options?: { floorId?: string; deskId?: string }) => void;
  onOpenChatDrawer?: (agentId: string) => void;
  onOpenAgentDm?: (agentId: string) => void;
  onOpenPlaybookDrawer?: (agentId?: string) => void;
  onAssignIssue?: (issueId: string, agentId: string | null) => void;
  agentBehaviors?: Record<string, OfficeAgentBehaviorConfig>;
  onSaveAgentBehavior?: (agentId: string, behavior: OfficeAgentBehaviorConfig) => void;
  onPreviewAgentSlogan?: (agentId: string, text: string) => void;
  kpiSnapshot?: OfficeKpiSnapshot;
  onFollowAgent?: (agentId: string) => void;
}

export function StationModal({
  station,
  onClose,
  companyId,
  activeBuilding,
  activeFloorId,
  onSwitchFloor,
  agentsById,
  recentRuns,
  pendingApprovals,
  routines,
  workspaces,
  issues,
  goals,
  projects,
  allowedActions,
  isPip,
  onTogglePip,
  onPauseAgent,
  onResumeAgent,
  onApproveItem,
  onRejectItem,
  onRunRoutine,
  onCustomizeAgentSkin,
  onOpenBuildMode,
  onTakeItem,
  onCaptureScreenshot,
  onExportBlueprint,
  onOpenHireAgent,
  onOpenChatDrawer,
  onOpenAgentDm,
  onOpenPlaybookDrawer,
  onAssignIssue,
  agentBehaviors,
  onSaveAgentBehavior,
  onPreviewAgentSlogan,
  kpiSnapshot,
  onFollowAgent,
}: StationModalProps) {
  const ot = useOfficeT();
  const { openNewIssue, openNewAgent } = useDialogActions();
  const [liveEventsBump, setLiveEventsBump] = useState(0);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [selectedPrintIssueId, setSelectedPrintIssueId] = useState<string>("");
  const [browsingWorkspaceId, setBrowsingWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedIssueId(null);
    setSelectedPrintIssueId(issues[0]?.id ?? "");
    setBrowsingWorkspaceId(null);
  }, [station?.id, issues]);

  const agent =
    station?.kind === "agent_desk" && station.targetEntityId
      ? agentsById[station.targetEntityId] ?? null
      : null;

  const latestAgentRunId =
    agent?.currentRunId ??
    (agent
      ? recentRuns.find((r) => r.agentId === agent.agentId)?.id ?? null
      : null);

  useTranscriptLiveStream(latestAgentRunId ? [latestAgentRunId] : [], {
    companyId,
    enabled: Boolean(station?.kind === "agent_desk" && latestAgentRunId),
  }, () => {
    setLiveEventsBump((v) => v + 1);
  });

  const runEventsQuery = useQuery({
    queryKey: ["office3d-run-events", latestAgentRunId, liveEventsBump] as const,
    queryFn: () => heartbeatsApi.events(latestAgentRunId!, 0, 80),
    enabled: Boolean(station?.kind === "agent_desk" && latestAgentRunId),
  });

  const runLogQuery = useQuery({
    queryKey: ["office3d-run-log", latestAgentRunId, liveEventsBump] as const,
    queryFn: () => heartbeatsApi.log(latestAgentRunId!, 0, 64000),
    enabled: Boolean(station?.kind === "agent_desk" && latestAgentRunId),
  });

  const agentArtifactsQuery = useQuery({
    queryKey: queryKeys.artifacts.byAgent(companyId, agent?.agentId ?? ""),
    queryFn: () => artifactsApi.list(companyId, { agentId: agent!.agentId, limit: 12 }),
    enabled: Boolean(station?.kind === "agent_desk" && agent && companyId),
  });

  const companyArtifactsQuery = useQuery({
    queryKey: queryKeys.artifacts.list(companyId, "all", "", "none", ""),
    queryFn: () => artifactsApi.list(companyId, { limit: 20 }),
    enabled: Boolean(station?.kind === "artifacts_showcase" && companyId),
  });

  const performanceQuery = useQuery({
    queryKey: queryKeys.performance.company(companyId, "30d"),
    queryFn: () => performanceApi.getCompanyPerformance(companyId, "30d"),
    enabled: Boolean(station?.kind === "agent_desk" && companyId),
  });
  const agentPerf = agent
    ? performanceQuery.data?.agents.find((row) => row.agentId === agent.agentId) ?? null
    : null;

  useEffect(() => {
    if (!station && isPip) {
      onTogglePip();
    }
  }, [station, isPip, onTogglePip]);

  if (!station) return null;

  const title =
    station.labelFallback ??
    ot(station.labelKey as Parameters<typeof ot>[0]);

  const canApprove = allowedActions.includes("approve");
  const canPause = allowedActions.includes("pause_resume_agent");
  const canAssign = allowedActions.includes("assign_issue");
  const canHire = allowedActions.includes("hire_agent");
  const canEditLayout = allowedActions.includes("edit_layout");

  const awaitingHireAgents = Object.values(agentsById).filter(
    (a) => a.visualState === "awaiting_hire",
  );

  const wideModal = station.kind === "agent_desk" || station.kind === "server_rack";

  return (
    <Dialog open={Boolean(station)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`office-station-dialog ${wideModal ? "sm:max-w-3xl" : "sm:max-w-2xl"}`}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-8">
            <DialogTitle className="truncate">{title}</DialogTitle>
            <Button type="button" size="xs" variant="outline" onClick={onTogglePip}>
              {isPip ? (
                <>
                  <Maximize2 className="size-3.5" aria-hidden />
                  {ot("office3d.controls.pipExpand")}
                </>
              ) : (
                <>
                  <Minimize2 className="size-3.5" aria-hidden />
                  {ot("office3d.controls.pipShrink")}
                </>
              )}
            </Button>
          </div>
        </DialogHeader>

        {station.kind === "agent_desk" && agent ? (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="overview">{ot("office3d.modal.tabOverview")}</TabsTrigger>
              <TabsTrigger value="monitor">
                <Terminal className="size-3.5" aria-hidden />
                {ot("office3d.modal.tabMonitor")}
              </TabsTrigger>
              <TabsTrigger value="codespace">
                <FolderCode className="size-3.5" aria-hidden />
                {ot("office3d.modal.tabCodeSpace")}
              </TabsTrigger>
              <TabsTrigger value="behavior">
                <Sliders className="size-3.5" aria-hidden />
                {ot("office3d.modal.tabBehavior")}
              </TabsTrigger>
              <TabsTrigger value="artifacts">{ot("office3d.modal.tabArtifacts")}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 pt-3">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <Badge variant="outline" className="mt-1">
                    {agent.visualState}
                  </Badge>
                </div>
                <div>
                  <div className="text-muted-foreground">Role</div>
                  <div className="mt-1 font-medium">{agent.role}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Today Cost</div>
                  <div className="mt-1 font-medium">
                    {agent.costTodayCents !== null ? formatCents(agent.costTodayCents) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Budget Used</div>
                  <div className="mt-1 font-medium">
                    {agent.budgetUtilizationPct !== null ? `${agent.budgetUtilizationPct}%` : "Unlimited"}
                  </div>
                </div>
              </div>

              {agentPerf ? (
                <div className="rounded-lg border border-border bg-card/60 p-3 text-xs">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium text-muted-foreground">
                      {ot("office3d.overview.performanceTitle")}
                    </span>
                    <Link
                      to="/performance"
                      onClick={onClose}
                      className="text-primary hover:underline"
                    >
                      {ot("office3d.overview.fullPerformance")}
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <div className="text-muted-foreground">Tasks Done</div>
                      <div className="mt-0.5 font-mono font-medium">
                        {agentPerf.tasksDone}/{agentPerf.totalTasks}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Run Success</div>
                      <div className="mt-0.5 font-mono font-medium">
                        {agentPerf.runSuccessRatePct !== null
                          ? `${agentPerf.runSuccessRatePct.toFixed(1)}%`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Reopen Rate</div>
                      <div className="mt-0.5 font-mono font-medium">
                        {agentPerf.reopenRatePct !== null
                          ? `${agentPerf.reopenRatePct.toFixed(1)}%`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Board Rating</div>
                      <div className="mt-0.5 font-mono font-medium">
                        {agentPerf.avgRating !== null
                          ? `${agentPerf.avgRating.toFixed(1)} / 5`
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {agent.currentIssueIdentifier ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {agent.currentIssueIdentifier}
                  </span>
                  <p className="mt-0.5 font-medium">{agent.currentIssueTitle}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {onOpenChatDrawer ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onClose();
                      onOpenChatDrawer(agent.agentId);
                    }}
                  >
                    <MessageCircle className="size-4" aria-hidden />
                    {ot("office3d.modal.chat")}
                  </Button>
                ) : (
                  <Button asChild type="button" size="sm">
                    <Link
                      to={`/chats/${encodeURIComponent(agentRouteRef({ id: agent.agentId, urlKey: agent.urlKey, name: agent.name }))}`}
                      onClick={onClose}
                    >
                      <MessageCircle className="size-4" aria-hidden />
                      {ot("office3d.modal.chat")}
                    </Link>
                  </Button>
                )}

                {onOpenAgentDm ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onClose();
                      onOpenAgentDm(agent.agentId);
                    }}
                  >
                    <MessagesSquare className="size-4" aria-hidden />
                    {ot("office3d.modal.dmTeamChat")}
                  </Button>
                ) : null}

                {onFollowAgent ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onClose();
                      onFollowAgent(agent.agentId);
                    }}
                  >
                    <Eye className="size-4" aria-hidden />
                    {ot("office3d.controls.followAgent")}
                  </Button>
                ) : null}

                {canAssign ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onClose();
                      openNewIssue({ assigneeAgentId: agent.agentId });
                    }}
                  >
                    <Plus className="size-4" aria-hidden />
                    {ot("office3d.modal.assignTask")}
                  </Button>
                ) : null}

                {onOpenPlaybookDrawer ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onClose();
                      onOpenPlaybookDrawer(agent.agentId);
                    }}
                  >
                    <BookOpen className="size-4" aria-hidden />
                    {ot("office3d.modal.readPlaybook")}
                  </Button>
                ) : null}

                {canPause ? (
                  agent.visualState === "paused" || agent.visualState === "paused_budget" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onResumeAgent(agent.agentId)}
                    >
                      <Play className="size-4" aria-hidden />
                      {ot("office3d.modal.resume")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onPauseAgent(agent.agentId)}
                    >
                      <Pause className="size-4" aria-hidden />
                      {ot("office3d.modal.pause")}
                    </Button>
                  )
                ) : null}

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onCustomizeAgentSkin(agent.agentId)}
                >
                  <Shirt className="size-4" aria-hidden />
                  {ot("office3d.controls.customizeAvatar")}
                </Button>

                <Button asChild type="button" size="sm" variant="ghost">
                  <Link
                    to={`/agents/${encodeURIComponent(agentRouteRef({ id: agent.agentId, urlKey: agent.urlKey, name: agent.name }))}`}
                    onClick={onClose}
                  >
                    <ExternalLink className="size-4" aria-hidden />
                    {ot("office3d.modal.openDetail")}
                  </Link>
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="monitor" className="space-y-3 pt-3">
              {!latestAgentRunId ? (
                <p className="text-sm text-muted-foreground">{ot("office3d.modal.noActiveRun")}</p>
              ) : (
                <>
                  <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                    {(runEventsQuery.data ?? []).map((ev) => (
                      <div key={ev.id} className="flex gap-2">
                        <span className="shrink-0 text-muted-foreground">
                          {new Date(ev.createdAt).toLocaleTimeString()}
                        </span>
                        <span className="shrink-0 font-semibold">[{ev.eventType}]</span>
                        <span className="min-w-0 break-words">
                          {ev.message ?? JSON.stringify(ev.payload ?? {})}
                        </span>
                      </div>
                    ))}
                    {runLogQuery.data?.content ? (
                      <pre className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-muted-foreground">
                        {runLogQuery.data.content.slice(-3000)}
                      </pre>
                    ) : null}
                  </div>
                  <div className="flex justify-end">
                    <Button asChild size="xs" variant="outline">
                      <Link
                        to={`/agents/${encodeURIComponent(agentRouteRef({ id: agent.agentId, urlKey: agent.urlKey, name: agent.name }))}/runs/${latestAgentRunId}`}
                        onClick={onClose}
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                        Full Run View
                      </Link>
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="codespace" className="pt-3">
              <OfficeWorkspaceCodeBrowser
                companyId={companyId}
                agentId={agent.agentId}
                preferredIssueIdentifier={agent.currentIssueIdentifier}
              />
            </TabsContent>

            <TabsContent value="behavior" className="pt-3">
              <OfficeAgentBehaviorPanel
                agentId={agent.agentId}
                agentName={agent.name}
                behavior={agentBehaviors?.[agent.agentId]}
                canEdit={canEditLayout}
                onSave={onSaveAgentBehavior}
                onPreviewSlogan={onPreviewAgentSlogan}
              />
            </TabsContent>

            <TabsContent value="artifacts" className="space-y-2 pt-3">
              {(agentArtifactsQuery.data?.artifacts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No artifacts published by this agent yet.</p>
              ) : (
                (agentArtifactsQuery.data?.artifacts ?? []).map((art) => (
                  <div
                    key={art.id}
                    className="flex items-center justify-between rounded-md border border-border p-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{art.title}</p>
                      <p className="text-xs text-muted-foreground">{art.mediaKind}</p>
                    </div>
                    <Button asChild size="xs" variant="outline">
                      <Link to="/artifacts" onClick={onClose}>
                        View
                      </Link>
                    </Button>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        ) : null}

        {station.kind === "approval_desk" ? (
          <div className="space-y-3">
            {pendingApprovals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending approvals right now.</p>
            ) : (
              pendingApprovals.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{app.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(app.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {canApprove ? (
                      <>
                        <Button size="xs" onClick={() => onApproveItem(app.id)}>
                          <Check className="size-3.5" aria-hidden />
                          {ot("office3d.modal.approve")}
                        </Button>
                        <Button size="xs" variant="destructive" onClick={() => onRejectItem(app.id)}>
                          <X className="size-3.5" aria-hidden />
                          {ot("office3d.modal.reject")}
                        </Button>
                      </>
                    ) : (
                      <Badge variant="outline">{ot("office3d.modal.noPermission")}</Badge>
                    )}
                  </div>
                </div>
              ))
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/decisions" onClick={onClose}>
                  Open Decisions Queue
                </Link>
              </Button>
            </div>
          </div>
        ) : null}

        {station.kind === "server_rack" ? (
          browsingWorkspaceId ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => setBrowsingWorkspaceId(null)}
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {ot("office3d.codeSpace.backToWorkspaces")}
                </Button>
              </div>
              <OfficeWorkspaceCodeBrowser
                companyId={companyId}
                initialWorkspaceId={browsingWorkspaceId}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {workspaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active execution workspaces.</p>
              ) : (
                workspaces.map((ws) => (
                  <div
                    key={ws.workspaceId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{ws.workspaceName}</p>
                      <p className="text-xs text-muted-foreground">
                        {ws.branchName ?? ws.strategyType} · {ws.runningServiceCount}/{ws.serviceCount} services
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => setBrowsingWorkspaceId(ws.workspaceId)}
                      >
                        <FolderCode className="size-3.5" aria-hidden />
                        {ot("office3d.codeSpace.browseCode")}
                      </Button>
                      {ws.primaryServiceUrl ? (
                        <Button asChild size="xs" variant="outline">
                          <a href={ws.primaryServiceUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="size-3.5" aria-hidden />
                            Preview
                          </a>
                        </Button>
                      ) : null}
                      <Button asChild size="xs" variant="ghost">
                        <Link to={`/execution-workspaces/${ws.workspaceId}`} onClick={onClose}>
                          Inspect
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )
        ) : null}

        {station.kind === "hr_reception" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {canHire ? (
                <Button
                  size="sm"
                  onClick={() => {
                    onClose();
                    if (onOpenHireAgent) {
                      onOpenHireAgent();
                    } else {
                      openNewAgent();
                    }
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  {ot("office3d.modal.hireAgent")}
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline">
                <Link to="/teams-catalog" onClick={onClose}>
                  {ot("office3d.modal.teamCatalog")}
                </Link>
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Awaiting Approval ({awaitingHireAgents.length})
              </p>
              {awaitingHireAgents.map((a) => (
                <div
                  key={a.agentId}
                  className="flex items-center justify-between rounded-md border border-border p-2.5 text-sm"
                >
                  <span>
                    {a.name} · {a.role}
                  </span>
                  <Button asChild size="xs" variant="outline">
                    <Link to="/approvals" onClick={onClose}>
                      Review
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {station.kind === "routines_clock" ? (
          <div className="space-y-2">
            {routines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No routines configured.</p>
            ) : (
              routines.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-md border border-border p-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.status}</p>
                  </div>
                  <Button size="xs" variant="outline" onClick={() => onRunRoutine(r.id)}>
                    <Play className="size-3.5" aria-hidden />
                    {ot("office3d.modal.runNow")}
                  </Button>
                </div>
              ))
            )}
          </div>
        ) : null}

        {station.kind === "artifacts_showcase" ? (
          <div className="space-y-2">
            {(companyArtifactsQuery.data?.artifacts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No company artifacts found.</p>
            ) : (
              (companyArtifactsQuery.data?.artifacts ?? []).map((art) => (
                <div
                  key={art.id}
                  className="flex items-center justify-between rounded-md border border-border p-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{art.title}</p>
                    <p className="text-xs text-muted-foreground">{art.mediaKind}</p>
                  </div>
                  <Button asChild size="xs" variant="outline">
                    <Link to="/artifacts" onClick={onClose}>
                      Open
                    </Link>
                  </Button>
                </div>
              ))
            )}
          </div>
        ) : null}

        {station.kind === "whiteboard" || station.kind === "filing_cabinet" ? (() => {
          const isWhiteboard = station.kind === "whiteboard";
          const boundProject = isWhiteboard && station.targetEntityId
            ? projects.find((p) => p.id === station.targetEntityId) ?? null
            : null;
          const visibleIssues = boundProject
            ? issues.filter((i) => i.projectId === boundProject.id)
            : issues;
          const visibleAgents = Object.values(agentsById).filter((a) => a.visualState !== "hidden");
          const topIssue = visibleIssues[0];

          return (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {boundProject ? `${boundProject.name} Tasks` : "Recent Tasks"} ({visibleIssues.length})
                  </p>
                  {!isWhiteboard && onTakeItem ? (
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => {
                        const label = topIssue?.identifier ?? topIssue?.title ?? ot("office3d.item.document");
                        onTakeItem(
                          "document",
                          label,
                          station.id,
                          topIssue
                            ? {
                                entityKind: "issue",
                                entityId: topIssue.id,
                                entityIdentifier: topIssue.identifier ?? undefined,
                              }
                            : undefined,
                        );
                        onClose();
                      }}
                    >
                      {ot("office3d.modal.takeDocument")}
                    </Button>
                  ) : null}
                </div>

                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {visibleIssues.slice(0, 10).map((issue) => {
                    const isExpanded = expandedIssueId === issue.id;
                    return (
                      <div key={issue.id} className="rounded-md border border-border">
                        <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-accent/50">
                          <button
                            type="button"
                            onClick={() => setExpandedIssueId(isExpanded ? null : issue.id)}
                            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                          >
                            <span className="truncate font-medium">
                              {issue.identifier ? `${issue.identifier} · ` : ""}
                              {issue.title}
                            </span>
                            <Badge variant="outline">{issue.status}</Badge>
                          </button>

                          {onTakeItem ? (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => {
                                onTakeItem(
                                  "document",
                                  issue.identifier ?? issue.title,
                                  station.id,
                                  {
                                    entityKind: "issue",
                                    entityId: issue.id,
                                    entityIdentifier: issue.identifier ?? undefined,
                                  },
                                );
                                onClose();
                              }}
                            >
                              <FileText className="size-3" aria-hidden />
                              {ot("office3d.modal.carryIssue")}
                            </Button>
                          ) : null}

                          <Button asChild type="button" size="icon-xs" variant="ghost" title={ot("office3d.modal.openFullPage")}>
                            <Link to={issueUrl(issue)} onClick={onClose}>
                              <ExternalLink className="size-3.5" aria-hidden />
                            </Link>
                          </Button>
                        </div>

                        {isExpanded ? (
                          <div className="space-y-2 border-t border-border bg-muted/30 px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                              <span>Priority: {issue.priority}</span>
                              {canAssign && onAssignIssue ? (
                                <label className="flex items-center gap-1.5">
                                  <span>Assignee:</span>
                                  <select
                                    value={issue.assigneeAgentId ?? ""}
                                    onChange={(e) => onAssignIssue(issue.id, e.target.value || null)}
                                    className="rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground"
                                  >
                                    <option value="">Unassigned</option>
                                    {visibleAgents.map((ag) => (
                                      <option key={ag.agentId} value={ag.agentId}>
                                        {ag.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : null}
                            </div>
                            {issue.description ? (
                              <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                                {issue.description}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {isWhiteboard ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Company Goals ({goals.length})
                  </p>
                  <div className="space-y-1.5">
                    {goals.slice(0, 5).map((g) => (
                      <Link
                        key={g.id}
                        to={`/goals/${g.id}`}
                        onClick={onClose}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
                      >
                        <span className="truncate font-medium">{g.title}</span>
                        <Badge variant="outline">{g.status}</Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })() : null}

        {station.kind === "elevator" ? (
          <div className="space-y-3">
            <div className="space-y-2">
              {activeBuilding.floors.map((floor) => {
                const seatedCount = floor.desks.filter((d) => Boolean(d.assignedAgentId)).length;
                return (
                  <button
                    key={floor.id}
                    type="button"
                    onClick={() => {
                      onSwitchFloor(floor.id);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className="font-medium">{floor.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{seatedCount} agents</Badge>
                      {floor.id === activeFloorId ? <Badge>Current</Badge> : null}
                    </div>
                  </button>
                );
              })}
            </div>
            {activeBuilding.floors.length <= 1 ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p>{ot("office3d.modal.elevatorSingleFloorHint")}</p>
                {canEditLayout && onOpenBuildMode ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      onClose();
                      onOpenBuildMode();
                    }}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {ot("office3d.modal.elevatorOpenBuild")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {station.kind === "bookshelf" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Browse team roles & agent playbooks or carry a handbook in your hotbar.
              </p>
              {onTakeItem ? (
                <Button
                  type="button"
                  size="xs"
                  onClick={() => {
                    onTakeItem("handbook", ot("office3d.item.handbook"), station.id);
                    onClose();
                  }}
                >
                  {ot("office3d.modal.takeHandbook")}
                </Button>
              ) : null}
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {Object.values(agentsById)
                .filter((a) => a.visualState !== "hidden")
                .map((ag) => (
                  <div
                    key={ag.agentId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent/50"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenPlaybookDrawer?.(ag.agentId);
                      }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                    >
                      <span className="truncate font-medium">{ag.name}</span>
                      <Badge variant="outline">{ag.role}</Badge>
                    </button>
                    {onTakeItem ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          onTakeItem("handbook", `${ag.name} Guide`, station.id, {
                            entityKind: "agent",
                            entityId: ag.agentId,
                          });
                          onClose();
                        }}
                      >
                        <BookOpen className="size-3" aria-hidden />
                        {ot("office3d.modal.carryIssue")}
                      </Button>
                    ) : null}
                  </div>
                ))}
            </div>
          </div>
        ) : null}

        {station.kind === "printer" ? (() => {
          const selectedIssue = issues.find((i) => i.id === selectedPrintIssueId) ?? null;
          return (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Print a task report into your hotbar, capture a 3D snapshot, or export the office blueprint.
              </p>
              {issues.length > 0 ? (
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">Issue to bind to report</span>
                  <select
                    id="office-printer-issue"
                    name="officePrinterIssue"
                    value={selectedPrintIssueId}
                    onChange={(e) => setSelectedPrintIssueId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
                  >
                    <option value="">Blank Document (Open Assign Task dialog)</option>
                    {issues.slice(0, 15).map((issue) => (
                      <option key={issue.id} value={issue.id}>
                        {issue.identifier ? `${issue.identifier} · ` : ""}
                        {issue.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {onTakeItem ? (
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => {
                      const reportName = selectedIssue?.identifier
                        ? selectedIssue.identifier
                        : selectedIssue?.title ?? ot("office3d.item.document");
                      onTakeItem(
                        "document",
                        reportName,
                        station.id,
                        selectedIssue
                          ? {
                              entityKind: "issue",
                              entityId: selectedIssue.id,
                              entityIdentifier: selectedIssue.identifier ?? undefined,
                            }
                          : undefined,
                      );
                      onClose();
                    }}
                  >
                    {ot("office3d.modal.printReport")}
                  </Button>
                ) : null}
                {onCaptureScreenshot ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      onCaptureScreenshot();
                      onClose();
                    }}
                  >
                    {ot("office3d.modal.captureSnapshot")}
                  </Button>
                ) : null}
                {onExportBlueprint ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      onExportBlueprint();
                      onClose();
                    }}
                  >
                    {ot("office3d.modal.exportBlueprint")}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })() : null}

        {station.kind === "kpi_screen" && kpiSnapshot ? (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground">{ot("office3d.kpi.title")}</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                <div className="text-muted-foreground">{ot("office3d.kpi.doneTasks")}</div>
                <div className="mt-1 font-mono text-base font-semibold text-foreground">
                  {kpiSnapshot.doneIssues}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                <div className="text-muted-foreground">{ot("office3d.kpi.activeTasks")}</div>
                <div className="mt-1 font-mono text-base font-semibold text-foreground">
                  {kpiSnapshot.activeIssues}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                <div className="text-muted-foreground">{ot("office3d.kpi.runningAgents")}</div>
                <div className="mt-1 font-mono text-base font-semibold text-foreground">
                  {kpiSnapshot.runningAgents}/{kpiSnapshot.totalAgents}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                <div className="text-muted-foreground">{ot("office3d.kpi.todaySpend")}</div>
                <div className="mt-1 font-mono text-base font-semibold text-foreground">
                  {formatCents(kpiSnapshot.costTodayCents)}
                </div>
              </div>
            </div>
            {kpiSnapshot.topAgentName ? (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs">
                <span className="text-muted-foreground">{ot("office3d.kpi.topAgent")}</span>
                <span className="font-semibold text-foreground">
                  {kpiSnapshot.topAgentName}
                  {typeof kpiSnapshot.topAgentScore === "number"
                    ? ` (${Math.round(kpiSnapshot.topAgentScore)})`
                    : ""}
                </span>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button asChild size="sm">
                <Link to="/performance" onClick={onClose}>
                  <ExternalLink className="size-3.5" aria-hidden />
                  {ot("office3d.kpi.openPerformance")}
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
