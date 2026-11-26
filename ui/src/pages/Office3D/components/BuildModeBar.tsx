import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Download,
  MousePointer,
  Move,
  Redo2,
  RotateCcw,
  RotateCw,
  Sofa,
  SquareDashed,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  BUILD_CATEGORY_ITEMS,
  OFFICE_PALETTE_KEYS,
  type BuildObjectCategory,
} from "../model/constants";
import type { Project } from "@paperclipai/shared";
import type {
  AgentOfficeSnapshot,
  DeskConfig,
  FloorConfig,
  FurnitureItem,
  GridRotation,
  OfficePaletteKey,
  RoomConfig,
} from "../model/types";
import type { BuildPlaceableKind, BuildTool } from "../scene/OfficeSceneEngine";
import { useOfficeT, type OfficeCopyKey } from "../officeCopy";

const PALETTE_SWATCH: Record<OfficePaletteKey, string> = {
  slate: "var(--office-palette-slate)",
  sand: "var(--office-palette-sand)",
  sage: "var(--office-palette-sage)",
  sky: "var(--office-palette-sky)",
  rose: "var(--office-palette-rose)",
  amber: "var(--office-palette-amber)",
  graphite: "var(--office-palette-graphite)",
};

export interface BuildModeBarProps {
  floor: FloorConfig;
  activeFloorIndex: number;
  tool: BuildTool;
  onToolChange: (tool: BuildTool) => void;
  placeableKind: BuildPlaceableKind;
  onPlaceableKindChange: (kind: BuildPlaceableKind) => void;
  placementRotation: GridRotation;
  isMovingEntity: boolean;
  onRotate: () => void;
  onStartMoveSelected: () => void;
  selectedTarget: { kind: "room" | "desk" | "furniture"; id: string } | null;
  agents: AgentOfficeSnapshot[];
  projects: Project[];
  canUndo: boolean;
  canRedo: boolean;
  errorMessage: string | null;
  onAddFloor: () => void;
  onRemoveFloor: () => void;
  onApplyPresetTemplate: () => void;
  onApplyOrgTemplate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onSave: () => void;
  onUpdateRoom: (roomId: string, patch: Partial<RoomConfig>) => void;
  onUpdateFurniture: (furnitureId: string, patch: Partial<FurnitureItem>) => void;
  onAssignDesk: (deskId: string, agentId: string | null) => void;
  onDeleteSelected: () => void;
  onExportBlueprint: () => void;
  onImportBlueprint: (jsonText: string) => void;
}

