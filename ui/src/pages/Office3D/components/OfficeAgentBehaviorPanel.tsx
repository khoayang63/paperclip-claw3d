import { useEffect, useState } from "react";
import { Check, MessageSquareQuote, Sparkles } from "lucide-react";
import type { OfficeAgentBehaviorConfig, OfficeIdlePreset } from "@paperclipai/shared";
import { OFFICE_IDLE_PRESETS } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useOfficeT } from "../officeCopy";

const DEFAULT_BEHAVIOR: OfficeAgentBehaviorConfig = {
  slogans: [],
  idlePreset: "balanced",
  refreshmentWeight: 1,
  wanderWeight: 1,
  sloganFrequency: 0.35,
};

export interface OfficeAgentBehaviorPanelProps {
  agentId: string;
  agentName: string;
  behavior?: OfficeAgentBehaviorConfig;
  canEdit: boolean;
  onSave?: (agentId: string, next: OfficeAgentBehaviorConfig) => void;
  onPreviewSlogan?: (agentId: string, text: string) => void;
}

export function OfficeAgentBehaviorPanel({
  agentId,
  agentName,
  behavior,
  canEdit,
  onSave,
  onPreviewSlogan,
}: OfficeAgentBehaviorPanelProps) {
  const ot = useOfficeT();
  const initial = behavior ?? DEFAULT_BEHAVIOR;

  const [idlePreset, setIdlePreset] = useState<OfficeIdlePreset>(initial.idlePreset);
  const [refreshmentWeight, setRefreshmentWeight] = useState<number>(initial.refreshmentWeight);
  const [wanderWeight, setWanderWeight] = useState<number>(initial.wanderWeight);
  const [sloganFrequency, setSloganFrequency] = useState<number>(initial.sloganFrequency);
  const [slogansText, setSlogansText] = useState<string>(initial.slogans.join("\n"));
  const [savedFlag, setSavedFlag] = useState(false);

  useEffect(() => {
    const next = behavior ?? DEFAULT_BEHAVIOR;
    setIdlePreset(next.idlePreset);
    setRefreshmentWeight(next.refreshmentWeight);
    setWanderWeight(next.wanderWeight);
    setSloganFrequency(next.sloganFrequency);
    setSlogansText(next.slogans.join("\n"));
    setSavedFlag(false);
  }, [agentId, behavior]);

  const parsedSlogans = slogansText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => line.slice(0, 120));

  function handleSave() {
    onSave?.(agentId, {
      idlePreset,
      refreshmentWeight,
      wanderWeight,
      sloganFrequency,
      slogans: parsedSlogans,
    });
    setSavedFlag(true);
    window.setTimeout(() => setSavedFlag(false), 1800);
  }

  function handlePreview() {
    const sample =
      parsedSlogans[0] ?? `${agentName}: ${ot("office3d.behavior.defaultPreview")}`;
    onPreviewSlogan?.(agentId, sample);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-foreground">
          {ot("office3d.behavior.presetLabel")}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {OFFICE_IDLE_PRESETS.map((preset) => {
            const active = idlePreset === preset;
            const key =
              preset === "focused"
                ? "office3d.behavior.presetFocused"
                : preset === "lively"
                  ? "office3d.behavior.presetLively"
                  : "office3d.behavior.presetBalanced";
            return (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                disabled={!canEdit}
                onClick={() => setIdlePreset(preset)}
              >
                {ot(key)}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{ot("office3d.behavior.refreshments")}</span>
            <span className="font-mono text-foreground">{refreshmentWeight.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0}
            max={3}
            step={0.25}
            disabled={!canEdit}
            value={refreshmentWeight}
            onChange={(e) => setRefreshmentWeight(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </label>

        <label className="space-y-1 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{ot("office3d.behavior.roaming")}</span>
            <span className="font-mono text-foreground">{wanderWeight.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0}
            max={3}
            step={0.25}
            disabled={!canEdit}
            value={wanderWeight}
            onChange={(e) => setWanderWeight(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </label>

        <label className="space-y-1 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{ot("office3d.behavior.sloganChance")}</span>
            <span className="font-mono text-foreground">{Math.round(sloganFrequency * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            disabled={!canEdit}
            value={sloganFrequency}
            onChange={(e) => setSloganFrequency(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <MessageSquareQuote className="size-3.5 text-muted-foreground" aria-hidden />
            {ot("office3d.behavior.slogansLabel")}
          </label>
          <span className="text-xs text-muted-foreground">
            {parsedSlogans.length}/8
          </span>
        </div>
        <Textarea
          value={slogansText}
          onChange={(e) => setSlogansText(e.target.value)}
          disabled={!canEdit}
          rows={4}
          placeholder={ot("office3d.behavior.slogansPlaceholder")}
          className="max-h-36 min-h-20 overflow-y-auto resize-y text-xs"
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={handlePreview}>
          <Sparkles className="size-3.5" aria-hidden />
          {ot("office3d.behavior.previewBubble")}
        </Button>

        {canEdit && onSave ? (
          <Button type="button" size="sm" onClick={handleSave}>
            {savedFlag ? (
              <>
                <Check className="size-3.5" aria-hidden />
                {ot("office3d.behavior.saved")}
              </>
            ) : (
              ot("office3d.behavior.save")
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
