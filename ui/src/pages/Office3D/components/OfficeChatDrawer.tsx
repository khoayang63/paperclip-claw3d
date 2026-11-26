import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue, LiveEvent } from "@paperclipai/shared";
import {
  BookOpen,
  ExternalLink,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Send,
  X,
  Zap,
} from "lucide-react";
import { agentChatsApi } from "@/api/agentChats";
import { issuesApi } from "@/api/issues";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDialogActions } from "@/context/DialogContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useOptionalToastActions } from "@/context/ToastContext";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { agentRouteRef, cn, formatDateTime } from "@/lib/utils";
import type { AgentOfficeSnapshot, OfficeActionCapability } from "../model/types";
import { useOfficeT } from "../officeCopy";

export interface OfficeChatDrawerProps {
  agent: AgentOfficeSnapshot | null;
  companyId: string;
  allowedActions: OfficeActionCapability[];
  onClose: () => void;
  onPauseAgent: (agentId: string) => void;
  onResumeAgent: (agentId: string) => void;
  onWakeAgent: (agentId: string) => void;
  wakingAgent?: boolean;
  onOpenPlaybook?: (agentId: string) => void;
}

export function OfficeChatDrawer({
  agent,
  companyId,
  allowedActions,
  onClose,
  onPauseAgent,
  onResumeAgent,
  onWakeAgent,
  wakingAgent = false,
  onOpenPlaybook,
}: OfficeChatDrawerProps) {
  const ot = useOfficeT();
  const queryClient = useQueryClient();
  const { openNewIssue } = useDialogActions();
  const pushToast = useOptionalToastActions()?.pushToast ?? null;
  const { enabled: chatEnabled, loaded: chatFlagLoaded } = useAgentChatEnabled();
  const [draft, setDraft] = useState("");
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const creatingChatRef = useRef<Promise<Issue> | null>(null);

  useEffect(() => {
    creatingChatRef.current = null;
    setDraft("");
  }, [agent?.agentId, companyId]);

  const chatIssueQuery = useQuery({
    queryKey: ["office3d-agent-chat-issue", companyId, agent?.agentId ?? ""] as const,
    queryFn: () => agentChatsApi.get(companyId, agent!.agentId),
    enabled: Boolean(agent && companyId && (!chatFlagLoaded || chatEnabled)),
  });

  const chatIssueId = chatIssueQuery.data?.id ?? null;

  const commentsQuery = useQuery({
    queryKey: ["office3d-agent-chat-comments", chatIssueId ?? ""] as const,
    queryFn: () => issuesApi.listComments(chatIssueId!, { order: "asc", limit: 120 }),
    enabled: Boolean(chatIssueId),
  });

  useCompanyLiveEvent((event: LiveEvent) => {
    if (!agent || !companyId) return;
    const payload = event.payload ?? {};
    const evtIssueId = typeof payload.issueId === "string" ? payload.issueId : null;
    const evtEntityId = typeof payload.entityId === "string" ? payload.entityId : null;
    const evtAgentId = typeof payload.agentId === "string" ? payload.agentId : null;

    if (
      (chatIssueId && (evtIssueId === chatIssueId || evtEntityId === chatIssueId)) ||
      evtAgentId === agent.agentId
    ) {
      if (chatIssueId) {
        void queryClient.invalidateQueries({
          queryKey: ["office3d-agent-chat-comments", chatIssueId],
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ["office3d-agent-chat-issue", companyId, agent.agentId],
      });
    }
  });

  useEffect(() => {
    if (typeof scrollEndRef.current?.scrollIntoView === "function") {
      scrollEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [commentsQuery.data?.length, agent?.agentId]);

  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!agent || !companyId) throw new Error("Missing agent or company context.");
      let issue = chatIssueQuery.data ?? null;
      if (!issue) {
        creatingChatRef.current ??= agentChatsApi.ensure(companyId, agent.agentId);
        try {
          issue = await creatingChatRef.current;
          queryClient.setQueryData(
            ["office3d-agent-chat-issue", companyId, agent.agentId],
            issue,
          );
          queryClient.setQueryData(queryKeys.issues.detail(issue.id), issue);
        } catch (err) {
          creatingChatRef.current = null;
          throw err;
        }
      }
      return issuesApi.addComment(issue.id, text);
    },
    onSuccess: (comment) => {
      setDraft("");
      void queryClient.invalidateQueries({
        queryKey: ["office3d-agent-chat-comments", comment.issueId],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
    },
    onError: (err) => {
      pushToast?.({
        title: "Could not send chat message",
        body: err instanceof Error ? err.message : "Request failed.",
        tone: "error",
      });
    },
  });

  if (!agent) return null;

  const canPause = allowedActions.includes("pause_resume_agent");
  const canAssign = allowedActions.includes("assign_issue");
  const isPaused = agent.visualState === "paused" || agent.visualState === "paused_budget";
  const agentRef = agentRouteRef({ id: agent.agentId, urlKey: agent.urlKey, name: agent.name });
  const comments = commentsQuery.data ?? [];

  const handleSubmit = () => {
    const body = draft.trim();
    if (!body || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate(body);
  };

  return (
    <aside
      aria-label={`${ot("office3d.chat.title")}: ${agent.name}`}
      className="office-side-drawer pointer-events-auto absolute right-4 z-30 flex flex-col rounded-lg border border-border bg-card/95 shadow-xl backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <MessageCircle className="size-4 shrink-0 text-primary" aria-hidden />
            <h2 className="truncate text-sm font-semibold text-foreground">{agent.name}</h2>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{agent.role}</span>
            <Badge variant="outline">{agent.visualState}</Badge>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {onOpenPlaybook ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title={ot("office3d.modal.readPlaybook")}
              onClick={() => onOpenPlaybook(agent.agentId)}
            >
              <BookOpen className="size-3.5" aria-hidden />
            </Button>
          ) : null}
          <Button asChild type="button" size="icon-xs" variant="ghost" title={ot("office3d.modal.openFullPage")}>
            <Link to={`/chats/${encodeURIComponent(agentRef)}`}>
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {/* Quick Control Bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={wakingAgent}
          onClick={() => onWakeAgent(agent.agentId)}
        >
          <Zap className="size-3.5" aria-hidden />
          {wakingAgent ? ot("office3d.chat.waking") : ot("office3d.chat.wakeNow")}
        </Button>

        {canAssign ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => openNewIssue({ assigneeAgentId: agent.agentId })}
          >
            <Plus className="size-3.5" aria-hidden />
            {ot("office3d.modal.assignTask")}
          </Button>
        ) : null}

        {canPause ? (
          isPaused ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onResumeAgent(agent.agentId)}
            >
              <Play className="size-3.5" aria-hidden />
              {ot("office3d.modal.resume")}
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onPauseAgent(agent.agentId)}
            >
              <Pause className="size-3.5" aria-hidden />
              {ot("office3d.modal.pause")}
            </Button>
          )
        ) : null}
      </div>

      {/* Conversation History */}
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {chatFlagLoaded && !chatEnabled && !chatIssueQuery.data ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {ot("office3d.chat.disabled")}
          </div>
        ) : commentsQuery.isLoading || chatIssueQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading conversation…</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{ot("office3d.chat.empty")}</p>
        ) : (
          comments.map((msg) => {
            const fromAgent = msg.authorType === "agent" || Boolean(msg.authorAgentId);
            return (
              <div
                key={msg.id}
                className={cn(
                  "rounded-md border px-2.5 py-2 text-xs",
                  fromAgent
                    ? "mr-4 border-border bg-muted/60 text-foreground"
                    : "ml-4 border-primary/30 bg-primary/10 text-foreground",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {fromAgent ? agent.name : "You"}
                  </span>
                  <span>{formatDateTime(msg.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
              </div>
            );
          })
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Message Composer */}
      {!chatFlagLoaded || chatEnabled || chatIssueQuery.data ? (
        <form
          className="border-t border-border p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div className="flex items-end gap-1.5">
            <textarea
              id="office-chat-input"
              name="officeChatInput"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                } else if (e.key === "Escape") {
                  onClose();
                }
              }}
              placeholder={ot("office3d.chat.placeholder", { name: agent.name })}
              className="flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={!draft.trim() || sendMessageMutation.isPending}
              title={ot("office3d.chat.send")}
            >
              <Send className="size-3.5" aria-hidden />
            </Button>
          </div>
        </form>
      ) : null}
    </aside>
  );
}