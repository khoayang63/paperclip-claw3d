import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Copy,
  FileCode2,
  Folder,
  RefreshCw,
} from "lucide-react";
import type { OfficeWorkspaceTarget } from "@paperclipai/shared";
import { officeLayoutApi } from "@/api/office-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOfficeT } from "../officeCopy";

export interface OfficeWorkspaceCodeBrowserProps {
  companyId: string;
  agentId?: string;
  initialWorkspaceId?: string | null;
  preferredIssueIdentifier?: string | null;
}

function formatByteSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pickInitialWorkspace(
  workspaces: OfficeWorkspaceTarget[],
  initialWorkspaceId?: string | null,
  preferredIssueIdentifier?: string | null,
): OfficeWorkspaceTarget | null {
  if (workspaces.length === 0) return null;
  if (initialWorkspaceId) {
    const exact = workspaces.find((w) => w.id === initialWorkspaceId);
    if (exact) return exact;
  }
  if (preferredIssueIdentifier) {
    const matchingIssue = workspaces.find(
      (w) => w.exists && w.issueIdentifier === preferredIssueIdentifier,
    );
    if (matchingIssue) return matchingIssue;
  }
  return workspaces.find((w) => w.exists) ?? workspaces[0] ?? null;
}

export function OfficeWorkspaceCodeBrowser({
  companyId,
  agentId,
  initialWorkspaceId,
  preferredIssueIdentifier,
}: OfficeWorkspaceCodeBrowserProps) {
  const ot = useOfficeT();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(initialWorkspaceId ?? "");
  const [currentFolderPath, setCurrentFolderPath] = useState<string>("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const workspacesQuery = useQuery({
    queryKey: ["office3d-workspaces", companyId, agentId ?? "company"] as const,
    queryFn: () => officeLayoutApi.listWorkspaces(companyId, { agentId }),
    enabled: Boolean(companyId),
  });

  const workspaces = workspacesQuery.data?.workspaces ?? [];

  useEffect(() => {
    const chosen = pickInitialWorkspace(
      workspaces,
      initialWorkspaceId,
      preferredIssueIdentifier,
    );
    if (!chosen) {
      setSelectedWorkspaceId("");
      return;
    }
    setSelectedWorkspaceId((prev) =>
      prev && workspaces.some((w) => w.id === prev) ? prev : chosen.id,
    );
  }, [workspaces, initialWorkspaceId, preferredIssueIdentifier]);

  useEffect(() => {
    if (initialWorkspaceId) {
      setSelectedWorkspaceId(initialWorkspaceId);
      setCurrentFolderPath("");
      setSelectedFilePath(null);
    }
  }, [initialWorkspaceId]);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedWorkspaceId) ?? null,
    [workspaces, selectedWorkspaceId],
  );

  const treeQuery = useQuery({
    queryKey: [
      "office3d-workspace-tree",
      companyId,
      activeWorkspace?.id ?? "",
      currentFolderPath,
      agentId ?? "company",
    ] as const,
    queryFn: () =>
      officeLayoutApi.getWorkspaceTree(companyId, activeWorkspace!.id, {
        path: currentFolderPath,
        agentId,
      }),
    enabled: Boolean(companyId && activeWorkspace && activeWorkspace.exists),
  });

  const fileQuery = useQuery({
    queryKey: [
      "office3d-workspace-file",
      companyId,
      activeWorkspace?.id ?? "",
      selectedFilePath ?? "",
      agentId ?? "company",
    ] as const,
    queryFn: () =>
      officeLayoutApi.getWorkspaceFile(companyId, activeWorkspace!.id, {
        path: selectedFilePath!,
        agentId,
      }),
    enabled: Boolean(
      companyId && activeWorkspace && activeWorkspace.exists && selectedFilePath,
    ),
  });

  const breadcrumbSegments = useMemo(
    () => (currentFolderPath ? currentFolderPath.split("/").filter(Boolean) : []),
    [currentFolderPath],
  );

  const handleSelectWorkspace = (nextId: string) => {
    setSelectedWorkspaceId(nextId);
    setCurrentFolderPath("");
    setSelectedFilePath(null);
    setCopied(false);
  };

  const handleRefresh = () => {
    void workspacesQuery.refetch();
    if (activeWorkspace?.exists) {
      void treeQuery.refetch();
      if (selectedFilePath) {
        void fileQuery.refetch();
      }
    }
  };

  const handleCopy = async () => {
    const content = fileQuery.data?.content;
    if (!content || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (workspacesQuery.isLoading) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        Loading workspaces...
      </div>
    );
  }

  if (workspacesQuery.error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        {workspacesQuery.error instanceof Error
          ? workspacesQuery.error.message
          : "Failed to load workspaces."}
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {ot("office3d.codeSpace.emptyWorkspaces")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <span className="shrink-0 font-medium text-muted-foreground">
            {ot("office3d.codeSpace.workspaceLabel")}
          </span>
          <select
            aria-label={ot("office3d.codeSpace.workspaceLabel")}
            value={selectedWorkspaceId}
            onChange={(e) => handleSelectWorkspace(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.label}
                {!ws.exists ? " (missing)" : ""}
              </option>
            ))}
          </select>
        </label>

        <Button type="button" size="xs" variant="outline" onClick={handleRefresh}>
          <RefreshCw className="size-3.5" aria-hidden />
          {ot("office3d.codeSpace.refresh")}
        </Button>
      </div>

      {activeWorkspace ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs">
          <span className="min-w-0 truncate font-mono text-muted-foreground" title={activeWorkspace.cwd}>
            {activeWorkspace.cwd}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {activeWorkspace.issueIdentifier ? (
              <Badge variant="outline">{activeWorkspace.issueIdentifier}</Badge>
            ) : null}
            {activeWorkspace.branchName ? (
              <Badge variant="secondary">{activeWorkspace.branchName}</Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeWorkspace && !activeWorkspace.exists ? (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {ot("office3d.codeSpace.missingOnDisk")}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setCurrentFolderPath("");
                setSelectedFilePath(null);
              }}
              className="rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
            >
              {ot("office3d.codeSpace.rootBreadcrumb")}
            </button>
            {breadcrumbSegments.map((seg, idx) => {
              const targetPath = breadcrumbSegments.slice(0, idx + 1).join("/");
              return (
                <div key={targetPath} className="flex items-center gap-1">
                  <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentFolderPath(targetPath);
                      setSelectedFilePath(null);
                    }}
                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {seg}
                  </button>
                </div>
              );
            })}
            {treeQuery.data?.truncated ? (
              <Badge variant="outline" className="ml-auto">
                {ot("office3d.codeSpace.truncatedFolder")}
              </Badge>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-muted/20 p-1.5 sm:col-span-4">
              {treeQuery.isLoading ? (
                <p className="p-2 text-xs text-muted-foreground">Loading folder...</p>
              ) : treeQuery.error ? (
                <p className="p-2 text-xs text-destructive">
                  {treeQuery.error instanceof Error
                    ? treeQuery.error.message
                    : "Failed to load directory."}
                </p>
              ) : (treeQuery.data?.entries ?? []).length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  {ot("office3d.codeSpace.emptyFolder")}
                </p>
              ) : (
                <div className="space-y-0.5">
                  {treeQuery.data!.entries.map((entry) => {
                    const isSelected = entry.kind === "file" && entry.path === selectedFilePath;
                    return (
                      <button
                        key={entry.path}
                        type="button"
                        onClick={() => {
                          if (entry.kind === "directory") {
                            setCurrentFolderPath(entry.path);
                            setSelectedFilePath(null);
                          } else {
                            setSelectedFilePath(entry.path);
                            setCopied(false);
                          }
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs ${
                          isSelected
                            ? "bg-accent font-medium text-accent-foreground"
                            : "text-foreground hover:bg-accent/50"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          {entry.kind === "directory" ? (
                            <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          ) : (
                            <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          )}
                          <span className="truncate">{entry.name}</span>
                        </span>
                        {entry.kind === "file" && entry.sizeBytes !== null ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatByteSize(entry.sizeBytes)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex max-h-80 flex-col rounded-md border border-border bg-muted/20 sm:col-span-8">
              {!selectedFilePath ? (
                <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
                  {ot("office3d.codeSpace.selectFile")}
                </div>
              ) : fileQuery.isLoading ? (
                <div className="p-4 text-xs text-muted-foreground">Loading file...</div>
              ) : fileQuery.error ? (
                <div className="p-4 text-xs text-destructive">
                  {fileQuery.error instanceof Error
                    ? fileQuery.error.message
                    : "Failed to load file."}
                </div>
              ) : fileQuery.data ? (
                <>
                  <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs">
                    <span className="min-w-0 truncate font-mono font-medium">
                      {fileQuery.data.path}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-muted-foreground">
                        {formatByteSize(fileQuery.data.sizeBytes)}
                      </span>
                      {fileQuery.data.truncated ? (
                        <Badge variant="outline">{ot("office3d.codeSpace.truncated")}</Badge>
                      ) : null}
                      {!fileQuery.data.isBinary && fileQuery.data.content !== null ? (
                        <Button type="button" size="xs" variant="ghost" onClick={handleCopy}>
                          {copied ? (
                            <>
                              <Check className="size-3" aria-hidden />
                              {ot("office3d.codeSpace.copied")}
                            </>
                          ) : (
                            <>
                              <Copy className="size-3" aria-hidden />
                              {ot("office3d.codeSpace.copy")}
                            </>
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {fileQuery.data.isBinary ? (
                    <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
                      {ot("office3d.codeSpace.binaryNotice")}
                    </div>
                  ) : (
                    <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground">
                      <code>{fileQuery.data.content ?? ""}</code>
                    </pre>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
