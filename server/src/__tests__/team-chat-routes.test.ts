import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamChatMessage, TeamChatRoomMember, TeamChatRoomSummary } from "@paperclipai/shared";
import { errorHandler } from "../middleware/index.js";
import { teamChatRoutes } from "../routes/team-chat.js";
import {
  buildTeamChatModelMessages,
  buildTeamChatSystemPrompt,
  EMPTY_TRUNCATED_FALLBACK_TEXT,
  extractMentionedRoomMembers,
  generateTeamChatReplyWithRetry,
  normalizeTeamChatModel,
  selectInitialRoomSpeakers,
  slugifyRoomName,
} from "../services/team-chat.js";

const serviceMocks = vi.hoisted(() => ({
  listConnectionChoices: vi.fn(),
  listModelsForConnection: vi.fn(),
  listRooms: vi.fn(),
  getRoom: vi.fn(),
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  archiveRoom: vi.fn(),
  postMessage: vi.fn(),
  triggerDiscussion: vi.fn(),
  promoteMessageToIssue: vi.fn(),
}));

vi.mock("../services/team-chat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/team-chat.js")>();
  return {
    ...actual,
    teamChatService: () => serviceMocks,
  };
});

const companyId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";
const msgId = "33333333-3333-4333-8333-333333333333";
const pmAgentId = "44444444-4444-4444-8444-444444444444";
const devAgentId = "55555555-5555-4555-8555-555555555555";
const designerAgentId = "66666666-6666-4666-8666-666666666666";

