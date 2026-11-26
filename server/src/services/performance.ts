import { and, desc, eq, gte, isNull, ne } from "drizzle-orm";
import {
  activityLog,
  agents,
  heartbeatRuns,
  issueQualityReviews,
  issues,
  type Db,
} from "@paperclipai/db";
import type {
  AgentPerformanceRow,
  CompanyPerformanceReport,
  CompanyPerformanceSummary,
  IssueQualityReview,
  IssueQualityVerdict,
  PerformanceTrendPoint,
  PerformanceWindow,
  UpsertIssueQualityReviewInput,
} from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { heartbeatService } from "./heartbeat.js";
import { queueIssueAssignmentWakeup } from "./issue-assignment-wakeup.js";
import { issueService } from "./issues.js";

export interface PerformanceActorContext {
  actorType: "user" | "agent" | "system";
  actorId: string;
  userId: string | null;
  agentId?: string | null;
  runId?: string | null;
  agentApiKeyId?: string | null;
}

export interface PerformanceAgentInput {
  id: string;
  name: string;
  role: string;
  title: string | null;
  icon: string | null;
  status: string;
  adapterConfig: Record<string, unknown> | null;
}

export interface PerformanceIssueInput {
  id: string;
  assigneeAgentId: string | null;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface PerformanceRunInput {
  id: string;
  agentId: string;
  issueId: string | null;
  status: string;
  invocationSource: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  errorCode: string | null;
  usageJson: Record<string, unknown> | null;
  contextSnapshot: Record<string, unknown> | null;
}

export interface PerformanceActivityInput {
  id: string;
  entityId: string;
  agentId: string | null;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PerformanceReviewInput {
  id: string;
  companyId: string;
  issueId: string;
  agentId: string | null;
  rating: number;
  verdict: string;
  note: string | null;
  reviewedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const REOPEN_TARGET_STATUSES = new Set([
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "backlog",
]);

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function extractStatusTransition(
  details: Record<string, unknown> | null | undefined,
): { from: string | null; to: string | null } {
  if (!details) return { from: null, to: null };
  const statusVal = details.status;
  if (statusVal && typeof statusVal === "object" && !Array.isArray(statusVal)) {
    const obj = statusVal as Record<string, unknown>;
    return { from: readString(obj.from), to: readString(obj.to) };
  }
  const to = readString(statusVal);
  const prevObj =
    details._previous && typeof details._previous === "object" && !Array.isArray(details._previous)
      ? (details._previous as Record<string, unknown>)
      : null;
  const from =
    readString(details.previousStatus) ??
    (prevObj ? readString(prevObj.status) : null);
  return { from, to };
}

export function isReopenTransition(details: Record<string, unknown> | null | undefined): boolean {
  const { from, to } = extractStatusTransition(details);
  if (from !== "done" || !to) return false;
  return REOPEN_TARGET_STATUSES.has(to);
}

export function windowCutoffDate(window: PerformanceWindow, now = new Date()): Date | null {
  if (window === "all") return null;
  const days = window === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveRunIssueId(run: PerformanceRunInput): string | null {
  if (run.issueId) return run.issueId;
  const snap = run.contextSnapshot;
  if (snap && typeof snap.issueId === "string" && snap.issueId.trim()) {
    return snap.issueId.trim();
  }
  return null;
}

function extractUsageMetrics(usageJson: Record<string, unknown> | null | undefined): {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  sessionReused: boolean | null;
} {
  if (!usageJson) {
    return {
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      sessionReused: null,
    };
  }
  const costUsd =
    readFiniteNumber(usageJson.cacheAdjustedCostUsd) ??
    readFiniteNumber(usageJson.costUsd) ??
    0;
  const inputTokens = readFiniteNumber(usageJson.inputTokens) ?? 0;
  const outputTokens = readFiniteNumber(usageJson.outputTokens) ?? 0;
  const cachedInputTokens = readFiniteNumber(usageJson.cachedInputTokens) ?? 0;
  const sessionReused =
    typeof usageJson.sessionReused === "boolean" ? usageJson.sessionReused : null;

  return {
    costUsd: Math.max(0, costUsd),
    inputTokens: Math.max(0, inputTokens),
    outputTokens: Math.max(0, outputTokens),
    cachedInputTokens: Math.max(0, cachedInputTokens),
    sessionReused,
  };
}

function computePerformanceScore(input: {
  runSuccessRatePct: number | null;
  reopenRatePct: number | null;
  avgRating: number | null;
  tasksDone: number;
  totalRuns: number;
}): number | null {
  if (input.tasksDone === 0 && input.totalRuns === 0 && input.avgRating === null) {
    return null;
  }

  let weightedSum = 0;
  let weightTotal = 0;

  if (input.runSuccessRatePct !== null) {
    weightedSum += input.runSuccessRatePct * 0.45;
    weightTotal += 0.45;
  }
  if (input.reopenRatePct !== null) {
    weightedSum += Math.max(0, 100 - input.reopenRatePct) * 0.25;
    weightTotal += 0.25;
  }
  if (input.avgRating !== null) {
    weightedSum += ((input.avgRating / 5) * 100) * 0.3;
    weightTotal += 0.3;
  }

  if (weightTotal <= 0) return null;
  return Math.round(weightedSum / weightTotal);
}

export function computeCompanyPerformance(input: {
  companyId: string;
  window: PerformanceWindow;
  now?: Date;
  agents: readonly PerformanceAgentInput[];
  issues: readonly PerformanceIssueInput[];
  runs: readonly PerformanceRunInput[];
  activities: readonly PerformanceActivityInput[];
  reviews: readonly PerformanceReviewInput[];
}): CompanyPerformanceReport {
  const now = input.now ?? new Date();
  const cutoff = windowCutoffDate(input.window, now);

  const inWindow = (date: Date | null | undefined): boolean => {
    if (!cutoff) return true;
    if (!date) return false;
    return date.getTime() >= cutoff.getTime();
  };

  const issueById = new Map(input.issues.map((issue) => [issue.id, issue]));
  const filteredIssues = input.issues.filter((issue) =>
    inWindow(issue.completedAt ?? issue.updatedAt ?? issue.createdAt),
  );
  const filteredRuns = input.runs.filter((run) =>
    inWindow(run.startedAt ?? run.createdAt),
  );
  const filteredActivities = input.activities.filter(
    (act) => act.action === "issue.updated" && inWindow(act.createdAt),
  );
  const filteredReviews = input.reviews.filter((rev) =>
    inWindow(rev.updatedAt ?? rev.createdAt),
  );

  // Track runs grouped by issueId for runs/done-task calculation
  const runsCountByIssueId = new Map<string, number>();
  for (const run of filteredRuns) {
    const issId = resolveRunIssueId(run);
    if (issId) {
      runsCountByIssueId.set(issId, (runsCountByIssueId.get(issId) ?? 0) + 1);
    }
  }

  const reopenCountByAgentId = new Map<string, number>();
  let totalReopenCount = 0;
  for (const act of filteredActivities) {
    if (!isReopenTransition(act.details)) continue;
    totalReopenCount += 1;
    const targetIssue = issueById.get(act.entityId);
    const attributedAgentId = targetIssue?.assigneeAgentId ?? act.agentId;
    if (attributedAgentId) {
      reopenCountByAgentId.set(
        attributedAgentId,
        (reopenCountByAgentId.get(attributedAgentId) ?? 0) + 1,
      );
    }
  }

  const trendMap = new Map<string, PerformanceTrendPoint>();
  const ensureTrendBucket = (day: string): PerformanceTrendPoint => {
    const existing = trendMap.get(day);
    if (existing) return existing;
    const created: PerformanceTrendPoint = {
      date: day,
      tasksDone: 0,
      runsSucceeded: 0,
      runsFailed: 0,
      costUsd: 0,
    };
    trendMap.set(day, created);
    return created;
  };

  if (input.window !== "all") {
    const days = input.window === "7d" ? 7 : 30;
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const d = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
      ensureTrendBucket(utcDayKey(d));
    }
  }

  for (const iss of filteredIssues) {
    if (iss.status === "done" && iss.completedAt) {
      ensureTrendBucket(utcDayKey(iss.completedAt)).tasksDone += 1;
    }
  }

  let companyRunsSucceeded = 0;
  let companyRunsTotal = 0;
  let companyCostUsd = 0;
  let companyInputTokens = 0;
  let companyCachedTokens = 0;

  for (const run of filteredRuns) {
    companyRunsTotal += 1;
    const day = utcDayKey(run.startedAt ?? run.createdAt);
    const bucket = ensureTrendBucket(day);
    if (run.status === "succeeded") {
      companyRunsSucceeded += 1;
      bucket.runsSucceeded += 1;
    } else if (run.status === "failed" || run.status === "timed_out") {
      bucket.runsFailed += 1;
    }
    const usage = extractUsageMetrics(run.usageJson);
    companyCostUsd += usage.costUsd;
    companyInputTokens += usage.inputTokens;
    companyCachedTokens += usage.cachedInputTokens;
    bucket.costUsd = roundTo(bucket.costUsd + usage.costUsd, 4);
  }

  const agentRows: AgentPerformanceRow[] = input.agents.map((agent) => {
    const agentIssues = filteredIssues.filter((i) => i.assigneeAgentId === agent.id);
    const doneIssues = agentIssues.filter((i) => i.status === "done");
    const tasksDone = doneIssues.length;
    const tasksInProgress = agentIssues.filter(
      (i) => i.status === "in_progress" || i.status === "in_review",
    ).length;
    const tasksBlocked = agentIssues.filter((i) => i.status === "blocked").length;
    const tasksCancelled = agentIssues.filter((i) => i.status === "cancelled").length;

    const cycleTimesSec: number[] = [];
    let runsOnDoneTasks = 0;
    let doneTasksWithRuns = 0;
    for (const iss of doneIssues) {
      if (iss.startedAt && iss.completedAt) {
        const diffSec = Math.max(0, (iss.completedAt.getTime() - iss.startedAt.getTime()) / 1000);
        cycleTimesSec.push(diffSec);
      }
      const rc = runsCountByIssueId.get(iss.id) ?? 0;
      if (rc > 0) {
        runsOnDoneTasks += rc;
        doneTasksWithRuns += 1;
      }
    }

    const agentRuns = filteredRuns.filter((r) => r.agentId === agent.id);
    const runsSucceeded = agentRuns.filter((r) => r.status === "succeeded").length;
    const runsFailed = agentRuns.filter(
      (r) => r.status === "failed" || r.status === "timed_out",
    ).length;
    const runsCancelled = agentRuns.filter((r) => r.status === "cancelled").length;
    const runsTimeout = agentRuns.filter(
      (r) => r.status === "timed_out" || r.errorCode === "timeout",
    ).length;
    const runsProcessLost = agentRuns.filter((r) => r.errorCode === "process_lost").length;
    const manualInterventions = agentRuns.filter(
      (r) => r.status === "cancelled" || r.invocationSource === "on_demand",
    ).length;

    const runDurationsSec: number[] = [];
    let totalCostUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let sessionObservedCount = 0;
    let sessionReusedCount = 0;

    for (const run of agentRuns) {
      if (run.startedAt && run.finishedAt) {
        runDurationsSec.push(
          Math.max(0, (run.finishedAt.getTime() - run.startedAt.getTime()) / 1000),
        );
      }
      const usage = extractUsageMetrics(run.usageJson);
      totalCostUsd += usage.costUsd;
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      cachedInputTokens += usage.cachedInputTokens;
      if (usage.sessionReused !== null) {
        sessionObservedCount += 1;
        if (usage.sessionReused) sessionReusedCount += 1;
      }
    }

    const terminalRuns = runsSucceeded + runsFailed + runsCancelled;
    const runSuccessRatePct =
      terminalRuns > 0 ? roundTo((runsSucceeded / terminalRuns) * 100, 1) : null;

    const reopenCount = reopenCountByAgentId.get(agent.id) ?? 0;
    const reopenDenom = tasksDone + reopenCount;
    const reopenRatePct =
      reopenDenom > 0 ? roundTo((reopenCount / reopenDenom) * 100, 1) : null;

    const avgRunDurationSec =
      runDurationsSec.length > 0
        ? roundTo(runDurationsSec.reduce((a, b) => a + b, 0) / runDurationsSec.length, 1)
        : null;
    const avgCycleTimeSec =
      cycleTimesSec.length > 0
        ? roundTo(cycleTimesSec.reduce((a, b) => a + b, 0) / cycleTimesSec.length, 1)
        : null;

    const costPerDoneTaskUsd =
      tasksDone > 0 && totalCostUsd > 0 ? roundTo(totalCostUsd / tasksDone, 4) : null;
    const cacheTotal = inputTokens + cachedInputTokens;
    const cacheHitRatePct =
      cacheTotal > 0 ? roundTo((cachedInputTokens / cacheTotal) * 100, 1) : null;
    const sessionReuseRatePct =
      sessionObservedCount > 0
        ? roundTo((sessionReusedCount / sessionObservedCount) * 100, 1)
        : null;
    const avgRunsPerDoneTask =
      doneTasksWithRuns > 0 ? roundTo(runsOnDoneTasks / doneTasksWithRuns, 2) : null;

    const agentReviews = filteredReviews.filter((rev) => {
      const ownerId = rev.agentId ?? issueById.get(rev.issueId)?.assigneeAgentId;
      return ownerId === agent.id;
    });
    const reviewCount = agentReviews.length;
    const avgRating =
      reviewCount > 0
        ? roundTo(agentReviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount, 2)
        : null;
    const passCount = agentReviews.filter((r) => r.verdict === "pass").length;
    const needsReworkCount = agentReviews.filter((r) => r.verdict === "needs_rework").length;
    const passRatePct =
      reviewCount > 0 ? roundTo((passCount / reviewCount) * 100, 1) : null;

    const modelRaw = agent.adapterConfig?.model;
    const model = typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : null;

    const performanceScore = computePerformanceScore({
      runSuccessRatePct,
      reopenRatePct,
      avgRating,
      tasksDone,
      totalRuns: agentRuns.length,
    });

    return {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      icon: agent.icon,
      status: agent.status,
      model,
      tasksDone,
      tasksInProgress,
      tasksBlocked,
      tasksCancelled,
      totalTasks: agentIssues.length,
      totalRuns: agentRuns.length,
      runsSucceeded,
      runsFailed,
      runsCancelled,
      runsTimeout,
      runsProcessLost,
      runSuccessRatePct,
      reopenCount,
      reopenRatePct,
      avgRunDurationSec,
      avgCycleTimeSec,
      totalCostUsd: roundTo(totalCostUsd, 4),
      costPerDoneTaskUsd,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheHitRatePct,
      sessionReuseRatePct,
      avgRunsPerDoneTask,
      manualInterventions,
      reviewCount,
      avgRating,
      passCount,
      needsReworkCount,
      passRatePct,
      performanceScore,
    };
  });

  agentRows.sort((a, b) => {
    if (b.tasksDone !== a.tasksDone) return b.tasksDone - a.tasksDone;
    const scoreA = a.performanceScore ?? -1;
    const scoreB = b.performanceScore ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.name.localeCompare(b.name);
  });

  const doneCompanyIssues = filteredIssues.filter((i) => i.status === "done");
  const companyCycleTimes = doneCompanyIssues
    .filter((i) => i.startedAt && i.completedAt)
    .map((i) => Math.max(0, (i.completedAt!.getTime() - i.startedAt!.getTime()) / 1000));

  const companyTerminalRuns = filteredRuns.filter((r) =>
    ["succeeded", "failed", "timed_out", "cancelled"].includes(r.status),
  ).length;
  const companyReopenDenom = doneCompanyIssues.length + totalReopenCount;
  const companyCacheDenom = companyInputTokens + companyCachedTokens;
  const companyReviewsCount = filteredReviews.length;
  const companyPassCount = filteredReviews.filter((r) => r.verdict === "pass").length;

  const summary: CompanyPerformanceSummary = {
    tasksDone: doneCompanyIssues.length,
    totalTasks: filteredIssues.length,
    totalRuns: companyRunsTotal,
    runSuccessRatePct:
      companyTerminalRuns > 0
        ? roundTo((companyRunsSucceeded / companyTerminalRuns) * 100, 1)
        : null,
    reopenCount: totalReopenCount,
    reopenRatePct:
      companyReopenDenom > 0
        ? roundTo((totalReopenCount / companyReopenDenom) * 100, 1)
        : null,
    avgCycleTimeSec:
      companyCycleTimes.length > 0
        ? roundTo(companyCycleTimes.reduce((a, b) => a + b, 0) / companyCycleTimes.length, 1)
        : null,
    totalCostUsd: roundTo(companyCostUsd, 4),
    costPerDoneTaskUsd:
      doneCompanyIssues.length > 0 && companyCostUsd > 0
        ? roundTo(companyCostUsd / doneCompanyIssues.length, 4)
        : null,
    cacheHitRatePct:
      companyCacheDenom > 0
        ? roundTo((companyCachedTokens / companyCacheDenom) * 100, 1)
        : null,
    reviewCount: companyReviewsCount,
    avgRating:
      companyReviewsCount > 0
        ? roundTo(filteredReviews.reduce((acc, r) => acc + r.rating, 0) / companyReviewsCount, 2)
        : null,
    passRatePct:
      companyReviewsCount > 0
        ? roundTo((companyPassCount / companyReviewsCount) * 100, 1)
        : null,
  };

  const dailyTrend = Array.from(trendMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    companyId: input.companyId,
    window: input.window,
    generatedAt: now.toISOString(),
    summary,
    agents: agentRows,
    dailyTrend,
  };
}

function serializeReview(row: typeof issueQualityReviews.$inferSelect): IssueQualityReview {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId,
    agentId: row.agentId ?? null,
    rating: row.rating,
    verdict: (row.verdict === "needs_rework" ? "needs_rework" : "pass") as IssueQualityVerdict,
    note: row.note ?? null,
    reviewedByUserId: row.reviewedByUserId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function performanceService(db: Db) {
  const issuesSvc = issueService(db);
  const heartbeatSvc = heartbeatService(db);

  async function getCompanyPerformance(
    companyId: string,
    window: PerformanceWindow = "30d",
  ): Promise<CompanyPerformanceReport> {
    const cutoff = windowCutoffDate(window);

    const [agentRows, issueRows, runRows, activityRows, reviewRows] = await Promise.all([
      db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          title: agents.title,
          icon: agents.icon,
          status: agents.status,
          adapterConfig: agents.adapterConfig,
        })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated"))),
      db
        .select({
          id: issues.id,
          assigneeAgentId: issues.assigneeAgentId,
          status: issues.status,
          createdAt: issues.createdAt,
          startedAt: issues.startedAt,
          completedAt: issues.completedAt,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(and(eq(issues.companyId, companyId), isNull(issues.hiddenAt))),
      db
        .select({
          id: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          issueId: heartbeatRuns.issueId,
          status: heartbeatRuns.status,
          invocationSource: heartbeatRuns.invocationSource,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          createdAt: heartbeatRuns.createdAt,
          errorCode: heartbeatRuns.errorCode,
          usageJson: heartbeatRuns.usageJson,
          contextSnapshot: heartbeatRuns.contextSnapshot,
        })
        .from(heartbeatRuns)
        .where(
          cutoff
            ? and(eq(heartbeatRuns.companyId, companyId), gte(heartbeatRuns.createdAt, cutoff))
            : eq(heartbeatRuns.companyId, companyId),
        ),
      db
        .select({
          id: activityLog.id,
          entityId: activityLog.entityId,
          agentId: activityLog.agentId,
          action: activityLog.action,
          details: activityLog.details,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            eq(activityLog.entityType, "issue"),
            eq(activityLog.action, "issue.updated"),
            ...(cutoff ? [gte(activityLog.createdAt, cutoff)] : []),
          ),
        )
        .orderBy(desc(activityLog.createdAt)),
      db
        .select()
        .from(issueQualityReviews)
        .where(eq(issueQualityReviews.companyId, companyId)),
    ]);

    return computeCompanyPerformance({
      companyId,
      window,
      agents: agentRows,
      issues: issueRows,
      runs: runRows,
      activities: activityRows,
      reviews: reviewRows,
    });
  }

  async function getIssueQualityReview(
    companyId: string,
    issueId: string,
  ): Promise<IssueQualityReview | null> {
    const [row] = await db
      .select()
      .from(issueQualityReviews)
      .where(
        and(
          eq(issueQualityReviews.companyId, companyId),
          eq(issueQualityReviews.issueId, issueId),
        ),
      )
      .limit(1);
    return row ? serializeReview(row) : null;
  }

  async function upsertIssueQualityReview(
    companyId: string,
    issueId: string,
    input: UpsertIssueQualityReviewInput,
    actor: PerformanceActorContext,
  ): Promise<{ review: IssueQualityReview; reopened: boolean; wokeAssignee: boolean }> {
    const issue = await issuesSvc.getById(issueId);
    if (!issue || issue.companyId !== companyId) {
      throw notFound("Issue not found");
    }

    const now = new Date();
    const trimmedNote = input.note?.trim() ? input.note.trim() : null;
    const [saved] = await db
      .insert(issueQualityReviews)
      .values({
        companyId,
        issueId: issue.id,
        agentId: issue.assigneeAgentId ?? null,
        rating: input.rating,
        verdict: input.verdict,
        note: trimmedNote,
        reviewedByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [issueQualityReviews.companyId, issueQualityReviews.issueId],
        set: {
          agentId: issue.assigneeAgentId ?? null,
          rating: input.rating,
          verdict: input.verdict,
          note: trimmedNote,
          reviewedByUserId: actor.userId,
          updatedAt: now,
        },
      })
      .returning();

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? issue.assigneeAgentId ?? null,
      runId: actor.runId ?? null,
      agentApiKeyId: actor.agentApiKeyId ?? null,
      action: "issue.quality_reviewed",
      entityType: "issue",
      entityId: issue.id,
      details: {
        rating: input.rating,
        verdict: input.verdict,
        reopenIssue: input.reopenIssue,
      },
    });

    let reopened = false;
    let wokeAssignee = false;
    if (input.reopenIssue && input.verdict === "needs_rework" && issue.status === "done") {
      const updatedIssue = await issuesSvc.update(issue.id, {
        status: "todo",
        companyGuard: companyId,
        actorUserId: actor.userId,
      });
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: issue.assigneeAgentId ?? null,
        runId: actor.runId ?? null,
        agentApiKeyId: actor.agentApiKeyId ?? null,
        action: "issue.updated",
        entityType: "issue",
        entityId: issue.id,
        details: {
          status: { from: "done", to: "todo" },
          reason: "quality_review_rework",
        },
      });

      const commentBody = trimmedNote
        ? `**Board Quality Review (${input.rating}/5 · Needs Rework — Reopened)**\n\n${trimmedNote}`
        : `**Board Quality Review (${input.rating}/5 · Needs Rework — Reopened)**\n\nTask reopened for rework. Please review the deliverables and address remaining gaps.`;
      try {
        await issuesSvc.addComment(issue.id, commentBody, {
          userId: actor.userId ?? undefined,
        });
      } catch (err) {
        logger.warn(
          { err, companyId, issueId: issue.id },
          "failed to post rework comment after quality review reopen",
        );
      }

      const wakeTarget = updatedIssue ?? { ...issue, status: "todo" };
      if (wakeTarget.assigneeAgentId) {
        try {
          await queueIssueAssignmentWakeup({
            heartbeat: heartbeatSvc,
            issue: wakeTarget,
            reason: "quality_review_rework",
            mutation: "update",
            contextSource: "quality_review.reopen",
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
          });
          wokeAssignee = true;
        } catch (err) {
          logger.warn(
            { err, companyId, issueId: issue.id },
            "failed to wake assignee after quality review reopen",
          );
        }
      }
      reopened = true;
    }

    return {
      review: serializeReview(saved!),
      reopened,
      wokeAssignee,
    };
  }

  return {
    getCompanyPerformance,
    getIssueQualityReview,
    upsertIssueQualityReview,
  };
}
