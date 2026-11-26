import { describe, expect, it, vi } from "vitest";
import { issues } from "@paperclipai/db";
import type { LiveEvent, TeamChatRoomSummary } from "@paperclipai/shared";
import {
  classifyIssueActivityForTeamChat,
  teamChatWorkEventService,
} from "../services/team-chat-work-events.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const pmAgentId = "44444444-4444-4444-8444-444444444444";
const devAgentId = "55555555-5555-4555-8555-555555555555";
const outsiderAgentId = "77777777-7777-4777-8777-777777777777";

function makeRoom(
  id: string,
  slug: string,
  workEventMode: TeamChatRoomSummary["workEventMode"],
): TeamChatRoomSummary {
  return {
    id,
    companyId,
    slug,
    name: slug,
    kind: "channel",
    topic: null,
    personaPrompt: null,
    aiConnectionId: null,
    aiConnectionGrantId: null,
    model: "google/gemma-4-26b-a4b-it:free",
    maxAutoTurns: 4,
    maxOutputTokens: 1024,
    workEventMode,
    createdByUserId: "local-board",
    archivedAt: null,
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
    members: [
      {
        id: "m1",
        agentId: pmAgentId,
        name: "cuong",
        role: "pm",
        title: "PM",
        icon: "brain",
        status: "idle",
        roleLabel: "PM",
        sortOrder: 0,
        hasSoul: true,
      },
      {
        id: "m2",
        agentId: devAgentId,
        name: "Full-Stack Developer",
        role: "engineer",
        title: "Full-Stack Engineer",
        icon: "code",
        status: "idle",
        roleLabel: null,
        sortOrder: 1,
        hasSoul: true,
      },
    ],
    lastMessage: null,
    messageCount: 0,
  };
}

function makeMockDb(input: {
  issueRow: {
    id: string;
    identifier: string;
    title: string;
    status: string;
    assigneeAgentId: string | null;
  } | null;
  assigneeName?: string | null;
}) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === issues) {
              return input.issueRow ? [input.issueRow] : [];
            }
            return input.assigneeName ? [{ name: input.assigneeName }] : [];
          },
        }),
      }),
    }),
  };
}

function makeActivityEvent(payload: Record<string, unknown>): LiveEvent {
  return {
    id: 1,
    companyId,
    type: "activity.logged",
    createdAt: "2026-11-25T00:00:00.000Z",
    payload,
  };
}

describe("classifyIssueActivityForTeamChat", () => {
  it("detects created assigned issues and skips team_chat.promote duplicates", () => {
    expect(
      classifyIssueActivityForTeamChat(
        makeActivityEvent({
          entityType: "issue",
          entityId: issueId,
          action: "issue.created",
          actorType: "agent",
          agentId: pmAgentId,
          details: { source: "team_chat.promote" },
        }),
      ),
    ).toBeNull();

    const created = classifyIssueActivityForTeamChat(
      makeActivityEvent({
        entityType: "issue",
        entityId: issueId,
        action: "issue.created",
        actorType: "agent",
        agentId: pmAgentId,
        details: { title: "Build chat UI", status: "todo" },
      }),
    );
    expect(created).toMatchObject({
      issueId,
      eventKind: "assigned",
      actorAgentId: pmAgentId,
    });
  });

  it("classifies status transitions to done/in_review/blocked and assignee handoffs", () => {
    const doneEvt = classifyIssueActivityForTeamChat(
      makeActivityEvent({
        entityType: "issue",
        entityId: issueId,
        action: "issue.updated",
        actorType: "agent",
        agentId: devAgentId,
        details: {
          changes: { status: "done" },
          _previous: { status: "in_progress" },
        },
      }),
    );
    expect(doneEvt?.eventKind).toBe("status_done");

    const handoffEvt = classifyIssueActivityForTeamChat(
      makeActivityEvent({
        entityType: "issue",
        entityId: issueId,
        action: "issue.updated",
        actorType: "agent",
        agentId: pmAgentId,
        details: {
          changes: { assigneeAgentId: devAgentId },
          _previous: { assigneeAgentId: pmAgentId },
        },
      }),
    );
    expect(handoffEvt?.eventKind).toBe("assigned");

    const objectDoneEvt = classifyIssueActivityForTeamChat(
      makeActivityEvent({
        entityType: "issue",
        entityId: issueId,
        action: "issue.updated",
        actorType: "user",
        details: {
          status: "done",
          changes: { status: { to: "done", from: "blocked" } },
          _previous: { status: "blocked" },
        },
      }),
    );
    expect(objectDoneEvt?.eventKind).toBe("status_done");

    const objectHandoffEvt = classifyIssueActivityForTeamChat(
      makeActivityEvent({
        entityType: "issue",
        entityId: issueId,
        action: "issue.updated",
        actorType: "agent",
        agentId: pmAgentId,
        details: {
          changes: { assigneeAgentId: { to: devAgentId, from: null } },
          _previous: { assigneeAgentId: null },
        },
      }),
    );
    expect(objectHandoffEvt?.eventKind).toBe("assigned");

    const noiseEvt = classifyIssueActivityForTeamChat(
      makeActivityEvent({
        entityType: "issue",
        entityId: issueId,
        action: "issue.updated",
        actorType: "user",
        details: {
          changes: { priority: "high" },
          _previous: { priority: "medium" },
        },
      }),
    );
    expect(noiseEvt).toBeNull();
  });
});

