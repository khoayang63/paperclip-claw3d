import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { generateText } from "ai";
import {
  agents,
  companyMemberships,
  issues,
  teamChatRoomMembers,
  teamChatRoomMessages,
  teamChatRooms,
  type Db,
} from "@paperclipai/db";
import {
  aiConnectionMetadataSchema,
  isUuidLike,
  TEAM_CHAT_DISCUSS_ROUNDS_DEFAULT,
  TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT,
  TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX,
  TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN,
  TEAM_CHAT_ROOM_MAX_AUTO_TURNS_DEFAULT,
  type CreateTeamChatMessageInput,
  type CreateTeamChatRoomInput,
  type DiscussTeamChatRoomInput,
  type PromoteTeamChatMessageInput,
  type TeamChatConnectionChoice,
  type TeamChatDiscussResult,
  type TeamChatMessage,
  type TeamChatMessageMetadata,
  type TeamChatModelOption,
  type TeamChatPostMessageResult,
  type TeamChatPromoteResult,
  type TeamChatRoomDetail,
  type TeamChatRoomMember,
  type TeamChatRoomSummary,
  type TeamChatWorkEventMode,
  type UpdateTeamChatRoomInput,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { aiConnectionService } from "./ai-connections.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { assertAssignableAgent } from "./agent-assignability.js";
import { fastResponseCatalogModels } from "./fast-response-models.js";
import { fastResponseModel, fastResponseReceipt } from "./fast-response-provider.js";
import { heartbeatService } from "./heartbeat.js";
import { queueIssueAssignmentWakeup } from "./issue-assignment-wakeup.js";
import { issueService } from "./issues.js";
import { listOpenRouterModels } from "./openrouter-models.js";
import { logActivity } from "./activity-log.js";
import { logger } from "../middleware/logger.js";

export const DEFAULT_TEAM_CHAT_MODEL_BY_PROVIDER: Readonly<Record<string, string>> = {
  openrouter: "openrouter/free",
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-haiku-latest",
  google: "gemini-2.5-flash",
  xai: "grok-3-mini",
};

const TEAM_CHAT_SUPPORTED_PROVIDERS = new Set([
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "xai",
  "bedrock",
]);

const MAX_CONTEXT_MESSAGES = 24;
const MAX_SOUL_CHARS = 3500;
const MAX_AGENTS_GUIDE_CHARS = 1400;

export const EMPTY_TRUNCATED_FALLBACK_TEXT =
  "[Response cut off before visible text — try a non-reasoning model or increase Max Output Tokens in Room Settings]";

export interface TeamChatActorContext {
  actorType: "user" | "agent" | "system";
  actorId: string;
  userId: string | null;
  agentId?: string | null;
  runId?: string | null;
  agentApiKeyId?: string | null;
}

export interface TeamChatReplyResult {
  text: string;
  finishReason?: string;
  retried?: boolean;
  truncated?: boolean;
  usage?: TeamChatMessageMetadata["usage"] | null;
}

export type TeamChatReplyGenerator = (input: {
  companyId: string;
  room: TeamChatRoomSummary;
  agent: TeamChatRoomMember;
  provider: string;
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxOutputTokens?: number;
  resolveLanguageModel: () => Promise<ReturnType<typeof fastResponseModel>>;
}) => Promise<TeamChatReplyResult>;

export function slugifyRoomName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return normalized || "room";
}

export function normalizeTeamChatModel(
  provider: string,
  rawModel: string | null | undefined,
  fallbackModel?: string | null,
): string {
  const defaultModel =
    fallbackModel?.trim() || DEFAULT_TEAM_CHAT_MODEL_BY_PROVIDER[provider] || "openrouter/free";
  const trimmed = rawModel?.trim() ?? "";
  if (!trimmed) {
    return defaultModel;
  }
  if (provider === "openrouter") {
    // OpenCode prepends "openrouter/" to every OpenRouter model ID, producing
    // strings like "openrouter/openrouter/free" or "openrouter/google/gemini-2.5-flash".
    // @openrouter/ai-sdk-provider expects the native OpenRouter model ID instead.
    if (trimmed.startsWith("openrouter/")) {
      const rest = trimmed.slice("openrouter/".length);
      if (rest.includes("/")) return rest;
    }
    return trimmed;
  }
  if (trimmed.startsWith("paperclip/")) {
    return trimmed.slice("paperclip/".length) || defaultModel;
  }
  const prefix = `${provider}/`;
  if (trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length) || defaultModel;
  }
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPatternsForMember(member: TeamChatRoomMember): string[] {
  const aliases = new Set<string>();
  const addAlias = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && trimmed.length >= 2) aliases.add(trimmed);
  };
  addAlias(member.name);
  addAlias(member.roleLabel);
  const firstToken = member.name.trim().split(/[\s/]+/)[0];
  addAlias(firstToken);
  addAlias(member.role);
  return [...aliases];
}

export function extractMentionedRoomMembers(
  body: string,
  members: readonly TeamChatRoomMember[],
  explicitMentionIds?: readonly string[],
): TeamChatRoomMember[] {
  const byId = new Map(members.map((member) => [member.agentId, member]));
  const result: TeamChatRoomMember[] = [];
  const seen = new Set<string>();

  for (const agentId of explicitMentionIds ?? []) {
    const member = byId.get(agentId);
    if (member && !seen.has(member.agentId)) {
      seen.add(member.agentId);
      result.push(member);
    }
  }

  const matchedPositions: Array<{ index: number; member: TeamChatRoomMember }> = [];
  for (const member of members) {
    if (seen.has(member.agentId)) continue;
    const aliases = aliasPatternsForMember(member).sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const regex = new RegExp(`(^|[\\s([{"'])@${escapeRegExp(alias)}(?=$|[\\s.,!?:;)\\]}"'])`, "i");
      const match = regex.exec(body);
      if (match) {
        matchedPositions.push({ index: match.index, member });
        break;
      }
    }
  }

  matchedPositions.sort((a, b) => a.index - b.index);
  for (const item of matchedPositions) {
    if (!seen.has(item.member.agentId)) {
      seen.add(item.member.agentId);
      result.push(item.member);
    }
  }

  return result;
}

function preferredLeadSortScore(member: TeamChatRoomMember): number {
  const role = member.role.toLowerCase();
  const label = (member.roleLabel ?? "").toLowerCase();
  if (role === "pm" || label === "pm" || label.includes("product manager")) return 0;
  if (role === "ceo" || label === "ceo") return 1;
  return 2;
}

