import { describe, expect, it } from "vitest";
import { computeCompanyPerformance, isReopenTransition } from "../services/performance.js";

describe("performance service computation", () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  const agentA = "22222222-2222-4222-8222-222222222222";
  const agentB = "33333333-3333-4333-8333-333333333333";
  const now = new Date("2026-11-25T12:00:00.000Z");

  it("detects done -> non-done transitions as reopens across nested and flat formats", () => {
    expect(isReopenTransition({ status: { from: "done", to: "todo" } })).toBe(true);
    expect(isReopenTransition({ status: { from: "done", to: "in_progress" } })).toBe(true);
    expect(isReopenTransition({ status: "todo", _previous: { status: "done" } })).toBe(true);
    expect(isReopenTransition({ status: { from: "in_progress", to: "done" } })).toBe(false);
    expect(isReopenTransition({ status: { from: "done", to: "cancelled" } })).toBe(false);
  });

  it("computes delivery, reliability, speed, tokens/cost, reopen rate, and quality score per agent", () => {
    const tMinus2h = new Date("2026-11-25T10:00:00.000Z");
    const tMinus1h = new Date("2026-11-25T11:00:00.000Z");
    const tOld = new Date("2026-10-01T10:00:00.000Z");

    const report = computeCompanyPerformance({
      companyId,
      window: "7d",
      now,
      agents: [
        {
          id: agentA,
          name: "Full-Stack Developer",
          role: "engineer",
          title: "Full-Stack Engineer",
          icon: "code",
          status: "idle",
          adapterConfig: { model: "deepseek/deepseek-flash" },
        },
        {
          id: agentB,
          name: "QA Engineer",
          role: "qa",
          title: "QA & Test Engineer",
          icon: "shield",
          status: "idle",
          adapterConfig: { model: "deepseek/deepseek-flash" },
        },
      ],
      issues: [
        {
          id: "iss-1",
          assigneeAgentId: agentA,
          status: "done",
          createdAt: tMinus2h,
          startedAt: tMinus2h,
          completedAt: tMinus1h,
          updatedAt: tMinus1h,
        },
        {
          id: "iss-2",
          assigneeAgentId: agentA,
          status: "blocked",
          createdAt: tMinus2h,
          startedAt: tMinus2h,
          completedAt: null,
          updatedAt: tMinus1h,
        },
        {
          id: "iss-old",
          assigneeAgentId: agentB,
          status: "done",
          createdAt: tOld,
          startedAt: tOld,
          completedAt: tOld,
          updatedAt: tOld,
        },
      ],
      runs: [
        {
          id: "run-1",
          agentId: agentA,
          issueId: "iss-1",
          status: "succeeded",
          invocationSource: "assignment",
          startedAt: new Date("2026-11-25T10:05:00.000Z"),
          finishedAt: new Date("2026-11-25T10:07:00.000Z"),
          createdAt: tMinus2h,
          errorCode: null,
          usageJson: {
            costUsd: 0.02,
            inputTokens: 1000,
            outputTokens: 500,
            cachedInputTokens: 3000,
            sessionReused: true,
          },
          contextSnapshot: null,
        },
        {
          id: "run-2",
          agentId: agentA,
          issueId: "iss-1",
          status: "failed",
          invocationSource: "on_demand",
          startedAt: new Date("2026-11-25T10:10:00.000Z"),
          finishedAt: new Date("2026-11-25T10:11:00.000Z"),
          createdAt: tMinus2h,
          errorCode: "timeout",
          usageJson: null,
          contextSnapshot: null,
        },
        {
          id: "run-old",
          agentId: agentB,
          issueId: "iss-old",
          status: "succeeded",
          invocationSource: "assignment",
          startedAt: tOld,
          finishedAt: tOld,
          createdAt: tOld,
          errorCode: null,
          usageJson: { costUsd: 0.5 },
          contextSnapshot: null,
        },
      ],
      activities: [
        {
          id: "act-1",
          entityId: "iss-1",
          agentId: agentA,
          action: "issue.updated",
          details: { status: { from: "done", to: "todo" } },
          createdAt: tMinus1h,
        },
      ],
      reviews: [
        {
          id: "rev-1",
          companyId,
          issueId: "iss-1",
          agentId: agentA,
          rating: 4,
          verdict: "pass",
          note: "Clean code",
          reviewedByUserId: "local-board",
          createdAt: tMinus1h,
          updatedAt: tMinus1h,
        },
      ],
    });

    expect(report.summary.tasksDone).toBe(1);
    expect(report.summary.totalRuns).toBe(2);
    expect(report.summary.runSuccessRatePct).toBe(50);
    expect(report.summary.reopenCount).toBe(1);
    expect(report.summary.reopenRatePct).toBe(50);
    expect(report.summary.avgRating).toBe(4);
    expect(report.summary.passRatePct).toBe(100);
    expect(report.dailyTrend).toHaveLength(7);

    const rowA = report.agents.find((a) => a.agentId === agentA)!;
    expect(rowA.tasksDone).toBe(1);
    expect(rowA.tasksBlocked).toBe(1);
    expect(rowA.runsSucceeded).toBe(1);
    expect(rowA.runsFailed).toBe(1);
    expect(rowA.runsTimeout).toBe(1);
    expect(rowA.runSuccessRatePct).toBe(50);
    expect(rowA.reopenCount).toBe(1);
    expect(rowA.reopenRatePct).toBe(50);
    expect(rowA.avgCycleTimeSec).toBe(3600);
    expect(rowA.avgRunDurationSec).toBe(90);
    expect(rowA.cacheHitRatePct).toBe(75);
    expect(rowA.sessionReuseRatePct).toBe(100);
    expect(rowA.avgRunsPerDoneTask).toBe(2);
    expect(rowA.costPerDoneTaskUsd).toBe(0.02);
    expect(rowA.avgRating).toBe(4);
    expect(rowA.passRatePct).toBe(100);
    // 50 * 0.45 + 50 * 0.25 + 80 * 0.30 = 22.5 + 12.5 + 24 = 59
    expect(rowA.performanceScore).toBe(59);

    const rowB = report.agents.find((a) => a.agentId === agentB)!;
    expect(rowB.tasksDone).toBe(0);
    expect(rowB.performanceScore).toBeNull();
  });

  it("handles empty companies without NaN or divide-by-zero", () => {
    const report = computeCompanyPerformance({
      companyId,
      window: "all",
      now,
      agents: [],
      issues: [],
      runs: [],
      activities: [],
      reviews: [],
    });

    expect(report.summary.tasksDone).toBe(0);
    expect(report.summary.runSuccessRatePct).toBeNull();
    expect(report.summary.costPerDoneTaskUsd).toBeNull();
    expect(report.summary.cacheHitRatePct).toBeNull();
    expect(report.agents).toEqual([]);
    expect(report.dailyTrend).toEqual([]);
  });
});
