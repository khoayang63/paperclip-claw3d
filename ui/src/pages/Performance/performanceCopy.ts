import { useCallback } from "react";
import { useTranslation } from "@/i18n";

export const PERFORMANCE_COPY = {
  "performance.title": "Agent Performance",
  "performance.subtitle":
    "Track delivery velocity, run reliability, reopen rate, cost efficiency, and board quality scores.",
  "performance.noCompany": "Select a company to view agent performance metrics.",
  "performance.window.7d": "7 Days",
  "performance.window.30d": "30 Days",
  "performance.window.all": "All Time",
  "performance.kpi.tasksDone": "Tasks Done",
  "performance.kpi.tasksDoneSub": "{{done}} of {{total}} tasks in window",
  "performance.kpi.successRate": "Run Success Rate",
  "performance.kpi.runsSub": "{{runs}} runs · {{reopen}} reopen",
  "performance.kpi.costPerTask": "Avg Cost / Task",
  "performance.kpi.costTotalSub": "Total {{total}} · Cache {{cache}}",
  "performance.kpi.qualityScore": "Board Quality Score",
  "performance.kpi.qualitySub": "{{count}} reviews · {{pass}} pass",
  "performance.trend.title": "Daily Delivery & Runs",
  "performance.trend.subtitle": "Completed tasks and heartbeat runs across the selected window",
  "performance.trend.empty": "No activity recorded in this time window.",
  "performance.table.title": "Agent Leaderboard",
  "performance.table.empty": "No agents found for this company.",
  "performance.col.agent": "Agent",
  "performance.col.score": "Score",
  "performance.col.tasks": "Tasks Done",
  "performance.col.success": "Run Success",
  "performance.col.reopen": "Reopen Rate",
  "performance.col.cycleTime": "Avg Cycle",
  "performance.col.cache": "Cache Hit",
  "performance.col.costPerTask": "Cost / Task",
  "performance.col.runsPerTask": "Runs / Task",
  "performance.col.rating": "Board Rating",
  "performance.review.title": "Board Quality Review",
  "performance.review.subtitle":
    "Rate completed work (1–5 stars) and mark Pass or Needs Rework to feed agent performance metrics.",
  "performance.review.verdictPass": "Pass",
  "performance.review.verdictRework": "Needs Rework",
  "performance.review.reopenToggle": "Reopen task to Todo for rework",
  "performance.review.notePlaceholder": "Optional review note (what worked well or needs fixing)...",
  "performance.review.save": "Save Review",
  "performance.review.saving": "Saving...",
  "performance.review.saved": "Saved",
  "performance.review.hide": "Hide",
  "performance.review.expand": "Rate",
  "performance.review.edit": "Edit",
  "performance.review.unrated": "Not rated yet",
  "office3d.overview.performanceTitle": "30d Performance",
  "office3d.overview.fullPerformance": "Full Performance",
} as const;

export type PerformanceCopyKey = keyof typeof PERFORMANCE_COPY;

export function usePerformanceCopy() {
  const { t } = useTranslation();
  return useCallback(
    (key: PerformanceCopyKey, values?: Record<string, string | number>) =>
      t(key, { defaultValue: PERFORMANCE_COPY[key], ...(values ?? {}) }),
    [t],
  );
}
