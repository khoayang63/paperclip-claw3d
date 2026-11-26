// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officeLayoutApi } from "@/api/office-layout";
import { OfficeWorkspaceCodeBrowser } from "./OfficeWorkspaceCodeBrowser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushUi() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function waitForText(container: HTMLElement, needle: string) {
  for (let i = 0; i < 40; i += 1) {
    if (container.textContent?.includes(needle)) return;
    await flushUi();
  }
  expect(container.textContent).toContain(needle);
}

describe("OfficeWorkspaceCodeBrowser", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    vi.restoreAllMocks();
  });

  it("loads workspace tree, enters folders, renders code/binary previews, and copies code", async () => {
    const workspace = {
      id: "ws-1",
      label: "PTI-33 · Mini Chat",
      sourceKind: "execution_workspace" as const,
      cwd: "C:\\workspaces\\pti-33",
      branchName: "feat/chat",
      issueId: "issue-33",
      issueIdentifier: "PTI-33",
      issueTitle: "Mini Chat App",
      executionWorkspaceId: "ws-1",
      lastUsedAt: "2026-11-25T10:00:00.000Z",
      exists: true,
    };

    vi.spyOn(officeLayoutApi, "listWorkspaces").mockResolvedValue({
      workspaces: [workspace],
    });
    vi.spyOn(officeLayoutApi, "getWorkspaceTree").mockImplementation(async (_cid, _wsId, opts) => {
      if (opts?.path === "src") {
        return {
          workspace,
          currentPath: "src",
          truncated: false,
          entries: [
            {
              name: "App.tsx",
              path: "src/App.tsx",
              kind: "file",
              sizeBytes: 42,
              modifiedAt: "2026-11-25T10:00:00.000Z",
            },
          ],
        };
      }
      return {
        workspace,
        currentPath: "",
        truncated: false,
        entries: [
          {
            name: "src",
            path: "src",
            kind: "directory",
            sizeBytes: null,
            modifiedAt: "2026-11-25T10:00:00.000Z",
          },
          {
            name: "logo.bin",
            path: "logo.bin",
            kind: "file",
            sizeBytes: 12,
            modifiedAt: "2026-11-25T10:00:00.000Z",
          },
        ],
      };
    });
    vi.spyOn(officeLayoutApi, "getWorkspaceFile").mockImplementation(async (_cid, _wsId, opts) => {
      if (opts.path === "logo.bin") {
        return {
          workspace,
          path: "logo.bin",
          sizeBytes: 12,
          modifiedAt: "2026-11-25T10:00:00.000Z",
          isBinary: true,
          truncated: false,
          content: null,
        };
      }
      return {
        workspace,
        path: "src/App.tsx",
        sizeBytes: 42,
        modifiedAt: "2026-11-25T10:00:00.000Z",
        isBinary: false,
        truncated: false,
        content: "export function App() { return <div>Hi</div>; }",
      };
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <OfficeWorkspaceCodeBrowser
            companyId="company-1"
            agentId="agent-1"
            preferredIssueIdentifier="PTI-33"
          />
        </QueryClientProvider>,
      );
    });
    await waitForText(container, "PTI-33 · Mini Chat");
    await waitForText(container, "logo.bin");
    expect(container.textContent).toContain("src");

    // Click binary file first
    const binBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("logo.bin"),
    );
    await act(async () => {
      binBtn?.click();
    });
    await waitForText(container, "Binary file preview is not supported here.");

    // Navigate into src/ folder and open App.tsx
    const srcBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim() === "src",
    );
    await act(async () => {
      srcBtn?.click();
    });
    await waitForText(container, "App.tsx");

    const appBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("App.tsx"),
    );
    await act(async () => {
      appBtn?.click();
    });
    await waitForText(container, "export function App() { return <div>Hi</div>; }");

    // Click Copy button
    const copyBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Copy"),
    );
    await act(async () => {
      copyBtn?.click();
    });
    expect(writeTextMock).toHaveBeenCalledWith("export function App() { return <div>Hi</div>; }");
  });
});
