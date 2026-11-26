// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "@/api/agents";
import { TooltipProvider } from "@/components/ui/tooltip";
import { saveOfficeHotbar } from "./model/storage";
import { OfficePlaybookDrawer } from "./components/OfficePlaybookDrawer";
import { Office3D } from "./Office3DPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({
  webglAvailable: true,
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  setBreadcrumbs: vi.fn(),
  pushToast: vi.fn(),
  teleportToCell: vi.fn(),
  showAgentSpeechBubble: vi.fn(),
  setKpiSnapshot: vi.fn(),
  liveHandlers: new Set<(event: Record<string, unknown>) => void>(),
  dispose: vi.fn(),
}));

vi.mock("@/api/team-chat", () => ({
  teamChatApi: {
    listRooms: vi.fn().mockResolvedValue([
      {
        id: "room-1",
        companyId: "company-1",
        slug: "delivery-team",
        name: "Delivery Team",
        kind: "channel",
        topic: "Standup",
        personaPrompt: null,
        aiConnectionId: null,
        aiConnectionGrantId: null,
        model: "google/gemma-4-26b-a4b-it:free",
        maxAutoTurns: 4,
        maxOutputTokens: 1024,
        workEventMode: "assignments_and_status",
        createdByUserId: "alice",
        archivedAt: null,
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
        members: [],
        lastMessage: null,
        messageCount: 0,
      },
    ]),
    getRoom: vi.fn().mockResolvedValue({
      room: {
        id: "room-1",
        companyId: "company-1",
        slug: "delivery-team",
        name: "Delivery Team",
        kind: "channel",
        topic: "Standup",
        personaPrompt: null,
        aiConnectionId: null,
        aiConnectionGrantId: null,
        model: "google/gemma-4-26b-a4b-it:free",
        maxAutoTurns: 4,
        maxOutputTokens: 1024,
        workEventMode: "assignments_and_status",
        createdByUserId: "alice",
        archivedAt: null,
        createdAt: "2026-11-25T00:00:00.000Z",
        updatedAt: "2026-11-25T00:00:00.000Z",
        members: [],
        lastMessage: null,
        messageCount: 0,
      },
      messages: [],
    }),
    listConnections: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockResolvedValue([]),
    postMessage: vi.fn(),
    discuss: vi.fn(),
    promoteMessage: vi.fn(),
  },
}));

