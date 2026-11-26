import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";

export const teamChatRooms = pgTable(
  "team_chat_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<"channel" | "dm">().notNull().default("channel"),
    topic: text("topic"),
    personaPrompt: text("persona_prompt"),
    aiConnectionId: uuid("ai_connection_id"),
    aiConnectionGrantId: uuid("ai_connection_grant_id"),
    model: text("model"),
    maxAutoTurns: integer("max_auto_turns").notNull().default(4),
    maxOutputTokens: integer("max_output_tokens").notNull().default(1024),
    workEventMode: text("work_event_mode")
      .$type<"off" | "assignments_and_status">()
      .notNull()
      .default("off"),
    createdByUserId: text("created_by_user_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySlugUq: unique("team_chat_rooms_company_slug_uq").on(table.companyId, table.slug),
    companyUpdatedIdx: index("team_chat_rooms_company_updated_idx").on(
      table.companyId,
      table.archivedAt,
      table.updatedAt,
    ),
  }),
);

export const teamChatRoomMembers = pgTable(
  "team_chat_room_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => teamChatRooms.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    roleLabel: text("role_label"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomAgentUq: unique("team_chat_room_members_room_agent_uq").on(table.roomId, table.agentId),
    companyRoomIdx: index("team_chat_room_members_company_room_idx").on(
      table.companyId,
      table.roomId,
    ),
  }),
);

export const teamChatRoomMessages = pgTable(
  "team_chat_room_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => teamChatRooms.id, { onDelete: "cascade" }),
    authorType: text("author_type").$type<"user" | "agent" | "system">().notNull(),
    authorUserId: text("author_user_id"),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    replyToMessageId: uuid("reply_to_message_id"),
    linkedIssueId: uuid("linked_issue_id").references(() => issues.id, { onDelete: "set null" }),
    provider: text("provider"),
    model: text("model"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedAtIdx: index("team_chat_room_messages_room_created_at_idx").on(
      table.roomId,
      table.createdAt,
    ),
    companyRoomCreatedAtIdx: index("team_chat_room_messages_company_room_created_at_idx").on(
      table.companyId,
      table.roomId,
      table.createdAt,
    ),
  }),
);
