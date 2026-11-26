import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AGENT_ROLES, AGENT_ROLE_LABELS, type Agent, type AgentRole } from "@paperclipai/shared";
import { ExternalLink, UserPlus } from "lucide-react";
import { adaptersApi } from "@/api/adapters";
import { agentsApi } from "@/api/agents";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/router";
import type { BuildingConfig } from "../model/types";
import { useOfficeT } from "../officeCopy";

export interface OfficeHireResult {
  agent: Agent;
  approvalPending: boolean;
  targetFloorId: string | null;
  targetDeskId: string | null;
  autoPlaceDesk: boolean;
}

export interface OfficeHireAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  agents: Agent[];
  activeBuilding: BuildingConfig;
  activeFloorId: string;
  preselectedFloorId?: string;
  preselectedDeskId?: string;
  canEditLayout: boolean;
  onHired: (result: OfficeHireResult) => Promise<void> | void;
}

function readStringField(record: unknown, key: string): string {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "";
  const val = (record as Record<string, unknown>)[key];
  return typeof val === "string" ? val : "";
}

export function OfficeHireAgentModal({
  open,
  onOpenChange,
  companyId,
  agents,
  activeBuilding,
  activeFloorId,
  preselectedFloorId,
  preselectedDeskId,
  canEditLayout,
  onHired,
}: OfficeHireAgentModalProps) {
  const ot = useOfficeT();

  const nonTerminatedAgents = useMemo(
    () => agents.filter((a) => a.status !== "terminated"),
    [agents],
  );

  // Derive defaults dynamically from existing working agents in the company (no hardcoding)
  const companyTemplate = useMemo(() => {
    const withModel =
      nonTerminatedAgents.find(
        (a) => a.role !== "ceo" && Boolean(readStringField(a.adapterConfig, "model")),
      ) ??
      nonTerminatedAgents.find((a) => Boolean(readStringField(a.adapterConfig, "model"))) ??
      nonTerminatedAgents[0];

    const ceo = nonTerminatedAgents.find((a) => a.role === "ceo");
    return {
      adapterType: withModel?.adapterType ?? "",
      model: readStringField(withModel?.adapterConfig, "model"),
      cwd: readStringField(withModel?.adapterConfig, "cwd"),
      ceoId: ceo?.id ?? "",
    };
  }, [nonTerminatedAgents]);

  const adaptersQuery = useQuery({
    queryKey: ["office3d-adapters", companyId] as const,
    queryFn: () => adaptersApi.list({ companyId }),
    enabled: open && Boolean(companyId),
  });

  const adapterChoices = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of adaptersQuery.data ?? []) {
      if (!a.disabled) seen.set(a.type, a.label || a.type);
    }
    for (const ag of nonTerminatedAgents) {
      if (ag.adapterType && !seen.has(ag.adapterType)) {
        seen.set(ag.adapterType, ag.adapterType);
      }
    }
    return [...seen.entries()].map(([type, label]) => ({ type, label }));
  }, [adaptersQuery.data, nonTerminatedAgents]);

  const [name, setName] = useState("");
  const [role, setRole] = useState<AgentRole>("engineer");
  const [title, setTitle] = useState("");
  const [reportsTo, setReportsTo] = useState("");
  const [adapterType, setAdapterType] = useState("");
  const [model, setModel] = useState("");
  const [cwd, setCwd] = useState("");
  const [targetFloorId, setTargetFloorId] = useState("");
  const [deskChoice, setDeskChoice] = useState<string>("auto");
  const [instructionsText, setInstructionsText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedFloor = useMemo(
    () =>
      activeBuilding.floors.find((f) => f.id === targetFloorId) ??
      activeBuilding.floors[0] ??
      null,
    [activeBuilding.floors, targetFloorId],
  );

  const emptyDesksOnSelectedFloor = useMemo(
    () => (selectedFloor ? selectedFloor.desks.filter((d) => !d.assignedAgentId) : []),
    [selectedFloor],
  );

  useEffect(() => {
    if (!open) return;
    const initFloorId =
      preselectedFloorId ?? activeFloorId ?? activeBuilding.floors[0]?.id ?? "";
    const initFloor =
      activeBuilding.floors.find((f) => f.id === initFloorId) ?? activeBuilding.floors[0];
    const initEmptyDesk =
      preselectedDeskId ?? initFloor?.desks.find((d) => !d.assignedAgentId)?.id;

    setName("");
    setRole("engineer");
    setTitle("");
    setReportsTo(companyTemplate.ceoId);
    setAdapterType(companyTemplate.adapterType || adapterChoices[0]?.type || "");
    setModel(companyTemplate.model);
    setCwd(companyTemplate.cwd);
    setTargetFloorId(initFloorId);
    setDeskChoice(canEditLayout ? (initEmptyDesk ?? "auto") : "unseated");
    setInstructionsText("");
    setErrorMessage(null);
  }, [
    activeBuilding.floors,
    activeFloorId,
    canEditLayout,
    companyTemplate,
    open,
    preselectedDeskId,
    preselectedFloorId,
  ]);

  useEffect(() => {
    if (!open || adapterType) return;
    if (adapterChoices[0]?.type) {
      setAdapterType(adapterChoices[0].type);
    }
  }, [adapterChoices, adapterType, open]);

  const modelsQuery = useQuery({
    queryKey: ["office3d-adapter-models", companyId, adapterType] as const,
    queryFn: () => agentsApi.adapterModels(companyId, adapterType),
    enabled: open && Boolean(companyId) && Boolean(adapterType),
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    if (model.trim()) return;
    const firstSuggested = modelsQuery.data?.[0]?.id;
    if (firstSuggested) setModel(firstSuggested);
  }, [model, modelsQuery.data, open]);

  const hireMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) {
        throw new Error("Agent name is required.");
      }
      if (!adapterType) {
        throw new Error("Select an adapter before hiring.");
      }

      const adapterConfig: Record<string, unknown> = {};
      if (model.trim()) adapterConfig.model = model.trim();
      if (cwd.trim()) adapterConfig.cwd = cwd.trim();

      const payload: Record<string, unknown> = {
        name: name.trim(),
        role,
        title: title.trim() || null,
        reportsTo: reportsTo || null,
        adapterType,
        adapterConfig,
        runtimeConfig: {
          heartbeat: { enabled: false },
        },
      };
      if (instructionsText.trim()) {
        payload.instructionsBundle = {
          entryFile: "AGENTS.md",
          files: { "AGENTS.md": instructionsText.trim() },
        };
      }

      return agentsApi.hire(companyId, payload);
    },
    onSuccess: async (res) => {
      const approvalPending =
        Boolean(res.approval) || res.agent.status === "pending_approval";
      const useAuto = canEditLayout && deskChoice === "auto";
      const deskId =
        canEditLayout && deskChoice !== "auto" && deskChoice !== "unseated"
          ? deskChoice
          : null;

      await onHired({
        agent: res.agent,
        approvalPending,
        targetFloorId: canEditLayout && deskChoice !== "unseated" ? (selectedFloor?.id ?? null) : null,
        targetDeskId: deskId,
        autoPlaceDesk: useAuto,
      });
      onOpenChange(false);
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Failed to hire agent.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="office-station-dialog max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-8">
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" aria-hidden />
              <span>{ot("office3d.hire.title")}</span>
            </DialogTitle>
            <Button asChild type="button" size="xs" variant="ghost">
              <Link to="/agents/new" onClick={() => onOpenChange(false)}>
                <ExternalLink className="size-3.5" aria-hidden />
                {ot("office3d.hire.fullWizard")}
              </Link>
            </Button>
          </div>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setErrorMessage(null);
            hireMutation.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{ot("office3d.hire.name")}</span>
              <Input
                id="office-hire-name"
                name="officeHireName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={ot("office3d.hire.namePlaceholder")}
                required
              />
            </label>

            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{ot("office3d.hire.role")}</span>
              <select
                id="office-hire-role"
                name="officeHireRole"
                value={role}
                onChange={(e) => setRole(e.target.value as AgentRole)}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground"
              >
                {AGENT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {AGENT_ROLE_LABELS[r]} ({r})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{ot("office3d.hire.agentTitle")}</span>
              <Input
                id="office-hire-title"
                name="officeHireTitle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={ot("office3d.hire.agentTitlePlaceholder")}
              />
            </label>

            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{ot("office3d.hire.reportsTo")}</span>
              <select
                id="office-hire-reports-to"
                name="officeHireReportsTo"
                value={reportsTo}
                onChange={(e) => setReportsTo(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground"
              >
                <option value="">{ot("office3d.hire.noManager")}</option>
                {nonTerminatedAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.role})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{ot("office3d.hire.adapter")}</span>
              <select
                id="office-hire-adapter"
                name="officeHireAdapter"
                value={adapterType}
                onChange={(e) => setAdapterType(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground"
              >
                {adapterChoices.map((opt) => (
                  <option key={opt.type} value={opt.type}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">{ot("office3d.hire.model")}</span>
              <Input
                id="office-hire-model"
                name="officeHireModel"
                list="office-hire-model-list"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="provider/model-id"
              />
              <datalist id="office-hire-model-list">
                {(modelsQuery.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </datalist>
            </label>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{ot("office3d.hire.cwd")}</span>
            <Input
              id="office-hire-cwd"
              name="officeHireCwd"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="."
            />
          </label>

          {canEditLayout ? (
            <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">
              <label className="block space-y-1 text-xs">
                <span className="text-muted-foreground">{ot("office3d.hire.floor")}</span>
                <select
                  id="office-hire-floor"
                  name="officeHireFloor"
                  value={selectedFloor?.id ?? ""}
                  onChange={(e) => {
                    const nextFId = e.target.value;
                    setTargetFloorId(nextFId);
                    const nextFloor = activeBuilding.floors.find((f) => f.id === nextFId);
                    const firstFree = nextFloor?.desks.find((d) => !d.assignedAgentId)?.id;
                    setDeskChoice(firstFree ?? "auto");
                  }}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
                >
                  {activeBuilding.floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1 text-xs">
                <span className="text-muted-foreground">{ot("office3d.hire.desk")}</span>
                <select
                  id="office-hire-desk"
                  name="officeHireDesk"
                  value={deskChoice}
                  onChange={(e) => setDeskChoice(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
                >
                  {emptyDesksOnSelectedFloor.map((d) => (
                    <option key={d.id} value={d.id}>
                      {ot("office3d.hire.deskEmptyLabel", { x: d.x, z: d.z })}
                    </option>
                  ))}
                  <option value="auto">{ot("office3d.hire.deskAuto")}</option>
                  <option value="unseated">{ot("office3d.hire.deskUnseated")}</option>
                </select>
              </label>
            </div>
          ) : null}

          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{ot("office3d.hire.instructions")}</span>
            <textarea
              id="office-hire-instructions"
              name="officeHireInstructions"
              rows={3}
              value={instructionsText}
              onChange={(e) => setInstructionsText(e.target.value)}
              placeholder={ot("office3d.hire.instructionsPlaceholder")}
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
            />
          </label>

          {errorMessage ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive"
            >
              {errorMessage}
            </div>
          ) : null}

          <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {ot("office3d.build.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={hireMutation.isPending}>
              {hireMutation.isPending ? ot("office3d.hire.submitting") : ot("office3d.hire.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}