const sampleMembers: TeamChatRoomMember[] = [
  {
    id: "m1",
    agentId: pmAgentId,
    name: "cuong",
    role: "pm",
    title: "Project Manager",
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
  {
    id: "m3",
    agentId: designerAgentId,
    name: "UI/UX Designer",
    role: "designer",
    title: "Product Designer",
    icon: "palette",
    status: "idle",
    roleLabel: null,
    sortOrder: 2,
    hasSoul: false,
  },
];

const sampleRoom: TeamChatRoomSummary = {
  id: roomId,
  companyId,
  slug: "delivery-team",
  name: "Delivery Team",
  kind: "channel",
  topic: "Sprint coordination",
  personaPrompt: "Keep answers crisp and friendly.",
  aiConnectionId: null,
  aiConnectionGrantId: null,
  model: "openrouter/free",
  maxAutoTurns: 4,
  maxOutputTokens: 1024,
  workEventMode: "off",
  createdByUserId: "alice",
  archivedAt: null,
  createdAt: "2026-11-24T10:00:00.000Z",
  updatedAt: "2026-11-24T10:00:00.000Z",
  members: sampleMembers,
  lastMessage: null,
  messageCount: 0,
};

const boardAdmin: Express.Request["actor"] = {
  type: "board",
  source: "session",
  userId: "alice",
  isInstanceAdmin: false,
  companyIds: [companyId],
  memberships: [{ companyId, membershipRole: "owner", status: "active" }],
};

const viewer: Express.Request["actor"] = {
  type: "board",
  source: "session",
  userId: "bob",
  companyIds: [companyId],
  memberships: [{ companyId, membershipRole: "viewer", status: "active" }],
};

function makeApp(identity: Express.Request["actor"] = boardAdmin) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = identity;
    next();
  });
  app.use("/api", teamChatRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("team chat pure helpers", () => {
  it("slugifies Vietnamese and punctuation room names cleanly", () => {
    expect(slugifyRoomName("Nhóm Delivery & QA!")).toBe("nhom-delivery-qa");
    expect(slugifyRoomName("Đồng đội #1")).toBe("dong-doi-1");
    expect(slugifyRoomName("   ")).toBe("room");
  });

  it("normalizes OpenCode-prefixed OpenRouter and vendor model IDs", () => {
    expect(normalizeTeamChatModel("openrouter", "openrouter/openrouter/free")).toBe("openrouter/free");
    expect(normalizeTeamChatModel("openrouter", "openrouter/google/gemini-2.5-flash")).toBe(
      "google/gemini-2.5-flash",
    );
    expect(normalizeTeamChatModel("openrouter", "openrouter/free")).toBe("openrouter/free");
    expect(normalizeTeamChatModel("openai", "openai/gpt-4.1-mini")).toBe("gpt-4.1-mini");
    expect(normalizeTeamChatModel("openrouter", null)).toBe("openrouter/free");
  });

  it("extracts mentioned room members in order and preserves explicit mentions", () => {
    const hits = extractMentionedRoomMembers(
      "Nho @Full-Stack Developer xem API giup @cuong nhe!",
      sampleMembers,
    );
    expect(hits.map((m) => m.agentId)).toEqual([devAgentId, pmAgentId]);

    const merged = extractMentionedRoomMembers("hello @cuong", sampleMembers, [designerAgentId]);
    expect(merged.map((m) => m.agentId)).toEqual([designerAgentId, pmAgentId]);
  });

  it("picks explicitly mentioned speakers first or falls back to lead-first team ordering", () => {
    const mentionedOnly = selectInitialRoomSpeakers({
      body: "Hoi rieng @UI/UX Designer thoi",
      members: sampleMembers,
      maxTurns: 4,
    });
    expect(mentionedOnly.map((m) => m.agentId)).toEqual([designerAgentId]);

    const openFloor = selectInitialRoomSpeakers({
      body: "Hom nay team lam gi?",
      members: sampleMembers,
      maxTurns: 2,
    });
    expect(openFloor.map((m) => m.agentId)).toEqual([pmAgentId, devAgentId]);
  });

  it("builds discussion-only SOUL.md system prompt and maps agent conversation turns", () => {
    const system = buildTeamChatSystemPrompt({
      room: sampleRoom,
      agent: sampleMembers[0],
      members: sampleMembers,
      soulContent: "Be warm and structured.",
      agentsGuideContent: "Coordinate delivery clearly.",
    });
    expect(system).toContain("SOUL.md");
    expect(system).toContain("Be warm and structured.");
    expect(system).toContain("Keep answers crisp and friendly.");
    expect(system).toContain("NO workspace/terminal/issue-creation tools");

    const history: TeamChatMessage[] = [
      {
        id: "1",
        companyId,
        roomId,
        authorType: "user",
        authorUserId: "alice",
        authorAgentId: null,
        authorName: "You",
        authorRole: null,
        authorTitle: null,
        authorIcon: null,
        body: "Chao team",
        replyToMessageId: null,
        linkedIssueId: null,
        linkedIssue: null,
        provider: null,
        model: null,
        metadata: null,
        createdAt: "2026-11-24T10:00:00.000Z",
      },
      {
        id: "2",
        companyId,
        roomId,
        authorType: "agent",
        authorUserId: null,
        authorAgentId: pmAgentId,
        authorName: "cuong",
        authorRole: "pm",
        authorTitle: "Project Manager",
        authorIcon: "brain",
        body: "Chao ban!",
        replyToMessageId: "1",
        linkedIssueId: null,
        linkedIssue: null,
        provider: "openrouter",
        model: "openrouter/free",
        metadata: null,
        createdAt: "2026-11-24T10:01:00.000Z",
      },
    ];

    const pmMessages = buildTeamChatModelMessages(history, pmAgentId);
    expect(pmMessages[0]).toEqual({ role: "user", content: "[Board Operator]: Chao team" });
    expect(pmMessages[1]).toEqual({ role: "assistant", content: "Chao ban!" });
    expect(pmMessages[2]?.role).toBe("user");
  });
});

describe("team chat routes & authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.listRooms.mockResolvedValue([sampleRoom]);
    serviceMocks.getRoom.mockResolvedValue({ room: sampleRoom, messages: [] });
    serviceMocks.createRoom.mockResolvedValue(sampleRoom);
    serviceMocks.updateRoom.mockResolvedValue({ ...sampleRoom, name: "Updated Room" });
    serviceMocks.archiveRoom.mockResolvedValue(undefined);
    serviceMocks.postMessage.mockResolvedValue({
      userMessage: { id: msgId },
      agentMessages: [],
      warnings: [],
    });
    serviceMocks.triggerDiscussion.mockResolvedValue({ agentMessages: [], warnings: [] });
    serviceMocks.promoteMessageToIssue.mockResolvedValue({
      issue: { id: "iss-1", identifier: "PTI-99", title: "Do work", status: "todo", priority: "medium", assigneeAgentId: devAgentId },
      message: { id: msgId },
      systemMessage: { id: "sys-1" },
      wokeAssignee: true,
    });
  });

  it("supports room CRUD, messaging, discussion, and issue promotion for board admins", async () => {
    await request(makeApp(boardAdmin))
      .get(`/api/companies/${companyId}/team-chat/rooms`)
      .expect(200);

    await request(makeApp(boardAdmin))
      .post(`/api/companies/${companyId}/team-chat/rooms`)
      .send({ name: "Delivery Team", kind: "channel", memberAgentIds: [pmAgentId, devAgentId] })
      .expect(201);

    await request(makeApp(boardAdmin))
      .get(`/api/companies/${companyId}/team-chat/rooms/${roomId}`)
      .expect(200);

    await request(makeApp(boardAdmin))
      .patch(`/api/companies/${companyId}/team-chat/rooms/${roomId}`)
      .send({ name: "Updated Room", maxAutoTurns: 3 })
      .expect(200);

    await request(makeApp(boardAdmin))
      .post(`/api/companies/${companyId}/team-chat/rooms/${roomId}/messages`)
      .send({ body: "Hello @cuong", autoReplyTurns: 2 })
      .expect(201);

    await request(makeApp(boardAdmin))
      .post(`/api/companies/${companyId}/team-chat/rooms/${roomId}/discuss`)
      .send({ rounds: 2 })
      .expect(200);

    await request(makeApp(boardAdmin))
      .post(`/api/companies/${companyId}/team-chat/rooms/${roomId}/messages/${msgId}/promote`)
      .send({ title: "Ship team chat", assigneeAgentId: devAgentId, wakeAssignee: true })
      .expect(201);

    await request(makeApp(boardAdmin))
      .delete(`/api/companies/${companyId}/team-chat/rooms/${roomId}`)
      .expect(204);
  });

  it("validates payloads and rejects unauthorized actors", async () => {
    await request(makeApp(boardAdmin))
      .post(`/api/companies/${companyId}/team-chat/rooms`)
      .send({ name: "", memberAgentIds: [] })
      .expect(400);

    await request(makeApp(viewer))
      .get(`/api/companies/${companyId}/team-chat/rooms`)
      .expect(200);

    await request(makeApp(viewer))
      .post(`/api/companies/${companyId}/team-chat/rooms`)
      .send({ name: "Test", memberAgentIds: [pmAgentId] })
      .expect(403);

    const foreignBoard: Express.Request["actor"] = {
      type: "board",
      source: "session",
      userId: "eve",
      companyIds: ["99999999-9999-4999-8999-999999999999"],
      memberships: [],
    };
    await request(makeApp(foreignBoard))
      .get(`/api/companies/${companyId}/team-chat/rooms`)
      .expect(403);

    await request(makeApp(boardAdmin))
      .patch(`/api/companies/${companyId}/team-chat/rooms/${roomId}`)
      .send({ maxOutputTokens: 64 })
      .expect(400);

    await request(makeApp(boardAdmin))
      .patch(`/api/companies/${companyId}/team-chat/rooms/${roomId}`)
      .send({ maxOutputTokens: 8192 })
      .expect(400);

    await request(makeApp(boardAdmin))
      .patch(`/api/companies/${companyId}/team-chat/rooms/${roomId}`)
      .send({ maxOutputTokens: 2048, workEventMode: "assignments_and_status" })
      .expect(200);
  });
});

