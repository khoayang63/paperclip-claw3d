import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Hash, MessageCircle, MessagesSquare, Plus } from "lucide-react";
import type {
  Agent,
  TeamChatRoomKind,
  TeamChatRoomSummary,
  TeamChatWorkEventMode,
} from "@paperclipai/shared";
import {
  TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT,
  TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX,
  TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN,
} from "@paperclipai/shared";
import { useNavigate, useParams } from "@/lib/router";
import { agentsApi } from "@/api/agents";
import { teamChatApi } from "@/api/team-chat";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { queryKeys } from "@/lib/queryKeys";
import { AgentIcon } from "@/components/AgentIconPicker";
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
import { ModelCombobox } from "./ModelCombobox";
import { TeamChatRoomView } from "./TeamChatRoomView";
import { useTeamChatCopy } from "./teamChatCopy";

const MAX_AUTO_TURNS_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const MAX_OUTPUT_TOKEN_PRESETS = [512, 1024, 2048, 4096] as const;

export function TeamChatPage() {
  const copy = useTeamChatCopy();
  const navigate = useNavigate();
  const { roomId: paramRoomId } = useParams<{ roomId?: string }>();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [createKind, setCreateKind] = useState<TeamChatRoomKind>("channel");
  const [createName, setCreateName] = useState("");
  const [createTopic, setCreateTopic] = useState("");
  const [createPersonaPrompt, setCreatePersonaPrompt] = useState("");
  const [createConnectionId, setCreateConnectionId] = useState("");
  const [createModel, setCreateModel] = useState("");
  const [createMaxTurns, setCreateMaxTurns] = useState<number>(4);
  const [createMaxOutputTokens, setCreateMaxOutputTokens] = useState<number>(
    TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT,
  );
  const [createWorkEventMode, setCreateWorkEventMode] = useState<TeamChatWorkEventMode>("off");
  const [createMemberIds, setCreateMemberIds] = useState<string[]>([]);

  const [editName, setEditName] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [editPersonaPrompt, setEditPersonaPrompt] = useState("");
  const [editConnectionId, setEditConnectionId] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editMaxTurns, setEditMaxTurns] = useState<number>(4);
  const [editMaxOutputTokens, setEditMaxOutputTokens] = useState<number>(
    TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT,
  );
  const [editWorkEventMode, setEditWorkEventMode] = useState<TeamChatWorkEventMode>("off");
  const [editMemberIds, setEditMemberIds] = useState<string[]>([]);

  const roomsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.teamChat.rooms(selectedCompanyId) : ["team-chat", "rooms", "none"],
    queryFn: () => teamChatApi.listRooms(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const agentsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const connectionsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.teamChat.connections(selectedCompanyId)
      : ["team-chat", "connections", "none"],
    queryFn: () => teamChatApi.listConnections(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const connections = connectionsQuery.data ?? [];
  const defaultConnectionId = useMemo(
    () => (connections.find((c) => c.isDefault) ?? connections[0])?.id ?? "",
    [connections],
  );

  const activeDialogConnectionId = settingsOpen
    ? editConnectionId || defaultConnectionId
    : createOpen
      ? createConnectionId || defaultConnectionId
      : "";

  const modelsQuery = useQuery({
    queryKey:
      selectedCompanyId && activeDialogConnectionId
        ? queryKeys.teamChat.models(selectedCompanyId, activeDialogConnectionId)
        : ["team-chat", "models", "none"],
    queryFn: () => teamChatApi.listModels(selectedCompanyId!, activeDialogConnectionId),
    enabled: Boolean(selectedCompanyId && activeDialogConnectionId),
  });

  const rooms = roomsQuery.data ?? [];
  const activeAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => agent.status !== "terminated"),
    [agentsQuery.data],
  );

  const activeRoomSummary: TeamChatRoomSummary | null = useMemo(() => {
    if (rooms.length === 0) return null;
    if (paramRoomId) {
      return rooms.find((r) => r.id === paramRoomId) ?? rooms[0] ?? null;
    }
    return rooms[0] ?? null;
  }, [paramRoomId, rooms]);

  const activeRoomId = activeRoomSummary?.id ?? null;

  useEffect(() => {
    if (!paramRoomId && activeRoomId) {
      navigate(`/team-chat/${activeRoomId}`, { replace: true });
    }
  }, [activeRoomId, navigate, paramRoomId]);

  const roomDetailQuery = useQuery({
    queryKey:
      selectedCompanyId && activeRoomId
        ? queryKeys.teamChat.room(selectedCompanyId, activeRoomId)
        : ["team-chat", "room", "none"],
    queryFn: () => teamChatApi.getRoom(selectedCompanyId!, activeRoomId!),
    enabled: Boolean(selectedCompanyId && activeRoomId),
  });

  const activeRoom = roomDetailQuery.data?.room ?? activeRoomSummary;
  const messages = roomDetailQuery.data?.messages ?? [];

  useEffect(() => {
    if (activeRoom) {
      const roomTitle = activeRoom.kind === "channel" ? `#${activeRoom.slug}` : activeRoom.name;
      setBreadcrumbs([
        { label: copy("teamChat.title"), href: "/team-chat" },
        { label: roomTitle },
      ]);
    } else {
      setBreadcrumbs([{ label: copy("teamChat.title") }]);
    }
  }, [activeRoom, copy, setBreadcrumbs]);

  useCompanyLiveEvent((event) => {
    if (!selectedCompanyId || event.type !== "activity.logged") return;
    const action = typeof event.payload?.action === "string" ? event.payload.action : "";
    if (!action.startsWith("team_chat.")) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.rooms(selectedCompanyId) });
    if (activeRoomId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teamChat.room(selectedCompanyId, activeRoomId),
      });
    }
  });

  const channels = useMemo(() => rooms.filter((r) => r.kind === "channel"), [rooms]);
  const dms = useMemo(() => rooms.filter((r) => r.kind === "dm"), [rooms]);

  const createRoomMutation = useMutation({
    mutationFn: (payload: Parameters<typeof teamChatApi.createRoom>[1]) =>
      teamChatApi.createRoom(selectedCompanyId!, payload),
    onSuccess: (room) => {
      setErrorBanner(null);
      setCreateOpen(false);
      if (selectedCompanyId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.rooms(selectedCompanyId) });
      }
      navigate(`/team-chat/${room.id}`);
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : "Failed to create room");
    },
  });

  const updateRoomMutation = useMutation({
    mutationFn: (payload: Parameters<typeof teamChatApi.updateRoom>[2]) =>
      teamChatApi.updateRoom(selectedCompanyId!, activeRoomId!, payload),
    onSuccess: () => {
      setErrorBanner(null);
      setSettingsOpen(false);
      if (selectedCompanyId && activeRoomId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.rooms(selectedCompanyId) });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.teamChat.room(selectedCompanyId, activeRoomId),
        });
      }
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : "Failed to save room settings");
    },
  });

  const archiveRoomMutation = useMutation({
    mutationFn: () => teamChatApi.archiveRoom(selectedCompanyId!, activeRoomId!),
    onSuccess: () => {
      setSettingsOpen(false);
      setErrorBanner(null);
      if (selectedCompanyId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.rooms(selectedCompanyId) });
      }
      navigate("/team-chat");
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : "Failed to archive room");
    },
  });

  function openCreateDialog() {
    const defaultConn = connections.find((c) => c.isDefault) ?? connections[0];
    setCreateKind("channel");
    setCreateName("");
    setCreateTopic("");
    setCreatePersonaPrompt("");
    setCreateConnectionId(defaultConn?.id ?? "");
    setCreateModel(defaultConn?.defaultModel ?? "");
    setCreateMaxTurns(4);
    setCreateMaxOutputTokens(TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT);
    setCreateWorkEventMode("off");
    setCreateMemberIds(activeAgents.slice(0, Math.min(4, activeAgents.length)).map((a) => a.id));
    setCreateOpen(true);
  }

  function openSettingsDialog() {
    if (!activeRoom) return;
    setEditName(activeRoom.name);
    setEditTopic(activeRoom.topic ?? "");
    setEditPersonaPrompt(activeRoom.personaPrompt ?? "");
    setEditConnectionId(activeRoom.aiConnectionId ?? "");
    setEditModel(activeRoom.model ?? "");
    setEditMaxTurns(activeRoom.maxAutoTurns);
    setEditMaxOutputTokens(activeRoom.maxOutputTokens ?? TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT);
    setEditWorkEventMode(activeRoom.workEventMode ?? "off");
    setEditMemberIds(activeRoom.members.map((m) => m.agentId));
    setSettingsOpen(true);
  }

  function handleQuickDm(agent: Agent) {
    if (!selectedCompanyId) return;
    const defaultConn = connections.find((c) => c.isDefault) ?? connections[0];
    createRoomMutation.mutate({
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
  }

  function toggleMemberSelection(id: string, list: string[], setter: (next: string[]) => void) {
    if (list.includes(id)) {
      if (list.length <= 1) return;
      setter(list.filter((item) => item !== id));
      return;
    }
    setter([...list, id]);
  }

  if (!selectedCompanyId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {copy("teamChat.noCompany")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      {/* Room Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card min-h-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-semibold text-sm">
              <MessagesSquare className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{copy("teamChat.title")}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {selectedCompany?.name ?? ""}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={openCreateDialog}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {copy("teamChat.actions.newRoom")}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
          {/* Channels */}
          <div className="space-y-1">
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {copy("teamChat.sidebar.channels")}
            </div>
            {channels.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {copy("teamChat.sidebar.noRooms")}
              </div>
            ) : (
              channels.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => navigate(`/team-chat/${room.id}`)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                    room.id === activeRoomId
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/85 hover:bg-muted/70",
                  )}
                >
                  <Hash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate text-sm font-medium">{room.slug}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {room.members.length}
                      </span>
                    </div>
                    {room.lastMessage ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {room.lastMessage.authorName}: {room.lastMessage.body}
                      </p>
                    ) : room.topic ? (
                      <p className="truncate text-xs text-muted-foreground">{room.topic}</p>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Direct Messages */}
          {dms.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {copy("teamChat.sidebar.dms")}
              </div>
              {dms.map((room) => {
                const dmMember = room.members[0];
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => navigate(`/team-chat/${room.id}`)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
                      room.id === activeRoomId
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground/85 hover:bg-muted/70",
                    )}
                  >
                    {dmMember ? (
                      <AgentIcon icon={dmMember.icon} className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{room.name}</div>
                      {room.lastMessage && (
                        <p className="truncate text-xs text-muted-foreground">
                          {room.lastMessage.body}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick DM Roster */}
          {activeAgents.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {copy("teamChat.sidebar.quickDm")}
              </div>
              {activeAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => handleQuickDm(agent)}
                  disabled={createRoomMutation.isPending}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
                >
                  <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1 font-medium text-foreground/90">
                    {agent.name}
                  </span>
                  <span className="truncate text-xs opacity-75">
                    {agent.title ?? agent.role}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Chat Pane */}
      <main className="flex min-w-0 flex-1 flex-col min-h-0">
        {errorBanner && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-xs text-destructive flex items-center justify-between">
            <span>{errorBanner}</span>
            <button type="button" onClick={() => setErrorBanner(null)}>
              ×
            </button>
          </div>
        )}

        <TeamChatRoomView
          companyId={selectedCompanyId}
          room={activeRoom}
          messages={messages}
          activeAgents={activeAgents}
          onOpenSettings={activeRoom ? openSettingsDialog : undefined}
          emptyContent={
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <MessagesSquare className="h-10 w-10 text-muted-foreground" />
              <div className="space-y-1 max-w-md">
                <h2 className="text-base font-semibold">{copy("teamChat.title")}</h2>
                <p className="text-sm text-muted-foreground">{copy("teamChat.empty.createFirst")}</p>
              </div>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-1.5" />
                {copy("teamChat.actions.newRoom")}
              </Button>
            </div>
          }
        />
      </main>

      {/* Create Room Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy("teamChat.modal.create.title")}</DialogTitle>
            <DialogDescription>{copy("teamChat.modal.create.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1 max-h-96 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.kind")}</label>
                <select
                  value={createKind}
                  onChange={(e) => setCreateKind(e.target.value as TeamChatRoomKind)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="channel">{copy("teamChat.field.kindChannel")}</option>
                  <option value="dm">{copy("teamChat.field.kindDm")}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.maxAutoTurns")}</label>
                <select
                  value={createMaxTurns}
                  onChange={(e) => setCreateMaxTurns(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {MAX_AUTO_TURNS_CHOICES.map((val) => (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{copy("teamChat.field.name")}</label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="delivery-team"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{copy("teamChat.field.topic")}</label>
              <Input
                value={createTopic}
                onChange={(e) => setCreateTopic(e.target.value)}
                placeholder="Sprint standup, brainstorming & handoffs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{copy("teamChat.field.personaPrompt")}</label>
              <Textarea
                value={createPersonaPrompt}
                onChange={(e) => setCreatePersonaPrompt(e.target.value)}
                rows={2}
                placeholder="Keep conversation focused, friendly, and decisive..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.connection")}</label>
                <select
                  value={createConnectionId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setCreateConnectionId(nextId);
                    const conn = connections.find((c) => c.id === nextId);
                    if (conn) setCreateModel(conn.defaultModel);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{copy("teamChat.field.connectionAuto")}</option>
                  {connections.map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name} ({conn.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.model")}</label>
                <ModelCombobox
                  value={createModel}
                  onChange={setCreateModel}
                  models={modelsQuery.data ?? []}
                  loading={modelsQuery.isFetching}
                  placeholder={copy("teamChat.field.modelPlaceholder")}
                  searchPlaceholder={copy("teamChat.field.modelSearch")}
                  recommendedGroupLabel={copy("teamChat.field.modelRecommended")}
                  allGroupLabel={copy("teamChat.field.modelAll")}
                  emptyLabel={copy("teamChat.field.modelEmpty")}
                  useCustomLabel={copy("teamChat.field.modelCustom")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.maxOutputTokens")}</label>
                <Input
                  type="number"
                  min={TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN}
                  max={TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX}
                  step={128}
                  value={createMaxOutputTokens}
                  onChange={(e) => setCreateMaxOutputTokens(Number(e.target.value) || TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT)}
                />
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {MAX_OUTPUT_TOKEN_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCreateMaxOutputTokens(preset)}
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-xs",
                        createMaxOutputTokens === preset
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.workEventMode")}</label>
                <select
                  value={createWorkEventMode}
                  onChange={(e) => setCreateWorkEventMode(e.target.value as TeamChatWorkEventMode)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="off">{copy("teamChat.field.workEventOff")}</option>
                  <option value="assignments_and_status">
                    {copy("teamChat.field.workEventAssignments")}
                  </option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">{copy("teamChat.field.members")}</label>
              <div className="max-h-36 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                {activeAgents.map((agent) => (
                  <label
                    key={agent.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      checked={createMemberIds.includes(agent.id)}
                      onChange={() =>
                        toggleMemberSelection(agent.id, createMemberIds, setCreateMemberIds)
                      }
                    />
                    <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 text-primary" />
                    <span className="font-medium">{agent.name}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {agent.title ?? agent.role}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {copy("teamChat.actions.cancel")}
            </Button>
            <Button
              disabled={
                !createName.trim() || createMemberIds.length === 0 || createRoomMutation.isPending
              }
              onClick={() => {
                const chosenConn = connections.find((c) => c.id === createConnectionId);
                createRoomMutation.mutate({
                  kind: createKind,
                  name: createName.trim(),
                  topic: createTopic.trim() || null,
                  personaPrompt: createPersonaPrompt.trim() || null,
                  aiConnectionId: createConnectionId || null,
                  aiConnectionGrantId: chosenConn?.grantId ?? null,
                  model: createModel.trim() || null,
                  maxAutoTurns: createMaxTurns,
                  maxOutputTokens: Math.min(
                    Math.max(createMaxOutputTokens, TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN),
                    TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX,
                  ),
                  workEventMode: createWorkEventMode,
                  memberAgentIds: createMemberIds,
                });
              }}
            >
              {createRoomMutation.isPending
                ? copy("teamChat.actions.creating")
                : copy("teamChat.actions.createRoom")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Room Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy("teamChat.modal.settings.title")}</DialogTitle>
            <DialogDescription>{copy("teamChat.modal.settings.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1 max-h-96 overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.name")}</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.maxAutoTurns")}</label>
                <select
                  value={editMaxTurns}
                  onChange={(e) => setEditMaxTurns(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {MAX_AUTO_TURNS_CHOICES.map((val) => (
                    <option key={val} value={val}>
                      {val}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{copy("teamChat.field.topic")}</label>
              <Input value={editTopic} onChange={(e) => setEditTopic(e.target.value)} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{copy("teamChat.field.personaPrompt")}</label>
              <Textarea
                value={editPersonaPrompt}
                onChange={(e) => setEditPersonaPrompt(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.connection")}</label>
                <select
                  value={editConnectionId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setEditConnectionId(nextId);
                    const conn = connections.find((c) => c.id === nextId);
                    if (conn && !editModel.trim()) setEditModel(conn.defaultModel);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{copy("teamChat.field.connectionAuto")}</option>
                  {connections.map((conn) => (
                    <option key={conn.id} value={conn.id}>
                      {conn.name} ({conn.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.model")}</label>
                <ModelCombobox
                  value={editModel}
                  onChange={setEditModel}
                  models={modelsQuery.data ?? []}
                  loading={modelsQuery.isFetching}
                  placeholder={copy("teamChat.field.modelPlaceholder")}
                  searchPlaceholder={copy("teamChat.field.modelSearch")}
                  recommendedGroupLabel={copy("teamChat.field.modelRecommended")}
                  allGroupLabel={copy("teamChat.field.modelAll")}
                  emptyLabel={copy("teamChat.field.modelEmpty")}
                  useCustomLabel={copy("teamChat.field.modelCustom")}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.maxOutputTokens")}</label>
                <Input
                  type="number"
                  min={TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN}
                  max={TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX}
                  step={128}
                  value={editMaxOutputTokens}
                  onChange={(e) => setEditMaxOutputTokens(Number(e.target.value) || TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT)}
                />
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {MAX_OUTPUT_TOKEN_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEditMaxOutputTokens(preset)}
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-xs",
                        editMaxOutputTokens === preset
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{copy("teamChat.field.workEventMode")}</label>
                <select
                  value={editWorkEventMode}
                  onChange={(e) => setEditWorkEventMode(e.target.value as TeamChatWorkEventMode)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="off">{copy("teamChat.field.workEventOff")}</option>
                  <option value="assignments_and_status">
                    {copy("teamChat.field.workEventAssignments")}
                  </option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">{copy("teamChat.field.members")}</label>
              <div className="max-h-36 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                {activeAgents.map((agent) => (
                  <label
                    key={agent.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      checked={editMemberIds.includes(agent.id)}
                      onChange={() =>
                        toggleMemberSelection(agent.id, editMemberIds, setEditMemberIds)
                      }
                    />
                    <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 text-primary" />
                    <span className="font-medium">{agent.name}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {agent.title ?? agent.role}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={archiveRoomMutation.isPending}
                onClick={() => archiveRoomMutation.mutate()}
              >
                <Archive className="h-3.5 w-3.5 mr-1.5" />
                {copy("teamChat.actions.archiveRoom")}
              </Button>
            </div>
          </div>

          <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              {copy("teamChat.actions.cancel")}
            </Button>
            <Button
              disabled={
                !editName.trim() || editMemberIds.length === 0 || updateRoomMutation.isPending
              }
              onClick={() => {
                const chosenConn = connections.find((c) => c.id === editConnectionId);
                updateRoomMutation.mutate({
                  name: editName.trim(),
                  topic: editTopic.trim() || null,
                  personaPrompt: editPersonaPrompt.trim() || null,
                  aiConnectionId: editConnectionId || null,
                  aiConnectionGrantId: editConnectionId ? chosenConn?.grantId ?? null : null,
                  model: editModel.trim() || null,
                  maxAutoTurns: editMaxTurns,
                  maxOutputTokens: Math.min(
                    Math.max(editMaxOutputTokens, TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN),
                    TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX,
                  ),
                  workEventMode: editWorkEventMode,
                  memberAgentIds: editMemberIds,
                });
              }}
            >
              {updateRoomMutation.isPending
                ? copy("teamChat.actions.saving")
                : copy("teamChat.actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
