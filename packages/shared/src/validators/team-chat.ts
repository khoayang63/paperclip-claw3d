import { z } from "zod";

export const TEAM_CHAT_ROOM_KINDS = ["channel", "dm"] as const;
export type TeamChatRoomKind = (typeof TEAM_CHAT_ROOM_KINDS)[number];

export const TEAM_CHAT_MESSAGE_AUTHOR_TYPES = ["user", "agent", "system"] as const;
export type TeamChatMessageAuthorType = (typeof TEAM_CHAT_MESSAGE_AUTHOR_TYPES)[number];

export const TEAM_CHAT_ROOM_MAX_AUTO_TURNS_MIN = 1;
export const TEAM_CHAT_ROOM_MAX_AUTO_TURNS_MAX = 8;
export const TEAM_CHAT_ROOM_MAX_AUTO_TURNS_DEFAULT = 4;

export const TEAM_CHAT_POST_AUTO_TURNS_MIN = 0;
export const TEAM_CHAT_POST_AUTO_TURNS_MAX = 8;

export const TEAM_CHAT_DISCUSS_ROUNDS_MIN = 1;
export const TEAM_CHAT_DISCUSS_ROUNDS_MAX = 8;
export const TEAM_CHAT_DISCUSS_ROUNDS_DEFAULT = 2;

export const TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN = 128;
export const TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX = 4096;
export const TEAM_CHAT_MAX_OUTPUT_TOKENS_DEFAULT = 1024;

export const TEAM_CHAT_WORK_EVENT_MODES = ["off", "assignments_and_status"] as const;
export type TeamChatWorkEventMode = (typeof TEAM_CHAT_WORK_EVENT_MODES)[number];

export interface TeamChatMessageMetadata extends Record<string, unknown> {
  turnIndex?: number;
  finishReason?: string;
  retried?: boolean;
  truncated?: boolean;
  origin?: "chat" | "work_event";
  workEventAction?: string;
  usage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    costStatus?: string;
  };
}

export const createTeamChatRoomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase letters, numbers, and hyphens")
    .optional(),
  kind: z.enum(TEAM_CHAT_ROOM_KINDS).default("channel"),
  topic: z.string().trim().max(400).nullable().optional(),
  personaPrompt: z.string().trim().max(4000).nullable().optional(),
  aiConnectionId: z.string().uuid().nullable().optional(),
  aiConnectionGrantId: z.string().uuid().nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  maxAutoTurns: z
    .number()
    .int()
    .min(TEAM_CHAT_ROOM_MAX_AUTO_TURNS_MIN)
    .max(TEAM_CHAT_ROOM_MAX_AUTO_TURNS_MAX)
    .optional(),
  maxOutputTokens: z
    .number()
    .int()
    .min(TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN)
    .max(TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX)
    .optional(),
  workEventMode: z.enum(TEAM_CHAT_WORK_EVENT_MODES).optional(),
  memberAgentIds: z.array(z.string().uuid()).min(1).max(20),
});
export type CreateTeamChatRoomInput = z.infer<typeof createTeamChatRoomSchema>;

export const updateTeamChatRoomSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  topic: z.string().trim().max(400).nullable().optional(),
  personaPrompt: z.string().trim().max(4000).nullable().optional(),
  aiConnectionId: z.string().uuid().nullable().optional(),
  aiConnectionGrantId: z.string().uuid().nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  maxAutoTurns: z
    .number()
    .int()
    .min(TEAM_CHAT_ROOM_MAX_AUTO_TURNS_MIN)
    .max(TEAM_CHAT_ROOM_MAX_AUTO_TURNS_MAX)
    .optional(),
  maxOutputTokens: z
    .number()
    .int()
    .min(TEAM_CHAT_MAX_OUTPUT_TOKENS_MIN)
    .max(TEAM_CHAT_MAX_OUTPUT_TOKENS_MAX)
    .optional(),
  workEventMode: z.enum(TEAM_CHAT_WORK_EVENT_MODES).optional(),
  memberAgentIds: z.array(z.string().uuid()).min(1).max(20).optional(),
});
export type UpdateTeamChatRoomInput = z.infer<typeof updateTeamChatRoomSchema>;

