import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  Approval,
  BudgetOverview,
  CompanyArtifact,
  CompactIssue,
  Goal,
  HeartbeatRun,
  LiveEvent,
  RoutineListItem,
  WorkspaceOverviewItem,
} from "@paperclipai/shared";
import { accessApi } from "@/api/access";
import { agentsApi } from "@/api/agents";
import { approvalsApi } from "@/api/approvals";
import { artifactsApi } from "@/api/artifacts";
import { budgetsApi } from "@/api/budgets";
import { costsApi } from "@/api/costs";
import { executionWorkspacesApi } from "@/api/execution-workspaces";
import { goalsApi } from "@/api/goals";
import { heartbeatsApi, type LiveRunForIssue } from "@/api/heartbeats";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { routinesApi } from "@/api/routines";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useOptionalToastActions } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { mapAgentVisualState } from "./model/agentState";
import {
  CONTROL_PLANE_THROTTLE_MS,
  RECAP_TRIGGER_HOUR,
  TROPHY_SUCCEEDED_RUNS_THRESHOLD,
} from "./model/constants";
import { findAgentDeskLocation } from "./model/layout";
import { formatLocalDateKey } from "./model/lighting";
import { dismissRecapForDate, isRecapDismissedForDate } from "./model/storage";
import type {
  AgentMovementTask,
  AgentOfficeSnapshot,
  EndOfDayRecap,
  EnvironmentConfig,
  OfficeActionCapability,
  OfficeControlPlaneSummary,
  OfficeLayout,
  WorldMarker,
} from "./model/types";

function startOfLocalDayIso(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}

