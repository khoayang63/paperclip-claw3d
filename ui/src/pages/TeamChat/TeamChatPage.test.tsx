// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, TeamChatMessage, TeamChatRoomDetail, TeamChatRoomSummary } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildPromotedTaskDescription } from "./teamChatHelpers";
import { TeamChatPage } from "./TeamChatPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";
const pmAgentId = "44444444-4444-4444-8444-444444444444";

const sampleRoom: TeamChatRoomSummary = {
  id: roomId,
  companyId,
  slug: "delivery-team",
  name: "Delivery Team",
  kind: "channel",
  topic: "Daily standup",
  personaPrompt: "Keep updates crisp.",
  aiConnectionId: "conn-1",
  aiConnectionGrantId: "grant-1",
  model: "openrouter/free",
  maxAutoTurns: 4,
  maxOutputTokens: 1024,
  workEventMode: "off",
  createdByUserId: "local-board",
  archivedAt: null,
  createdAt: "2026-11-24T10:00:00.000Z",
  updatedAt: "2026-11-24T10:00:00.000Z",
  members: [
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
  ],
  lastMessage: null,
  messageCount: 1,
};

const sampleMessages: TeamChatMessage[] = [
  {
    id: "msg-1",
    companyId,
    roomId,
    authorType: "agent",
    authorUserId: null,
    authorAgentId: pmAgentId,
    authorName: "cuong",
    authorRole: "pm",
    authorTitle: "Project Manager",
    authorIcon: "brain",
    body: "Chào team, hôm nay mình rà soát tiến độ nhé!",
    replyToMessageId: null,
    linkedIssueId: null,
    linkedIssue: null,
    provider: "openrouter",
    model: "openrouter/free",
    metadata: {
      origin: "work_event",
      truncated: true,
    },
    createdAt: "2026-11-24T10:05:00.000Z",
  },
];

const apiMocks = vi.hoisted(() => ({
  listRooms: vi.fn(),
  getRoom: vi.fn(),
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  archiveRoom: vi.fn(),
  postMessage: vi.fn(),
  discuss: vi.fn(),
  promoteMessage: vi.fn(),
  listConnections: vi.fn(),
  listModels: vi.fn(),
  listAgents: vi.fn(),
  setBreadcrumbs: vi.fn(),
}));

vi.mock("@/api/team-chat", () => ({
  teamChatApi: {
    listRooms: apiMocks.listRooms,
    getRoom: apiMocks.getRoom,
    createRoom: apiMocks.createRoom,
    updateRoom: apiMocks.updateRoom,
    archiveRoom: apiMocks.archiveRoom,
    postMessage: apiMocks.postMessage,
    discuss: apiMocks.discuss,
    promoteMessage: apiMocks.promoteMessage,
    listConnections: apiMocks.listConnections,
    listModels: apiMocks.listModels,
  },
}));

vi.mock("@/api/agents", () => ({
  agentsApi: {
    list: apiMocks.listAgents,
  },
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: apiMocks.setBreadcrumbs,
  }),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: companyId,
    selectedCompany: { id: companyId, name: "ptit", issuePrefix: "PTI" },
  }),
}));

vi.mock("@/context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: () => {},
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string } & Record<string, unknown>) => {
      let text = opts?.defaultValue ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          if (k !== "defaultValue") {
            text = text.replace(`{{${k}}}`, String(v));
          }
        }
      }
      return text;
    },
  }),
}));