export function selectInitialRoomSpeakers(input: {
  body: string;
  members: readonly TeamChatRoomMember[];
  explicitMentionIds?: readonly string[];
  lastSpeakerAgentId?: string | null;
  maxTurns: number;
}): TeamChatRoomMember[] {
  const activeMembers = input.members.filter((m) => m.status !== "terminated");
  if (input.maxTurns <= 0 || activeMembers.length === 0) return [];

  const mentioned = extractMentionedRoomMembers(
    input.body,
    activeMembers,
    input.explicitMentionIds,
  );
  if (mentioned.length > 0) {
    return mentioned.slice(0, input.maxTurns);
  }

  // No explicit @mention: pick a natural lead (PM/CEO) or rotate after the previous speaker,
  // then let additional teammates chime in up to maxTurns.
  const ordered = [...activeMembers].sort((a, b) => {
    const scoreDiff = preferredLeadSortScore(a) - preferredLeadSortScore(b);
    if (scoreDiff !== 0) return scoreDiff;
    return a.sortOrder - b.sortOrder;
  });

  if (input.lastSpeakerAgentId && ordered.length > 1) {
    const lastIdx = ordered.findIndex((m) => m.agentId === input.lastSpeakerAgentId);
    if (lastIdx >= 0) {
      const rotated = [...ordered.slice(lastIdx + 1), ...ordered.slice(0, lastIdx + 1)];
      return rotated.slice(0, Math.min(input.maxTurns, rotated.length));
    }
  }

  return ordered.slice(0, Math.min(input.maxTurns, ordered.length));
}