function classifyLiveRunEventKind(payload: Record<string, unknown>): "tool_call" | "message" | "unknown" {
  const rawType = typeof payload.eventType === "string"
    ? payload.eventType
    : typeof payload.type === "string"
      ? payload.type
      : "";
  const lower = rawType.toLowerCase();
  if (lower.includes("tool") || typeof payload.toolName === "string" || typeof payload.currentToolName === "string") {
    return "tool_call";
  }
  if (lower.includes("message") || lower.includes("assistant") || lower.includes("reason") || lower.includes("think")) {
    return "message";
  }
  return "unknown";
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export interface UseOfficeControlPlaneBridgeOptions {
  layout: OfficeLayout | null;
  environment: EnvironmentConfig;
  meetingActive?: boolean;
  onMovementTask?: (task: AgentMovementTask) => void;
  onRunCompleted?: (agentId?: string) => void;
  onRunFailed?: () => void;
}

export function useOfficeControlPlaneBridge({
  layout,
  environment,
  meetingActive = false,
  onMovementTask,
  onRunCompleted,
  onRunFailed,
}: UseOfficeControlPlaneBridgeOptions) {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? "";
  const queryClient = useQueryClient();
  const pushToast = useOptionalToastActions()?.pushToast ?? null;

  const todayStartIso = useMemo(() => startOfLocalDayIso(), []);
  const todayDateKey = useMemo(() => formatLocalDateKey(new Date()), []);
  const [recapDismissed, setRecapDismissed] = useState(() =>
    companyId ? isRecapDismissedForDate(companyId, todayDateKey) : false,
  );
  useEffect(() => {
    setRecapDismissed(companyId ? isRecapDismissedForDate(companyId, todayDateKey) : false);
  }, [companyId, todayDateKey]);

  const [eventTick, setEventTick] = useState(0);
  const lastEventKindByAgentRef = useRef<Map<string, "tool_call" | "message" | "unknown">>(new Map());
  const throttleTimerRef = useRef<number | null>(null);
  const layoutRef = useRef<OfficeLayout | null>(layout);
  const onMovementTaskRef = useRef(onMovementTask);
  const agentNameByIdRef = useRef<Map<string, string>>(new Map());
  layoutRef.current = layout;
  onMovementTaskRef.current = onMovementTask;

  const scheduleTick = useCallback(() => {
    if (throttleTimerRef.current !== null) return;
    throttleTimerRef.current = window.setTimeout(() => {
      throttleTimerRef.current = null;
      setEventTick((v) => v + 1);
    }, CONTROL_PLANE_THROTTLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  useCompanyLiveEvent((event: LiveEvent) => {
    const payload = event.payload ?? {};
    const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
    const currentLayout = layoutRef.current;

    if (event.type === "heartbeat.run.event" || event.type === "heartbeat.run.progress") {
      if (agentId) {
        lastEventKindByAgentRef.current.set(agentId, classifyLiveRunEventKind(payload));
        scheduleTick();
      }
    } else if (event.type === "heartbeat.run.queued" && agentId && currentLayout) {
      const desk = findAgentDeskLocation(currentLayout, agentId);
      if (desk) {
        onMovementTaskRef.current?.({
          id: `move-${Date.now()}-${agentId}`,
          agentId,
          purpose: "return_desk",
          targetFloorId: desk.floorId,
          targetCell: desk.cell,
          bubbleText: "New task assigned!",
          startedAt: Date.now(),
        });
      }
      scheduleTick();
    } else if (event.type === "heartbeat.run.status") {
      const status = typeof payload.status === "string" ? payload.status : "";
      if (status === "succeeded") {
        onRunCompleted?.(agentId ?? undefined);
      } else if (status === "failed" || status === "timed_out") {
        onRunFailed?.();
      }
      if (agentId && (status === "running" || status === "queued") && currentLayout) {
        const desk = findAgentDeskLocation(currentLayout, agentId);
        if (desk) {
          onMovementTaskRef.current?.({
            id: `move-${Date.now()}-${agentId}`,
            agentId,
            purpose: "return_desk",
            targetFloorId: desk.floorId,
            targetCell: desk.cell,
            startedAt: Date.now(),
          });
        }
      }
      if (agentId && status !== "running") {
        lastEventKindByAgentRef.current.delete(agentId);
      }
      scheduleTick();
    } else if (event.type === "activity.logged" && currentLayout) {
      const entityType = typeof payload.entityType === "string" ? payload.entityType : "";
      const action = typeof payload.action === "string" ? payload.action : "";
      const actorType = typeof payload.actorType === "string" ? payload.actorType : "";
      const actorId = typeof payload.actorId === "string" ? payload.actorId : "";
      const details =
        payload.details && typeof payload.details === "object"
          ? (payload.details as Record<string, unknown>)
          : {};

      if (
        entityType === "issue" &&
        (action === "issue.created" ||
          action === "issue.updated" ||
          action === "issue.comment_added")
      ) {
        const assigneeId =
          typeof details.assigneeAgentId === "string" ? details.assigneeAgentId : null;
        const mentionedIds = Array.isArray(details.mentionedAgentIds)
          ? details.mentionedAgentIds.filter((x): x is string => typeof x === "string")
          : [];
        const targetId = assigneeId ?? mentionedIds[0] ?? null;

        if (actorType === "agent" && actorId && targetId && targetId !== actorId) {
          const targetDesk = findAgentDeskLocation(currentLayout, targetId);
          if (targetDesk) {
            const targetName = agentNameByIdRef.current.get(targetId) ?? "teammate";
            onMovementTaskRef.current?.({
              id: `handoff-${Date.now()}-${actorId}`,
              agentId: actorId,
              purpose: "handoff",
              targetFloorId: targetDesk.floorId,
              targetCell: targetDesk.cell,
              targetAgentId: targetId,
              bubbleText: `Handing off to ${targetName}`,
              startedAt: Date.now(),
            });
          }
        } else if (assigneeId) {
          const targetDesk = findAgentDeskLocation(currentLayout, assigneeId);
          if (targetDesk) {
            onMovementTaskRef.current?.({
              id: `assign-${Date.now()}-${assigneeId}`,
              agentId: assigneeId,
              purpose: "return_desk",
              targetFloorId: targetDesk.floorId,
              targetCell: targetDesk.cell,
              bubbleText: "New task assigned!",
              startedAt: Date.now(),
            });
          }
        }
      }
    }
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: Boolean(companyId),
  });

  const liveRunsQuery = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    enabled: Boolean(companyId),
  });

  const runsQuery = useQuery({
    queryKey: queryKeys.heartbeats(companyId),
    queryFn: () => heartbeatsApi.list(companyId, undefined, 40, { summary: true }),
    enabled: Boolean(companyId),
  });

  const approvalsQuery = useQuery({
    queryKey: queryKeys.approvals.list(companyId, "pending"),
    queryFn: () => approvalsApi.list(companyId, "pending"),
    enabled: Boolean(companyId),
  });

  const costsByAgentQuery = useQuery({
    queryKey: queryKeys.costs(companyId, todayStartIso),
    queryFn: () => costsApi.byAgent(companyId, todayStartIso),
    enabled: Boolean(companyId),
  });

  const costSummaryQuery = useQuery({
    queryKey: [...queryKeys.costs(companyId, todayStartIso), "summary"] as const,
    queryFn: () => costsApi.summary(companyId, todayStartIso),
    enabled: Boolean(companyId),
  });

  const budgetsQuery = useQuery({
    queryKey: queryKeys.budgets.overview(companyId),
    queryFn: () => budgetsApi.overview(companyId),
    enabled: Boolean(companyId),
  });

  const routinesQuery = useQuery({
    queryKey: queryKeys.routines.list(companyId),
    queryFn: () => routinesApi.list(companyId),
    enabled: Boolean(companyId),
  });

  const workspacesQuery = useQuery({
    queryKey: queryKeys.executionWorkspaces.overview(companyId, { limit: 20 }),
    queryFn: () => executionWorkspacesApi.listOverview(companyId, { limit: 20 }),
    enabled: Boolean(companyId),
  });

  const artifactsQuery = useQuery({
    queryKey: queryKeys.artifacts.list(companyId, "all", "", "none", ""),
    queryFn: () => artifactsApi.list(companyId, { limit: 20 }),
    enabled: Boolean(companyId),
  });

  const issuesQuery = useQuery({
    queryKey: [...queryKeys.issues.list(companyId), "office3d-compact"] as const,
    queryFn: () =>
      issuesApi.listCompact(companyId, {
        projection: "index",
        limit: 80,
        sortField: "updated",
        sortDir: "desc",
      }),
    enabled: Boolean(companyId),
  });

  const goalsQuery = useQuery({
    queryKey: queryKeys.goals.list(companyId),
    queryFn: () => goalsApi.list(companyId),
    enabled: Boolean(companyId),
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(companyId),
    queryFn: () => projectsApi.list(companyId),
    enabled: Boolean(companyId),
  });

  const accessQuery = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
  });

  const allowedActions = useMemo<OfficeActionCapability[]>(() => {
    const access = accessQuery.data;
    if (!access) {
      return ["approve", "pause_resume_agent", "assign_issue", "hire_agent", "edit_layout"];
    }
    const membership = access.memberships?.find((m) => m.companyId === companyId);
    const isViewerOnly =
      !access.isInstanceAdmin &&
      membership?.membershipRole === "viewer";
    if (isViewerOnly) return [];
    return ["approve", "pause_resume_agent", "assign_issue", "hire_agent", "edit_layout"];
  }, [accessQuery.data, companyId]);

  const agents: Agent[] = agentsQuery.data ?? [];
  const liveRuns: LiveRunForIssue[] = liveRunsQuery.data ?? [];
  const recentRuns: HeartbeatRun[] = runsQuery.data ?? [];
  const pendingApprovals: Approval[] = approvalsQuery.data ?? [];
  const routines: RoutineListItem[] = routinesQuery.data ?? [];
  const workspaces: WorkspaceOverviewItem[] = workspacesQuery.data?.items ?? [];
  const artifacts: CompanyArtifact[] = artifactsQuery.data?.artifacts ?? [];
  const issues: CompactIssue[] = issuesQuery.data ?? [];
  const goals: Goal[] = goalsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const budgetOverview: BudgetOverview | undefined = budgetsQuery.data;

  useEffect(() => {
    agentNameByIdRef.current = new Map(agents.map((a) => [a.id, a.name]));
  }, [agents]);

  const trophyAgentIds = useMemo(() => {
    const succeededCounts = new Map<string, number>();
    for (const run of recentRuns) {
      if (run.status === "succeeded") {
        succeededCounts.set(run.agentId, (succeededCounts.get(run.agentId) ?? 0) + 1);
      }
    }
    const ids = new Set<string>();
    for (const [aid, count] of succeededCounts.entries()) {
      if (count >= TROPHY_SUCCEEDED_RUNS_THRESHOLD) {
        ids.add(aid);
      }
    }
    return ids;
  }, [recentRuns]);

  const summary = useMemo<OfficeControlPlaneSummary>(() => {
    const now = Date.now();
    const issueMap = new Map<string, CompactIssue>(issues.map((i) => [i.id, i]));
    const liveRunByAgent = new Map<string, LiveRunForIssue>();
    for (const run of liveRuns) {
      if (!liveRunByAgent.has(run.agentId)) {
        liveRunByAgent.set(run.agentId, run);
      }
    }

    const latestRunByAgent = new Map<string, HeartbeatRun>();
    const latestFailAtByAgent = new Map<string, string>();
    for (const run of recentRuns) {
      if (!latestRunByAgent.has(run.agentId)) {
        latestRunByAgent.set(run.agentId, run);
      }
      if ((run.status === "failed" || run.status === "timed_out") && !latestFailAtByAgent.has(run.agentId)) {
        const ts = run.finishedAt ?? run.createdAt;
        if (ts) latestFailAtByAgent.set(run.agentId, new Date(ts).toISOString());
      }
    }

    const costTodayByAgent = new Map<string, number>();
    for (const row of costsByAgentQuery.data ?? []) {
      if (row.agentId) costTodayByAgent.set(row.agentId, row.costCents);
    }

    const budgetPolicyByAgent = new Map<string, number>();
    for (const policy of budgetOverview?.policies ?? []) {
      if (policy.scopeType === "agent" && policy.isActive) {
        budgetPolicyByAgent.set(policy.scopeId, policy.utilizationPercent);
      }
    }

    const agentsById: Record<string, AgentOfficeSnapshot> = {};
    for (const agent of agents) {
      const liveRun = liveRunByAgent.get(agent.id) ?? null;
      const latestRun = latestRunByAgent.get(agent.id) ?? null;
      const currentRun = liveRun ?? latestRun;

      let lastRunEventKind = lastEventKindByAgentRef.current.get(agent.id) ?? null;
      if (!lastRunEventKind && liveRun) {
        if (liveRun.currentToolName) lastRunEventKind = "tool_call";
        else if (liveRun.lastAssistantSnippet) lastRunEventKind = "message";
      }

      const visualState = mapAgentVisualState({
        agentStatus: agent.status,
        pauseReason: agent.pauseReason,
        currentRunStatus: (currentRun?.status as HeartbeatRun["status"] | undefined) ?? null,
        lastRunFailedAt: latestFailAtByAgent.get(agent.id) ?? null,
        lastRunEventKind,
        inMeeting: meetingActive,
        now,
      });

      const issueId = currentRun?.issueId ?? null;
      const issue = issueId ? issueMap.get(issueId) : undefined;
      const budgetPct =
        budgetPolicyByAgent.get(agent.id) ??
        (agent.budgetMonthlyCents > 0
          ? Math.round((agent.spentMonthlyCents / agent.budgetMonthlyCents) * 100)
          : null);

      agentsById[agent.id] = {
        agentId: agent.id,
        name: agent.name,
        urlKey: agent.urlKey,
        role: agent.role,
        title: agent.title,
        icon: agent.icon,
        reportsTo: agent.reportsTo,
        visualState,
        currentRunId: currentRun?.id ?? null,
        currentIssueIdentifier: issue?.identifier ?? null,
        currentIssueTitle: issue?.title ?? null,
        runStartedAt: currentRun?.startedAt ? new Date(currentRun.startedAt).toISOString() : null,
        costTodayCents: costTodayByAgent.get(agent.id) ?? null,
        budgetUtilizationPct: budgetPct,
      };
    }

    const upcomingRoutines = routines.map((r) => {
      const nextTrigger = r.triggers.find((t) => t.enabled && t.nextRunAt);
      return {
        routineId: r.id,
        name: r.title,
        nextRunAt: nextTrigger?.nextRunAt ? new Date(nextTrigger.nextRunAt).toISOString() : null,
        status: r.status,
      };
    });

    const runningWorkspaces = workspaces.map((w) => ({
      workspaceId: w.workspaceId,
      name: w.workspaceName,
      status:
        w.primaryService?.healthStatus === "unhealthy"
          ? ("unhealthy" as const)
          : w.runningServiceCount > 0 || w.primaryServiceUrlRunning
            ? ("healthy" as const)
            : ("stopped" as const),
      previewUrl: w.primaryServiceUrl ?? w.primaryService?.url ?? undefined,
    }));

    return {
      companyId,
      pendingApprovalsCount: pendingApprovals.length,
      upcomingRoutines,
      runningWorkspaces,
      recentArtifactsCount: artifacts.length,
      agentsById,
      allowedActions,
    };
    // eventTick ensures re-evaluation when WebSocket events mutate ref
  }, [
    agents,
    allowedActions,
    artifacts.length,
    budgetOverview?.policies,
    companyId,
    costsByAgentQuery.data,
    eventTick,
    issues,
    liveRuns,
    meetingActive,
    pendingApprovals.length,
    recentRuns,
    routines,
    workspaces,
  ]);

  const markers = useMemo<WorldMarker[]>(() => {
    if (!layout) return [];
    const out: WorldMarker[] = [];
    const now = Date.now();

    for (const snap of Object.values(summary.agentsById)) {
      if (snap.visualState !== "error" && snap.visualState !== "paused_budget") continue;
      const loc = findAgentDeskLocation(layout, snap.agentId);
      if (!loc) continue;
      out.push({
        id: `marker-agent-${snap.agentId}`,
        kind: snap.visualState === "paused_budget" ? "budget_paused" : "run_error",
        floorId: loc.floorId,
        cell: loc.cell,
        targetEntityId: snap.agentId,
        label: snap.name,
        createdAt: now,
        expiresAt: null,
      });
    }

    if (summary.pendingApprovalsCount > 0) {
      for (const b of layout.buildings) {
        for (const f of b.floors) {
          const desk = f.furniture.find((item) => item.kind === "approval_desk");
          if (desk) {
            out.push({
              id: `marker-approvals-${f.id}`,
              kind: "approval_pending",
              floorId: f.id,
              cell: [desk.x, desk.z],
              targetEntityId: desk.id,
              label: String(summary.pendingApprovalsCount),
              createdAt: now,
              expiresAt: null,
            });
          }
        }
      }
    }

    return out;
  }, [layout, summary.agentsById, summary.pendingApprovalsCount]);

  const endOfDayRecap = useMemo<EndOfDayRecap | null>(() => {
    if (
      !companyId ||
      environment.timeMode !== "realtime" ||
      !environment.enableEndOfDayRecap ||
      recapDismissed
    ) {
      return null;
    }
    const now = new Date();
    if (now.getHours() < RECAP_TRIGGER_HOUR) return null;

    const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const issuesCompleted = issues.filter(
      (i) => i.status === "done" && new Date(i.updatedAt).getTime() >= todayStartMs,
    ).length;
    const runsFailed = recentRuns.filter(
      (r) =>
        (r.status === "failed" || r.status === "timed_out") &&
        new Date(r.finishedAt ?? r.createdAt).getTime() >= todayStartMs,
    ).length;

    return {
      date: todayDateKey,
      issuesCompleted,
      runsFailed,
      totalCostCents: costSummaryQuery.data?.spendCents ?? 0,
      pendingApprovals: pendingApprovals.length,
    };
  }, [
    companyId,
    costSummaryQuery.data?.spendCents,
    environment.enableEndOfDayRecap,
    environment.timeMode,
    issues,
    pendingApprovals.length,
    recapDismissed,
    recentRuns,
    todayDateKey,
  ]);

  const dismissRecap = useCallback(() => {
    if (!companyId) return;
    dismissRecapForDate(companyId, todayDateKey);
    setRecapDismissed(true);
  }, [companyId, todayDateKey]);

  const pauseAgent = useMutation({
    mutationFn: (agentId: string) => agentsApi.pause(agentId, companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    },
    onError: (err) => {
      pushToast?.({ title: "Could not pause agent", body: errorText(err, "Request failed."), tone: "error" });
    },
  });

  const resumeAgent = useMutation({
    mutationFn: (agentId: string) => agentsApi.resume(agentId, companyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    },
    onError: (err) => {
      pushToast?.({ title: "Could not resume agent", body: errorText(err, "Request failed."), tone: "error" });
    },
  });

  const approveItem = useMutation({
    mutationFn: (approvalId: string) => approvalsApi.approve(approvalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(companyId, "pending") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    },
    onError: (err) => {
      pushToast?.({ title: "Approval failed", body: errorText(err, "Request failed."), tone: "error" });
    },
  });

  const rejectItem = useMutation({
    mutationFn: (approvalId: string) => approvalsApi.reject(approvalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(companyId, "pending") });
    },
    onError: (err) => {
      pushToast?.({ title: "Reject failed", body: errorText(err, "Request failed."), tone: "error" });
    },
  });

  const runRoutine = useMutation({
    mutationFn: (routineId: string) => routinesApi.run(routineId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.routines.list(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
    },
    onError: (err) => {
      pushToast?.({ title: "Routine trigger failed", body: errorText(err, "Request failed."), tone: "error" });
    },
  });

  const wakeAgent = useMutation({
    mutationFn: (agentId: string) =>
      agentsApi.wakeup(
        agentId,
        { source: "on_demand", triggerDetail: "manual", reason: "office3d_wake" },
        companyId,
      ),
    onSuccess: (_res, agentId) => {
      const name = agentNameByIdRef.current.get(agentId) ?? "agent";
      pushToast?.({ title: `Wakeup sent to ${name}`, tone: "info" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
    },
    onError: (err) => {
      pushToast?.({ title: "Could not wake agent", body: errorText(err, "Request failed."), tone: "error" });
    },
  });

  const assignIssueToAgent = useMutation({
    mutationFn: ({ issueId, agentId }: { issueId: string; agentId: string | null }) =>
      issuesApi.update(issueId, { assigneeAgentId: agentId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
    },
    onError: (err) => {
      pushToast?.({ title: "Could not assign issue", body: errorText(err, "Request failed."), tone: "error" });
    },
  });

  return {
    companyId,
    agents,
    agentsLoading: agentsQuery.isLoading,
    summary,
    markers,
    pendingApprovals,
    routines,
    workspaces,
    artifacts,
    issues,
    goals,
    projects,
    recentRuns,
    trophyAgentIds,
    endOfDayRecap,
    dismissRecap,
    pauseAgent,
    resumeAgent,
    wakeAgent,
    assignIssueToAgent,
    approveItem,
    rejectItem,
    runRoutine,
  };
}
