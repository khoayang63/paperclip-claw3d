import { and, eq } from "drizzle-orm";
import { agents, issues, type Db } from "@paperclipai/db";
import type { LiveEvent, TeamChatRoomMember, TeamChatRoomSummary } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { teamChatService } from "./team-chat.js";

const DEFAULT_DEDUP_TTL_MS = 60_000;
const TRACKED_STATUSES = new Set(["done", "in_review", "blocked"]);

type TeamChatSvcSubset = Pick<
  ReturnType<typeof teamChatService>,
  "listRooms" | "postWorkEventMessage"
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractTransition(
  changes: Record<string, unknown>,
  previous: Record<string, unknown>,
  key: string,
): { next: string | null; prev: string | null } {
  const rawChange = changes[key];
  if (rawChange && typeof rawChange === "object" && !Array.isArray(rawChange)) {
    const pair = rawChange as Record<string, unknown>;
    return {
      next: asNonEmptyString(pair.to),
      prev: asNonEmptyString(pair.from) ?? asNonEmptyString(previous[key]),
    };
  }
  return {
    next: asNonEmptyString(rawChange),
    prev: asNonEmptyString(previous[key]),
  };
}

function buildWorkEventPrompts(input: {
  eventKind: "assigned" | "status_done" | "status_in_review" | "status_blocked";
  issueIdentifier: string;
  issueTitle: string;
  speaker: TeamChatRoomMember;
  assigneeName: string | null;
  actorIsAssigner: boolean;
}): { eventSummaryPrompt: string; fallbackBody: string } {
  const { eventKind, issueIdentifier, issueTitle, assigneeName, actorIsAssigner } = input;
  const tagAssignee = assigneeName ? `@${assigneeName}` : "";

  if (eventKind === "assigned") {
    if (actorIsAssigner && assigneeName) {
      return {
        eventSummaryPrompt: `Event: You just delegated/assigned Paperclip task ${issueIdentifier} ("${issueTitle}") to teammate @${assigneeName}. Announce this handoff briefly in 1-2 sentences and tag @${assigneeName}.`,
        fallbackBody: `${tagAssignee} mình vừa giao task ${issueIdentifier} (${issueTitle}) cho bạn phụ trách nhé!`,
      };
    }
    return {
      eventSummaryPrompt: `Event: You have been assigned Paperclip task ${issueIdentifier} ("${issueTitle}"). Post a brief 1-2 sentence acknowledgment in character.`,
      fallbackBody: `Mình đã nhận task ${issueIdentifier} (${issueTitle}) và bắt đầu xử lý nhé team.`,
    };
  }

  if (eventKind === "status_done") {
    return {
      eventSummaryPrompt: `Event: Paperclip task ${issueIdentifier} ("${issueTitle}") just transitioned to status DONE. Share a concise 1-2 sentence update with the room.`,
      fallbackBody: `Đã hoàn thành task ${issueIdentifier} (${issueTitle}) rồi nhé team.`,
    };
  }

  if (eventKind === "status_in_review") {
    return {
      eventSummaryPrompt: `Event: Paperclip task ${issueIdentifier} ("${issueTitle}") just moved to IN REVIEW. Share a crisp 1-2 sentence handoff/review request with the room.`,
      fallbackBody: `Task ${issueIdentifier} (${issueTitle}) đã chuyển sang trạng thái chờ review, nhờ team kiểm tra giúp nhé.`,
    };
  }

  return {
    eventSummaryPrompt: `Event: Paperclip task ${issueIdentifier} ("${issueTitle}") just moved to BLOCKED. Briefly flag the blocker status in 1-2 sentences so teammates know.`,
    fallbackBody: `Task ${issueIdentifier} (${issueTitle}) đang bị blocked, cần team hỗ trợ tháo gỡ sớm.`,
  };
}