describe("generateTeamChatReplyWithRetry", () => {
  it("returns immediately without retrying when the first response is complete", async () => {
    const callModel = vi.fn().mockResolvedValueOnce({
      text: "cuong: Đã chốt tiến độ sprint.",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 25, costStatus: "reported" },
    });

    const res = await generateTeamChatReplyWithRetry({
      agentName: "cuong",
      maxOutputTokens: 1024,
      system: "System prompt",
      callModel,
    });

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      text: "Đã chốt tiến độ sprint.",
      finishReason: "stop",
      retried: false,
      truncated: false,
    });
  });

  it("retries once with doubled token ceiling when cut off or empty, and flags still-truncated replies", async () => {
    const callEmptyThenOk = vi
      .fn()
      .mockResolvedValueOnce({ text: "", finishReason: "length" })
      .mockResolvedValueOnce({ text: "Đã trả lời đầy đủ!", finishReason: "stop" });

    const recovered = await generateTeamChatReplyWithRetry({
      agentName: "QA & Test Engineer",
      maxOutputTokens: 512,
      system: "System prompt",
      callModel: callEmptyThenOk,
    });

    expect(callEmptyThenOk).toHaveBeenCalledTimes(2);
    expect(callEmptyThenOk).toHaveBeenNthCalledWith(1, { maxOutputTokens: 512, system: "System prompt" });
    expect(callEmptyThenOk.mock.calls[1]?.[0]?.maxOutputTokens).toBe(1024);
    expect(callEmptyThenOk.mock.calls[1]?.[0]?.system).toContain("visible conversational text immediately");
    expect(recovered).toMatchObject({
      text: "Đã trả lời đầy đủ!",
      retried: true,
      truncated: false,
    });

    const callAlwaysEmpty = vi
      .fn()
      .mockResolvedValue({ text: "   ", finishReason: "length" });

    const stillTruncated = await generateTeamChatReplyWithRetry({
      agentName: "QA & Test Engineer",
      maxOutputTokens: 1024,
      system: "System prompt",
      callModel: callAlwaysEmpty,
    });

    expect(callAlwaysEmpty).toHaveBeenCalledTimes(2);
    expect(stillTruncated).toMatchObject({
      text: EMPTY_TRUNCATED_FALLBACK_TEXT,
      retried: true,
      truncated: true,
    });
  });
});
