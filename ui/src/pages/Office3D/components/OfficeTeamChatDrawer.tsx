import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MessagesSquare, X } from "lucide-react";
import { TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT, type Agent } from "@paperclipai/shared";
import { teamChatApi } from "@/api/team-chat";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { TeamChatRoomView } from "@/pages/TeamChat/TeamChatRoomView";
import { useOfficeT } from "../officeCopy";

const DM_OPTION_PREFIX = "__dm__:";

export interface OfficeTeamChatDrawerProps {
  open: boolean;
  companyId: string;
  agents: Agent[];
  onClose: () => void;
  onAgentMessageSpoken?: (agentId: string, text: string) => void;
  targetDmAgentId?: string | null;
  onDmTargetHandled?: () => void;
}

export function OfficeTeamChatDrawer({
  open,
  companyId,
  agents,
  onClose,
  onAgentMessageSpoken,
  targetDmAgentId,
  onDmTargetHandled,
}: OfficeTeamChatDrawerProps) {
  const ot = useOfficeT();
  const queryClient = useQueryClient();
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const seededRoomIdRef = useRef<string | null>(null);
  const handledDmTargetRef = useRef<string | null>(null);

  const roomsQuery = useQuery({
    queryKey: queryKeys.teamChat.rooms(companyId),
    queryFn: () => teamChatApi.listRooms(companyId),
    enabled: Boolean(open && companyId),
  });

  const connectionsQuery = useQuery({
    queryKey: queryKeys.teamChat.connections(companyId),
    queryFn: () => teamChatApi.listConnections(companyId),
    enabled: Boolean(open && companyId),
  });

  const createDmMutation = useMutation({
    mutationFn: (agent: Agent) => {
      const conns = connectionsQuery.data ?? [];
      const defaultConn = conns.find((c) => c.isDefault) ?? conns[0];
      return teamChatApi.createRoom(companyId, {
        kind: "dm",
        name: agent.name,
        topic: agent.title ? `1:1 with ${agent.title}` : undefined,
        aiConnectionId: defaultConn?.id ?? null,
        aiConnectionGrantId: defaultConn?.grantId ?? null,
        model: defaultConn?.defaultModel ?? null,
        maxAutoTurns: 1,
        maxOutputTokens: TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT,
        workEventMode: "off",
        memberAgentIds: [agent.id],
      });
    },
    onSuccess: (room) => {
      setSelectedRoomId(room.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.rooms(companyId) });
    },
  });

  const rooms = roomsQuery.data ?? [];
  const activeAgents = agents.filter((a) => a.status !== "terminated");

  const openOrCreateDm = useCallback(
    (agentId: string) => {
      const existingDm = rooms.find(
        (r) =>
          r.kind === "dm" &&
          r.members.length === 1 &&
          r.members[0]?.agentId === agentId,
      );
      if (existingDm) {
        setSelectedRoomId(existingDm.id);
        return;
      }
      const agent = activeAgents.find((a) => a.id === agentId);
      if (agent && !createDmMutation.isPending) {
        createDmMutation.mutate(agent);
      }
    },
    [activeAgents, createDmMutation, rooms],
  );

  useEffect(() => {
    if (!open || !targetDmAgentId || roomsQuery.isLoading) return;
    if (handledDmTargetRef.current === targetDmAgentId) return;
    handledDmTargetRef.current = targetDmAgentId;
    openOrCreateDm(targetDmAgentId);
    onDmTargetHandled?.();
  }, [onDmTargetHandled, open, openOrCreateDm, roomsQuery.isLoading, targetDmAgentId]);

  useEffect(() => {
    if (!targetDmAgentId) {
      handledDmTargetRef.current = null;
    }
  }, [targetDmAgentId]);
  const activeRoomSummary =
    rooms.find((r) => r.id === selectedRoomId) ?? rooms[0] ?? null;
  const activeRoomId = activeRoomSummary?.id ?? null;

  useEffect(() => {
    if (!selectedRoomId && activeRoomId) {
      setSelectedRoomId(activeRoomId);
    }
  }, [activeRoomId, selectedRoomId]);

  const detailQuery = useQuery({
    queryKey: activeRoomId
      ? queryKeys.teamChat.room(companyId, activeRoomId)
      : ["team-chat", "room", "none"],
    queryFn: () => teamChatApi.getRoom(companyId, activeRoomId!),
    enabled: Boolean(open && companyId && activeRoomId),
  });

  const fetchedMessages = detailQuery.data?.messages;

  useEffect(() => {
    if (!open || !activeRoomId || !fetchedMessages) return;
    if (seededRoomIdRef.current !== activeRoomId) {
      seenMessageIdsRef.current = new Set(fetchedMessages.map((m) => m.id));
      seededRoomIdRef.current = activeRoomId;
      return;
    }
    for (const msg of fetchedMessages) {
      if (seenMessageIdsRef.current.has(msg.id)) continue;
      seenMessageIdsRef.current.add(msg.id);
      if (msg.authorType === "agent" && msg.authorAgentId && msg.body.trim()) {
        onAgentMessageSpoken?.(msg.authorAgentId, msg.body);
      }
    }
  }, [activeRoomId, fetchedMessages, onAgentMessageSpoken, open]);

  if (!open) return null;

  const activeRoom = detailQuery.data?.room ?? activeRoomSummary;
  const messages = detailQuery.data?.messages ?? [];

  return (
    <aside
      aria-label={ot("office3d.teamChat.title")}
      className="office-side-drawer pointer-events-auto absolute right-4 z-30 flex flex-col rounded-lg border border-border bg-card/95 shadow-xl backdrop-blur-md overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MessagesSquare className="size-4 shrink-0 text-primary" aria-hidden />
          <select
            aria-label={ot("office3d.teamChat.title")}
            value={activeRoomId ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith(DM_OPTION_PREFIX)) {
                openOrCreateDm(val.slice(DM_OPTION_PREFIX.length));
              } else {
                setSelectedRoomId(val);
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground"
          >
            {rooms.length === 0 ? (
              <option value="">{ot("office3d.teamChat.title")}</option>
            ) : (
              <optgroup label={ot("office3d.teamChat.roomsGroup")}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.kind === "channel" ? `#${r.slug}` : `DM: ${r.name}`}
                  </option>
                ))}
              </optgroup>
            )}
            {activeAgents.length > 0 ? (
              <optgroup label={ot("office3d.teamChat.quickDmGroup")}>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={`${DM_OPTION_PREFIX}${agent.id}`}>
                    DM · {agent.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button type="button" size="icon-xs" variant="ghost" asChild title={ot("office3d.teamChat.openFull")}>
            <Link to={activeRoomId ? `/team-chat/${activeRoomId}` : "/team-chat"}>
              <ExternalLink className="size-3.5" />
            </Link>
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label="Close Team Chat"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <TeamChatRoomView
        companyId={companyId}
        room={activeRoom}
        messages={messages}
        activeAgents={activeAgents}
        compact
        emptyContent={
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
            <MessagesSquare className="size-8 opacity-60" aria-hidden />
            <p>{ot("office3d.teamChat.empty")}</p>
            <Button type="button" size="xs" variant="outline" asChild>
              <Link to="/team-chat">{ot("office3d.teamChat.openFull")}</Link>
            </Button>
          </div>
        }
      />
    </aside>
  );
}