vi.mock("@/api/office-layout", () => ({
  officeLayoutApi: {
    get: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/api/activity", () => ({
  activityApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/api/heartbeats", () => ({
  heartbeatsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/api/performance", () => ({
  performanceApi: {
    getCompanyPerformance: vi.fn().mockResolvedValue({
      companyId: "company-1",
      window: "30d",
      agents: [
        { agentId: "agent-low", name: "DevOps Engineer", performanceScore: 72, tasksDone: 5 },
        { agentId: "agent-top", name: "Full-Stack Developer", performanceScore: 93, tasksDone: 15 },
      ],
      dailyTrend: [],
    }),
  },
}));

vi.mock("./scene/OfficeSceneEngine", () => ({
  isWebGLAvailable: () => mockState.webglAvailable,
  OfficeSceneEngine: class MockOfficeSceneEngine {
    private snap = { x: 14.5, z: 3.5, yaw: 0, fpYaw: Math.PI, fpPitch: -0.05 };
    private initialApplied = false;
    setSceneData = vi.fn((params: { initialPlayerState?: { x: number; z: number; yaw?: number; fpYaw?: number; fpPitch?: number } | null }) => {
      if (!this.initialApplied && params?.initialPlayerState) {
        this.initialApplied = true;
        this.snap = {
          x: params.initialPlayerState.x,
          z: params.initialPlayerState.z,
          yaw: params.initialPlayerState.yaw ?? this.snap.yaw,
          fpYaw: params.initialPlayerState.fpYaw ?? this.snap.fpYaw,
          fpPitch: params.initialPlayerState.fpPitch ?? this.snap.fpPitch,
        };
      } else {
        this.initialApplied = true;
      }
    });
    setMarkers = vi.fn();
    setEnvironmentConfig = vi.fn();
    setPlayerSkin = vi.fn();
    setPerformanceConfig = vi.fn();
    setCameraMode = vi.fn();
    setSizeInvalidated = vi.fn();
    setBuildMode = vi.fn();
    setKeyPressed = vi.fn();
    clearPressedKeys = vi.fn();
    setMeetingActive = vi.fn();
    setReplayActive = vi.fn();
    setBuildingViewMode = vi.fn();
    setPlayerHeldItem = vi.fn();
    togglePlayerSit = vi.fn(() => true);
    standUpPlayer = vi.fn();
    triggerPlayerActionPose = vi.fn();
    triggerAgentGiftReaction = vi.fn();
    triggerAgentCelebration = vi.fn();
    interactOutdoor = vi.fn(() => null);
    exitPointerLock = vi.fn();
    getPlayerSnapshot = vi.fn(() => ({ ...this.snap }));
    restorePlayerState = vi.fn();
    triggerPlayerEmote = vi.fn();
    setFollowAgent = vi.fn();
    setKpiSnapshot = mockState.setKpiSnapshot;
    enqueueMovementTask = vi.fn();
    captureScreenshot = vi.fn(() => "data:image/png;base64,AA==");
    teleportToCell = mockState.teleportToCell;
    showAgentSpeechBubble = mockState.showAgentSpeechBubble;
    dispose = mockState.dispose;
  },
}));

vi.mock("./scene/audio", () => ({
  OfficeSpatialAudio: class MockOfficeSpatialAudio {
    setVolume = vi.fn();
    setMuted = vi.fn();
    playTaskCompleted = vi.fn();
    playErrorAlert = vi.fn();
    playApprovalStamp = vi.fn();
    tickPositionalAmbient = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", issuePrefix: "PAP", name: "Paperclip" },
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: mockState.setBreadcrumbs,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useOptionalToastActions: () => ({
    pushToast: mockState.pushToast,
  }),
}));

vi.mock("@/context/DialogContext", () => ({
  useDialogActions: () => ({
    openNewIssue: vi.fn(),
    openNewAgent: vi.fn(),
  }),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [mockState.searchParams, mockState.setSearchParams] as const,
}));

const mockBridgeReturn = vi.hoisted(() => ({
  companyId: "company-1",
  agents: [
    {
      id: "agent-1",
      companyId: "company-1",
      name: "Builder Bot",
      urlKey: "builder-bot",
      role: "engineer",
      title: "Staff Engineer",
      icon: null,
      status: "running",
      reportsTo: null,
      capabilities: null,
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: 1000,
      spentMonthlyCents: 250,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: false },
      lastHeartbeatAt: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  agentsLoading: false,
  summary: {
    companyId: "company-1",
    pendingApprovalsCount: 1,
    upcomingRoutines: [],
    runningWorkspaces: [],
    recentArtifactsCount: 0,
    agentsById: {
      "agent-1": {
        agentId: "agent-1",
        name: "Builder Bot",
        urlKey: "builder-bot",
        role: "engineer",
        title: "Staff Engineer",
        icon: null,
        reportsTo: null,
        visualState: "coding" as const,
        currentRunId: "run-1",
        currentIssueIdentifier: "PAP-10",
        currentIssueTitle: "Build Office",
        runStartedAt: new Date().toISOString(),
        costTodayCents: 120,
        budgetUtilizationPct: 25,
      },
    },
    allowedActions: ["approve", "pause_resume_agent", "assign_issue", "hire_agent", "edit_layout"],
  },
  markers: [],
  pendingApprovals: [],
  routines: [],
  workspaces: [],
  artifacts: [],
  issues: [],
  goals: [],
  projects: [],
  recentRuns: [],
  trophyAgentIds: new Set<string>(),
  endOfDayRecap: null,
  dismissRecap: vi.fn(),
  pauseAgent: { mutate: vi.fn() },
  resumeAgent: { mutate: vi.fn() },
  wakeAgent: { mutate: vi.fn(), isPending: false },
  assignIssueToAgent: { mutate: vi.fn(), isPending: false },
  approveItem: { mutate: vi.fn() },
  rejectItem: { mutate: vi.fn() },
  runRoutine: { mutate: vi.fn() },
}));

vi.mock("@/hooks/useAgentChatEnabled", () => ({
  useAgentChatEnabled: () => ({ enabled: true, loaded: true }),
}));

vi.mock("@/context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (handler: (event: Record<string, unknown>) => void) => {
    mockState.liveHandlers.add(handler);
  },
  useTranscriptLiveStream: vi.fn(),
  useHasCompanyLiveConnection: () => true,
}));