async function flushUi(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("TeamChatPage", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    apiMocks.listRooms.mockResolvedValue([sampleRoom]);
    apiMocks.getRoom.mockResolvedValue({
      room: sampleRoom,
      messages: sampleMessages,
    } satisfies TeamChatRoomDetail);
    apiMocks.listConnections.mockResolvedValue([
      {
        id: "conn-1",
        grantId: "grant-1",
        name: "OpenRouter",
        provider: "openrouter",
        method: "api_key",
        ownership: "shared",
        status: "connected",
        isDefault: true,
        defaultModel: "openrouter/free",
      },
    ]);
    apiMocks.listModels.mockResolvedValue([
      { id: "openrouter/free", label: "OpenRouter Free" },
      { id: "google/gemma-4-26b-a4b-it:free", label: "Google: Gemma 4 26B A4B (free)" },
    ]);
    apiMocks.listAgents.mockResolvedValue([
      {
        id: pmAgentId,
        companyId,
        name: "cuong",
        role: "pm",
        title: "Project Manager",
        icon: "brain",
        status: "idle",
      } as unknown as Agent,
    ]);
    apiMocks.postMessage.mockResolvedValue({
      userMessage: {
        ...sampleMessages[0],
        id: "msg-2",
        authorType: "user",
        authorAgentId: null,
        authorName: "You",
        body: "Hello @cuong",
      },
      agentMessages: [],
      warnings: [],
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
  });

  async function renderPage(initialEntry = `/team-chat/${roomId}`) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MemoryRouter initialEntries={[initialEntry]}>
              <Routes>
                <Route path="/team-chat" element={<TeamChatPage />} />
                <Route path="/team-chat/:roomId" element={<TeamChatPage />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await flushUi();
  }

  it("renders rooms, breadcrumbs, badges, SOUL pills, messages, and sends a new message", async () => {
    await renderPage();

    expect(container.textContent).toContain("delivery-team");
    expect(container.textContent).toContain("SOUL");
    expect(container.textContent).toContain("Truncated");
    expect(container.textContent).toContain("Work Update");
    expect(container.textContent).toContain("Chào team, hôm nay mình rà soát tiến độ nhé!");
    expect(apiMocks.setBreadcrumbs).toHaveBeenCalledWith([
      { label: "Team Chat", href: "/team-chat" },
      { label: "#delivery-team" },
    ]);

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Hello @cuong");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushUi();

    const sendButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Send"),
    );
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton!.click();
    });
    await flushUi();

    expect(apiMocks.postMessage).toHaveBeenCalledWith(companyId, roomId, {
      body: "Hello @cuong",
      autoReplyTurns: 4,
    });
  });

  it("opens Room Settings with searchable ModelCombobox and Promote modal with context checkbox", async () => {
    await renderPage();

    const settingsBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Room Settings"),
    );
    expect(settingsBtn).toBeTruthy();
    await act(async () => {
      settingsBtn!.click();
    });
    await flushUi();
    expect(document.body.textContent).toContain("Max Output Tokens (128-4096)");
    expect(document.body.textContent).toContain("Auto Work Updates");

    const comboboxTrigger = document.body.querySelector('button[role="combobox"]') as HTMLButtonElement | null;
    expect(comboboxTrigger).toBeTruthy();
    await act(async () => {
      comboboxTrigger!.click();
    });
    await flushUi();
    expect(document.body.textContent).toContain("google/gemma-4-26b-a4b-it:free");

    const cancelBtn = Array.from(document.body.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Cancel",
    );
    expect(cancelBtn).toBeTruthy();
    await act(async () => {
      cancelBtn!.click();
    });
    await flushUi();

    const createTaskBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Create Task"),
    );
    expect(createTaskBtn).toBeTruthy();
    await act(async () => {
      createTaskBtn!.click();
    });
    await flushUi();
    expect(document.body.textContent).toContain("Promote Message to Task");
    expect(document.body.textContent).toContain("Include recent chat context (last 8 messages)");
  });

  it("builds promoted task description with up to 8 prior messages when context is enabled", () => {
    const history: TeamChatMessage[] = Array.from({ length: 10 }, (_, idx) => ({
      ...sampleMessages[0],
      id: `m-${idx + 1}`,
      authorType: idx % 2 === 0 ? "user" : "agent",
      authorName: idx % 2 === 0 ? "You" : "cuong",
      body: `Tin nhan thu ${idx + 1}`,
      metadata: null,
    }));
    const target = history[9]!;

    const withContext = buildPromotedTaskDescription(history, target, {
      roomLabel: "#delivery-team",
      includeContext: true,
    });
    expect(withContext).toContain("Recent Discussion Context (last 8 messages)");
    expect(withContext).not.toContain("Tin nhan thu 1\n");
    expect(withContext).toContain("Tin nhan thu 2");
    expect(withContext).toContain("Tin nhan thu 9");

    const withoutContext = buildPromotedTaskDescription(history, target, {
      roomLabel: "#delivery-team",
      includeContext: false,
    });
    expect(withoutContext).not.toContain("Recent Discussion Context");
    expect(withoutContext).toContain("Tin nhan thu 10");
  });
});