export function BuildModeBar({
  floor,
  activeFloorIndex,
  tool,
  onToolChange,
  placeableKind,
  onPlaceableKindChange,
  placementRotation,
  isMovingEntity,
  onRotate,
  onStartMoveSelected,
  selectedTarget,
  agents,
  projects,
  canUndo,
  canRedo,
  errorMessage,
  onAddFloor,
  onRemoveFloor,
  onApplyPresetTemplate,
  onApplyOrgTemplate,
  onUndo,
  onRedo,
  onCancel,
  onSave,
  onUpdateRoom,
  onUpdateFurniture,
  onAssignDesk,
  onDeleteSelected,
  onExportBlueprint,
  onImportBlueprint,
}: BuildModeBarProps) {
  const ot = useOfficeT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [category, setCategory] = useState<BuildObjectCategory>("indoor_work");
  const [templatesOpen, setTemplatesOpen] = useState(false);

  useEffect(() => {
    const matched = (Object.keys(BUILD_CATEGORY_ITEMS) as BuildObjectCategory[]).find((cat) =>
      BUILD_CATEGORY_ITEMS[cat].includes(placeableKind),
    );
    if (matched && matched !== category) {
      setCategory(matched);
    }
  }, [category, placeableKind]);

  const availableCategories: readonly BuildObjectCategory[] =
    activeFloorIndex === 0
      ? ["indoor_work", "indoor_decor", "outdoor"]
      : ["indoor_work", "indoor_decor"];
  const visiblePlaceableKinds = BUILD_CATEGORY_ITEMS[
    availableCategories.includes(category) ? category : "indoor_work"
  ];

  const selectedRoom: RoomConfig | null =
    selectedTarget?.kind === "room"
      ? floor.rooms.find((r) => r.id === selectedTarget.id) ?? null
      : null;

  const selectedDesk: DeskConfig | null =
    selectedTarget?.kind === "desk"
      ? floor.desks.find((d) => d.id === selectedTarget.id) ?? null
      : null;

  const selectedFurniture: FurnitureItem | null =
    selectedTarget?.kind === "furniture"
      ? floor.furniture.find((f) => f.id === selectedTarget.id) ?? null
      : null;

  const canRotate =
    tool === "furniture"
      ? placeableKind !== "door"
      : tool === "move" && isMovingEntity
        ? selectedTarget?.kind !== "room"
        : Boolean(selectedDesk || selectedFurniture);

  const activeRotation: GridRotation =
    tool === "furniture" && placeableKind !== "door"
      ? placementRotation
      : tool === "move" && isMovingEntity
        ? placementRotation
        : selectedDesk?.rotation ?? selectedFurniture?.rotation ?? placementRotation;

  return (
    <>
      {selectedRoom || selectedDesk || selectedFurniture ? (
        <div className="office-inspector-panel pointer-events-auto absolute right-4 z-30 w-72 rounded-lg border border-border bg-card/95 p-4 shadow-lg backdrop-blur-sm">
          {selectedRoom ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {ot("office3d.build.roomInspector")}
                </span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={onDeleteSelected}>
                  <Trash2 className="size-4 text-destructive" aria-hidden />
                </Button>
              </div>
              <label className="block space-y-1 text-xs">
                <span className="text-muted-foreground">{ot("office3d.build.roomName")}</span>
                <Input
                  id="office-build-room-name"
                  name="officeBuildRoomName"
                  value={selectedRoom.name}
                  onChange={(e) => onUpdateRoom(selectedRoom.id, { name: e.target.value })}
                />
              </label>
              <div className="space-y-1 text-xs">
                <span className="text-muted-foreground">{ot("office3d.build.wallStyle")}</span>
                <div className="flex gap-1.5">
                  {(["glass", "wood", "none"] as const).map((ws) => (
                    <Button
                      key={ws}
                      type="button"
                      size="xs"
                      variant={selectedRoom.wallStyle === ws ? "default" : "outline"}
                      onClick={() => onUpdateRoom(selectedRoom.id, { wallStyle: ws })}
                    >
                      {ws}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1 text-xs">
                <span className="text-muted-foreground">{ot("office3d.build.palette")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {OFFICE_PALETTE_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-label={key}
                      onClick={() => onUpdateRoom(selectedRoom.id, { floorPalette: key })}
                      style={{ ["--office-swatch-color" as string]: PALETTE_SWATCH[key] }}
                      className={cn(
                        "office-swatch size-6 rounded-md border",
                        selectedRoom.floorPalette === key
                          ? "border-primary ring-2 ring-ring"
                          : "border-border",
                      )}
                    />
                  ))}
                </div>
              </div>
              <Button type="button" size="xs" variant="outline" className="w-full" onClick={onStartMoveSelected}>
                <Move className="size-3.5" aria-hidden />
                {ot("office3d.build.moveRoom")}
              </Button>
            </div>
          ) : selectedDesk ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {ot("office3d.build.deskInspector")}
                </span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={onDeleteSelected}>
                  <Trash2 className="size-4 text-destructive" aria-hidden />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {ot("office3d.build.position")}: ({selectedDesk.x}, {selectedDesk.z}) · {selectedDesk.rotation}°
              </p>
              <label className="block space-y-1 text-xs">
                <span className="text-muted-foreground">{ot("office3d.build.assignedAgent")}</span>
                <select
                  id="office-build-desk-agent"
                  name="officeBuildDeskAgent"
                  value={selectedDesk.assignedAgentId ?? ""}
                  onChange={(e) => onAssignDesk(selectedDesk.id, e.target.value || null)}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground"
                >
                  <option value="">{ot("office3d.build.unassigned")}</option>
                  {agents
                    .filter((a) => a.visualState !== "hidden")
                    .map((a) => (
                      <option key={a.agentId} value={a.agentId}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                </select>
              </label>
              <div className="flex items-center gap-1.5">
                <Button type="button" size="xs" variant="outline" className="flex-1" onClick={onRotate}>
                  <RotateCw className="size-3.5" aria-hidden />
                  {ot("office3d.build.rotate")}
                </Button>
                <Button type="button" size="xs" variant="outline" className="flex-1" onClick={onStartMoveSelected}>
                  <Move className="size-3.5" aria-hidden />
                  {ot("office3d.build.moveAction")}
                </Button>
              </div>
            </div>
          ) : selectedFurniture ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {ot("office3d.build.furnitureInspector")}
                </span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={onDeleteSelected}>
                  <Trash2 className="size-4 text-destructive" aria-hidden />
                </Button>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-foreground">
                  {ot(`office3d.furniture.${selectedFurniture.kind}` as OfficeCopyKey)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ot("office3d.build.position")}: ({selectedFurniture.x}, {selectedFurniture.z}) ·{" "}
                  {selectedFurniture.rotation}°
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button type="button" size="xs" variant="outline" className="flex-1" onClick={onRotate}>
                  <RotateCw className="size-3.5" aria-hidden />
                  {ot("office3d.build.rotate")}
                </Button>
                <Button type="button" size="xs" variant="outline" className="flex-1" onClick={onStartMoveSelected}>
                  <Move className="size-3.5" aria-hidden />
                  {ot("office3d.build.moveAction")}
                </Button>
              </div>
              {selectedFurniture.kind === "whiteboard" ? (
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{ot("office3d.build.projectBinding")}</span>
                  <select
                    id="office-build-furniture-project"
                    name="officeBuildFurnitureProject"
                    value={selectedFurniture.targetEntityId ?? ""}
                    onChange={(e) =>
                      onUpdateFurniture(selectedFurniture.id, {
                        targetEntityId: e.target.value || undefined,
                      })
                    }
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground"
                  >
                    <option value="">{ot("office3d.build.allProjects")}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="pointer-events-auto fixed bottom-4 left-1/2 z-30 flex max-w-full -translate-x-1/2 flex-col items-center gap-2 px-3">
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-1.5 text-xs font-medium text-destructive"
          >
            {errorMessage}
          </div>
        ) : null}

        {tool === "move" || tool === "furniture" ? (
          <div className="rounded-md border border-border bg-card/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
            {tool === "move"
              ? ot(isMovingEntity ? "office3d.build.movingHint" : "office3d.build.selectToMoveHint")
              : placeableKind === "door"
                ? ot("office3d.build.placingDoorHint")
                : ot("office3d.build.placingHint", { deg: placementRotation })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-1 rounded-lg border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur-sm">
          {/* Cancel / Discard on the left per DESIGN.md footer convention */}
          <Button type="button" variant="outline" size="xs" onClick={onCancel}>
            {ot("office3d.build.cancel")}
          </Button>

          <Button
            type="button"
            size="xs"
            variant={tool === "select" ? "default" : "ghost"}
            onClick={() => onToolChange("select")}
          >
            <MousePointer className="size-3.5" aria-hidden />
            {ot("office3d.build.toolSelect")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={tool === "move" ? "default" : "ghost"}
            onClick={() => onToolChange("move")}
          >
            <Move className="size-3.5" aria-hidden />
            {ot("office3d.build.toolMove")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={tool === "room" ? "default" : "ghost"}
            onClick={() => onToolChange("room")}
          >
            <SquareDashed className="size-3.5" aria-hidden />
            {ot("office3d.build.toolRoom")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={tool === "furniture" ? "default" : "ghost"}
            onClick={() => onToolChange("furniture")}
          >
            <Sofa className="size-3.5" aria-hidden />
            {ot("office3d.build.toolFurniture")}
          </Button>

          {tool === "furniture" ? (
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5">
              {(
                [
                  { id: "indoor_work", key: "office3d.build.catIndoorWork" },
                  { id: "indoor_decor", key: "office3d.build.catIndoorDecor" },
                  ...(activeFloorIndex === 0
                    ? [{ id: "outdoor", key: "office3d.build.catOutdoor" } as const]
                    : []),
                ] as const
              ).map((cat) => (
                <Button
                  key={cat.id}
                  type="button"
                  size="xs"
                  variant={category === cat.id ? "secondary" : "ghost"}
                  onClick={() => {
                    setCategory(cat.id);
                    const nextItems = BUILD_CATEGORY_ITEMS[cat.id];
                    if (nextItems.length > 0 && !nextItems.includes(placeableKind)) {
                      onPlaceableKindChange(nextItems[0]!);
                    }
                  }}
                >
                  {ot(cat.key)}
                </Button>
              ))}
              <select
                id="office-build-furniture-kind"
                name="officeBuildFurnitureKind"
                aria-label={ot("office3d.build.toolFurniture")}
                value={placeableKind}
                onChange={(e) => onPlaceableKindChange(e.target.value as BuildPlaceableKind)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
              >
                {visiblePlaceableKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {ot(`office3d.furniture.${kind}` as OfficeCopyKey)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!canRotate}
            onClick={onRotate}
            title={ot("office3d.build.rotateHint")}
          >
            <RotateCw className="size-3.5" aria-hidden />
            {ot("office3d.build.rotate")} ({activeRotation}°)
          </Button>

          <Button
            type="button"
            size="xs"
            variant={tool === "delete" ? "destructive" : "ghost"}
            onClick={() => onToolChange("delete")}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {ot("office3d.build.toolDelete")}
          </Button>

          <Button type="button" size="xs" variant="outline" onClick={onAddFloor}>
            <Building2 className="size-3.5" aria-hidden />
            {ot("office3d.build.addFloor")}
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={onRemoveFloor}>
            {ot("office3d.build.removeFloor")}
          </Button>

          <Popover open={templatesOpen} onOpenChange={setTemplatesOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="xs" variant="outline">
                <RotateCcw className="size-3.5" aria-hidden />
                {ot("office3d.build.templates")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 space-y-1 p-2" align="end">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  onApplyPresetTemplate();
                  setTemplatesOpen(false);
                }}
              >
                {ot("office3d.build.applyPreset")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  onApplyOrgTemplate();
                  setTemplatesOpen(false);
                }}
              >
                {ot("office3d.build.applyOrg")}
              </Button>
            </PopoverContent>
          </Popover>

          <Button type="button" size="icon-xs" variant="ghost" disabled={!canUndo} onClick={onUndo} title={ot("office3d.build.undo")}>
            <Undo2 className="size-3.5" aria-hidden />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" disabled={!canRedo} onClick={onRedo} title={ot("office3d.build.redo")}>
            <Redo2 className="size-3.5" aria-hidden />
          </Button>

          <Button type="button" size="icon-xs" variant="ghost" onClick={onExportBlueprint} title={ot("office3d.build.export")}>
            <Download className="size-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            title={ot("office3d.build.import")}
          >
            <Upload className="size-3.5" aria-hidden />
          </Button>
          <input
            ref={fileInputRef}
            id="office-blueprint-import"
            name="officeBlueprintImport"
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void file.text().then((txt) => onImportBlueprint(txt));
              e.target.value = "";
            }}
          />

          {/* Primary Save action on the right */}
          <Button type="button" size="xs" onClick={onSave}>
            {ot("office3d.build.save")}
          </Button>
        </div>
      </div>
    </>
  );
}