vi.mock("@/api/adapters", () => ({
  adaptersApi: {
    list: vi.fn().mockResolvedValue([{ type: "opencode_local", label: "OpenCode", disabled: false }]),
  },
}));

vi.mock("@/api/agents", () => ({
  agentsApi: {
    adapterModels: vi.fn().mockResolvedValue([]),
    hire: vi.fn().mockResolvedValue({ agent: null, approval: null }),
    instructionsBundle: vi.fn().mockResolvedValue({ entryFile: "AGENTS.md", editable: true }),
    instructionsFile: vi.fn().mockResolvedValue({ path: "AGENTS.md", content: "# Agent Playbook" }),
    saveInstructionsFile: vi.fn(),
  },
}));

vi.mock("@/api/agentChats", () => ({
  agentChatsApi: {
    get: vi.fn().mockResolvedValue(null),
    ensure: vi.fn(),
  },
}));

vi.mock("@/api/issues", () => ({
  issuesApi: {
    get: vi.fn().mockResolvedValue({
      id: "issue-38",
      identifier: "PAP-38",
      title: "Upgrade Scientific Calculator Modes",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: "agent-1",
      description: "Full description for PAP-38 calculator upgrade.",
    }),
    listComments: vi.fn().mockResolvedValue([]),
    addComment: vi.fn(),
  },
}));

vi.mock("./useOfficeControlPlaneBridge", () => ({
  useOfficeControlPlaneBridge: () => mockBridgeReturn,
}));

