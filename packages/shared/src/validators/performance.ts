import { z } from "zod";

export const PERFORMANCE_WINDOWS = ["7d", "30d", "all"] as const;
export type PerformanceWindow = (typeof PERFORMANCE_WINDOWS)[number];

export const performanceWindowSchema = z.enum(PERFORMANCE_WINDOWS);

export const ISSUE_QUALITY_VERDICTS = ["pass", "needs_rework"] as const;
export type IssueQualityVerdict = (typeof ISSUE_QUALITY_VERDICTS)[number];

export const upsertIssueQualityReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  verdict: z.enum(ISSUE_QUALITY_VERDICTS),
  note: z.string().trim().max(2000).nullable().optional(),
  reopenIssue: z.boolean().optional().default(false),
});
export type UpsertIssueQualityReviewInput = z.infer<typeof upsertIssueQualityReviewSchema>;

export interface IssueQualityReview {
  id: string;
  companyId: string;
  issueId: string;
  agentId: string | null;
  rating: number;
  verdict: IssueQualityVerdict;
  note: string | null;
  reviewedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPerformanceRow {
  agentId: string;
  name: string;
  role: string;
  title: string | null;
  icon: string | null;
  status: string;
  model: string | null;
  tasksDone: number;
  tasksInProgress: number;
  tasksBlocked: number;
  tasksCancelled: number;
  totalTasks: number;
  totalRuns: number;
  runsSucceeded: number;
  runsFailed: number;
  runsCancelled: number;
  runsTimeout: number;
  runsProcessLost: number;
  runSuccessRatePct: number | null;
  reopenCount: number;
  reopenRatePct: number | null;
  avgRunDurationSec: number | null;
  avgCycleTimeSec: number | null;
  totalCostUsd: number;
  costPerDoneTaskUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheHitRatePct: number | null;
  sessionReuseRatePct: number | null;
  avgRunsPerDoneTask: number | null;
  manualInterventions: number;
  reviewCount: number;
  avgRating: number | null;
  passCount: number;
  needsReworkCount: number;
  passRatePct: number | null;
  performanceScore: number | null;
}

export interface PerformanceTrendPoint {
  date: string;
  tasksDone: number;
  runsSucceeded: number;
  runsFailed: number;
  costUsd: number;
}

export interface CompanyPerformanceSummary {
  tasksDone: number;
  totalTasks: number;
  totalRuns: number;
  runSuccessRatePct: number | null;
  reopenCount: number;
  reopenRatePct: number | null;
  avgCycleTimeSec: number | null;
  totalCostUsd: number;
  costPerDoneTaskUsd: number | null;
  cacheHitRatePct: number | null;
  reviewCount: number;
  avgRating: number | null;
  passRatePct: number | null;
}

export interface CompanyPerformanceReport {
  companyId: string;
  window: PerformanceWindow;
  generatedAt: string;
  summary: CompanyPerformanceSummary;
  agents: AgentPerformanceRow[];
  dailyTrend: PerformanceTrendPoint[];
}
