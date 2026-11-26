import { describe, expect, it } from "vitest";
import { deriveDefaultAgentSkin, mapAgentVisualState } from "./agentState";
import { RUN_ERROR_RECENCY_MS } from "./constants";
import type { AgentVisualStateInput } from "./types";

const NOW = 1_700_000_000_000;

function baseInput(overrides: Partial<AgentVisualStateInput> = {}): AgentVisualStateInput {
  return {
    agentStatus: "active",
    pauseReason: null,
    currentRunStatus: null,
    lastRunFailedAt: null,
    lastRunEventKind: null,
    inMeeting: false,
    now: NOW,
    ...overrides,
  };
}

describe("mapAgentVisualState", () => {
  it("maps terminated agents to hidden regardless of run state", () => {
    expect(
      mapAgentVisualState(
        baseInput({
          agentStatus: "terminated",
          currentRunStatus: "running",
          lastRunEventKind: "tool_call",
        }),
      ),
    ).toBe("hidden");
  });

  it("maps pending_approval agents to awaiting_hire", () => {
    expect(
      mapAgentVisualState(baseInput({ agentStatus: "pending_approval" })),
    ).toBe("awaiting_hire");
  });

  it("distinguishes budget hard-stop pauses from manual pauses", () => {
    expect(
      mapAgentVisualState(baseInput({ agentStatus: "paused", pauseReason: "budget" })),
    ).toBe("paused_budget");

    expect(
      mapAgentVisualState(baseInput({ agentStatus: "paused", pauseReason: "manual" })),
    ).toBe("paused");
  });

  it("maps error agents and recent failures (<10m) to error while ignoring stale failures", () => {
    expect(mapAgentVisualState(baseInput({ agentStatus: "error" }))).toBe("error");

    expect(
      mapAgentVisualState(
        baseInput({
          lastRunFailedAt: new Date(NOW - 60_000).toISOString(),
          currentRunStatus: "failed",
        }),
      ),
    ).toBe("error");

    expect(
      mapAgentVisualState(
        baseInput({
          lastRunFailedAt: new Date(NOW - RUN_ERROR_RECENCY_MS - 1_000).toISOString(),
          currentRunStatus: "failed",
        }),
      ),
    ).toBe("idle");

    expect(
      mapAgentVisualState(
        baseInput({
          lastRunFailedAt: new Date(NOW - 60_000).toISOString(),
          currentRunStatus: "succeeded",
        }),
      ),
    ).toBe("idle");
  });

  it("distinguishes coding vs thinking on running runs and defaults unknown events to thinking", () => {
    expect(
      mapAgentVisualState(
        baseInput({ agentStatus: "running", currentRunStatus: "running", lastRunEventKind: "tool_call" }),
      ),
    ).toBe("coding");

    expect(
      mapAgentVisualState(
        baseInput({ agentStatus: "running", currentRunStatus: "running", lastRunEventKind: "message" }),
      ),
    ).toBe("thinking");

    expect(
      mapAgentVisualState(
        baseInput({ agentStatus: "running", currentRunStatus: "running", lastRunEventKind: "unknown" }),
      ),
    ).toBe("thinking");
  });

  it("maps queued/scheduled_retry to waiting, meeting to meeting, and falls back to idle", () => {
    expect(mapAgentVisualState(baseInput({ currentRunStatus: "queued" }))).toBe("waiting");
    expect(mapAgentVisualState(baseInput({ currentRunStatus: "scheduled_retry" }))).toBe("waiting");
    expect(mapAgentVisualState(baseInput({ inMeeting: true }))).toBe("meeting");
    expect(mapAgentVisualState(baseInput({ agentStatus: "idle" }))).toBe("idle");
  });
});

describe("deriveDefaultAgentSkin", () => {
  it("produces deterministic skins based on agentId and role", () => {
    const first = deriveDefaultAgentSkin("agent-123", "engineer");
    const second = deriveDefaultAgentSkin("agent-123", "engineer");
    expect(first).toEqual(second);
    expect(first.outfit).toBe("hoodie");
    expect(first.headwear).toBe("headset");

    const ceoSkin = deriveDefaultAgentSkin("agent-ceo", "ceo");
    expect(ceoSkin.outfit).toBe("suit");
    expect(ceoSkin.headwear).toBe("glasses");

    const qaSkin = deriveDefaultAgentSkin("agent-qa", "qa");
    expect(qaSkin.headwear).toBe("hardhat");
  });
});