describe("Office3DPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  function renderPage() {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Office3D />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockState.webglAvailable = true;
    mockState.searchParams = new URLSearchParams();
    mockState.setSearchParams.mockReset();
    mockState.setBreadcrumbs.mockReset();
    mockState.teleportToCell.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
  });

  it("renders WebGLFallback with /org and /dashboard links when WebGL is unavailable", () => {
    mockState.webglAvailable = false;

    renderPage();

    expect(container.textContent).toContain("WebGL 3D rendering is unavailable");
    expect(container.textContent).toContain("Builder Bot");
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/org");
    expect(hrefs).toContain("/dashboard");
  });

  it("mounts the 3D scene HUD, compacts options under Office Options, toggles Hide Map, and toggles Build Mode cleanly", () => {
    renderPage();

    expect(container.textContent).toContain("Build Office");
    expect(container.textContent).toContain("Office Options");
    expect(mockState.setBreadcrumbs).toHaveBeenCalledWith([{ label: "3D Office" }]);

    // Toggle Hide Map from the minimap corner button and restore via Map (M)
    const hideMapBtn = container.querySelector('button[aria-label="Hide Map"]') as HTMLButtonElement | null;
    expect(hideMapBtn).not.toBeNull();
    act(() => {
      hideMapBtn!.click();
    });
    expect(container.textContent).toContain("Map (M)");
    const restoreMapBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Map (M)"),
    );
    expect(restoreMapBtn).toBeDefined();
    act(() => {
      restoreMapBtn!.click();
    });
    expect(container.querySelector('button[aria-label="Hide Map"]')).not.toBeNull();

    const buildBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Build Office"),
    );
    expect(buildBtn).toBeDefined();

    act(() => {
      buildBtn!.click();
    });

    expect(container.textContent).toContain("Save Layout");
    expect(container.textContent).toContain("Cancel");

    const cancelBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim() === "Cancel",
    );
    act(() => {
      cancelBtn!.click();
    });

    expect(container.textContent).not.toContain("Save Layout");
    expect(container.textContent).toContain("Build Office");
  });

  it("toggles Meeting Mode and Time-lapse Replay bar from the Office Options menu", () => {
    renderPage();

    const openOptions = () => {
      const optBtn = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Office Options"),
      );
      expect(optBtn).toBeDefined();
      act(() => {
        optBtn!.click();
      });
    };

    openOptions();
    expect(document.body.textContent).toContain("Customize Avatar");
    const meetBtn = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Call Meeting"),
    );
    expect(meetBtn).toBeDefined();
    act(() => {
      meetBtn!.click();
    });

    openOptions();
    expect(document.body.textContent).toContain("End Meeting");
    const replayBtn = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Replay"),
    );
    expect(replayBtn).toBeDefined();
    act(() => {
      replayBtn!.click();
    });
    expect(container.textContent).toContain("Time-lapse Replay");

    const exitReplayBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Exit Replay"),
    );
    expect(exitReplayBtn).toBeDefined();
    act(() => {
      exitReplayBtn!.click();
    });
    expect(container.textContent).not.toContain("Time-lapse Replay");
  });

  it("opens in-office Quick Chat drawer and Hire modal without leaving Office3D", () => {
    renderPage();

    const rosterBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Agents (1)"),
    );
    expect(rosterBtn).toBeDefined();
    act(() => {
      rosterBtn!.click();
    });

    const chatBtn = document.body.querySelector(
      'button[title="Quick Chat"]',
    ) as HTMLButtonElement | null;
    expect(chatBtn).not.toBeNull();
    act(() => {
      chatBtn!.click();
    });

    expect(container.querySelector('aside[aria-label="Quick Chat: Builder Bot"]')).not.toBeNull();

    act(() => {
      rosterBtn!.click();
    });
    const hireBtn = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Hire",
    );
    expect(hireBtn).toBeDefined();
    act(() => {
      hireBtn!.click();
    });

    expect(document.body.textContent).toContain("Hire Agent in Office");
  });

  it("exposes unified Place Object (desk/door), Move, and Rotate 90° controls in Build Mode without duplicate Place Door/Desk buttons", () => {
    renderPage();

    const buildBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Build Office"),
    );
    expect(buildBtn).toBeDefined();
    act(() => {
      buildBtn!.click();
    });

    const buttonsText = [...container.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
    expect(buttonsText.some((t) => t === "Move")).toBe(true);
    expect(buttonsText.some((t) => t === "Place Object")).toBe(true);
    expect(buttonsText.some((t) => t.startsWith("Rotate 90°"))).toBe(true);
    expect(buttonsText.some((t) => t === "Place Door")).toBe(false);
    expect(buttonsText.some((t) => t === "Place Desk")).toBe(false);

    const placeObjBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Place Object",
    );
    expect(placeObjBtn).toBeDefined();
    act(() => {
      placeObjBtn!.click();
    });

    const kindSelect = container.querySelector(
      'select[name="officeBuildFurnitureKind"]',
    ) as HTMLSelectElement | null;
    expect(kindSelect).not.toBeNull();
    const optionValues = [...kindSelect!.options].map((o) => o.value);
    expect(optionValues).toContain("desk");
    expect(optionValues).toContain("door");

    const outdoorCatBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Outdoor Yard"),
    );
    expect(outdoorCatBtn).toBeDefined();
    act(() => {
      outdoorCatBtn!.click();
    });
    const outdoorOptions = [...kindSelect!.options].map((o) => o.value);
    expect(outdoorOptions).toContain("outdoor_sakura_tree");
    expect(outdoorOptions).toContain("outdoor_bench");

    const rotateBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Rotate 90°"),
    );
    expect(rotateBtn?.textContent).toContain("(0°)");
    act(() => {
      rotateBtn!.click();
    });
    expect(rotateBtn?.textContent).toContain("(90°)");
  });

  it("opens Team Chat drawer from HUD and shows 3D speech bubble on live team_chat.message_posted event", async () => {
    mockState.webglAvailable = true;
    mockState.liveHandlers.clear();
    renderPage();
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }

    const teamChatBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Team Chat"),
    );
    expect(teamChatBtn).toBeDefined();

    act(() => {
      teamChatBtn!.click();
    });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }

    expect(container.textContent).toContain("delivery-team");

    act(() => {
      for (const handler of mockState.liveHandlers) {
        handler({
          companyId: "company-1",
          type: "activity.logged",
          payload: {
            action: "team_chat.message_posted",
            entityId: "room-1",
            details: {
              authorAgentId: "agent-1",
              bodyPreview: "Hello from team chat!",
            },
          },
        });
      }
    });

    expect(mockState.showAgentSpeechBubble).toHaveBeenCalledWith(
      "agent-1",
      "Hello from team chat!",
      9000,
    );
  });

  it("opens HeldIssueModal when pressing E or F while holding a bound issue document", async () => {
    saveOfficeHotbar("company-1", {
      selectedSlot: 0,
      slots: [
        {
          id: "item-38",
          kind: "document",
          label: "PAP-38",
          entityKind: "issue",
          entityId: "issue-38",
          entityIdentifier: "PAP-38",
        },
        null,
        null,
        null,
        null,
        null,
      ],
    });

    renderPage();
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(container.textContent).toContain("View [F]");
    expect(container.textContent).toContain("Press [F] or [E] to view PAP-38");

    const viewport = container.querySelector(".office-viewport") as HTMLDivElement | null;
    expect(viewport).not.toBeNull();

    act(() => {
      viewport!.dispatchEvent(new KeyboardEvent("keydown", { key: "e", code: "KeyE", bubbles: true }));
    });
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    expect(document.body.textContent).toContain("Upgrade Scientific Calculator Modes");
    expect(document.body.textContent).toContain("Full description for PAP-38 calculator upgrade.");
    expect(document.body.textContent).toContain("Open Full Issue");
  });

  it("toggles Emote bar via G key without bubbling and activates Follow Agent banner", async () => {
    localStorage.setItem(
      "paperclip.office3d.playerState.v1.company-1",
      JSON.stringify({
        buildingId: "building-hq",
        floorId: "floor-1",
        x: 14.5,
        z: 30.4,
        yaw: 1.25,
        fpYaw: 2.1,
        fpPitch: -0.1,
        cameraMode: "rpg",
        buildingViewMode: "cutaway",
      }),
    );

    const docKeySpy = vi.fn();
    document.addEventListener("keydown", docKeySpy);
    try {
      renderPage();
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await Promise.resolve();
        });
      }

      const persistedRaw = localStorage.getItem("paperclip.office3d.playerState.v1.company-1");
      expect(persistedRaw).not.toBeNull();
      const persisted = JSON.parse(persistedRaw!);
      expect(persisted.x).toBeCloseTo(14.5);
      expect(persisted.z).toBeCloseTo(30.4);

      const viewport = container.querySelector(".office-viewport") as HTMLDivElement | null;
      expect(viewport).not.toBeNull();

      act(() => {
        viewport!.dispatchEvent(new KeyboardEvent("keydown", { key: "g", code: "KeyG", bubbles: true }));
      });
      expect(docKeySpy).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Wave");
      expect(container.textContent).toContain("Celebrate");
      expect(container.textContent).toContain("Clap");
    } finally {
      document.removeEventListener("keydown", docKeySpy);
      localStorage.removeItem("paperclip.office3d.playerState.v1.company-1");
    }

    const rosterBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Agents (1)"),
    );
    expect(rosterBtn).toBeDefined();
    act(() => {
      rosterBtn!.click();
    });

    const followBtn = [...document.body.querySelectorAll("button")].find(
      (b) => b.getAttribute("title") === "Follow",
    );
    expect(followBtn).toBeDefined();
    act(() => {
      followBtn!.click();
    });
    expect(container.textContent).toContain("Following Builder Bot");
    expect(container.textContent).toContain("Stop Following");

    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(mockState.setKpiSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        topAgentName: "Full-Stack Developer",
        topAgentScore: 93,
      }),
    );
  });
});

