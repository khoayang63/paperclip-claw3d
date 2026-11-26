import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Hash,
  ListPlus,
  MessageCircle,
  Paperclip,
  Send,
  SlidersHorizontal,
  Sparkles,
  User,
  X,
} from "lucide-react";
import type { Agent, TeamChatMessage, TeamChatRoomSummary } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { teamChatApi } from "@/api/team-chat";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { queryKeys } from "@/lib/queryKeys";
import { AgentIcon } from "@/components/AgentIconPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTeamChatCopy } from "./teamChatCopy";
import {
  buildPromotedTaskDescription,
  clipChatPreview,
  getPromotableContextMessages,
  isMessageTruncated,
  isWorkEventMessage,
  PROMOTE_CONTEXT_DEFAULT_COUNT,
} from "./teamChatHelpers";

const AUTO_REPLY_TURN_OPTIONS = [0, 1, 2, 4, 6, 8] as const;

function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function deriveTaskTitleFromBody(body: string): string {
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Follow-up task from Team Chat";
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
}

export interface TeamChatRoomViewProps {
  companyId: string;
  room: TeamChatRoomSummary | null;
  messages: TeamChatMessage[];
  activeAgents: Agent[];
  compact?: boolean;
  onOpenSettings?: () => void;
  emptyContent?: ReactNode;
}

