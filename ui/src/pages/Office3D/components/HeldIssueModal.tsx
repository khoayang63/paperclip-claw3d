import { ExternalLink, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { CompactIssue } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { issueUrl } from "@/lib/utils";
import type { AgentOfficeSnapshot } from "../model/types";
import { useOfficeT } from "../officeCopy";

export interface HeldIssueModalProps {
  open: boolean;
  issueId: string | null;
  fallbackLabel?: string | null;
  fallbackIdentifier?: string | null;
  compactIssue?: CompactIssue | null;
  agentsById: Record<string, AgentOfficeSnapshot>;
  onClose: () => void;
}

export function HeldIssueModal({
  open,
  issueId,
  fallbackLabel,
  fallbackIdentifier,
  compactIssue,
  agentsById,
  onClose,
}: HeldIssueModalProps) {
  const ot = useOfficeT();

  const detailQuery = useQuery({
    queryKey: issueId ? queryKeys.issues.detail(issueId) : ["issues", "held-none"],
    queryFn: () => issuesApi.get(issueId!),
    enabled: Boolean(open && issueId),
  });

  const issue = detailQuery.data ?? null;
  const identifier =
    issue?.identifier ?? compactIssue?.identifier ?? fallbackIdentifier ?? fallbackLabel ?? "Task";
  const title = issue?.title ?? compactIssue?.title ?? fallbackLabel ?? identifier;
  const status = issue?.status ?? compactIssue?.status ?? null;
  const priority = issue?.priority ?? compactIssue?.priority ?? null;
  const assigneeId = issue?.assigneeAgentId ?? compactIssue?.assigneeAgentId ?? null;
  const assignee = assigneeId ? agentsById[assigneeId] : null;
  const description = issue?.description?.trim() || null;
  const fullPath = issueUrl({ id: issueId ?? identifier, identifier: issue?.identifier ?? compactIssue?.identifier ?? fallbackIdentifier ?? null });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 font-mono">
              <FileText className="size-3" aria-hidden />
              {identifier}
            </Badge>
            {status ? <Badge variant="secondary">{status}</Badge> : null}
            {priority ? <Badge variant="outline">{priority}</Badge> : null}
          </div>
          <DialogTitle className="pt-1 text-base leading-snug">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">{ot("office3d.issueModal.assignee")}</span>
            <span className="font-medium text-foreground">
              {assignee ? `${assignee.name} (${assignee.role})` : ot("office3d.issueModal.unassigned")}
            </span>
          </div>

          {detailQuery.isLoading && !description ? (
            <p className="text-xs text-muted-foreground">{ot("office3d.issueModal.loading")}</p>
          ) : description ? (
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background/80 p-3 text-xs leading-relaxed text-foreground">
              {description}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {ot("office3d.issueModal.noDescription")}
            </p>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {ot("office3d.issueModal.close")}
          </Button>
          {issueId ? (
            <Button asChild size="sm">
              <Link to={fullPath} onClick={onClose}>
                <ExternalLink className="size-3.5" aria-hidden />
                {ot("office3d.issueModal.openFull")}
              </Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
