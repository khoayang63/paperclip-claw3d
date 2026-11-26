// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyPerformanceReport } from "@paperclipai/shared";
import { PerformancePage } from "./PerformancePage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockGetCompanyPerformance = vi.fn();

vi.mock("@/api/performance", () => ({
  performanceApi: {
    getCompanyPerformance: (...args: unknown[]) => mockGetCompanyPerformance(...args),
  },
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "PTIT", issuePrefix: "PTI" },
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: vi.fn(),
  }),
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

const sampleReport = (window: "7d" | "30d" | "all"): CompanyPerformanceReport => ({
  companyId: "company-1",
  window,
  generatedAt: "2026-11-25T12:00:00.000Z",
  summary: {
    tasksDone: window === "7d" ? 4 : 12,
    totalTasks: 15,
    totalRuns: 30,
    runSuccessRatePct: 86.7,
    reopenCount: 1,
    reopenRatePct: 7.7,
    avgCycleTimeSec: 420,
    totalCostUsd: 0.45,
    costPerDoneTaskUsd: 0.0375,
    cacheHitRatePct: 72.4,
    reviewCount: 2,
    avgRating: 4.5,
    passRatePct: 100,
  },
  agents: [
    {
      agentId: "agent-1",
      name: "Full-Stack Developer",
      role: "engineer",
      title: "Full-Stack Engineer",
      icon: "code",
      status: "idle",
      model: "deepseek/deepseek-flash",
      tasksDone: 8,
      tasksInProgress: 1,
      tasksBlocked: 0,
      tasksCancelled: 0,
      totalTasks: 9,
      totalRuns: 16,
      runsSucceeded: 15,
      runsFailed: 1,
      runsCancelled: 0,
      runsTimeout: 0,
      runsProcessLost: 0,
      runSuccessRatePct: 93.8,
      reopenCount: 0,
      reopenRatePct: 0,
      avgRunDurationSec: 45,
      avgCycleTimeSec: 300,
      totalCostUsd: 0.24,
      costPerDoneTaskUsd: 0.03,
      inputTokens: 10000,
      outputTokens: 2000,
      cachedInputTokens: 30000,
      cacheHitRatePct: 75,
      sessionReuseRatePct: 80,
      avgRunsPerDoneTask: 1.5,
      manualInterventions: 0,
      reviewCount: 2,
      avgRating: 4.5,
      passCount: 2,
      needsReworkCount: 0,
      passRatePct: 100,
      performanceScore: 94,
    },
    {
      agentId: "agent-2",
      name: "QA Engineer",
      role: "qa",
      title: "QA & Test Engineer",
      icon: "shield",
      status: "idle",
      model: "deepseek/deepseek-flash",
      tasksDone: 4,
      tasksInProgress: 0,
      tasksBlocked: 1,
      tasksCancelled: 0,
      totalTasks: 6,
      totalRuns: 14,
      runsSucceeded: 11,
      runsFailed: 3,
      runsCancelled: 0,
      runsTimeout: 1,
      runsProcessLost: 0,
      runSuccessRatePct: 78.6,
      reopenCount: 1,
      reopenRatePct: 20,
      avgRunDurationSec: 55,
      avgCycleTimeSec: 540,
      totalCostUsd: 0.21,
      costPerDoneTaskUsd: 0.0525,
      inputTokens: 8000,
      outputTokens: 1500,
      cachedInputTokens: 16000,
      cacheHitRatePct: 66.7,
      sessionReuseRatePct: 70,
      avgRunsPerDoneTask: 2.5,
      manualInterventions: 1,
      reviewCount: 0,
      avgRating: null,
      passCount: 0,
      needsReworkCount: 0,
      passRatePct: null,
      performanceScore: 79,
    },
  ],
  dailyTrend: [
    {
      date: "2026-11-25",
      tasksDone: 4,
      runsSucceeded: 10,
      runsFailed: 2,
      costUsd: 0.12,
    },
  ],
});

async function flushUi(rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

describe("PerformancePage", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    mockGetCompanyPerformance.mockImplementation((_cid: string, window: "7d" | "30d" | "all") =>
      Promise.resolve(sampleReport(window)),
    );
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    container.remove();
  });

  it("renders summary KPIs, leaderboard rows, and switches time windows", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={["/PTI/performance"]}>
          <QueryClientProvider client={qc}>
            <Routes>
              <Route path="/:companyPrefix/performance" element={<PerformancePage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await flushUi();

    expect(container.textContent).toContain("Full-Stack Developer");
    expect(container.textContent).toContain("QA Engineer");
    expect(container.textContent).toContain("86.7%");
    expect(container.textContent).toContain("4.5 / 5");

    const sevenDaysBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("7 Days"),
    );
    expect(sevenDaysBtn).toBeTruthy();

    await act(async () => {
      sevenDaysBtn!.click();
    });
    await flushUi();

    expect(mockGetCompanyPerformance).toHaveBeenCalledWith("company-1", "7d");
  });
});