export const createTeamChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  replyToMessageId: z.string().uuid().nullable().optional(),
  mentionAgentIds: z.array(z.string().uuid()).max(20).optional(),
  autoReplyTurns: z
    .number()
    .int()
    .min(TEAM_CHAT_POST_AUTO_TURNS_MIN)
    .max(TEAM_CHAT_POST_AUTO_TURNS_MAX)
    .optional(),
});
export type CreateTeamChatMessageInput = z.infer<typeof createTeamChatMessageSchema>;

export const discussTeamChatRoomSchema = z.object({
  prompt: z.string().trim().max(2000).nullable().optional(),
  rounds: z
    .number()
    .int()
    .min(TEAM_CHAT_DISCUSS_ROUNDS_MIN)
    .max(TEAM_CHAT_DISCUSS_ROUNDS_MAX)
    .optional(),
});
export type DiscussTeamChatRoomInput = z.infer<typeof discussTeamChatRoomSchema>;

export const promoteTeamChatMessageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20000).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  wakeAssignee: z.boolean().optional().default(true),
});
export type PromoteTeamChatMessageInput = z.infer<typeof promoteTeamChatMessageSchema>;

export interface TeamChatRoomMember {
  id: string;
  agentId: string;
  name: string;
  role: string;
  title: string | null;
  icon: string | null;
  status: string;
  roleLabel: string | null;
  sortOrder: number;
  hasSoul: boolean;
}

export interface TeamChatLinkedIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeAgentId: string | null;
}

export interface TeamChatMessage {
  id: string;
  companyId: string;
  roomId: string;
  authorType: TeamChatMessageAuthorType;
  authorUserId: string | null;
  authorAgentId: string | null;
  authorName: string;
  authorRole: string | null;
  authorTitle: string | null;
  authorIcon: string | null;
  body: string;
  replyToMessageId: string | null;
  linkedIssueId: string | null;
  linkedIssue: TeamChatLinkedIssueSummary | null;
  provider: string | null;
  model: string | null;
  metadata: TeamChatMessageMetadata | null;
  createdAt: string;
}

export interface TeamChatRoomSummary {
  id: string;
  companyId: string;
  slug: string;
  name: string;
  kind: TeamChatRoomKind;
  topic: string | null;
  personaPrompt: string | null;
  aiConnectionId: string | null;
  aiConnectionGrantId: string | null;
  model: string | null;
  maxAutoTurns: number;
  maxOutputTokens: number;
  workEventMode: TeamChatWorkEventMode;
  createdByUserId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  members: TeamChatRoomMember[];
  lastMessage: {
    id: string;
    authorType: TeamChatMessageAuthorType;
    authorName: string;
    body: string;
    createdAt: string;
  } | null;
  messageCount: number;
}

export interface TeamChatRoomDetail {
  room: TeamChatRoomSummary;
  messages: TeamChatMessage[];
}

export interface TeamChatPostMessageResult {
  userMessage: TeamChatMessage;
  agentMessages: TeamChatMessage[];
  warnings: string[];
}

export interface TeamChatDiscussResult {
  agentMessages: TeamChatMessage[];
  warnings: string[];
}

export interface TeamChatPromoteResult {
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    status: string;
    priority: string;
    assigneeAgentId: string | null;
  };
  message: TeamChatMessage;
  systemMessage: TeamChatMessage;
  wokeAssignee: boolean;
}

export interface TeamChatConnectionChoice {
  id: string;
  grantId: string | null;
  name: string;
  provider: string;
  method: string;
  ownership: string;
  status: string;
  isDefault: boolean;
  defaultModel: string;
}

export interface TeamChatModelOption {
  id: string;
  label: string;
}