function truncatePromptSection(text: string | null | undefined, maxChars: number): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n...(truncated)`;
}

export function buildTeamChatSystemPrompt(input: {
  room: TeamChatRoomSummary;
  agent: TeamChatRoomMember;
  members: readonly TeamChatRoomMember[];
  soulContent: string | null;
  agentsGuideContent: string | null;
}): string {
  const { room, agent, members } = input;
  const peers = members
    .filter((m) => m.agentId !== agent.agentId)
    .map((m) => `- @${m.name} (${m.roleLabel ?? m.title ?? m.role})`)
    .join("\n");

  const lines: string[] = [
    `You are ${agent.name}${agent.title ? ` (${agent.title})` : ""}, role: ${agent.roleLabel ?? agent.role}.`,
    `You are participating in Paperclip Team Chat room ${room.kind === "dm" ? `DM "${room.name}"` : `#${room.slug} (${room.name})`}.`,
  ];

  if (room.topic?.trim()) {
    lines.push(`Room topic: ${room.topic.trim()}`);
  }
  if (room.personaPrompt?.trim()) {
    lines.push(`Room tone / guidance:\n${room.personaPrompt.trim()}`);
  }

  const soul = truncatePromptSection(input.soulContent, MAX_SOUL_CHARS);
  if (soul) {
    lines.push(`Your SOUL.md persona (stay deeply authentic to this voice and personality):\n${soul}`);
  } else {
    lines.push(
      "You do not have a custom SOUL.md yet; speak naturally in a warm, pragmatic, collaborative teammate voice tailored to your role.",
    );
  }

  const guide = truncatePromptSection(input.agentsGuideContent, MAX_AGENTS_GUIDE_CHARS);
  if (guide) {
    lines.push(`Your working playbook / scope (AGENTS.md excerpt):\n${guide}`);
  }

  if (peers) {
    lines.push(`Other teammates in this room:\n${peers}`);
  }

  lines.push(
    [
      "Conversation rules:",
      "- Respond in character as ONLY yourself. Never write dialogue lines for other teammates or the Board Operator.",
      "- Do NOT prefix your reply with your own name (e.g. avoid starting with '[name]:' or 'name:').",
      "- Match the user's language naturally (reply in Vietnamese when the conversation is in Vietnamese).",
      "- Keep replies concise and human (usually 1-3 short paragraphs, crisp bullets only when concrete).",
      "- Tag another teammate with @Exact Name when you specifically want their perspective or handoff.",
      "- IMPORTANT: Team Chat is discussion-only mode with NO workspace/terminal/issue-creation tools. Never claim you ran commands, edited code, ran tests, or created a task. If work should become a tracked Paperclip task, say so and let the user click 'Create Task' on the message.",
    ].join("\n"),
  );

  return lines.join("\n\n");
}

export function buildTeamChatModelMessages(
  messages: readonly TeamChatMessage[],
  currentAgentId: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const recent = messages.slice(-MAX_CONTEXT_MESSAGES);
  const mapped: Array<{ role: "user" | "assistant"; content: string }> = recent.map((msg) => {
    if (msg.authorType === "agent" && msg.authorAgentId === currentAgentId) {
      return { role: "assistant", content: msg.body };
    }
    const label =
      msg.authorType === "user"
        ? "Board Operator"
        : msg.authorType === "system"
          ? "System"
          : msg.authorName;
    return {
      role: "user",
      content: `[${label}]: ${msg.body}`,
    };
  });

  if (mapped.length === 0 || mapped[mapped.length - 1]?.role === "assistant") {
    mapped.push({
      role: "user",
      content: "[Moderator]: Share your thoughts next in the conversation.",
    });
  }
  return mapped;
}

function stripLeadingSpeakerPrefix(text: string, agentName: string): string {
  const trimmed = text.trim();
  const escaped = escapeRegExp(agentName);
  const regex = new RegExp(`^(?:\\[${escaped}\\]|${escaped})\\s*:\\s*`, "i");
  return trimmed.replace(regex, "").trim();
}

function clampMaxOutputTokens(value: number | null | undefined): number {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT;
  return Math.min(Math.max(raw, TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN), TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX);
}

export async function generateTeamChatReplyWithRetry(input: {
  agentName: string;
  maxOutputTokens: number;
  system: string;
  callModel: (opts: { maxOutputTokens: number; system: string }) => Promise<{
    text: string;
    finishReason?: string;
    usage?: TeamChatMessageMetadata["usage"] | null;
  }>;
}): Promise<Required<Pick<TeamChatReplyResult, "text" | "finishReason" | "retried" | "truncated">> & {
  usage?: TeamChatMessageMetadata["usage"] | null;
}> {
  const initialTokens = clampMaxOutputTokens(input.maxOutputTokens);
  const first = await input.callModel({ maxOutputTokens: initialTokens, system: input.system });
  const cleanedFirst = stripLeadingSpeakerPrefix(first.text, input.agentName);
  const firstFinishReason = first.finishReason ?? "stop";
  const needsRetry = cleanedFirst.length === 0 || firstFinishReason === "length";

  if (!needsRetry) {
    return {
      text: cleanedFirst,
      finishReason: firstFinishReason,
      retried: false,
      truncated: false,
      usage: first.usage ?? null,
    };
  }

  const retryTokens = Math.min(
    Math.max(initialTokens * 2, TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT),
    TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX,
  );
  const retrySystem =
    cleanedFirst.length === 0
      ? `${input.system}\n\nRespond directly with visible conversational text immediately; do not spend tokens on lengthy hidden reasoning.`
      : input.system;

  const second = await input.callModel({ maxOutputTokens: retryTokens, system: retrySystem });
  const cleanedSecond = stripLeadingSpeakerPrefix(second.text, input.agentName);
  const bestText = cleanedSecond || cleanedFirst;
  const finalFinishReason = second.finishReason ?? firstFinishReason;
  const truncated = bestText.length === 0 || finalFinishReason === "length";

  return {
    text: bestText || EMPTY_TRUNCATED_FALLBACK_TEXT,
    finishReason: finalFinishReason,
    retried: true,
    truncated,
    usage: second.usage ?? first.usage ?? null,
  };
}

async function defaultGenerateReply(
  input: Parameters<TeamChatReplyGenerator>[0],
): Promise<TeamChatReplyResult> {
  const languageModel = await input.resolveLanguageModel();
  const initialMaxTokens = clampMaxOutputTokens(input.maxOutputTokens ?? input.room.maxOutputTokens);
  return generateTeamChatReplyWithRetry({
    agentName: input.agent.name,
    maxOutputTokens: initialMaxTokens,
    system: input.system,
    callModel: async ({ maxOutputTokens, system }) => {
      const result = await generateText({
        model: languageModel,
        system,
        messages: input.messages,
        maxOutputTokens,
      });
      const receipt = fastResponseReceipt(result);
      return {
        text: result.text,
        finishReason: result.finishReason,
        usage: {
          inputTokens: receipt.inputTokens,
          outputTokens: receipt.outputTokens,
          costStatus: receipt.costStatus,
        },
      };
    },
  });
}

export function teamChatService(
  db: Db,
  options: {
    generateReply?: TeamChatReplyGenerator;
  } = {},
) {
  const instructions = agentInstructionsService(db);
  const aiConnections = aiConnectionService(db);
  const issuesSvc = issueService(db);
  const heartbeatSvc = heartbeatService(db);
  const generateReply = options.generateReply ?? defaultGenerateReply;

  async function resolveMembershipUserId(companyId: string, preferredUserId: string | null): Promise<string | null> {
    if (preferredUserId) {
      const [member] = await db
        .select({ principalId: companyMemberships.principalId })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, preferredUserId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .limit(1);
      if (member) return member.principalId;
    }

    // Fallback for local_implicit mode when caller ID isn't directly in companyMemberships:
    const [anyActiveMember] = await db
      .select({ principalId: companyMemberships.principalId })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
        ),
      )
      .limit(1);
    return anyActiveMember?.principalId ?? preferredUserId;
  }

  async function hydrateRooms(
    companyId: string,
    roomRows: Array<typeof teamChatRooms.$inferSelect>,
  ): Promise<TeamChatRoomSummary[]> {
    if (roomRows.length === 0) return [];
    const roomIds = roomRows.map((r) => r.id);

    const [memberRows, recentMsgRows] = await Promise.all([
      db
        .select({
          member: teamChatRoomMembers,
          agent: agents,
        })
        .from(teamChatRoomMembers)
        .innerJoin(agents, eq(teamChatRoomMembers.agentId, agents.id))
        .where(
          and(
            eq(teamChatRoomMembers.companyId, companyId),
            inArray(teamChatRoomMembers.roomId, roomIds),
          ),
        )
        .orderBy(asc(teamChatRoomMembers.sortOrder), asc(teamChatRoomMembers.createdAt)),
      db
        .select({
          message: teamChatRoomMessages,
          agent: agents,
        })
        .from(teamChatRoomMessages)
        .leftJoin(agents, eq(teamChatRoomMessages.authorAgentId, agents.id))
        .where(
          and(
            eq(teamChatRoomMessages.companyId, companyId),
            inArray(teamChatRoomMessages.roomId, roomIds),
          ),
        )
        .orderBy(desc(teamChatRoomMessages.createdAt)),
    ]);

    const soulPresenceMap = new Map<string, boolean>();
    const uniqueAgents = new Map<string, typeof agents.$inferSelect>();
    for (const row of memberRows) {
      uniqueAgents.set(row.agent.id, row.agent);
    }
    await Promise.all(
      [...uniqueAgents.values()].map(async (agentRow) => {
        try {
          await instructions.readFile(agentRow, "SOUL.md");
          soulPresenceMap.set(agentRow.id, true);
        } catch {
          soulPresenceMap.set(agentRow.id, false);
        }
      }),
    );

    const membersByRoom = new Map<string, TeamChatRoomMember[]>();
    for (const row of memberRows) {
      const list = membersByRoom.get(row.member.roomId) ?? [];
      list.push({
        id: row.member.id,
        agentId: row.agent.id,
        name: row.agent.name,
        role: row.agent.role,
        title: row.agent.title ?? null,
        icon: row.agent.icon ?? null,
        status: row.agent.status,
        roleLabel: row.member.roleLabel ?? null,
        sortOrder: row.member.sortOrder,
        hasSoul: soulPresenceMap.get(row.agent.id) ?? false,
      });
      membersByRoom.set(row.member.roomId, list);
    }

    const lastMessageByRoom = new Map<string, TeamChatRoomSummary["lastMessage"]>();
    const countByRoom = new Map<string, number>();
    for (const row of recentMsgRows) {
      const roomId = row.message.roomId;
      countByRoom.set(roomId, (countByRoom.get(roomId) ?? 0) + 1);
      if (!lastMessageByRoom.has(roomId)) {
        lastMessageByRoom.set(roomId, {
          id: row.message.id,
          authorType: row.message.authorType,
          authorName:
            row.message.authorType === "agent"
              ? (row.agent?.name ?? "Agent")
              : row.message.authorType === "system"
                ? "System"
                : "You",
          body: row.message.body,
          createdAt: row.message.createdAt.toISOString(),
        });
      }
    }

    return roomRows.map((room) => ({
      id: room.id,
      companyId: room.companyId,
      slug: room.slug,
      name: room.name,
      kind: room.kind,
      topic: room.topic ?? null,
      personaPrompt: room.personaPrompt ?? null,
      aiConnectionId: room.aiConnectionId ?? null,
      aiConnectionGrantId: room.aiConnectionGrantId ?? null,
      model: room.model ?? null,
      maxAutoTurns: room.maxAutoTurns,
      maxOutputTokens: room.maxOutputTokens ?? TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT,
      workEventMode: (room.workEventMode ?? "off") as TeamChatWorkEventMode,
      createdByUserId: room.createdByUserId ?? null,
      archivedAt: room.archivedAt ? room.archivedAt.toISOString() : null,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      members: membersByRoom.get(room.id) ?? [],
      lastMessage: lastMessageByRoom.get(room.id) ?? null,
      messageCount: countByRoom.get(room.id) ?? 0,
    }));
  }

  async function hydrateMessages(
    companyId: string,
    msgRows: Array<typeof teamChatRoomMessages.$inferSelect>,
  ): Promise<TeamChatMessage[]> {
    if (msgRows.length === 0) return [];
    const agentIds = [
      ...new Set(
        msgRows.map((m) => m.authorAgentId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const issueIds = [
      ...new Set(
        msgRows.map((m) => m.linkedIssueId).filter((id): id is string => Boolean(id)),
      ),
    ];

    const [agentRows, issueRows] = await Promise.all([
      agentIds.length > 0
        ? db
            .select()
            .from(agents)
            .where(and(eq(agents.companyId, companyId), inArray(agents.id, agentIds)))
        : Promise.resolve([]),
      issueIds.length > 0
        ? db
            .select({
              id: issues.id,
              identifier: issues.identifier,
              title: issues.title,
              status: issues.status,
              assigneeAgentId: issues.assigneeAgentId,
            })
            .from(issues)
            .where(and(eq(issues.companyId, companyId), inArray(issues.id, issueIds)))
        : Promise.resolve([]),
    ]);

    const agentMap = new Map(agentRows.map((a) => [a.id, a]));
    const issueMap = new Map(issueRows.map((i) => [i.id, i]));

    return msgRows.map((m) => {
      const authorAgent = m.authorAgentId ? agentMap.get(m.authorAgentId) : undefined;
      const linked = m.linkedIssueId ? issueMap.get(m.linkedIssueId) : undefined;
      return {
        id: m.id,
        companyId: m.companyId,
        roomId: m.roomId,
        authorType: m.authorType,
        authorUserId: m.authorUserId ?? null,
        authorAgentId: m.authorAgentId ?? null,
        authorName:
          m.authorType === "agent"
            ? (authorAgent?.name ?? "Agent")
            : m.authorType === "system"
              ? "System"
              : "You",
        authorRole: authorAgent?.role ?? null,
        authorTitle: authorAgent?.title ?? null,
        authorIcon: authorAgent?.icon ?? null,
        body: m.body,
        replyToMessageId: m.replyToMessageId ?? null,
        linkedIssueId: m.linkedIssueId ?? null,
        linkedIssue: linked
          ? {
              id: linked.id,
              identifier: linked.identifier ?? null,
              title: linked.title,
              status: linked.status,
              assigneeAgentId: linked.assigneeAgentId ?? null,
            }
          : null,
        provider: m.provider ?? null,
        model: m.model ?? null,
        metadata: m.metadata ?? null,
        createdAt: m.createdAt.toISOString(),
      };
    });
  }

  async function assertValidRoomAgents(companyId: string, agentIds: readonly string[]) {
    const uniqueIds = [...new Set(agentIds)];
    if (uniqueIds.length === 0) {
      throw unprocessable("Select at least one agent for the room");
    }
    const found = await db
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, companyId), inArray(agents.id, uniqueIds)));
    if (found.length !== uniqueIds.length) {
      throw unprocessable("One or more selected agents do not belong to this company");
    }
    const terminated = found.find((a) => a.status === "terminated");
    if (terminated) {
      throw unprocessable(`Agent ${terminated.name} is terminated and cannot join a room`);
    }
    return uniqueIds;
  }

  async function requireRoomRow(companyId: string, roomId: string) {
    if (!isUuidLike(roomId)) {
      throw notFound("Team chat room not found");
    }
    const [room] = await db
      .select()
      .from(teamChatRooms)
      .where(and(eq(teamChatRooms.companyId, companyId), eq(teamChatRooms.id, roomId)))
      .limit(1);
    if (!room || room.archivedAt) {
      throw notFound("Team chat room not found");
    }
    return room;
  }

  async function listConnectionChoices(
    companyId: string,
    preferredUserId: string | null,
  ): Promise<TeamChatConnectionChoice[]> {
    const userId = await resolveMembershipUserId(companyId, preferredUserId);
    if (!userId) return [];
    const list = await aiConnections.list(companyId, userId);
    return list
      .filter(
        (conn) =>
          conn.ownership === "shared" &&
          conn.method === "api_key" &&
          conn.status === "connected" &&
          TEAM_CHAT_SUPPORTED_PROVIDERS.has(conn.provider),
      )
      .map((conn) => ({
        id: conn.id,
        grantId: conn.grantId ?? null,
        name: conn.name,
        provider: conn.provider,
        method: conn.method,
        ownership: conn.ownership,
        status: conn.status,
        isDefault: conn.isDefault,
        defaultModel:
          conn.routing?.models?.[0]?.id ??
          DEFAULT_TEAM_CHAT_MODEL_BY_PROVIDER[conn.provider] ??
          "openrouter/free",
      }));
  }

  async function listModelsForConnection(
    companyId: string,
    connectionId: string,
    preferredUserId: string | null,
  ): Promise<TeamChatModelOption[]> {
    const userId = await resolveMembershipUserId(companyId, preferredUserId);
    if (!userId) return [];
    const choices = await listConnectionChoices(companyId, userId);
    const chosen = choices.find((c) => c.id === connectionId);
    if (!chosen || !chosen.grantId) {
      throw notFound("Shared API-key AI connection not found");
    }
    const selected = await aiConnections.selectFastResponse({
      companyId,
      connectionId: chosen.id,
      grantId: chosen.grantId,
      userId,
      agentId: null,
    });
    const metadata = aiConnectionMetadataSchema.parse(selected.connection.config.ai);
    if (selected.provider === "openrouter") {
      try {
        const models = await listOpenRouterModels();
        return models.map((m) => ({
          id: m.id.replace(/^openrouter\//, ""),
          label: m.label,
        }));
      } catch (err) {
        logger.warn({ err, companyId }, "failed to fetch OpenRouter models for team chat");
        return [{ id: DEFAULT_TEAM_CHAT_MODEL_BY_PROVIDER.openrouter, label: "OpenRouter Free (auto)" }];
      }
    }
    return fastResponseCatalogModels(metadata).map((m) => ({
      id: m.id,
      label: m.label ?? m.id,
    }));
  }

  async function resolveRoomConnection(
    companyId: string,
    room: TeamChatRoomSummary,
    preferredUserId: string | null,
  ): Promise<
    | {
        ok: true;
        provider: string;
        model: string;
        resolveLanguageModel: () => Promise<ReturnType<typeof fastResponseModel>>;
      }
    | {
        ok: false;
        warning: string;
      }
  > {
    const userId = await resolveMembershipUserId(companyId, preferredUserId);
    if (!userId) {
      return {
        ok: false,
        warning: "No active company member user found to resolve AI credentials.",
      };
    }

    let connectionId = room.aiConnectionId;
    let grantId = room.aiConnectionGrantId;

    if (!connectionId || !grantId) {
      const choices = await listConnectionChoices(companyId, userId);
      const preferred =
        (connectionId ? choices.find((c) => c.id === connectionId) : undefined) ??
        choices.find((c) => c.isDefault) ??
        choices[0];
      if (!preferred || !preferred.grantId) {
        return {
          ok: false,
          warning:
            "No connected shared API-key AI connection found. Connect OpenRouter/OpenAI/Anthropic/Google/xAI in Connectors or select one in Room Settings to enable replies.",
        };
      }
      connectionId = preferred.id;
      grantId = preferred.grantId;
    }

    try {
      const selected = await aiConnections.selectFastResponse({
        companyId,
        connectionId,
        grantId,
        userId,
        agentId: null,
      });
      const metadata = aiConnectionMetadataSchema.parse(selected.connection.config.ai);
      const routingDefaultModel = metadata.routing?.models?.[0]?.id ?? null;
      const model = normalizeTeamChatModel(selected.provider, room.model, routingDefaultModel);
      return {
        ok: true,
        provider: selected.provider,
        model,
        resolveLanguageModel: async () => {
          const credential = await aiConnections.credential(selected, 0, {
            responsibleUserId: userId,
            actorType: "user",
            actorId: userId,
            issueId: null,
          });
          return fastResponseModel({ metadata, credential, model });
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load room AI connection";
      return {
        ok: false,
        warning: message,
      };
    }
  }

  async function listRooms(companyId: string): Promise<TeamChatRoomSummary[]> {
    const rows = await db
      .select()
      .from(teamChatRooms)
      .where(and(eq(teamChatRooms.companyId, companyId), isNull(teamChatRooms.archivedAt)))
      .orderBy(desc(teamChatRooms.updatedAt), asc(teamChatRooms.createdAt));
    return hydrateRooms(companyId, rows);
  }

  async function getRoom(companyId: string, roomId: string): Promise<TeamChatRoomDetail> {
    const roomRow = await requireRoomRow(companyId, roomId);
    const [summary] = await hydrateRooms(companyId, [roomRow]);
    if (!summary) throw notFound("Team chat room not found");
    const msgRows = await db
      .select()
      .from(teamChatRoomMessages)
      .where(and(eq(teamChatRoomMessages.companyId, companyId), eq(teamChatRoomMessages.roomId, roomId)))
      .orderBy(asc(teamChatRoomMessages.createdAt));
    const messages = await hydrateMessages(companyId, msgRows);
    return { room: summary, messages };
  }

  async function resolveAvailableSlug(
    companyId: string,
    requestedSlug: string | undefined,
    name: string,
  ): Promise<string> {
    if (requestedSlug) {
      const [existing] = await db
        .select({ id: teamChatRooms.id })
        .from(teamChatRooms)
        .where(and(eq(teamChatRooms.companyId, companyId), eq(teamChatRooms.slug, requestedSlug)))
        .limit(1);
      if (existing) {
        throw conflict(`Room slug "${requestedSlug}" is already in use`);
      }
      return requestedSlug;
    }
    const base = slugifyRoomName(name);
    let candidate = base;
    for (let i = 2; i < 50; i += 1) {
      const [existing] = await db
        .select({ id: teamChatRooms.id })
        .from(teamChatRooms)
        .where(and(eq(teamChatRooms.companyId, companyId), eq(teamChatRooms.slug, candidate)))
        .limit(1);
      if (!existing) return candidate;
      candidate = `${base.slice(0, 56)}-${i}`;
    }
    return `${base.slice(0, 48)}-${Date.now()}`;
  }

  async function createRoom(
    companyId: string,
    input: CreateTeamChatRoomInput,
    actor: TeamChatActorContext,
  ): Promise<TeamChatRoomSummary> {
    const memberIds = await assertValidRoomAgents(companyId, input.memberAgentIds);

    // If opening a 1:1 DM without an explicit slug and an active DM with the exact same
    // single agent already exists, reuse it rather than creating clutter.
    if (input.kind === "dm" && memberIds.length === 1 && !input.slug) {
      const existingRooms = await listRooms(companyId);
      const existingDm = existingRooms.find(
        (r) =>
          r.kind === "dm" &&
          r.members.length === 1 &&
          r.members[0]?.agentId === memberIds[0],
      );
      if (existingDm) return existingDm;
    }

    let grantId = input.aiConnectionGrantId ?? null;
    if (input.aiConnectionId && !grantId) {
      const choices = await listConnectionChoices(companyId, actor.userId);
      grantId = choices.find((c) => c.id === input.aiConnectionId)?.grantId ?? null;
    }

    const slug = await resolveAvailableSlug(
      companyId,
      input.slug,
      input.kind === "dm" ? `dm-${input.name}` : input.name,
    );

    const createdRoom = await db.transaction(async (tx) => {
      const [room] = await tx
        .insert(teamChatRooms)
        .values({
          companyId,
          slug,
          name: input.name.trim(),
          kind: input.kind,
          topic: input.topic?.trim() || null,
          personaPrompt: input.personaPrompt?.trim() || null,
          aiConnectionId: input.aiConnectionId ?? null,
          aiConnectionGrantId: grantId,
          model: input.model?.trim() || null,
          maxAutoTurns: input.maxAutoTurns ?? TEAM_CHAT_ROOM_MAX_AUTO_TURNS_DEFAULT,
          maxOutputTokens: clampMaxOutputTokens(input.maxOutputTokens),
          workEventMode: input.workEventMode ?? "off",
          createdByUserId: actor.userId,
        })
        .returning();

      await tx.insert(teamChatRoomMembers).values(
        memberIds.map((agentId, index) => ({
          companyId,
          roomId: room.id,
          agentId,
          sortOrder: index,
        })),
      );

      return room;
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      agentApiKeyId: actor.agentApiKeyId ?? null,
      action: "team_chat.room_created",
      entityType: "team_chat_room",
      entityId: createdRoom.id,
      details: {
        slug: createdRoom.slug,
        name: createdRoom.name,
        kind: createdRoom.kind,
        memberCount: memberIds.length,
      },
    });

    const [hydrated] = await hydrateRooms(companyId, [createdRoom]);
    return hydrated;
  }

  async function updateRoom(
    companyId: string,
    roomId: string,
    input: UpdateTeamChatRoomInput,
    actor: TeamChatActorContext,
  ): Promise<TeamChatRoomSummary> {
    await requireRoomRow(companyId, roomId);

    const memberIds =
      input.memberAgentIds !== undefined
        ? await assertValidRoomAgents(companyId, input.memberAgentIds)
        : null;

    let resolvedGrantId = input.aiConnectionGrantId;
    if (input.aiConnectionId !== undefined) {
      if (input.aiConnectionId === null) {
        resolvedGrantId = null;
      } else if (!resolvedGrantId) {
        const choices = await listConnectionChoices(companyId, actor.userId);
        resolvedGrantId = choices.find((c) => c.id === input.aiConnectionId)?.grantId ?? null;
      }
    }

    const updated = await db.transaction(async (tx) => {
      const patch: Partial<typeof teamChatRooms.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.topic !== undefined) patch.topic = input.topic?.trim() || null;
      if (input.personaPrompt !== undefined) patch.personaPrompt = input.personaPrompt?.trim() || null;
      if (input.aiConnectionId !== undefined) patch.aiConnectionId = input.aiConnectionId;
      if (resolvedGrantId !== undefined) patch.aiConnectionGrantId = resolvedGrantId;
      if (input.model !== undefined) patch.model = input.model?.trim() || null;
      if (input.maxAutoTurns !== undefined) patch.maxAutoTurns = input.maxAutoTurns;
      if (input.maxOutputTokens !== undefined) {
        patch.maxOutputTokens = clampMaxOutputTokens(input.maxOutputTokens);
      }
      if (input.workEventMode !== undefined) patch.workEventMode = input.workEventMode;

      const [room] = await tx
        .update(teamChatRooms)
        .set(patch)
        .where(and(eq(teamChatRooms.companyId, companyId), eq(teamChatRooms.id, roomId)))
        .returning();

      if (memberIds !== null) {
        await tx
          .delete(teamChatRoomMembers)
          .where(and(eq(teamChatRoomMembers.companyId, companyId), eq(teamChatRoomMembers.roomId, roomId)));
        await tx.insert(teamChatRoomMembers).values(
          memberIds.map((agentId, index) => ({
            companyId,
            roomId,
            agentId,
            sortOrder: index,
          })),
        );
      }

      return room;
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      agentApiKeyId: actor.agentApiKeyId ?? null,
      action: "team_chat.room_updated",
      entityType: "team_chat_room",
      entityId: roomId,
      details: {
        name: updated.name,
        model: updated.model,
        maxAutoTurns: updated.maxAutoTurns,
        maxOutputTokens: updated.maxOutputTokens,
        workEventMode: updated.workEventMode,
      },
    });

    const [hydrated] = await hydrateRooms(companyId, [updated]);
    return hydrated;
  }

  async function archiveRoom(
    companyId: string,
    roomId: string,
    actor: TeamChatActorContext,
  ): Promise<void> {
    await requireRoomRow(companyId, roomId);
    const now = new Date();
    await db
      .update(teamChatRooms)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(teamChatRooms.companyId, companyId), eq(teamChatRooms.id, roomId)));

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      agentApiKeyId: actor.agentApiKeyId ?? null,
      action: "team_chat.room_archived",
      entityType: "team_chat_room",
      entityId: roomId,
      details: {},
    });
  }

  async function loadAgentPromptDocs(
    companyId: string,
    members: readonly TeamChatRoomMember[],
  ): Promise<Map<string, { soul: string | null; agentsGuide: string | null }>> {
    const memberIds = members.map((m) => m.agentId);
    const agentRows =
      memberIds.length > 0
        ? await db
            .select()
            .from(agents)
            .where(and(eq(agents.companyId, companyId), inArray(agents.id, memberIds)))
        : [];
    const byId = new Map(agentRows.map((a) => [a.id, a]));
    const docs = new Map<string, { soul: string | null; agentsGuide: string | null }>();

    await Promise.all(
      memberIds.map(async (agentId) => {
        const agentRow = byId.get(agentId);
        if (!agentRow) {
          docs.set(agentId, { soul: null, agentsGuide: null });
          return;
        }
        let soul: string | null = null;
        let agentsGuide: string | null = null;
        try {
          soul = (await instructions.readFile(agentRow, "SOUL.md")).content;
        } catch {
          soul = null;
        }
        try {
          agentsGuide = (await instructions.readFile(agentRow, "AGENTS.md")).content;
        } catch {
          agentsGuide = agentRow.capabilities ?? null;
        }
        docs.set(agentId, { soul, agentsGuide });
      }),
    );

    return docs;
  }

  async function runAutoTurns(input: {
    companyId: string;
    room: TeamChatRoomSummary;
    initialMessages: TeamChatMessage[];
    candidateQueue: TeamChatRoomMember[];
    maxTurns: number;
    allowRoundRobinFallback: boolean;
    replyToMessageId: string | null;
    actor: TeamChatActorContext;
  }): Promise<{ agentMessages: TeamChatMessage[]; warnings: string[] }> {
    const warnings: string[] = [];
    const agentMessages: TeamChatMessage[] = [];
    if (input.maxTurns <= 0 || input.candidateQueue.length === 0) {
      return { agentMessages, warnings };
    }

    const resolvedConn = await resolveRoomConnection(
      input.companyId,
      input.room,
      input.actor.userId,
    );
    if (!resolvedConn.ok) {
      warnings.push(resolvedConn.warning);
      return { agentMessages, warnings };
    }

    const activeMembers = input.room.members.filter((m) => m.status !== "terminated");
    const promptDocs = await loadAgentPromptDocs(input.companyId, activeMembers);
    const history = [...input.initialMessages];
    const queue = [...input.candidateQueue];
    const spokeCount = new Map<string, number>();
    let lastSpeakerId: string | null = null;
    let roundRobinIdx = 0;

    for (let turn = 0; turn < input.maxTurns; turn += 1) {
      let speaker: TeamChatRoomMember | undefined;
      while (queue.length > 0) {
        const next = queue.shift()!;
        if (next.status === "terminated") continue;
        // Avoid repeating the exact same speaker consecutively when someone else is available.
        if (next.agentId === lastSpeakerId && queue.length > 0) {
          queue.push(next);
          continue;
        }
        speaker = next;
        break;
      }

      if (!speaker && input.allowRoundRobinFallback && activeMembers.length > 1) {
        for (let probe = 0; probe < activeMembers.length; probe += 1) {
          const candidate = activeMembers[(roundRobinIdx + probe) % activeMembers.length];
          if (candidate && candidate.agentId !== lastSpeakerId) {
            speaker = candidate;
            roundRobinIdx = (roundRobinIdx + probe + 1) % activeMembers.length;
            break;
          }
        }
      }

      if (!speaker) break;

      const docPair = promptDocs.get(speaker.agentId) ?? { soul: null, agentsGuide: null };
      const system = buildTeamChatSystemPrompt({
        room: input.room,
        agent: speaker,
        members: activeMembers,
        soulContent: docPair.soul,
        agentsGuideContent: docPair.agentsGuide,
      });
      const promptMessages = buildTeamChatModelMessages(history, speaker.agentId);

      try {
        const reply = await generateReply({
          companyId: input.companyId,
          room: input.room,
          agent: speaker,
          provider: resolvedConn.provider,
          model: resolvedConn.model,
          system,
          messages: promptMessages,
          maxOutputTokens: input.room.maxOutputTokens,
          resolveLanguageModel: resolvedConn.resolveLanguageModel,
        });

        const truncated = Boolean(reply.truncated);
        const now = new Date();
        const [inserted] = await db
          .insert(teamChatRoomMessages)
          .values({
            companyId: input.companyId,
            roomId: input.room.id,
            authorType: "agent",
            authorAgentId: speaker.agentId,
            body: reply.text,
            replyToMessageId: input.replyToMessageId,
            provider: resolvedConn.provider,
            model: resolvedConn.model,
            metadata: {
              turnIndex: turn,
              origin: "chat",
              ...(reply.finishReason ? { finishReason: reply.finishReason } : {}),
              ...(reply.retried ? { retried: true } : {}),
              ...(truncated ? { truncated: true } : {}),
              ...(reply.usage ? { usage: reply.usage } : {}),
            },
            createdAt: now,
          })
          .returning();

        if (truncated && reply.text === EMPTY_TRUNCATED_FALLBACK_TEXT) {
          warnings.push(
            `${speaker.name}: model hit token limit before producing visible text (consider switching model in Room Settings).`,
          );
        }

        await db
          .update(teamChatRooms)
          .set({ updatedAt: now })
          .where(and(eq(teamChatRooms.companyId, input.companyId), eq(teamChatRooms.id, input.room.id)));

        const [hydrated] = await hydrateMessages(input.companyId, [inserted]);
        if (hydrated) {
          history.push(hydrated);
          agentMessages.push(hydrated);
        }

        await logActivity(db, {
          companyId: input.companyId,
          actorType: "agent",
          actorId: speaker.agentId,
          agentId: speaker.agentId,
          action: "team_chat.message_posted",
          entityType: "team_chat_room",
          entityId: input.room.id,
          details: {
            roomId: input.room.id,
            roomSlug: input.room.slug,
            messageId: inserted.id,
            authorType: "agent",
            authorAgentId: speaker.agentId,
            authorName: speaker.name,
            bodyPreview: reply.text.replace(/\s+/g, " ").trim().slice(0, 140),
            linkedIssueId: inserted.linkedIssueId ?? null,
            truncated,
            provider: resolvedConn.provider,
            model: resolvedConn.model,
          },
        });

        spokeCount.set(speaker.agentId, (spokeCount.get(speaker.agentId) ?? 0) + 1);
        lastSpeakerId = speaker.agentId;

        // If this agent tagged a teammate, let that teammate respond within the remaining turn cap.
        const taggedByAgent = extractMentionedRoomMembers(reply.text, activeMembers).filter(
          (m) => m.agentId !== speaker?.agentId,
        );
        for (const tagged of taggedByAgent) {
          const count = spokeCount.get(tagged.agentId) ?? 0;
          const alreadyQueued = queue.some((q) => q.agentId === tagged.agentId);
          if (!alreadyQueued && count < 2) {
            queue.push(tagged);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent reply failed";
        logger.warn(
          { err, companyId: input.companyId, roomId: input.room.id, agentId: speaker.agentId },
          "team chat fast reply failed",
        );
        warnings.push(`${speaker.name}: ${message}`);
      }
    }

    return { agentMessages, warnings };
  }

  async function postMessage(
    companyId: string,
    roomId: string,
    input: CreateTeamChatMessageInput,
    actor: TeamChatActorContext,
  ): Promise<TeamChatPostMessageResult> {
    const detail = await getRoom(companyId, roomId);
    const now = new Date();
    const [insertedUser] = await db
      .insert(teamChatRoomMessages)
      .values({
        companyId,
        roomId,
        authorType: "user",
        authorUserId: actor.userId ?? actor.actorId,
        body: input.body.trim(),
        replyToMessageId: input.replyToMessageId ?? null,
        metadata: input.mentionAgentIds?.length ? { mentionAgentIds: input.mentionAgentIds } : null,
        createdAt: now,
      })
      .returning();

    await db
      .update(teamChatRooms)
      .set({ updatedAt: now })
      .where(and(eq(teamChatRooms.companyId, companyId), eq(teamChatRooms.id, roomId)));

    const [hydratedUser] = await hydrateMessages(companyId, [insertedUser]);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      agentApiKeyId: actor.agentApiKeyId ?? null,
      action: "team_chat.message_posted",
      entityType: "team_chat_room",
      entityId: roomId,
      details: {
        messageId: insertedUser.id,
        authorType: "user",
      },
    });

    const maxTurns = input.autoReplyTurns ?? detail.room.maxAutoTurns;
    const lastAgentMsg = [...detail.messages].reverse().find((m) => m.authorType === "agent");
    const candidateQueue = selectInitialRoomSpeakers({
      body: input.body,
      members: detail.room.members,
      explicitMentionIds: input.mentionAgentIds,
      lastSpeakerAgentId: lastAgentMsg?.authorAgentId ?? null,
      maxTurns,
    });

    const { agentMessages, warnings } = await runAutoTurns({
      companyId,
      room: detail.room,
      initialMessages: [...detail.messages, hydratedUser],
      candidateQueue,
      maxTurns,
      allowRoundRobinFallback: false,
      replyToMessageId: insertedUser.id,
      actor,
    });

    return {
      userMessage: hydratedUser,
      agentMessages,
      warnings,
    };
  }

  async function triggerDiscussion(
    companyId: string,
    roomId: string,
    input: DiscussTeamChatRoomInput,
    actor: TeamChatActorContext,
  ): Promise<TeamChatDiscussResult> {
    const detail = await getRoom(companyId, roomId);
    const activeMembers = detail.room.members.filter((m) => m.status !== "terminated");
    if (activeMembers.length === 0) {
      throw unprocessable("Add at least one active agent to discuss");
    }

    const rounds = input.rounds ?? TEAM_CHAT_DISCUSS_ROUNDS_DEFAULT;
    const history = [...detail.messages];
    const promptText = input.prompt?.trim();
    if (promptText) {
      const [insertedPrompt] = await db
        .insert(teamChatRoomMessages)
        .values({
          companyId,
          roomId,
          authorType: "user",
          authorUserId: actor.userId ?? actor.actorId,
          body: promptText,
          metadata: { discussionSeed: true },
        })
        .returning();
      const [hydratedPrompt] = await hydrateMessages(companyId, [insertedPrompt]);
      if (hydratedPrompt) history.push(hydratedPrompt);
    }

    const lastAgentMsg = [...history].reverse().find((m) => m.authorType === "agent");
    const candidateQueue = selectInitialRoomSpeakers({
      body: promptText ?? history[history.length - 1]?.body ?? "",
      members: activeMembers,
      lastSpeakerAgentId: lastAgentMsg?.authorAgentId ?? null,
      maxTurns: rounds,
    });

    return runAutoTurns({
      companyId,
      room: detail.room,
      initialMessages: history,
      candidateQueue,
      maxTurns: rounds,
      allowRoundRobinFallback: true,
      replyToMessageId: history[history.length - 1]?.id ?? null,
      actor,
    });
  }

  async function promoteMessageToIssue(
    companyId: string,
    roomId: string,
    messageId: string,
    input: PromoteTeamChatMessageInput,
    actor: TeamChatActorContext,
  ): Promise<TeamChatPromoteResult> {
    const detail = await getRoom(companyId, roomId);
    const [targetRow] = await db
      .select()
      .from(teamChatRoomMessages)
      .where(
        and(
          eq(teamChatRoomMessages.companyId, companyId),
          eq(teamChatRoomMessages.roomId, roomId),
          eq(teamChatRoomMessages.id, messageId),
        ),
      )
      .limit(1);
    if (!targetRow) {
      throw notFound("Team chat message not found");
    }
    if (targetRow.linkedIssueId) {
      throw conflict("This message is already linked to a task");
    }

    if (input.assigneeAgentId) {
      await assertAssignableAgent(db, companyId, input.assigneeAgentId, { kind: "work" });
    }

    const roomLabel = detail.room.kind === "dm" ? `DM: ${detail.room.name}` : `#${detail.room.slug}`;
    const defaultDescription = `Promoted from Team Chat (${roomLabel}):\n\n> ${targetRow.body.replace(/\n/g, "\n> ")}`;
    const issueDescription = input.description?.trim() || defaultDescription;

    const createdIssue = await issuesSvc.create(companyId, {
      title: input.title.trim(),
      description: issueDescription,
      projectId: input.projectId ?? null,
      status: input.assigneeAgentId ? "todo" : "backlog",
      priority: input.priority ?? "medium",
      assigneeAgentId: input.assigneeAgentId ?? null,
      createdByUserId: actor.userId,
      originKind: "user_task",
      actorResponsibleUserId: actor.userId,
      trustExplicitResponsibleUserId: actor.actorType === "user",
    });

    const now = new Date();
    const [updatedTargetRow] = await db
      .update(teamChatRoomMessages)
      .set({ linkedIssueId: createdIssue.id })
      .where(
        and(
          eq(teamChatRoomMessages.companyId, companyId),
          eq(teamChatRoomMessages.id, messageId),
        ),
      )
      .returning();

    const identifierText = createdIssue.identifier ?? createdIssue.id.slice(0, 8);
    const [systemRow] = await db
      .insert(teamChatRoomMessages)
      .values({
        companyId,
        roomId,
        authorType: "system",
        body: `Promoted message to task ${identifierText}: ${createdIssue.title}`,
        replyToMessageId: messageId,
        linkedIssueId: createdIssue.id,
        createdAt: now,
      })
      .returning();

    await db
      .update(teamChatRooms)
      .set({ updatedAt: now })
      .where(and(eq(teamChatRooms.companyId, companyId), eq(teamChatRooms.id, roomId)));

    let wokeAssignee = false;
    if (input.wakeAssignee && createdIssue.assigneeAgentId && createdIssue.status !== "backlog") {
      try {
        await queueIssueAssignmentWakeup({
          heartbeat: heartbeatSvc,
          issue: createdIssue,
          reason: "issue_assigned",
          mutation: "create",
          contextSource: "team_chat.promote",
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
        });
        wokeAssignee = true;
      } catch (err) {
        logger.warn(
          { err, companyId, issueId: createdIssue.id },
          "failed to wake assignee after promoting team chat message",
        );
      }
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      agentApiKeyId: actor.agentApiKeyId ?? null,
      action: "issue.created",
      entityType: "issue",
      entityId: createdIssue.id,
      details: {
        title: createdIssue.title,
        identifier: createdIssue.identifier,
        status: createdIssue.status,
        priority: createdIssue.priority,
        assigneeAgentId: createdIssue.assigneeAgentId,
        source: "team_chat.promote",
        roomId,
        messageId,
      },
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      agentApiKeyId: actor.agentApiKeyId ?? null,
      action: "team_chat.message_promoted",
      entityType: "team_chat_room",
      entityId: roomId,
      details: {
        messageId,
        issueId: createdIssue.id,
        issueIdentifier: createdIssue.identifier,
        wokeAssignee,
      },
    });

    const [hydratedTarget, hydratedSystem] = await hydrateMessages(companyId, [
      updatedTargetRow,
      systemRow,
    ]);

    return {
      issue: {
        id: createdIssue.id,
        identifier: createdIssue.identifier ?? null,
        title: createdIssue.title,
        status: createdIssue.status,
        priority: createdIssue.priority,
        assigneeAgentId: createdIssue.assigneeAgentId ?? null,
      },
      message: hydratedTarget,
      systemMessage: hydratedSystem,
      wokeAssignee,
    };
  }

  async function postWorkEventMessage(input: {
    companyId: string;
    room: TeamChatRoomSummary;
    speaker: TeamChatRoomMember;
    linkedIssueId: string;
    workEventAction: string;
    eventSummaryPrompt: string;
    fallbackBody: string;
    preferredUserId?: string | null;
  }): Promise<TeamChatMessage | null> {
    let body = input.fallbackBody;
    let provider: string | null = null;
    let model: string | null = null;
    let truncated = false;
    let usage: TeamChatMessageMetadata["usage"] | null = null;

    const resolvedConn = await resolveRoomConnection(
      input.companyId,
      input.room,
      input.preferredUserId ?? null,
    );
    if (resolvedConn.ok) {
      try {
        const docs = await loadAgentPromptDocs(input.companyId, [input.speaker]);
        const docPair = docs.get(input.speaker.agentId) ?? { soul: null, agentsGuide: null };
        const baseSystem = buildTeamChatSystemPrompt({
          room: input.room,
          agent: input.speaker,
          members: input.room.members,
          soulContent: docPair.soul,
          agentsGuideContent: docPair.agentsGuide,
        });
        const workSystem = [
          baseSystem,
          "You are posting a single automatic live status/handoff update into Team Chat.",
          "Write 1-2 short natural sentences in character (matching SOUL.md and the room language, e.g. Vietnamese for Vietnamese task titles).",
          "Mention the exact issue identifier (e.g. PTI-12). Do NOT invent code/test details not present in the event.",
          "Do NOT ask open-ended follow-up questions that expect replies unless tagging a handoff recipient.",
        ].join("\n\n");

        const reply = await generateReply({
          companyId: input.companyId,
          room: input.room,
          agent: input.speaker,
          provider: resolvedConn.provider,
          model: resolvedConn.model,
          system: workSystem,
          messages: [{ role: "user", content: input.eventSummaryPrompt }],
          maxOutputTokens: Math.min(clampMaxOutputTokens(input.room.maxOutputTokens), 512),
          resolveLanguageModel: resolvedConn.resolveLanguageModel,
        });

        provider = resolvedConn.provider;
        model = resolvedConn.model;
        truncated = Boolean(reply.truncated);
        usage = reply.usage ?? null;
        if (reply.text && reply.text !== EMPTY_TRUNCATED_FALLBACK_TEXT) {
          body = reply.text;
        }
      } catch (err) {
        logger.warn(
          { err, companyId: input.companyId, roomId: input.room.id, linkedIssueId: input.linkedIssueId },
          "team chat work-event LLM generation failed; using deterministic fallback",
        );
      }
    }

    const now = new Date();
    const [inserted] = await db
      .insert(teamChatRoomMessages)
      .values({
        companyId: input.companyId,
        roomId: input.room.id,
        authorType: "agent",
        authorAgentId: input.speaker.agentId,
        body,
        linkedIssueId: input.linkedIssueId,
        provider,
        model,
        metadata: {
          origin: "work_event",
          workEventAction: input.workEventAction,
          ...(truncated ? { truncated: true } : {}),
          ...(usage ? { usage } : {}),
        },
        createdAt: now,
      })
      .returning();

    await db
      .update(teamChatRooms)
      .set({ updatedAt: now })
      .where(and(eq(teamChatRooms.companyId, input.companyId), eq(teamChatRooms.id, input.room.id)));

    await logActivity(db, {
      companyId: input.companyId,
      actorType: "agent",
      actorId: input.speaker.agentId,
      agentId: input.speaker.agentId,
      action: "team_chat.message_posted",
      entityType: "team_chat_room",
      entityId: input.room.id,
      details: {
        roomId: input.room.id,
        roomSlug: input.room.slug,
        messageId: inserted.id,
        authorType: "agent",
        authorAgentId: input.speaker.agentId,
        authorName: input.speaker.name,
        bodyPreview: body.replace(/\s+/g, " ").trim().slice(0, 140),
        linkedIssueId: input.linkedIssueId,
        origin: "work_event",
        workEventAction: input.workEventAction,
        provider,
        model,
      },
    });

    const [hydrated] = await hydrateMessages(input.companyId, [inserted]);
    return hydrated ?? null;
  }

  return {
    listRooms,
    getRoom,
    createRoom,
    updateRoom,
    archiveRoom,
    postMessage,
    triggerDiscussion,
    promoteMessageToIssue,
    listConnectionChoices,
    listModelsForConnection,
    postWorkEventMessage,
  };
}
