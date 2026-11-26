import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, X } from "lucide-react";
import { activityApi } from "@/api/activity";
import { heartbeatsApi } from "@/api/heartbeats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";
import { buildReplayTimeline, sampleReplayAt, type ReplaySample } from "../model/replay";
import type { AgentOfficeSnapshot } from "../model/types";
import { useOfficeT } from "../officeCopy";

export interface ReplayBarProps {
  open: boolean;
  companyId: string;
  baseAgentsById: Record<string, AgentOfficeSnapshot>;
  onReplaySample: (sample: ReplaySample | null) => void;
  onClose: () => void;
}

export function ReplayBar({
  open,
  companyId,
  baseAgentsById,
  onReplaySample,
  onClose,
}: ReplayBarProps) {
  const ot = useOfficeT();
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<5 | 10>(5);
  const [currentMs, setCurrentMs] = useState<number>(Date.now());
  const baseAgentsRef = useRef(baseAgentsById);
  const lastEmittedKeyRef = useRef<string | null>(null);
  baseAgentsRef.current = baseAgentsById;

  const activityQuery = useQuery({
    queryKey: [...queryKeys.activity(companyId), "office3d-replay"] as const,
    queryFn: () => activityApi.list(companyId, { limit: 200 }),
    enabled: open && Boolean(companyId),
  });

  const runsQuery = useQuery({
    queryKey: [...queryKeys.heartbeats(companyId), "office3d-replay"] as const,
    queryFn: () => heartbeatsApi.list(companyId, undefined, 100, { summary: true }),
    enabled: open && Boolean(companyId),
  });

  const timeline = useMemo(
    () => buildReplayTimeline(runsQuery.data ?? [], activityQuery.data ?? []),
    [activityQuery.data, runsQuery.data],
  );

  // Reset playhead when timeline loads or opens
  useEffect(() => {
    if (!open) return;
    setCurrentMs(timeline.windowStartMs);
    setPlaying(true);
  }, [open, timeline.windowStartMs]);

  // Playback tick scaled to span (~16s at 5x, ~8s at 10x regardless of day length)
  useEffect(() => {
    if (!open || !playing || !timeline.hasEvents) return;
    const spanMs = Math.max(10_000, timeline.windowEndMs - timeline.windowStartMs);
    const stepWallMs = 120;
    const virtualPerTickMs = spanMs / (speed === 10 ? 66 : 133);
    const id = window.setInterval(() => {
      setCurrentMs((prev) => {
        const next = prev + virtualPerTickMs;
        if (next >= timeline.windowEndMs) {
          return timeline.windowStartMs;
        }
        return next;
      });
    }, stepWallMs);
    return () => window.clearInterval(id);
  }, [open, playing, speed, timeline.hasEvents, timeline.windowEndMs, timeline.windowStartMs]);

  const agentKeysSignature = Object.keys(baseAgentsById).sort().join(",");
  const sample = useMemo(
    () => (open ? sampleReplayAt(timeline, currentMs, baseAgentsRef.current) : null),
    [agentKeysSignature, currentMs, open, timeline],
  );

  useEffect(() => {
    if (!open) {
      if (lastEmittedKeyRef.current !== null) {
        lastEmittedKeyRef.current = null;
        onReplaySample(null);
      }
      return;
    }
    const emitKey = `${currentMs}|${timeline.windowStartMs}|${timeline.windowEndMs}|${timeline.intervals.length}|${timeline.captions.length}|${agentKeysSignature}`;
    if (lastEmittedKeyRef.current === emitKey) return;
    lastEmittedKeyRef.current = emitKey;
    onReplaySample(sample);
  }, [
    agentKeysSignature,
    currentMs,
    onReplaySample,
    open,
    sample,
    timeline.captions.length,
    timeline.intervals.length,
    timeline.windowEndMs,
    timeline.windowStartMs,
  ]);

  useEffect(() => {
    return () => {
      if (lastEmittedKeyRef.current !== null) {
        lastEmittedKeyRef.current = null;
        onReplaySample(null);
      }
    };
  }, [onReplaySample]);

  if (!open) return null;

  const isLoading = activityQuery.isLoading || runsQuery.isLoading;

  return (
    <div className="office-replay-bar pointer-events-auto fixed bottom-4 left-1/2 z-30 w-full -translate-x-1/2 px-3">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              {ot("office3d.replay.title")}
            </span>
            <Badge variant="outline">
              {new Date(currentMs).toLocaleTimeString()}
            </Badge>
            {sample?.caption ? (
              <span className="max-w-xs truncate text-xs text-muted-foreground">
                {sample.caption}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!timeline.hasEvents || isLoading}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? (
                <>
                  <Pause className="size-3.5" aria-hidden />
                  {ot("office3d.replay.pause")}
                </>
              ) : (
                <>
                  <Play className="size-3.5" aria-hidden />
                  {ot("office3d.replay.play")}
                </>
              )}
            </Button>

            <Button
              type="button"
              size="xs"
              variant={speed === 5 ? "default" : "outline"}
              onClick={() => setSpeed(5)}
            >
              5x
            </Button>
            <Button
              type="button"
              size="xs"
              variant={speed === 10 ? "default" : "outline"}
              onClick={() => setSpeed(10)}
            >
              10x
            </Button>

            <Button type="button" size="xs" variant="ghost" onClick={onClose}>
              <X className="size-3.5" aria-hidden />
              {ot("office3d.replay.exit")}
            </Button>
          </div>
        </div>

        {!isLoading && !timeline.hasEvents ? (
          <p className="text-xs text-muted-foreground">{ot("office3d.replay.empty")}</p>
        ) : (
          <input
            id="office-replay-scrubber"
            name="officeReplayScrubber"
            aria-label={ot("office3d.replay.title")}
            type="range"
            min={timeline.windowStartMs}
            max={timeline.windowEndMs}
            step={1000}
            value={Math.max(timeline.windowStartMs, Math.min(timeline.windowEndMs, currentMs))}
            onChange={(e) => {
              setPlaying(false);
              setCurrentMs(Number(e.target.value));
            }}
            className="w-full"
          />
        )}
      </div>
    </div>
  );
}