export function TeamChatRoomView({
  companyId,
  room,
  messages,
  activeAgents,
  compact = false,
  onOpenSettings,
  emptyContent,
}: TeamChatRoomViewProps) {
  const copy = useTeamChatCopy();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState("");
  const [autoReplyTurns, setAutoReplyTurns] = useState<number>(room?.maxAutoTurns ?? 4);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [promoteTarget, setPromoteTarget] = useState<TeamChatMessage | null>(null);
  const [promoteTitle, setPromoteTitle] = useState("");
  const [promoteDescription, setPromoteDescription] = useState("");
  const [promoteIncludeContext, setPromoteIncludeContext] = useState(true);
  const [promoteSelectedContextIds, setPromoteSelectedContextIds] = useState<string[]>([]);
  const [promoteProjectId, setPromoteProjectId] = useState("");
  const [promoteFiles, setPromoteFiles] = useState<File[]>([]);
  const [promoteAssigneeId, setPromoteAssigneeId] = useState("");
  const [promotePriority, setPromotePriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [promoteWakeAssignee, setPromoteWakeAssignee] = useState(true);

  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const roomId = room?.id ?? null;

  const projectsQuery = useQuery({
    queryKey: companyId ? queryKeys.projects.list(companyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(companyId),
    enabled: Boolean(companyId && promoteTarget),
  });
  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    if (room) {
      setAutoReplyTurns(room.maxAutoTurns);
    }
  }, [room?.id, room?.maxAutoTurns]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [roomId, messages.length]);

  useCompanyLiveEvent((event) => {
    if (!companyId || event.type !== "activity.logged") return;
    const action = typeof event.payload?.action === "string" ? event.payload.action : "";
    if (!action.startsWith("team_chat.")) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.rooms(companyId) });
    if (roomId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teamChat.room(companyId, roomId),
      });
    }
  });

  const postMessageMutation = useMutation({
    mutationFn: (payload: { body: string; autoReplyTurns: number }) =>
      teamChatApi.postMessage(companyId, roomId!, payload),
    onSuccess: (res) => {
      setErrorBanner(null);
      setWarnings(res.warnings ?? []);
      setDraft("");
      if (roomId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.rooms(companyId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teamChat.room(companyId, roomId),
        });
      }
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : "Failed to send message");
    },
  });

  const discussMutation = useMutation({
    mutationFn: () => teamChatApi.discuss(companyId, roomId!, { rounds: 2 }),
    onSuccess: (res) => {
      setErrorBanner(null);
      setWarnings(res.warnings ?? []);
      if (roomId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.rooms(companyId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teamChat.room(companyId, roomId),
        });
      }
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : "Discussion round failed");
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async (payload: {
      messageId: string;
      title: string;
      description: string;
      projectId: string | null;
      assigneeAgentId: string | null;
      priority: "low" | "medium" | "high" | "critical";
      wakeAssignee: boolean;
      files: File[];
    }) => {
      const hasFiles = payload.files.length > 0;
      const result = await teamChatApi.promoteMessage(companyId, roomId!, payload.messageId, {
        title: payload.title,
        description: payload.description,
        projectId: payload.projectId,
        assigneeAgentId: payload.assigneeAgentId,
        priority: payload.priority,
        wakeAssignee: hasFiles ? false : payload.wakeAssignee,
      });

      if (hasFiles) {
        for (const file of payload.files) {
          await issuesApi.uploadAttachment(companyId, result.issue.id, file);
        }
        if (payload.wakeAssignee && payload.assigneeAgentId) {
          await agentsApi.wakeup(
            payload.assigneeAgentId,
            {
              source: "assignment",
              triggerDetail: "system",
              reason: "issue_assigned",
              payload: { issueId: result.issue.id, mutation: "create" },
            },
            companyId,
          );
        }
      }
      return result;
    },
    onSuccess: () => {
      setPromoteTarget(null);
      setPromoteFiles([]);
      setErrorBanner(null);
      if (roomId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teamChat.room(companyId, roomId),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      }
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : "Failed to promote message to task");
    },
  });

  const promoteContextCandidates = promoteTarget
    ? getPromotableContextMessages(messages, promoteTarget)
    : [];

  function rebuildPromoteDescription(
    target: TeamChatMessage,
    includeContext: boolean,
    selectedIds: string[],
  ) {
    const roomLabel = room ? (room.kind === "dm" ? `DM: ${room.name}` : `#${room.slug}`) : "Team Chat";
    setPromoteDescription(
      buildPromotedTaskDescription(messages, target, {
        roomLabel,
        includeContext,
        selectedContextMessageIds: selectedIds,
      }),
    );
  }

  function openPromoteDialog(message: TeamChatMessage) {
    const candidates = getPromotableContextMessages(messages, message);
    const defaultIds = candidates.slice(-PROMOTE_CONTEXT_DEFAULT_COUNT).map((m) => m.id);
    setPromoteTarget(message);
    setPromoteTitle(deriveTaskTitleFromBody(message.body));
    setPromoteIncludeContext(defaultIds.length > 0);
    setPromoteSelectedContextIds(defaultIds);
    rebuildPromoteDescription(message, defaultIds.length > 0, defaultIds);
    const defaultAssignee =
      message.authorAgentId ??
      room?.members.find((m) => m.role === "pm")?.agentId ??
      room?.members[0]?.agentId ??
      "";
    setPromoteAssigneeId(defaultAssignee);
    setPromoteProjectId("");
    setPromoteFiles([]);
    setPromotePriority("medium");
    setPromoteWakeAssignee(true);
  }

  function handleTogglePromoteContext(nextInclude: boolean) {
    setPromoteIncludeContext(nextInclude);
    if (!promoteTarget) return;
    const nextIds = nextInclude
      ? promoteSelectedContextIds.length > 0
        ? promoteSelectedContextIds
        : promoteContextCandidates.slice(-PROMOTE_CONTEXT_DEFAULT_COUNT).map((m) => m.id)
      : [];
    setPromoteSelectedContextIds(nextIds);
    rebuildPromoteDescription(promoteTarget, nextInclude, nextIds);
  }

  function handleTogglePromoteMessageId(messageId: string, checked: boolean) {
    if (!promoteTarget) return;
    const nextIds = checked
      ? promoteContextCandidates
          .filter((m) => m.id === messageId || promoteSelectedContextIds.includes(m.id))
          .map((m) => m.id)
      : promoteSelectedContextIds.filter((id) => id !== messageId);
    const nextInclude = nextIds.length > 0;
    setPromoteSelectedContextIds(nextIds);
    setPromoteIncludeContext(nextInclude);
    rebuildPromoteDescription(promoteTarget, nextInclude, nextIds);
  }

  function handleSelectAllPromoteMessages(selectAll: boolean) {
    if (!promoteTarget) return;
    const nextIds = selectAll ? promoteContextCandidates.map((m) => m.id) : [];
    setPromoteSelectedContextIds(nextIds);
    setPromoteIncludeContext(nextIds.length > 0);
    rebuildPromoteDescription(promoteTarget, nextIds.length > 0, nextIds);
  }

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || !roomId || postMessageMutation.isPending) return;
    postMessageMutation.mutate({ body: trimmed, autoReplyTurns });
  }

  function insertMention(name: string) {
    const token = `@${name} `;
    setDraft((prev) => {
      if (!prev) return token;
      const needsSpace = !/\s$/.test(prev);
      return `${prev}${needsSpace ? " " : ""}${token}`;
    });
  }

  if (!room) {
    return <>{emptyContent ?? null}</>;
  }

  const isBusy = postMessageMutation.isPending || discussMutation.isPending;

  return (
    <div className="flex min-w-0 flex-1 flex-col min-h-0">
      {/* Room Header */}
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/50",
          compact ? "px-3 py-2" : "px-5 py-3 gap-3",
        )}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {room.kind === "channel" ? (
              <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <MessageCircle className="h-4 w-4 text-primary shrink-0" />
            )}
            <h2 className={cn("truncate font-semibold", compact ? "text-sm" : "text-base")}>
              {room.kind === "channel" ? room.slug : room.name}
            </h2>
            <Badge variant="secondary" className="text-xs">
              {copy("teamChat.sidebar.membersCount", { count: room.members.length })}
            </Badge>
            {room.model && (
              <Badge variant="outline" className="text-xs font-mono">
                {room.model}
              </Badge>
            )}
            {room.workEventMode === "assignments_and_status" && (
              <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                {copy("teamChat.badge.workUpdate")}
              </Badge>
            )}
          </div>
          {!compact && room.topic && (
            <p className="text-xs text-muted-foreground truncate">{room.topic}</p>
          )}
          {!compact && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {room.members.map((member) => (
                <Badge
                  key={member.agentId}
                  variant="outline"
                  className="gap-1 px-2 py-0.5 text-xs font-normal"
                >
                  <AgentIcon icon={member.icon} className="h-3 w-3 text-primary" />
                  <span>{member.name}</span>
                  {member.hasSoul && (
                    <span className="rounded bg-primary/15 px-1 text-primary font-medium">
                      {copy("teamChat.header.soulBadge")}
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size={compact ? "xs" : "sm"}
            variant="secondary"
            disabled={isBusy}
            onClick={() => discussMutation.mutate()}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1" />
            {discussMutation.isPending
              ? copy("teamChat.actions.discussing")
              : copy("teamChat.actions.discuss")}
          </Button>
          {onOpenSettings && (
            <Button size={compact ? "xs" : "sm"} variant="outline" onClick={onOpenSettings}>
              <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
              {copy("teamChat.actions.settings")}
            </Button>
          )}
        </div>
      </header>

      {/* Banners */}
      {(errorBanner || warnings.length > 0) && (
        <div
          className={cn(
            "border-b border-border bg-muted/40 py-2 space-y-1",
            compact ? "px-3" : "px-5",
          )}
        >
          {errorBanner && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              <span className="truncate">{errorBanner}</span>
              <button type="button" onClick={() => setErrorBanner(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {warnings.map((warning, idx) => (
            <div
              key={`${idx}-${warning}`}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="truncate">{warning}</span>
              </div>
              <button
                type="button"
                onClick={() => setWarnings((prev) => prev.filter((_, i) => i !== idx))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Message Timeline */}
      <div
        className={cn(
          "flex-1 overflow-y-auto space-y-3",
          compact ? "px-3 py-3" : "px-5 py-4 space-y-4",
        )}
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            {copy("teamChat.empty.noMessages", {
              example: room.members[0]?.name ?? "cuong",
            })}
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.authorType === "user";
            const isSystem = msg.authorType === "system";
            const truncated = isMessageTruncated(msg);
            const workEvent = isWorkEventMessage(msg);

            return (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-2.5 rounded-lg border",
                  compact ? "px-2.5 py-2" : "gap-3 px-3.5 py-2.5",
                  isSystem
                    ? "border-border/60 bg-muted/40 text-xs text-muted-foreground"
                    : isUser
                      ? "border-primary/20 bg-primary/5"
                      : "border-border bg-card",
                )}
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                  {isUser ? (
                    <User className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <AgentIcon icon={msg.authorIcon} className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{msg.authorName}</span>
                    {!compact && msg.authorTitle && (
                      <span className="text-xs text-muted-foreground">{msg.authorTitle}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatMessageTime(msg.createdAt)}
                    </span>
                    {workEvent && (
                      <Badge variant="secondary" className="text-xs">
                        {copy("teamChat.badge.workUpdate")}
                      </Badge>
                    )}
                    {truncated && (
                      <Badge
                        variant="outline"
                        title={copy("teamChat.badge.truncatedHint")}
                        className="gap-1 text-xs border-destructive/40 text-destructive"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {copy("teamChat.badge.truncated")}
                      </Badge>
                    )}
                    {!compact && msg.model && (
                      <Badge variant="outline" className="text-xs font-mono">
                        {msg.model}
                      </Badge>
                    )}
                  </div>

                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {msg.body}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {msg.linkedIssue && (
                      <Link
                        to={`/issues/${msg.linkedIssue.identifier ?? msg.linkedIssue.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/15"
                      >
                        <ListPlus className="h-3 w-3" />
                        <span>
                          {msg.linkedIssue.identifier ?? msg.linkedIssue.id.slice(0, 8)} ·{" "}
                          {msg.linkedIssue.title}
                        </span>
                        <span className="opacity-75">({msg.linkedIssue.status})</span>
                      </Link>
                    )}

                    {!isSystem && !msg.linkedIssue && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => openPromoteDialog(msg)}
                      >
                        <ListPlus className="h-3 w-3 mr-1" />
                        {copy("teamChat.actions.createTask")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={timelineEndRef} />
      </div>

      {/* Composer */}
      <footer
        className={cn(
          "border-t border-border bg-card/60 space-y-2",
          compact ? "px-3 py-2" : "px-5 py-3",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {!compact && (
              <span className="text-xs text-muted-foreground mr-1">
                {copy("teamChat.composer.mentionHint")}
              </span>
            )}
            {room.members.map((member) => (
              <button
                key={member.agentId}
                type="button"
                onClick={() => insertMention(member.name)}
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
              >
                @{member.name}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{copy("teamChat.composer.autoReplies")}</span>
            <select
              value={autoReplyTurns}
              onChange={(e) => setAutoReplyTurns(Number(e.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
            >
              {AUTO_REPLY_TURN_OPTIONS.map((val) => (
                <option key={val} value={val}>
                  {val === 0 ? copy("teamChat.composer.silent") : `${val}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              room.kind === "channel"
                ? copy("teamChat.composer.placeholder", { room: room.slug })
                : copy("teamChat.composer.dmPlaceholder", { name: room.name })
            }
            rows={2}
            disabled={isBusy}
            className="min-h-12 flex-1 resize-none"
          />
          <Button
            size={compact ? "sm" : "default"}
            onClick={handleSend}
            disabled={!draft.trim() || isBusy}
            className="shrink-0"
          >
            <Send className="h-4 w-4 mr-1.5" />
            {postMessageMutation.isPending
              ? copy("teamChat.actions.sending")
              : copy("teamChat.actions.send")}
          </Button>
        </div>
      </footer>

      {/* Promote Message to Task Dialog */}
      <Dialog
        open={Boolean(promoteTarget)}
        onOpenChange={(open) => {
          if (!open) setPromoteTarget(null);
        }}
      >
        <DialogContent className="flex max-h-svh max-w-xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{copy("teamChat.modal.promote.title")}</DialogTitle>
            <DialogDescription>{copy("teamChat.modal.promote.description")}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-1 pr-1">
            <div className="space-y-1">
              <label className="text-xs font-medium">{copy("teamChat.field.taskTitle")}</label>
              <Input value={promoteTitle} onChange={(e) => setPromoteTitle(e.target.value)} />
            </div>

            {promoteContextCandidates.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    {copy("teamChat.field.contextMessages", {
                      selected: promoteSelectedContextIds.length,
                      total: promoteContextCandidates.length,
                    })}
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleSelectAllPromoteMessages(true)}
                      className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                      {copy("teamChat.actions.selectAll")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectAllPromoteMessages(false)}
                      className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                      {copy("teamChat.actions.clearSelection")}
                    </button>
                  </div>
                </div>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
                  {promoteContextCandidates.map((candidate) => {
                    const checked = promoteSelectedContextIds.includes(candidate.id);
                    return (
                      <label
                        key={candidate.id}
                        className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 shrink-0"
                          checked={checked}
                          onChange={(e) =>
                            handleTogglePromoteMessageId(candidate.id, e.target.checked)
                          }
                        />
                        <span className="min-w-0 flex-1 leading-snug">
                          <span className="font-medium text-foreground">
                            {candidate.authorName}
                          </span>
                          <span className="text-muted-foreground">
                            {": "}
                            {clipChatPreview(candidate.body, 110)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium">
                  {copy("teamChat.field.taskDescription")}
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={promoteIncludeContext}
                    onChange={(e) => handleTogglePromoteContext(e.target.checked)}
                  />
                  <span>
                    {copy("teamChat.field.includeContext", {
                      count: PROMOTE_CONTEXT_DEFAULT_COUNT,
                    })}
                  </span>
                </label>
              </div>
              <Textarea
                value={promoteDescription}
                onChange={(e) => setPromoteDescription(e.target.value)}
                rows={6}
                className="max-h-48 min-h-28 overflow-y-auto resize-y"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{copy("teamChat.field.project")}</label>
              <select
                value={promoteProjectId}
                onChange={(e) => setPromoteProjectId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{copy("teamChat.field.noProject")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium">{copy("teamChat.field.attachments")}</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                  {copy("teamChat.actions.addAttachment")}
                </Button>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    if (picked.length > 0) {
                      setPromoteFiles((prev) => [...prev, ...picked]);
                    }
                    e.target.value = "";
                  }}
                />
              </div>
              {promoteFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {promoteFiles.map((file, idx) => (
                    <span
                      key={`${file.name}-${file.size}-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                    >
                      <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="max-w-44 truncate">{file.name}</span>
                      <span className="text-muted-foreground">
                        ({Math.max(1, Math.round(file.size / 1024))} KB)
                      </span>
                      <button
                        type="button"
                        aria-label={copy("teamChat.actions.removeAttachment")}
                        onClick={() =>
                          setPromoteFiles((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.assignee")}</label>
                <select
                  value={promoteAssigneeId}
                  onChange={(e) => setPromoteAssigneeId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{copy("teamChat.field.unassigned")}</option>
                  {activeAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.title ?? agent.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.priority")}</label>
                <select
                  value={promotePriority}
                  onChange={(e) =>
                    setPromotePriority(
                      e.target.value as "low" | "medium" | "high" | "critical",
                    )
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={promoteWakeAssignee}
                onChange={(e) => setPromoteWakeAssignee(e.target.checked)}
                disabled={!promoteAssigneeId}
              />
              <span>{copy("teamChat.field.wakeAssignee")}</span>
            </label>
          </div>

          <DialogFooter className="shrink-0 flex flex-row items-center justify-between gap-2 border-t border-border pt-3 sm:justify-between">
            <Button variant="outline" onClick={() => setPromoteTarget(null)}>
              {copy("teamChat.actions.cancel")}
            </Button>
            <Button
              disabled={!promoteTarget || !promoteTitle.trim() || promoteMutation.isPending}
              onClick={() => {
                if (!promoteTarget) return;
                promoteMutation.mutate({
                  messageId: promoteTarget.id,
                  title: promoteTitle.trim(),
                  description: promoteDescription.trim(),
                  projectId: promoteProjectId || null,
                  assigneeAgentId: promoteAssigneeId || null,
                  priority: promotePriority,
                  wakeAssignee: Boolean(promoteAssigneeId && promoteWakeAssignee),
                  files: promoteFiles,
                });
              }}
            >
              {promoteMutation.isPending
                ? copy("teamChat.actions.promoting")
                : copy("teamChat.actions.promoteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
