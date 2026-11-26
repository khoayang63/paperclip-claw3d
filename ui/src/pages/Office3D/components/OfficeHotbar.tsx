import { useState } from "react";
import { BookOpen, Coffee, FileText, GlassWater, HandHelping, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HotbarItem, OfficeHotbarState, OfficeItemKind } from "../model/types";
import { useOfficeT } from "../officeCopy";

export interface OfficeHotbarProps {
  hotbar: OfficeHotbarState;
  onSelectSlot: (index: number) => void;
  onSwapSlots?: (fromIndex: number, toIndex: number) => void;
  onUseSelected: () => void;
  onDropSelected: () => void;
  canGiveToAgent: boolean;
  giveTargetAgentName?: string | null;
  feedback?: string | null;
}

function ItemKindIcon({ kind }: { kind: OfficeItemKind }) {
  switch (kind) {
    case "water_cup":
      return <GlassWater className="size-4 text-primary" aria-hidden />;
    case "coffee_cup":
      return <Coffee className="size-4 text-amber-500" aria-hidden />;
    case "handbook":
      return <BookOpen className="size-4 text-emerald-500" aria-hidden />;
    case "document":
    default:
      return <FileText className="size-4 text-sky-500" aria-hidden />;
  }
}

export function OfficeHotbar({
  hotbar,
  onSelectSlot,
  onSwapSlots,
  onUseSelected,
  onDropSelected,
  canGiveToAgent,
  giveTargetAgentName,
  feedback,
}: OfficeHotbarProps) {
  const ot = useOfficeT();
  const [dragFromSlot, setDragFromSlot] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const selectedItem: HotbarItem | null = hotbar.slots[hotbar.selectedSlot] ?? null;
  const isHeldIssue =
    selectedItem?.kind === "document" &&
    selectedItem.entityKind === "issue" &&
    Boolean(selectedItem.entityId);
  const isIssueDoc = canGiveToAgent && isHeldIssue;
  const actionLabel = isIssueDoc
    ? ot("office3d.hotbar.assignTask")
    : canGiveToAgent
      ? ot("office3d.hotbar.give")
      : isHeldIssue
        ? ot("office3d.hotbar.inspectIssue")
        : ot("office3d.hotbar.use");
  const actionTitle =
    canGiveToAgent && selectedItem && giveTargetAgentName
      ? isIssueDoc
        ? ot("office3d.hotbar.assignLabel", { label: selectedItem.label, name: giveTargetAgentName })
        : ot("office3d.hotbar.giveLabel", { label: selectedItem.label, name: giveTargetAgentName })
      : undefined;

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1.5">
      {feedback ? (
        <div
          role="status"
          className="rounded-md border border-border bg-card/95 px-3 py-1 text-xs font-medium text-foreground shadow-md backdrop-blur-sm"
        >
          {feedback}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-1" role="toolbar" aria-label="Hotbar inventory">
          {hotbar.slots.map((slot, index) => {
            const active = index === hotbar.selectedSlot;
            const isDropTarget = dragOverSlot === index && dragFromSlot !== null && dragFromSlot !== index;
            return (
              <button
                key={`hotbar-slot-${index}`}
                type="button"
                draggable={Boolean(slot && onSwapSlots)}
                onDragStart={(e) => {
                  if (!slot || !onSwapSlots) return;
                  setDragFromSlot(index);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(index));
                }}
                onDragOver={(e) => {
                  if (dragFromSlot === null || !onSwapSlots) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverSlot !== index) setDragOverSlot(index);
                }}
                onDragLeave={() => {
                  if (dragOverSlot === index) setDragOverSlot(null);
                }}
                onDrop={(e) => {
                  if (!onSwapSlots) return;
                  e.preventDefault();
                  const parsed = Number(e.dataTransfer.getData("text/plain"));
                  const fromIdx = Number.isInteger(parsed) ? parsed : dragFromSlot;
                  if (fromIdx !== null && fromIdx !== index) {
                    onSwapSlots(fromIdx, index);
                  }
                  setDragFromSlot(null);
                  setDragOverSlot(null);
                }}
                onDragEnd={() => {
                  setDragFromSlot(null);
                  setDragOverSlot(null);
                }}
                onClick={() => onSelectSlot(index)}
                title={slot ? `${index + 1}: ${slot.label} (Drag or Shift+${index + 1} to swap)` : `Slot ${index + 1}`}
                aria-label={slot ? `Slot ${index + 1}: ${slot.label}` : `Empty slot ${index + 1}`}
                aria-pressed={active}
                className={cn(
                  "relative flex h-12 w-14 flex-col items-center justify-center rounded-md border px-1 text-xs transition-colors",
                  isDropTarget
                    ? "border-primary bg-primary/25 text-foreground ring-2 ring-primary"
                    : active
                      ? "border-primary bg-primary/15 text-foreground ring-1 ring-primary"
                      : "border-border bg-background/70 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <span className="self-start text-xs leading-none opacity-70">{index + 1}</span>
                <div className="flex flex-1 items-center justify-center">
                  {slot ? (
                    <ItemKindIcon kind={slot.kind} />
                  ) : (
                    <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                  )}
                </div>
                {slot ? (
                  <span className="w-full truncate text-center text-xs leading-tight text-foreground">
                    {slot.label}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {selectedItem ? (
          <div className="flex flex-col gap-1 border-l border-border pl-1.5">
            {actionTitle ? (
              <span className="max-w-44 truncate text-center text-xs font-medium text-primary">
                {actionTitle}
              </span>
            ) : null}
            <Button type="button" size="xs" variant="default" onClick={onUseSelected} title={actionTitle}>
              {canGiveToAgent ? (
                <HandHelping className="size-3.5" aria-hidden />
              ) : (
                <Sparkles className="size-3.5" aria-hidden />
              )}
              {actionLabel}
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={onDropSelected}>
              <Trash2 className="size-3.5" aria-hidden />
              {ot("office3d.hotbar.drop")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