export function classifyIssueActivityForTeamChat(event: LiveEvent): {
  companyId: string;
  issueId: string;
  action: "issue.created" | "issue.updated";
  actorType: string | null;
  actorAgentId: string | null;
  responsibleUserId: string | null;
  eventKind: "assigned" | "status_done" | "status_in_review" | "status_blocked";
  dedupKeySuffix: string;
} | null {
  if (event.type !== "activity.logged") return null;
  const payload = asRecord(event.payload);
  const entityType = asNonEmptyString(payload.entityType);
  const action = asNonEmptyString(payload.action);
  const issueId = asNonEmptyString(payload.entityId) ?? asNonEmptyString(payload.issueId);
  if (entityType !== "issue" || !issueId) return null;
  if (action !== "issue.created" && action !== "issue.updated") return null;

  const details = asRecord(payload.details);
  const actorType = asNonEmptyString(payload.actorType);
  const actorAgentId = asNonEmptyString(payload.agentId);
  const responsibleUserId = asNonEmptyString(payload.responsibleUserId);

  if (action === "issue.created") {
    if (asNonEmptyString(details.source) === "team_chat.promote") {
      return null;
    }
    const createdStatus = asNonEmptyString(details.status);
    if (createdStatus === "backlog") {
      // Backlog creation waits until moved to an active queue or assigned actively.
      // Still allow if an assigneeAgentId exists in DB unless explicitly unassigned.
    }
    return {
      companyId: event.companyId,
      issueId,
      action,
      actorType,
      actorAgentId,
      responsibleUserId,
      eventKind: "assigned",
      dedupKeySuffix: "created",
    };
  }

  const changes = asRecord(details.changes);
  const previous = asRecord(details._previous);
  const { next: nextStatus, prev: prevStatus } = extractTransition(changes, previous, "status");

  if (nextStatus && nextStatus !== prevStatus && TRACKED_STATUSES.has(nextStatus)) {
    const eventKind =
      nextStatus === "done"
        ? "status_done"
        : nextStatus === "in_review"
          ? "status_in_review"
          : "status_blocked";
    return {
      companyId: event.companyId,
      issueId,
      action,
      actorType,
      actorAgentId,
      responsibleUserId,
      eventKind,
      dedupKeySuffix: nextStatus,
    };
  }

  const { next: nextAssignee, prev: prevAssignee } = extractTransition(
    changes,
    previous,
    "assigneeAgentId",
  );
  if (nextAssignee && nextAssignee !== prevAssignee) {
    return {
      companyId: event.companyId,
      issueId,
      action,
      actorType,
      actorAgentId,
      responsibleUserId,
      eventKind: "assigned",
      dedupKeySuffix: `assignee:${nextAssignee}`,
    };
  }

  return null;
}

