import { describe, expect, it } from "vitest";
import type { ActivityEvent, HeartbeatRun } from "@paperclipai/shared";
import { RUN_ERROR_RECENCY_MS } from "./constants";
import { buildReplayTimeline, sampleReplayAt } from "./replay";
import type { AgentOfficeSnapshot } from "./types";

function makeSnapshot(agentId: string, visualState: AgentOfficeSnapshot["visualState"] = "idle"): AgentOfficeSnapshot {
  return {
    agentId,
    name: `Agent ${agentId}`,
    urlKey: agentId,
    role: "engineer",
    title: null,
    icon: null,
    reportsTo: null,
    visualState,
    currentRunId: null,
    currentIssueIdentifier: null,
    currentIssueTitle: null,
    runStartedAt: null,
    costTodayCents: null,
    budgetUtilizationPct: null,
  };
}

describe("Time-lapse Replay timeline", () => {
  it("reconstructs thinking -> coding -> idle and error recency states across timestamps", () => {
    const baseMs = Date.UTC(2026, 10, 24, 10, 0, 0);
    const runs = [
      {
        id: "r1",
        companyId: "c1",
        agentId: "a1",
        status: "succeeded",
        startedAt: new Date(baseMs).toISOString(),
        finishedAt: new Date(baseMs + 100_000).toISOString(),
        createdAt: new Date(baseMs).toISOString(),
      },
      {
        id: "r2",
        companyId: "c1",
        agentId: "a2",
        status: "failed",
        startedAt: new Date(baseMs + 20_000).toISOString(),
        finishedAt: new Date(baseMs + 40_000).toISOString(),
        createdAt: new Date(baseMs + 20_000).toISOString(),
      },
    ] as unknown as HeartbeatRun[];

    const activity = [
      {
        id: "act-1",
        companyId: "c1",
        actorType: "agent",
        actorId: "a1",
        action: "issue.updated",
        entityType: "issue",
        entityId: "i1",
        createdAt: new Date(baseMs + 50_000).toISOString(),
      },
    ] as unknown as ActivityEvent[];

    const timeline = buildReplayTimeline(runs, activity, baseMs + 200_000);
    expect(timeline.hasEvents).toBe(true);

    const baseAgents = {
      a1: makeSnapshot("a1"),
      a2: makeSnapshot("a2"),
    };

    // Early in run -> thinking
    const s1 = sampleReplayAt(timeline, baseMs + 10_000, baseAgents);
    expect(s1.agentsById.a1!.visualState).toBe("thinking");

    // Mid/late in run -> coding, failed a2 after finish -> error
    const s2 = sampleReplayAt(timeline, baseMs + 60_000, baseAgents);
    expect(s2.agentsById.a1!.visualState).toBe("coding");
    expect(s2.agentsById.a2!.visualState).toBe("error");
    expect(s2.caption).toBe("issue.updated · issue");

    // Well past error recency -> both idle
    const s3 = sampleReplayAt(timeline, baseMs + RUN_ERROR_RECENCY_MS + 100_000, baseAgents);
    expect(s3.agentsById.a1!.visualState).toBe("idle");
    expect(s3.agentsById.a2!.visualState).toBe("idle");
  });

  it("returns a safe empty timeline when no runs or activity exist", () => {
    const timeline = buildReplayTimeline([], [], Date.UTC(2026, 10, 24, 12, 0, 0));
    expect(timeline.hasEvents).toBe(false);
    expect(timeline.windowEndMs).toBeGreaterThan(timeline.windowStartMs);
  });
});
