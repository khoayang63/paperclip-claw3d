import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, executionWorkspaces, heartbeatRuns, issues } from "@paperclipai/db";
import { OFFICE_WORKSPACE_MAX_FILE_BYTES } from "@paperclipai/shared";
import { errorHandler } from "../middleware/error-handler.js";
import { officeLayoutRoutes } from "../routes/office-layout.js";
import {
  normalizeWorkspaceRelativePath,
  officeCodeSpaceService,
  resolveSafeWorkspacePath,
} from "../services/office-code-space.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompanyId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "44444444-4444-4444-8444-444444444444";
const issueId = "55555555-5555-4555-8555-555555555555";

let tmpRoot: string;
let workspaceDir: string;
let outsideDir: string;

function makeMockDb(fixtures: {
  companyExists?: boolean;
  agentRows?: Array<{ id: string; name: string; adapterConfig: Record<string, unknown> }>;
  ewRows?: Array<Record<string, unknown>>;
  runRows?: Array<Record<string, unknown>>;
  issueRows?: Array<Record<string, unknown>>;
}) {
  const tableRows = (table: unknown): Array<Record<string, unknown>> => {
    if (table === agents) return fixtures.agentRows ?? [];
    if (table === executionWorkspaces) return fixtures.ewRows ?? [];
    if (table === heartbeatRuns) return fixtures.runRows ?? [];
    if (table === issues) return fixtures.issueRows ?? [];
    return [];
  };

  return {
    query: {
      companies: {
        findFirst: vi.fn().mockResolvedValue(fixtures.companyExists === false ? null : { id: companyId }),
      },
    },
    select: () => ({
      from: (table: unknown) => {
        const rows = tableRows(table);
        const chain: Record<string, unknown> = {
          where: () => chain,
          orderBy: () => chain,
          limit: async (n: number) => rows.slice(0, n),
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(rows).then(onFulfilled, onRejected),
        };
        return chain;
      },
    }),
  };
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-office-codespace-"));
  workspaceDir = path.join(tmpRoot, "workspace");
  outsideDir = path.join(tmpRoot, "outside");
  await fs.mkdir(path.join(workspaceDir, ".git"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });

  await fs.writeFile(path.join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main\n");
  await fs.writeFile(path.join(workspaceDir, "package.json"), '{"name":"mini-chat"}\n');
  await fs.writeFile(path.join(workspaceDir, "src", "App.tsx"), "export function App() { return null; }\n");
  await fs.writeFile(path.join(workspaceDir, "logo.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await fs.writeFile(path.join(workspaceDir, "huge.txt"), "A".repeat(OFFICE_WORKSPACE_MAX_FILE_BYTES + 200));
  await fs.writeFile(path.join(outsideDir, "secret.txt"), "top-secret\n");

  await fs.symlink(
    outsideDir,
    path.join(workspaceDir, "escape-dir"),
    process.platform === "win32" ? "junction" : "dir",
  );
});

afterAll(async () => {
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("normalizeWorkspaceRelativePath & resolveSafeWorkspacePath", () => {
  it("rejects traversal, null bytes, home tilde, and absolute paths", () => {
    expect(normalizeWorkspaceRelativePath(undefined)).toBe("");
    expect(normalizeWorkspaceRelativePath(".")).toBe("");
    expect(normalizeWorkspaceRelativePath("src\\App.tsx")).toBe("src/App.tsx");

    for (const bad of ["../secret", "src/../../etc/passwd", "/etc/passwd", "C:\\Windows", "~/foo", "a\0b"]) {
      expect(() => normalizeWorkspaceRelativePath(bad)).toThrow(/Invalid workspace path/);
    }
  });

  it("blocks symlink/junction escape outside workspace root", async () => {
    const safe = await resolveSafeWorkspacePath(workspaceDir, "src/App.tsx");
    expect(safe.targetReal).toContain("App.tsx");

    await expect(resolveSafeWorkspacePath(workspaceDir, "escape-dir/secret.txt")).rejects.toThrow(
      /Path escapes workspace root/,
    );
  });
});

describe("officeCodeSpaceService", () => {
  it("lists deduplicated workspaces, filters .git, previews text/binary/truncated files, and 404s unknown workspace", async () => {
    const db = makeMockDb({
      agentRows: [{ id: agentId, name: "Full-Stack Developer", adapterConfig: { cwd: workspaceDir } }],
      runRows: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          createdAt: new Date("2026-11-25T10:00:00.000Z"),
          contextSnapshot: {
            issueId,
            paperclipWorkspace: {
              cwd: workspaceDir,
              realization: { rebuild: { executionWorkspaceId: workspaceId } },
            },
          },
        },
      ],
      issueRows: [
        {
          id: issueId,
          identifier: "PTI-33",
          title: "Mini Chat App",
          executionWorkspaceId: workspaceId,
          updatedAt: new Date("2026-11-25T10:00:00.000Z"),
        },
      ],
      ewRows: [
        {
          id: workspaceId,
          name: "PTI-33",
          cwd: workspaceDir,
          branchName: "feat/chat",
          sourceIssueId: issueId,
          lastUsedAt: new Date("2026-11-25T10:00:00.000Z"),
        },
      ],
    });

    const svc = officeCodeSpaceService(db as never);
    const list = await svc.listWorkspaces(companyId, { agentId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: workspaceId,
      sourceKind: "execution_workspace",
      issueIdentifier: "PTI-33",
      branchName: "feat/chat",
      exists: true,
    });

    const rootTree = await svc.getTree(companyId, workspaceId, { agentId });
    expect(rootTree.entries.some((e) => e.name === ".git")).toBe(false);
    expect(rootTree.entries.some((e) => e.name === "escape-dir")).toBe(false);
    expect(rootTree.entries[0]?.kind).toBe("directory");
    expect(rootTree.entries.map((e) => e.name)).toContain("src");
    expect(rootTree.entries.map((e) => e.name)).toContain("package.json");

    const srcFile = await svc.getFile(companyId, workspaceId, { path: "src/App.tsx", agentId });
    expect(srcFile).toMatchObject({
      isBinary: false,
      truncated: false,
      content: "export function App() { return null; }\n",
    });

    const binFile = await svc.getFile(companyId, workspaceId, { path: "logo.bin", agentId });
    expect(binFile).toMatchObject({ isBinary: true, truncated: false, content: null });

    const hugeFile = await svc.getFile(companyId, workspaceId, { path: "huge.txt", agentId });
    expect(hugeFile.isBinary).toBe(false);
    expect(hugeFile.truncated).toBe(true);
    expect(hugeFile.content?.length).toBe(OFFICE_WORKSPACE_MAX_FILE_BYTES);

    await expect(svc.getTree(companyId, "99999999-9999-4999-8999-999999999999")).rejects.toThrow(
      /Workspace not found/,
    );
  });
});

describe("office-workspaces route authorization", () => {
  const boardAdmin: Express.Request["actor"] = {
    type: "board",
    source: "session",
    userId: "alice",
    companyIds: [companyId],
    memberships: [{ companyId, membershipRole: "owner", status: "active" }],
  };
  const agentActor: Express.Request["actor"] = {
    type: "agent",
    agentId,
    companyId,
    source: "agent_key",
  };

  function makeApp(actor: Express.Request["actor"]) {
    const db = makeMockDb({
      ewRows: [
        {
          id: workspaceId,
          name: "PTI-33",
          cwd: workspaceDir,
          branchName: null,
          sourceIssueId: null,
          lastUsedAt: new Date("2026-11-25T10:00:00.000Z"),
        },
      ],
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use("/api", officeLayoutRoutes(db as never));
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enforces board access and company boundary while serving workspace files to board users", async () => {
    const crossCompanyRes = await request(makeApp(boardAdmin)).get(
      `/api/companies/${otherCompanyId}/office-workspaces`,
    );
    expect(crossCompanyRes.status).toBe(403);

    const agentRes = await request(makeApp(agentActor)).get(
      `/api/companies/${companyId}/office-workspaces`,
    );
    expect(agentRes.status).toBe(403);

    const okList = await request(makeApp(boardAdmin)).get(
      `/api/companies/${companyId}/office-workspaces`,
    );
    expect(okList.status).toBe(200);
    expect(okList.body.workspaces).toHaveLength(1);

    const badPath = await request(makeApp(boardAdmin)).get(
      `/api/companies/${companyId}/office-workspaces/${workspaceId}/file?path=../../etc/passwd`,
    );
    expect(badPath.status).toBe(400);

    const okFile = await request(makeApp(boardAdmin)).get(
      `/api/companies/${companyId}/office-workspaces/${workspaceId}/file?path=package.json`,
    );
    expect(okFile.status).toBe(200);
    expect(okFile.body.content).toContain('"mini-chat"');
  });
});
