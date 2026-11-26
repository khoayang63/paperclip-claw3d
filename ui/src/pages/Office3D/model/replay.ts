import type { ActivityEvent, HeartbeatRun } from "@paperclipai/shared";
import { RUN_ERROR_RECENCY_MS } from "./constants";
import type { AgentOfficeSnapshot } from "./types";

export interface ReplayRunInterval {
  agentId: string;
  startMs: number;
  endMs: number;
  failed: boolean;
}

export interface ReplayCaptionEvent {
  timestampMs: number;
  label: string;
}

export interface ReplayTimeline {
  windowStartMs: number;
  windowEndMs: number;
  intervals: ReplayRunInterval[];
  captions: ReplayCaptionEvent[];
  hasEvents: boolean;
}

export interface ReplaySample {
  timestampMs: number;
  agentsById: Record<string, AgentOfficeSnapshot>;
  caption: string | null;
}

function toMs(raw: string | Date | null | undefined, fallbackMs: number): number {
  if (!raw) return fallbackMs;
  const parsed = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

/**
 * Builds a deterministic chronological timeline from heartbeat runs and company
 * activity logs for Time-lapse Replay (defaults to today; falls back to full
 * fetched history when today has no recorded runs yet).
 */
export function buildReplayTimeline(
  runs: readonly HeartbeatRun[],
  activity: readonly ActivityEvent[],
  nowMs = Date.now(),
): ReplayTimeline {
  const nowDate = new Date(nowMs);
  const startOfDayMs = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();

  const allIntervals: ReplayRunInterval[] = runs.map((run) => {
    const startMs = toMs(run.startedAt ?? run.createdAt, nowMs - 60_000);
    const rawEnd = run.finishedAt ? toMs(run.finishedAt, startMs + 30_000) : Math.max(startMs + 15_000, nowMs);
    const endMs = Math.max(startMs + 5_000, rawEnd);
    return {
      agentId: run.agentId,
      startMs,
      endMs,
      failed: run.status === "failed" || run.status === "timed_out",
    };
  });

  const allCaptions: ReplayCaptionEvent[] = activity
    .map((ev) => ({
      timestampMs: toMs(ev.createdAt, nowMs),
      label: `${ev.action} · ${ev.entityType}`,
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const todayIntervals = allIntervals.filter((i) => i.endMs >= startOfDayMs);
  const todayCaptions = allCaptions.filter((c) => c.timestampMs >= startOfDayMs);

  const useToday = todayIntervals.length > 0 || todayCaptions.length > 0;
  const intervals = (useToday ? todayIntervals : allIntervals).sort((a, b) => a.startMs - b.startMs);
  const captions = useToday ? todayCaptions : allCaptions;

  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const iv of intervals) {
    if (iv.startMs < minTs) minTs = iv.startMs;
    if (iv.endMs > maxTs) maxTs = iv.endMs;
  }
  for (const cap of captions) {
    if (cap.timestampMs < minTs) minTs = cap.timestampMs;
    if (cap.timestampMs > maxTs) maxTs = cap.timestampMs;
  }

  const hasEvents = intervals.length > 0 || captions.length > 0;
  if (!hasEvents) {
    return {
      windowStartMs: startOfDayMs,
      windowEndMs: Math.max(startOfDayMs + 60_000, nowMs),
      intervals: [],
      captions: [],
      hasEvents: false,
    };
  }

  const paddingMs = 60_000;
  const windowStartMs = Math.max(0, minTs - paddingMs);
  const windowEndMs = Math.max(windowStartMs + 60_000, maxTs + paddingMs);

  return {
    windowStartMs,
    windowEndMs,
    intervals,
    captions,
    hasEvents: true,
  };
}

/**
 * Evaluates agent visual states and nearest caption at an arbitrary replay timestamp `t`.
 */
export function sampleReplayAt(
  timeline: ReplayTimeline,
  timestampMs: number,
  baseAgentsById: Record<string, AgentOfficeSnapshot>,
): ReplaySample {
  const agentsById: Record<string, AgentOfficeSnapshot> = {};

  for (const [agentId, base] of Object.entries(baseAgentsById)) {
    if (base.visualState === "hidden" || base.visualState === "awaiting_hire") {
      agentsById[agentId] = base;
      continue;
    }

    let nextState: AgentOfficeSnapshot["visualState"] = "idle";
    const agentRuns = timeline.intervals.filter((iv) => iv.agentId === agentId);
    const active = agentRuns.find((iv) => timestampMs >= iv.startMs && timestampMs <= iv.endMs);

    if (active) {
      const progress = (timestampMs - active.startMs) / Math.max(1, active.endMs - active.startMs);
      nextState = progress < 0.35 ? "thinking" : "coding";
    } else {
      const recentFail = agentRuns.find(
        (iv) =>
          iv.failed &&
          timestampMs > iv.endMs &&
          timestampMs - iv.endMs <= RUN_ERROR_RECENCY_MS,
      );
      if (recentFail) {
        nextState = "error";
      }
    }

    agentsById[agentId] = {
      ...base,
      visualState: nextState,
    };
  }

  let caption: string | null = null;
  for (let i = timeline.captions.length - 1; i >= 0; i--) {
    const cap = timeline.captions[i]!;
    if (cap.timestampMs <= timestampMs && timestampMs - cap.timestampMs <= RUN_ERROR_RECENCY_MS) {
      caption = cap.label;
      break;
    }
  }

  return { timestampMs, agentsById, caption };
}
