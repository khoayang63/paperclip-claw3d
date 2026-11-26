import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownUp,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  RotateCcw,
  Star,
} from "lucide-react";
import type { AgentPerformanceRow, PerformanceWindow } from "@paperclipai/shared";
import { performanceApi } from "@/api/performance";
import { AgentIcon } from "@/components/AgentIconPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { usePerformanceCopy } from "./performanceCopy";

type SortColumn =
  | "tasksDone"
  | "performanceScore"
  | "runSuccessRatePct"
  | "reopenRatePct"
  | "avgCycleTimeSec"
  | "cacheHitRatePct"
  | "costPerDoneTaskUsd"
  | "avgRunsPerDoneTask"
  | "avgRating";

function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const mins = sec / 60;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

function formatUsd(usd: number | null): string {
  if (usd === null) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${pct.toFixed(1)}%`;
}

function scoreToneClass(score: number | null): string {
  if (score === null) return "border-border text-muted-foreground";
  if (score >= 85) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
  if (score >= 65) return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  return "border-destructive/40 bg-destructive/10 text-destructive";
}

export function PerformancePage() {
  const copy = usePerformanceCopy();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [window, setWindow] = useState<PerformanceWindow>("30d");
  const [sortBy, setSortBy] = useState<SortColumn>("tasksDone");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setBreadcrumbs([{ label: copy("performance.title") }]);
  }, [copy, setBreadcrumbs]);

  const query = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.performance.company(selectedCompanyId, window)
      : ["performance", "none"],
    queryFn: () => performanceApi.getCompanyPerformance(selectedCompanyId!, window),
    enabled: Boolean(selectedCompanyId),
  });

  const report = query.data;

  const sortedAgents = useMemo(() => {
    const rows = [...(report?.agents ?? [])];
    rows.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av === null && bv === null) return a.name.localeCompare(b.name);
      if (av === null) return 1;
      if (bv === null) return -1;
      const diff = Number(av) - Number(bv);
      if (diff !== 0) return sortDir === "desc" ? -diff : diff;
      return a.name.localeCompare(b.name);
    });
    return rows;
  }, [report?.agents, sortBy, sortDir]);

  const trend = useMemo(() => {
    const points = report?.dailyTrend ?? [];
    return points.slice(-21);
  }, [report?.dailyTrend]);

  const maxTrendActivity = useMemo(() => {
    let max = 1;
    for (const p of trend) {
      const total = p.runsSucceeded + p.runsFailed + p.tasksDone;
      if (total > max) max = total;
    }
    return max;
  }, [trend]);

  function handleSort(col: SortColumn) {
    if (sortBy === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(col);
      setSortDir(col === "reopenRatePct" || col === "avgCycleTimeSec" || col === "costPerDoneTaskUsd" ? "asc" : "desc");
    }
  }

  if (!selectedCompanyId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{copy("performance.noCompany")}</div>
    );
  }

  const summary = report?.summary;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight">
              {copy("performance.title")}
              {selectedCompany ? ` · ${selectedCompany.name}` : ""}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">{copy("performance.subtitle")}</p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {(["7d", "30d", "all"] as const).map((w) => (
            <Button
              key={w}
              type="button"
              size="sm"
              variant={window === w ? "default" : "ghost"}
              onClick={() => setWindow(w)}
            >
              {copy(`performance.window.${w}`)}
            </Button>
          ))}
        </div>
      </div>

      {query.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load performance metrics"}
        </div>
      ) : null}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>{copy("performance.kpi.tasksDone")}</span>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {summary ? summary.tasksDone : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {summary
              ? copy("performance.kpi.tasksDoneSub", {
                  done: summary.tasksDone,
                  total: summary.totalTasks,
                })
              : "Loading..."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>{copy("performance.kpi.successRate")}</span>
              <RotateCcw className="h-4 w-4 text-muted-foreground" aria-hidden />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {summary ? formatPct(summary.runSuccessRatePct) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {summary
              ? copy("performance.kpi.runsSub", {
                  runs: summary.totalRuns,
                  reopen: formatPct(summary.reopenRatePct),
                })
              : "Loading..."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>{copy("performance.kpi.costPerTask")}</span>
              <DollarSign className="h-4 w-4 text-muted-foreground" aria-hidden />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {summary ? formatUsd(summary.costPerDoneTaskUsd) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {summary
              ? copy("performance.kpi.costTotalSub", {
                  total: formatUsd(summary.totalCostUsd),
                  cache: formatPct(summary.cacheHitRatePct),
                })
              : "Loading..."}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
              <span>{copy("performance.kpi.qualityScore")}</span>
              <Star className="h-4 w-4 text-muted-foreground" aria-hidden />
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {summary?.avgRating !== null && summary?.avgRating !== undefined
                ? `${summary.avgRating.toFixed(1)} / 5`
                : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {summary
              ? copy("performance.kpi.qualitySub", {
                  count: summary.reviewCount,
                  pass: formatPct(summary.passRatePct),
                })
              : "Loading..."}
          </CardContent>
        </Card>
      </div>

      {/* Daily Trend Chart */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">{copy("performance.trend.title")}</CardTitle>
              <CardDescription>{copy("performance.trend.subtitle")}</CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-primary" />
                Succeeded runs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-destructive" />
                Failed runs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500" />
                Tasks done
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {copy("performance.trend.empty")}
            </p>
          ) : (
            <div className="flex h-36 items-end gap-1.5 pt-2">
              {trend.map((pt) => {
                const okPct = Math.round((pt.runsSucceeded / maxTrendActivity) * 100);
                const failPct = Math.round((pt.runsFailed / maxTrendActivity) * 100);
                const donePct = Math.round((pt.tasksDone / maxTrendActivity) * 100);
                const title = `${pt.date} · Done: ${pt.tasksDone} · Succeeded: ${pt.runsSucceeded} · Failed: ${pt.runsFailed} · Cost: ${formatUsd(pt.costUsd)}`;
                return (
                  <div
                    key={pt.date}
                    title={title}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  >
                    <div className="flex h-28 w-full items-end justify-center gap-0.5">
                      <div
                        className="w-1.5 rounded-t-xs bg-primary/80 transition-all"
                        style={{ height: `${Math.max(pt.runsSucceeded > 0 ? 8 : 0, okPct)}%` }}
                      />
                      <div
                        className="w-1.5 rounded-t-xs bg-destructive/80 transition-all"
                        style={{ height: `${Math.max(pt.runsFailed > 0 ? 8 : 0, failPct)}%` }}
                      />
                      <div
                        className="w-1.5 rounded-t-xs bg-emerald-500/80 transition-all"
                        style={{ height: `${Math.max(pt.tasksDone > 0 ? 8 : 0, donePct)}%` }}
                      />
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {pt.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-Agent Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{copy("performance.table.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sortedAgents.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              {copy("performance.table.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-y border-border bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">{copy("performance.col.agent")}</th>
                    {(
                      [
                        ["performanceScore", copy("performance.col.score")],
                        ["tasksDone", copy("performance.col.tasks")],
                        ["runSuccessRatePct", copy("performance.col.success")],
                        ["reopenRatePct", copy("performance.col.reopen")],
                        ["avgCycleTimeSec", copy("performance.col.cycleTime")],
                        ["cacheHitRatePct", copy("performance.col.cache")],
                        ["costPerDoneTaskUsd", copy("performance.col.costPerTask")],
                        ["avgRunsPerDoneTask", copy("performance.col.runsPerTask")],
                        ["avgRating", copy("performance.col.rating")],
                      ] as ReadonlyArray<[SortColumn, string]>
                    ).map(([colKey, label]) => (
                      <th key={colKey} className="px-3 py-2.5 font-medium whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleSort(colKey)}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          <span>{label}</span>
                          <ArrowDownUp
                            className={cn(
                              "h-3 w-3",
                              sortBy === colKey ? "text-primary" : "opacity-40",
                            )}
                            aria-hidden
                          />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedAgents.map((row: AgentPerformanceRow) => (
                    <tr key={row.agentId} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link
                          to={`/agents/${encodeURIComponent(row.agentId)}`}
                          className="flex items-center gap-2.5 hover:underline"
                        >
                          <AgentIcon icon={row.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">{row.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {row.title ?? row.role}
                              {row.model ? ` · ${row.model}` : ""}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={cn("font-mono", scoreToneClass(row.performanceScore))}
                        >
                          {row.performanceScore !== null ? `${row.performanceScore}` : "—"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        <span>{row.tasksDone}</span>
                        <span className="text-xs text-muted-foreground">/{row.totalTasks}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-mono">{formatPct(row.runSuccessRatePct)}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.runsSucceeded}/{row.totalRuns} runs
                          {row.runsTimeout > 0 ? ` · ${row.runsTimeout}t` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-mono">{formatPct(row.reopenRatePct)}</div>
                        {row.reopenCount > 0 ? (
                          <div className="text-xs text-muted-foreground">
                            {row.reopenCount} reopened
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 font-mono">
                          <Clock className="h-3 w-3 text-muted-foreground" aria-hidden />
                          {formatDuration(row.avgCycleTimeSec)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          run {formatDuration(row.avgRunDurationSec)}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono">
                        {formatPct(row.cacheHitRatePct)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-mono">{formatUsd(row.costPerDoneTaskUsd)}</div>
                        <div className="text-xs text-muted-foreground">
                          total {formatUsd(row.totalCostUsd)}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono">
                        {row.avgRunsPerDoneTask !== null ? row.avgRunsPerDoneTask.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {row.avgRating !== null ? (
                          <div>
                            <div className="inline-flex items-center gap-1 font-mono">
                              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                              {row.avgRating.toFixed(1)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {row.passCount}/{row.reviewCount} pass
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