export function teamChatWorkEventService(
  db: Db,
  options: {
    teamChat?: TeamChatSvcSubset;
    dedupTtlMs?: number;
  } = {},
) {
  const teamChat = options.teamChat ?? teamChatService(db);
  const dedupTtlMs = options.dedupTtlMs ?? DEFAULT_DEDUP_TTL_MS;
  const recentPosts = new Map<string, number>();

  function pruneAndCheckDedup(key: string, nowMs: number): boolean {
    for (const [entryKey, expiresAt] of recentPosts.entries()) {
      if (expiresAt <= nowMs) recentPosts.delete(entryKey);
    }
    const existing = recentPosts.get(key);
    if (existing && existing > nowMs) return true;
    recentPosts.set(key, nowMs + dedupTtlMs);
    return false;
  }

  function pickSpeakerForRoom(input: {
    room: TeamChatRoomSummary;
    eventKind: "assigned" | "status_done" | "status_in_review" | "status_blocked";
    actorType: string | null;
    actorAgentId: string | null;
    assigneeAgentId: string | null;
  }): { speaker: TeamChatRoomMember; actorIsAssigner: boolean } | null {
    const actorMember =
      input.actorType === "agent" && input.actorAgentId
        ? input.room.members.find((m) => m.agentId === input.actorAgentId && m.status !== "terminated") ?? null
        : null;
    const assigneeMember =
      input.assigneeAgentId
        ? input.room.members.find((m) => m.agentId === input.assigneeAgentId && m.status !== "terminated") ?? null
        : null;

    if (!actorMember && !assigneeMember) return null;

    if (input.eventKind === "assigned") {
      if (actorMember && assigneeMember && actorMember.agentId !== assigneeMember.agentId) {
        return { speaker: actorMember, actorIsAssigner: true };
      }
      if (actorMember && input.assigneeAgentId && actorMember.agentId !== input.assigneeAgentId) {
        return { speaker: actorMember, actorIsAssigner: true };
      }
      const fallbackSpeaker = assigneeMember ?? actorMember;
      return fallbackSpeaker ? { speaker: fallbackSpeaker, actorIsAssigner: false } : null;
    }

    const statusSpeaker = actorMember ?? assigneeMember;
    return statusSpeaker ? { speaker: statusSpeaker, actorIsAssigner: false } : null;
  }

  async function handleLiveEvent(event: LiveEvent): Promise<number> {
    const classified = classifyIssueActivityForTeamChat(event);
    if (!classified) return 0;

    const rooms = (await teamChat.listRooms(classified.companyId)).filter(
      (room) => room.workEventMode === "assignments_and_status" && room.archivedAt === null,
    );
    if (rooms.length === 0) return 0;

    const [issueRow] = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
      })
      .from(issues)
      .where(and(eq(issues.companyId, classified.companyId), eq(issues.id, classified.issueId)))
      .limit(1);

    if (!issueRow) return 0;
    if (classified.eventKind === "assigned" && !issueRow.assigneeAgentId) {
      return 0;
    }

    let assigneeName: string | null = null;
    if (issueRow.assigneeAgentId) {
      const [assigneeAgent] = await db
        .select({ name: agents.name })
        .from(agents)
        .where(and(eq(agents.companyId, classified.companyId), eq(agents.id, issueRow.assigneeAgentId)))
        .limit(1);
      assigneeName = assigneeAgent?.name ?? null;
    }

    const issueIdentifier = issueRow.identifier ?? issueRow.id.slice(0, 8);
    const nowMs = Date.now();
    let postedCount = 0;

    for (const room of rooms) {
      const picked = pickSpeakerForRoom({
        room,
        eventKind: classified.eventKind,
        actorType: classified.actorType,
        actorAgentId: classified.actorAgentId,
        assigneeAgentId: issueRow.assigneeAgentId ?? null,
      });
      if (!picked) continue;

      const dedupKey = `${room.id}:${issueRow.id}:${classified.eventKind}:${
        classified.dedupKeySuffix === "created" && issueRow.assigneeAgentId
          ? `assignee:${issueRow.assigneeAgentId}`
          : classified.dedupKeySuffix
      }`;
      if (pruneAndCheckDedup(dedupKey, nowMs)) continue;

      const prompts = buildWorkEventPrompts({
        eventKind: classified.eventKind,
        issueIdentifier,
        issueTitle: issueRow.title,
        speaker: picked.speaker,
        assigneeName,
        actorIsAssigner: picked.actorIsAssigner,
      });

      try {
        const created = await teamChat.postWorkEventMessage({
          companyId: classified.companyId,
          room,
          speaker: picked.speaker,
          linkedIssueId: issueRow.id,
          workEventAction: `${classified.action}:${classified.eventKind}`,
          eventSummaryPrompt: prompts.eventSummaryPrompt,
          fallbackBody: prompts.fallbackBody,
          preferredUserId: classified.responsibleUserId,
        });
        if (created) postedCount += 1;
      } catch (err) {
        logger.warn(
          {
            err,
            companyId: classified.companyId,
            roomId: room.id,
            issueId: issueRow.id,
          },
          "failed to post team chat work-event message",
        );
      }
    }

    return postedCount;
  }

  return {
    handleLiveEvent,
  };
}