describe("teamChatWorkEventService", () => {
  it("posts handoff to enabled rooms only and skips workEventMode=off rooms", async () => {
    const deliveryRoom = makeRoom("room-delivery", "delivery-team", "assignments_and_status");
    const watercoolerRoom = makeRoom("room-water", "watercooler", "off");
    const postWorkEventMessage = vi.fn().mockResolvedValue({ id: "msg-1" });

    const svc = teamChatWorkEventService(
      makeMockDb({
        issueRow: {
          id: issueId,
          identifier: "PTI-15",
          title: "Xay dung web app nhan tin",
          status: "todo",
          assigneeAgentId: devAgentId,
        },
        assigneeName: "Full-Stack Developer",
      }) as never,
      {
        teamChat: {
          listRooms: vi.fn().mockResolvedValue([deliveryRoom, watercoolerRoom]),
          postWorkEventMessage,
        },
      },
    );

    const posted = await svc.handleLiveEvent(
      makeActivityEvent({
        entityType: "issue",
        entityId: issueId,
        action: "issue.created",
        actorType: "agent",
        agentId: pmAgentId,
        details: { status: "todo" },
      }),
    );

    expect(posted).toBe(1);
    expect(postWorkEventMessage).toHaveBeenCalledTimes(1);
    expect(postWorkEventMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        room: deliveryRoom,
        linkedIssueId: issueId,
        workEventAction: "issue.created:assigned",
        speaker: expect.objectContaining({ agentId: pmAgentId }),
      }),
    );
  });

  it("deduplicates repeated status events within TTL and ignores non-member issues", async () => {
    const deliveryRoom = makeRoom("room-delivery", "delivery-team", "assignments_and_status");
    const postWorkEventMessage = vi.fn().mockResolvedValue({ id: "msg-2" });

    const svc = teamChatWorkEventService(
      makeMockDb({
        issueRow: {
          id: issueId,
          identifier: "PTI-16",
          title: "Fix chat API",
          status: "done",
          assigneeAgentId: devAgentId,
        },
        assigneeName: "Full-Stack Developer",
      }) as never,
      {
        teamChat: {
          listRooms: vi.fn().mockResolvedValue([deliveryRoom]),
          postWorkEventMessage,
        },
        dedupTtlMs: 60_000,
      },
    );

    const event = makeActivityEvent({
      entityType: "issue",
      entityId: issueId,
      action: "issue.updated",
      actorType: "agent",
      agentId: devAgentId,
      details: {
        changes: { status: "done" },
        _previous: { status: "in_progress" },
      },
    });

    expect(await svc.handleLiveEvent(event)).toBe(1);
    expect(await svc.handleLiveEvent(event)).toBe(0);
    expect(postWorkEventMessage).toHaveBeenCalledTimes(1);

    const outsiderSvc = teamChatWorkEventService(
      makeMockDb({
        issueRow: {
          id: issueId,
          identifier: "PTI-17",
          title: "Security audit",
          status: "done",
          assigneeAgentId: outsiderAgentId,
        },
      }) as never,
      {
        teamChat: {
          listRooms: vi.fn().mockResolvedValue([deliveryRoom]),
          postWorkEventMessage,
        },
      },
    );
    expect(
      await outsiderSvc.handleLiveEvent(
        makeActivityEvent({
          entityType: "issue",
          entityId: issueId,
          action: "issue.updated",
          actorType: "agent",
          agentId: outsiderAgentId,
          details: {
            changes: { status: "done" },
            _previous: { status: "in_progress" },
          },
        }),
      ),
    ).toBe(0);
  });
});