describe("OfficePlaybookDrawer multi-file instructions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  function setNativeInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function flushAsync() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
  });

  it("displays all bundle files (AGENTS.md, SOUL.md), switches tabs, edits existing files, and creates new files", async () => {
    const mockedBundle = vi.mocked(agentsApi.instructionsBundle);
    const mockedFile = vi.mocked(agentsApi.instructionsFile);
    const mockedSave = vi.mocked(agentsApi.saveInstructionsFile);

    mockedBundle.mockResolvedValue({
      agentId: "agent-1",
      companyId: "company-1",
      mode: "managed",
      rootPath: null,
      managedRootPath: "/tmp/agent-1",
      entryFile: "AGENTS.md",
      resolvedEntryPath: "/tmp/agent-1/AGENTS.md",
      editable: true,
      warnings: [],
      legacyPromptTemplateActive: false,
      legacyBootstrapPromptTemplateActive: false,
      files: [
        {
          path: "SOUL.md",
          contentHash: "hash-soul",
          size: 40,
          language: "markdown",
          markdown: true,
          isEntryFile: false,
          editable: true,
          deprecated: false,
          virtual: false,
        },
        {
          path: "AGENTS.md",
          contentHash: "hash-agents",
          size: 50,
          language: "markdown",
          markdown: true,
          isEntryFile: true,
          editable: true,
          deprecated: false,
          virtual: false,
        },
      ],
    });

    mockedFile.mockImplementation(async (_id, relPath) => ({
      path: relPath,
      contentHash: relPath === "SOUL.md" ? "hash-soul" : "hash-agents",
      size: 42,
      language: "markdown",
      markdown: true,
      isEntryFile: relPath === "AGENTS.md",
      editable: true,
      deprecated: false,
      virtual: false,
      content: relPath === "SOUL.md" ? "# Soul Persona\nCurious engineer." : "# CEO Playbook",
    }));

    mockedSave.mockImplementation(async (_id, data) => ({
      path: data.path,
      contentHash: "hash-updated",
      size: data.content.length,
      language: "markdown",
      markdown: true,
      isEntryFile: data.path === "AGENTS.md",
      editable: true,
      deprecated: false,
      virtual: false,
      content: data.content,
    }));

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OfficePlaybookDrawer
            open={true}
            initialAgentId="agent-1"
            companyId="company-1"
            agents={[mockBridgeReturn.summary.agentsById["agent-1"]!]}
            canEdit={true}
            onClose={vi.fn()}
          />
        </QueryClientProvider>,
      );
    });

    await flushAsync();
    await flushAsync();

    expect(container.textContent).toContain("AGENTS.md");
    expect(container.textContent).toContain("SOUL.md");
    expect(container.textContent).toContain("# CEO Playbook");

    const soulTab = [...container.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes("SOUL.md"),
    ) as HTMLButtonElement | undefined;
    expect(soulTab).toBeDefined();

    act(() => {
      soulTab!.click();
    });
    await flushAsync();
    await flushAsync();

    expect(container.textContent).toContain("# Soul Persona");

    const editBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Edit",
    );
    expect(editBtn).toBeDefined();
    act(() => {
      editBtn!.click();
    });

    const editor = container.querySelector('#office-playbook-editor') as HTMLTextAreaElement | null;
    expect(editor).not.toBeNull();
    act(() => {
      setNativeInputValue(editor!, "# Updated Soul");
    });

    const saveBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Save Playbook"),
    );
    expect(saveBtn).toBeDefined();
    act(() => {
      saveBtn!.click();
    });
    await flushAsync();

    expect(mockedSave).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        path: "SOUL.md",
        content: "# Updated Soul",
        baseHash: "hash-soul",
      }),
      "company-1",
    );

    const newFileBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("New File"),
    );
    expect(newFileBtn).toBeDefined();
    act(() => {
      newFileBtn!.click();
    });

    const newFileInput = container.querySelector("#office-playbook-new-file") as HTMLInputElement | null;
    expect(newFileInput).not.toBeNull();
    act(() => {
      setNativeInputValue(newFileInput!, "HEARTBEAT.md");
    });

    const createBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Create",
    );
    expect(createBtn).toBeDefined();
    act(() => {
      createBtn!.click();
    });

    const newEditor = container.querySelector("#office-playbook-editor") as HTMLTextAreaElement | null;
    expect(newEditor).not.toBeNull();
    act(() => {
      setNativeInputValue(newEditor!, "# Heartbeat Routine");
    });

    const saveNewBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Save Playbook"),
    );
    act(() => {
      saveNewBtn!.click();
    });
    await flushAsync();

    expect(mockedSave).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        path: "HEARTBEAT.md",
        content: "# Heartbeat Routine",
        baseRevisionId: null,
        baseHash: null,
      }),
      "company-1",
    );
  });
});
