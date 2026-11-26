import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Edit3, ExternalLink, FileText, Plus, Save, X } from "lucide-react";
import type { AgentInstructionsBundle, AgentInstructionsFileSummary } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { useOptionalToastActions } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import type { AgentOfficeSnapshot } from "../model/types";
import { useOfficeT } from "../officeCopy";

export interface OfficePlaybookDrawerProps {
  open: boolean;
  initialAgentId: string | null;
  companyId: string;
  agents: AgentOfficeSnapshot[];
  canEdit: boolean;
  onClose: () => void;
}

function normalizeInstructionPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\/+/, "");
  if (!trimmed || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return trimmed;
}

export function OfficePlaybookDrawer({
  open,
  initialAgentId,
  companyId,
  agents,
  canEdit,
  onClose,
}: OfficePlaybookDrawerProps) {
  const ot = useOfficeT();
  const queryClient = useQueryClient();
  const pushToast = useOptionalToastActions()?.pushToast ?? null;

  const visibleAgents = agents.filter((a) => a.visualState !== "hidden");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [newFileDraftPath, setNewFileDraftPath] = useState<string | null>(null);
  const [showNewFileForm, setShowNewFileForm] = useState(false);
  const [newFileNameInput, setNewFileNameInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const fallbackId = initialAgentId ?? visibleAgents[0]?.agentId ?? "";
    setSelectedAgentId(fallbackId);
    setSelectedPath("");
    setNewFileDraftPath(null);
    setShowNewFileForm(false);
    setNewFileNameInput("");
    setEditing(false);
    setDraftContent("");
    setErrorMessage(null);
  }, [initialAgentId, open]);

  const activeAgent =
    visibleAgents.find((a) => a.agentId === selectedAgentId) ?? visibleAgents[0] ?? null;
  const activeAgentId = activeAgent?.agentId ?? "";

  const bundleQuery = useQuery({
    queryKey: ["office3d-instructions-bundle", companyId, activeAgentId] as const,
    queryFn: () => agentsApi.instructionsBundle(activeAgentId, companyId),
    enabled: open && Boolean(companyId && activeAgentId),
    retry: false,
  });

  const entryFilePath = bundleQuery.data?.entryFile || "AGENTS.md";

  const bundleFiles: AgentInstructionsFileSummary[] = useMemo(() => {
    const rawFiles = bundleQuery.data?.files ?? [];
    if (bundleQuery.data && rawFiles.length === 0) {
      return [
        {
          path: entryFilePath,
          size: 0,
          language: "markdown",
          markdown: true,
          isEntryFile: true,
          editable: bundleQuery.data.editable ?? true,
          deprecated: false,
          virtual: false,
          binary: false,
        },
      ];
    }
    return [...rawFiles].sort((a, b) => {
      const aEntry = a.isEntryFile || a.path === entryFilePath;
      const bEntry = b.isEntryFile || b.path === entryFilePath;
      if (aEntry !== bEntry) return aEntry ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }, [bundleQuery.data, entryFilePath]);

  const activeFilePath = useMemo(() => {
    if (newFileDraftPath) return newFileDraftPath;
    if (selectedPath && bundleFiles.some((f) => f.path === selectedPath)) {
      return selectedPath;
    }
    return bundleFiles[0]?.path ?? entryFilePath;
  }, [bundleFiles, entryFilePath, newFileDraftPath, selectedPath]);

  const isNewDraftFile = Boolean(newFileDraftPath && activeFilePath === newFileDraftPath);
  const activeFileSummary = bundleFiles.find((f) => f.path === activeFilePath) ?? null;
  const isBinaryFile = Boolean(activeFileSummary?.binary);
  const isBundleEditable = canEdit && (bundleQuery.data?.editable ?? true);
  const isFileEditable =
    isBundleEditable &&
    (isNewDraftFile || ((activeFileSummary?.editable ?? true) && !isBinaryFile));

  const fileQuery = useQuery({
    queryKey: ["office3d-instructions-file", companyId, activeAgentId, activeFilePath] as const,
    queryFn: () => agentsApi.instructionsFile(activeAgentId, activeFilePath, companyId),
    enabled:
      open &&
      Boolean(
        companyId &&
          activeAgentId &&
          bundleQuery.isSuccess &&
          activeFilePath &&
          !isNewDraftFile &&
          !isBinaryFile,
      ),
    retry: false,
  });

  useEffect(() => {
    if (isNewDraftFile) return;
    if (fileQuery.data && !editing) {
      setDraftContent(fileQuery.data.content);
    }
  }, [activeFilePath, editing, fileQuery.data, isNewDraftFile]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const file = isNewDraftFile ? undefined : fileQuery.data;
      return agentsApi.saveInstructionsFile(
        activeAgentId,
        {
          path: activeFilePath,
          content: draftContent,
          baseRevisionId: isNewDraftFile ? null : (file?.revision?.id ?? null),
          baseHash: isNewDraftFile
            ? null
            : (file?.contentHash ?? file?.revision?.contentHash ?? null),
        },
        companyId,
      );
    },
    onSuccess: (updated) => {
      const savedPath = updated?.path || activeFilePath;
      setNewFileDraftPath(null);
      setShowNewFileForm(false);
      setNewFileNameInput("");
      setSelectedPath(savedPath);
      setEditing(false);
      setErrorMessage(null);

      queryClient.setQueryData(
        ["office3d-instructions-file", companyId, activeAgentId, savedPath],
        updated,
      );
      queryClient.setQueryData<AgentInstructionsBundle>(
        ["office3d-instructions-bundle", companyId, activeAgentId],
        (previous) => {
          if (!previous) return previous;
          const existingFiles = Array.isArray(previous.files) ? previous.files : [];
          const baseList =
            existingFiles.length > 0
              ? existingFiles
              : [
                  {
                    path: previous.entryFile || "AGENTS.md",
                    size: 0,
                    language: "markdown",
                    markdown: true,
                    isEntryFile: true,
                    editable: previous.editable ?? true,
                    deprecated: false,
                    virtual: false,
                    binary: false,
                  },
                ];
          const nextSummary: AgentInstructionsFileSummary = {
            path: savedPath,
            contentHash: updated?.contentHash,
            binary: updated?.binary ?? false,
            size: updated?.size ?? updated?.content?.length ?? draftContent.length,
            language: updated?.language ?? "markdown",
            markdown: updated?.markdown ?? savedPath.toLowerCase().endsWith(".md"),
            isEntryFile:
              updated?.isEntryFile ?? savedPath === (previous.entryFile || "AGENTS.md"),
            editable: updated?.editable ?? true,
            deprecated: updated?.deprecated ?? false,
            virtual: updated?.virtual ?? false,
          };
          return {
            ...previous,
            files: [...baseList.filter((item) => item.path !== savedPath), nextSummary],
          };
        },
      );
      void queryClient.invalidateQueries({
        queryKey: ["office3d-instructions-bundle", companyId, activeAgentId],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agents.instructionsBundle(activeAgentId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agents.instructionsFile(activeAgentId, savedPath),
      });
      pushToast?.({
        title: ot("office3d.playbook.saved", {
          path: savedPath,
          name: activeAgent?.name ?? "agent",
        }),
        tone: "info",
      });
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save instructions.");
    },
  });

  if (!open) return null;

  const agentRef = activeAgent
    ? agentRouteRef({ id: activeAgent.agentId, urlKey: activeAgent.urlKey, name: activeAgent.name })
    : "";

  const handleSelectFileChip = (path: string) => {
    setSelectedPath(path);
    setNewFileDraftPath(null);
    setShowNewFileForm(false);
    setEditing(false);
    setDraftContent("");
    setErrorMessage(null);
  };

  const handleCreateNewFile = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeInstructionPath(newFileNameInput);
    if (!normalized) {
      setErrorMessage(ot("office3d.playbook.invalidPath"));
      return;
    }
    const existing = bundleFiles.find((f) => f.path === normalized);
    if (existing) {
      setSelectedPath(existing.path);
      setNewFileDraftPath(null);
      setShowNewFileForm(false);
      setNewFileNameInput("");
      setEditing(true);
      setErrorMessage(null);
      return;
    }
    setNewFileDraftPath(normalized);
    setSelectedPath(normalized);
    setDraftContent("");
    setEditing(true);
    setShowNewFileForm(false);
    setNewFileNameInput("");
    setErrorMessage(null);
  };

  return (
    <aside
      aria-label={ot("office3d.playbook.title")}
      className="office-side-drawer pointer-events-auto absolute right-4 z-30 flex flex-col rounded-lg border border-border bg-card/95 shadow-xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <BookOpen className="size-4 shrink-0 text-primary" aria-hidden />
          <h2 className="truncate text-sm font-semibold text-foreground">
            {ot("office3d.playbook.title")}
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {agentRef ? (
            <Button
              asChild
              type="button"
              size="icon-xs"
              variant="ghost"
              title={ot("office3d.modal.openFullPage")}
            >
              <Link to={`/agents/${encodeURIComponent(agentRef)}/identity`}>
                <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </Button>
          ) : null}
          <Button type="button" size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <span className="shrink-0 text-muted-foreground">{ot("office3d.playbook.selectAgent")}</span>
          <select
            id="office-playbook-agent"
            name="officePlaybookAgent"
            value={activeAgentId}
            onChange={(e) => {
              setSelectedAgentId(e.target.value);
              setSelectedPath("");
              setNewFileDraftPath(null);
              setShowNewFileForm(false);
              setNewFileNameInput("");
              setEditing(false);
              setDraftContent("");
              setErrorMessage(null);
            }}
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
          >
            {visibleAgents.map((ag) => (
              <option key={ag.agentId} value={ag.agentId}>
                {ag.name} ({ag.role})
              </option>
            ))}
          </select>
        </label>

        {isFileEditable && !editing && (isNewDraftFile || fileQuery.data) ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              if (!isNewDraftFile) {
                setDraftContent(fileQuery.data?.content ?? "");
              }
              setEditing(true);
            }}
          >
            <Edit3 className="size-3.5" aria-hidden />
            {ot("office3d.playbook.edit")}
          </Button>
        ) : !isFileEditable && !isBinaryFile && fileQuery.data ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {ot("office3d.playbook.readOnly")}
          </span>
        ) : null}
      </div>

      {bundleQuery.isSuccess ? (
        <div className="space-y-2 border-b border-border bg-muted/20 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={ot("office3d.playbook.files")}>
            {bundleFiles.map((file) => {
              const isActive = !isNewDraftFile && activeFilePath === file.path;
              return (
                <Button
                  key={file.path}
                  type="button"
                  size="xs"
                  role="tab"
                  aria-selected={isActive}
                  variant={isActive ? "default" : "outline"}
                  onClick={() => handleSelectFileChip(file.path)}
                  className="max-w-full gap-1"
                >
                  <FileText className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{file.path}</span>
                  {(file.isEntryFile || file.path === entryFilePath) && bundleFiles.length > 1 ? (
                    <span className="rounded bg-background/20 px-1 text-xs opacity-80">
                      {ot("office3d.playbook.entryBadge")}
                    </span>
                  ) : null}
                </Button>
              );
            })}

            {newFileDraftPath ? (
              <Button
                type="button"
                size="xs"
                role="tab"
                aria-selected={isNewDraftFile}
                variant={isNewDraftFile ? "default" : "outline"}
                onClick={() => {
                  setSelectedPath(newFileDraftPath);
                  setEditing(true);
                  setErrorMessage(null);
                }}
                className="max-w-full gap-1"
              >
                <FileText className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{newFileDraftPath}</span>
              </Button>
            ) : null}

            {isBundleEditable ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setShowNewFileForm((v) => !v);
                  setErrorMessage(null);
                }}
                className="gap-1"
              >
                <Plus className="size-3" aria-hidden />
                {ot("office3d.playbook.newFile")}
              </Button>
            ) : null}
          </div>

          {showNewFileForm && isBundleEditable ? (
            <form onSubmit={handleCreateNewFile} className="flex items-center gap-1.5">
              <input
                id="office-playbook-new-file"
                name="officePlaybookNewFile"
                type="text"
                value={newFileNameInput}
                onChange={(e) => setNewFileNameInput(e.target.value)}
                placeholder={ot("office3d.playbook.newFilePlaceholder")}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
              />
              <Button type="submit" size="xs">
                {ot("office3d.playbook.createFile")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setShowNewFileForm(false);
                  setNewFileNameInput("");
                  setErrorMessage(null);
                }}
              >
                {ot("office3d.playbook.cancel")}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-3">
        {errorMessage ? (
          <div
            role="alert"
            className="mb-2 rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-1.5 text-xs text-destructive"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/60 pb-1.5">
          <span className="truncate font-mono text-xs font-medium text-muted-foreground">
            {activeFilePath}
          </span>
        </div>

        {bundleQuery.isLoading || (!isNewDraftFile && !isBinaryFile && fileQuery.isLoading) ? (
          <p className="text-xs text-muted-foreground">Loading playbook…</p>
        ) : isBinaryFile ? (
          <p className="text-xs text-muted-foreground">{ot("office3d.playbook.binaryUnsupported")}</p>
        ) : editing ? (
          <textarea
            id="office-playbook-editor"
            name="officePlaybookEditor"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (isNewDraftFile) {
                  setNewFileDraftPath(null);
                  setSelectedPath(entryFilePath);
                }
                setEditing(false);
              }
            }}
            rows={18}
            className="h-full w-full resize-none rounded-md border border-input bg-background p-2.5 font-mono text-xs text-foreground"
          />
        ) : fileQuery.data?.content ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
            {fileQuery.data.content}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">{ot("office3d.playbook.empty")}</p>
        )}
      </div>

      {editing ? (
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              if (isNewDraftFile) {
                setNewFileDraftPath(null);
                setSelectedPath(entryFilePath);
              }
              setEditing(false);
              setErrorMessage(null);
            }}
          >
            {ot("office3d.playbook.cancel")}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="size-3.5" aria-hidden />
            {saveMutation.isPending ? ot("office3d.playbook.saving") : ot("office3d.playbook.save")}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
