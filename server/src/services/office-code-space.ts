import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  agents,
  executionWorkspaces,
  heartbeatRuns,
  issues,
  type Db,
} from "@paperclipai/db";
import {
  isUuidLike,
  OFFICE_WORKSPACE_MAX_ENTRIES,
  OFFICE_WORKSPACE_MAX_FILE_BYTES,
  type OfficeWorkspaceEntry,
  type OfficeWorkspaceFileResponse,
  type OfficeWorkspaceSourceKind,
  type OfficeWorkspaceTarget,
  type OfficeWorkspaceTreeResponse,
} from "@paperclipai/shared";
import { badRequest, forbidden, notFound } from "../errors.js";

const BINARY_PROBE_BYTES = 4096;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCwdKey(cwd: string): string {
  const resolved = path.resolve(cwd);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function checkDirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function normalizeWorkspaceRelativePath(rawPath?: string | null): string {
  if (rawPath == null) return "";
  const trimmed = rawPath.trim();
  if (trimmed === "" || trimmed === ".") return "";
  if (trimmed.includes("\0")) {
    throw badRequest("Invalid workspace path");
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    trimmed.startsWith("~") ||
    /^[a-zA-Z]:/.test(trimmed)
  ) {
    throw badRequest("Invalid workspace path");
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalized === "" || normalized === ".") return "";
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") {
      throw badRequest("Invalid workspace path");
    }
  }
  return segments.join("/");
}

export async function resolveSafeWorkspacePath(
  rootDir: string,
  relativePath: string,
): Promise<{ rootReal: string; targetReal: string }> {
  let rootReal: string;
  try {
    rootReal = await fs.realpath(rootDir);
  } catch {
    throw notFound("Workspace directory not found on disk");
  }

  const candidate = relativePath ? path.join(rootReal, ...relativePath.split("/")) : rootReal;
  let targetReal: string;
  try {
    targetReal = await fs.realpath(candidate);
  } catch {
    throw notFound("Path not found in workspace");
  }

  const rel = path.relative(rootReal, targetReal);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw forbidden("Path escapes workspace root");
  }

  return { rootReal, targetReal };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function buildWorkspaceLabel(input: {
  issueIdentifier?: string | null;
  name?: string | null;
  cwd: string;
  fallbackLabel?: string;
}): string {
  const baseName = input.name ?? (path.basename(path.resolve(input.cwd)) || input.cwd);
  if (input.issueIdentifier && baseName !== input.issueIdentifier) {
    return `${input.issueIdentifier} · ${baseName}`;
  }
  return input.issueIdentifier ?? input.name ?? input.fallbackLabel ?? baseName;
}

export function officeCodeSpaceService(db: Db) {
  async function listWorkspaces(
    companyId: string,
    options?: { agentId?: string | null },
  ): Promise<OfficeWorkspaceTarget[]> {
    const agentId = asNonEmptyString(options?.agentId);
    const seenCwd = new Set<string>();
    const results: OfficeWorkspaceTarget[] = [];

    const tryPush = async (candidate: {
      id: string;
      label: string;
      sourceKind: OfficeWorkspaceSourceKind;
      cwd: string;
      branchName?: string | null;
      issueId?: string | null;
      issueIdentifier?: string | null;
      issueTitle?: string | null;
      executionWorkspaceId?: string | null;
      lastUsedAt?: string | null;
    }) => {
      const resolvedCwd = path.resolve(candidate.cwd);
      const key = normalizeCwdKey(resolvedCwd);
      if (seenCwd.has(key)) return;
      seenCwd.add(key);
      results.push({
        id: candidate.id,
        label: candidate.label,
        sourceKind: candidate.sourceKind,
        cwd: resolvedCwd,
        branchName: candidate.branchName ?? null,
        issueId: candidate.issueId ?? null,
        issueIdentifier: candidate.issueIdentifier ?? null,
        issueTitle: candidate.issueTitle ?? null,
        executionWorkspaceId: candidate.executionWorkspaceId ?? null,
        lastUsedAt: candidate.lastUsedAt ?? null,
        exists: await checkDirExists(resolvedCwd),
      });
    };

    if (agentId) {
      if (!isUuidLike(agentId)) {
        throw notFound("Agent not found");
      }
      const agent = await db
        .select({
          id: agents.id,
          name: agents.name,
          adapterConfig: agents.adapterConfig,
        })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)))
        .then((rows) => rows[0] ?? null);
      if (!agent) {
        throw notFound("Agent not found");
      }

      const runs = await db
        .select({
          id: heartbeatRuns.id,
          contextSnapshot: heartbeatRuns.contextSnapshot,
          createdAt: heartbeatRuns.createdAt,
        })
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId)))
        .orderBy(desc(heartbeatRuns.createdAt))
        .limit(20);

      const assignedIssues = await db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          executionWorkspaceId: issues.executionWorkspaceId,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.assigneeAgentId, agentId),
            isNotNull(issues.executionWorkspaceId),
          ),
        )
        .orderBy(desc(issues.updatedAt))
        .limit(20);

      const issueIds = new Set<string>();
      const ewIds = new Set<string>();
      for (const run of runs) {
        const snap = asRecord(run.contextSnapshot);
        const runIssueId = asNonEmptyString(snap.issueId);
        if (runIssueId && isUuidLike(runIssueId)) issueIds.add(runIssueId);
        const wsSnap = asRecord(snap.paperclipWorkspace);
        const rebuildEwId = asNonEmptyString(asRecord(asRecord(wsSnap.realization).rebuild).executionWorkspaceId);
        const directEwId = asNonEmptyString(wsSnap.workspaceId);
        const ewId = rebuildEwId ?? directEwId;
        if (ewId && isUuidLike(ewId)) ewIds.add(ewId);
      }
      for (const iss of assignedIssues) {
        issueIds.add(iss.id);
        if (iss.executionWorkspaceId) ewIds.add(iss.executionWorkspaceId);
      }

      const issueRows =
        issueIds.size > 0
          ? await db
              .select({
                id: issues.id,
                identifier: issues.identifier,
                title: issues.title,
                executionWorkspaceId: issues.executionWorkspaceId,
              })
              .from(issues)
              .where(and(eq(issues.companyId, companyId), inArray(issues.id, [...issueIds])))
          : [];
      const issueMap = new Map(issueRows.map((row) => [row.id, row]));
      for (const row of issueRows) {
        if (row.executionWorkspaceId) ewIds.add(row.executionWorkspaceId);
      }

      const ewRows =
        ewIds.size > 0
          ? await db
              .select({
                id: executionWorkspaces.id,
                name: executionWorkspaces.name,
                cwd: executionWorkspaces.cwd,
                branchName: executionWorkspaces.branchName,
                sourceIssueId: executionWorkspaces.sourceIssueId,
                lastUsedAt: executionWorkspaces.lastUsedAt,
              })
              .from(executionWorkspaces)
              .where(
                and(
                  eq(executionWorkspaces.companyId, companyId),
                  inArray(executionWorkspaces.id, [...ewIds]),
                ),
              )
          : [];
      const ewMap = new Map(ewRows.map((row) => [row.id, row]));

      for (const run of runs) {
        const snap = asRecord(run.contextSnapshot);
        const wsSnap = asRecord(snap.paperclipWorkspace);
        const runIssueId = asNonEmptyString(snap.issueId);
        const issueRow = runIssueId ? issueMap.get(runIssueId) ?? null : null;
        const ewId =
          asNonEmptyString(asRecord(asRecord(wsSnap.realization).rebuild).executionWorkspaceId) ??
          asNonEmptyString(wsSnap.workspaceId) ??
          issueRow?.executionWorkspaceId ??
          null;
        const ewRow = ewId ? ewMap.get(ewId) ?? null : null;
        const cwd = asNonEmptyString(wsSnap.cwd) ?? asNonEmptyString(ewRow?.cwd);
        if (!cwd) continue;

        const sourceKind: OfficeWorkspaceSourceKind = ewRow ? "execution_workspace" : "run_workspace";
        await tryPush({
          id: ewRow?.id ?? `run:${run.id}`,
          label: buildWorkspaceLabel({
            issueIdentifier: issueRow?.identifier ?? null,
            name: ewRow?.name ?? null,
            cwd,
          }),
          sourceKind,
          cwd,
          branchName: ewRow?.branchName ?? asNonEmptyString(wsSnap.branchName),
          issueId: issueRow?.id ?? runIssueId,
          issueIdentifier: issueRow?.identifier ?? null,
          issueTitle: issueRow?.title ?? null,
          executionWorkspaceId: ewRow?.id ?? null,
          lastUsedAt: toIso(ewRow?.lastUsedAt ?? run.createdAt),
        });
      }

      for (const iss of assignedIssues) {
        if (!iss.executionWorkspaceId) continue;
        const ewRow = ewMap.get(iss.executionWorkspaceId);
        const cwd = asNonEmptyString(ewRow?.cwd);
        if (!ewRow || !cwd) continue;
        await tryPush({
          id: ewRow.id,
          label: buildWorkspaceLabel({
            issueIdentifier: iss.identifier,
            name: ewRow.name,
            cwd,
          }),
          sourceKind: "execution_workspace",
          cwd,
          branchName: ewRow.branchName,
          issueId: iss.id,
          issueIdentifier: iss.identifier,
          issueTitle: iss.title,
          executionWorkspaceId: ewRow.id,
          lastUsedAt: toIso(ewRow.lastUsedAt ?? iss.updatedAt),
        });
      }

      const configuredCwd = asNonEmptyString(asRecord(agent.adapterConfig).cwd);
      if (configuredCwd) {
        await tryPush({
          id: `agent:${agent.id}`,
          label: buildWorkspaceLabel({
            cwd: configuredCwd,
            fallbackLabel: `${agent.name} Workspace`,
          }),
          sourceKind: "agent_cwd",
          cwd: configuredCwd,
          lastUsedAt: null,
        });
      }

      return results;
    }

    const ewRows = await db
      .select({
        id: executionWorkspaces.id,
        name: executionWorkspaces.name,
        cwd: executionWorkspaces.cwd,
        branchName: executionWorkspaces.branchName,
        sourceIssueId: executionWorkspaces.sourceIssueId,
        lastUsedAt: executionWorkspaces.lastUsedAt,
      })
      .from(executionWorkspaces)
      .where(and(eq(executionWorkspaces.companyId, companyId), isNotNull(executionWorkspaces.cwd)))
      .orderBy(desc(executionWorkspaces.lastUsedAt))
      .limit(30);

    const sourceIssueIds = ewRows
      .map((row) => row.sourceIssueId)
      .filter((id): id is string => Boolean(id && isUuidLike(id)));
    const sourceIssues =
      sourceIssueIds.length > 0
        ? await db
            .select({
              id: issues.id,
              identifier: issues.identifier,
              title: issues.title,
            })
            .from(issues)
            .where(and(eq(issues.companyId, companyId), inArray(issues.id, sourceIssueIds)))
        : [];
    const issueMap = new Map(sourceIssues.map((row) => [row.id, row]));

    for (const ew of ewRows) {
      const cwd = asNonEmptyString(ew.cwd);
      if (!cwd) continue;
      const iss = ew.sourceIssueId ? issueMap.get(ew.sourceIssueId) ?? null : null;
      await tryPush({
        id: ew.id,
        label: buildWorkspaceLabel({
          issueIdentifier: iss?.identifier ?? null,
          name: ew.name,
          cwd,
        }),
        sourceKind: "execution_workspace",
        cwd,
        branchName: ew.branchName,
        issueId: iss?.id ?? ew.sourceIssueId,
        issueIdentifier: iss?.identifier ?? null,
        issueTitle: iss?.title ?? null,
        executionWorkspaceId: ew.id,
        lastUsedAt: toIso(ew.lastUsedAt),
      });
    }

    return results;
  }

  async function resolveWorkspaceTarget(
    companyId: string,
    workspaceKey: string,
    agentId?: string | null,
  ): Promise<OfficeWorkspaceTarget> {
    if (!workspaceKey) {
      throw notFound("Workspace not found");
    }
    const candidates = agentId
      ? await listWorkspaces(companyId, { agentId })
      : await listWorkspaces(companyId);
    let match = candidates.find((w) => w.id === workspaceKey);
    if (!match && agentId) {
      const companyWorkspaces = await listWorkspaces(companyId);
      match = companyWorkspaces.find((w) => w.id === workspaceKey);
    }
    if (!match) {
      throw notFound("Workspace not found");
    }
    if (!match.exists) {
      throw notFound("Workspace directory not found on disk");
    }
    return match;
  }

  async function getTree(
    companyId: string,
    workspaceKey: string,
    options?: { path?: string | null; agentId?: string | null },
  ): Promise<OfficeWorkspaceTreeResponse> {
    const workspace = await resolveWorkspaceTarget(companyId, workspaceKey, options?.agentId);
    const currentPath = normalizeWorkspaceRelativePath(options?.path);
    const { rootReal, targetReal } = await resolveSafeWorkspacePath(workspace.cwd, currentPath);

    const dirStat = await fs.stat(targetReal).catch(() => null);
    if (!dirStat || !dirStat.isDirectory()) {
      throw badRequest("Target path is not a directory");
    }

    const dirents = await fs.readdir(targetReal, { withFileTypes: true });
    const entries: OfficeWorkspaceEntry[] = [];

    for (const dirent of dirents) {
      if (dirent.name === ".git") continue;
      const entryAbs = path.join(targetReal, dirent.name);
      const realEntry = await fs.realpath(entryAbs).catch(() => null);
      if (!realEntry) continue;
      const relFromRoot = path.relative(rootReal, realEntry);
      if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) continue;

      const stat = await fs.stat(realEntry).catch(() => null);
      if (!stat) continue;
      const kind = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : null;
      if (!kind) continue;

      entries.push({
        name: dirent.name,
        path: currentPath ? `${currentPath}/${dirent.name}` : dirent.name,
        kind,
        sizeBytes: kind === "file" ? stat.size : null,
        modifiedAt: stat.mtime.toISOString(),
      });
    }

    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    const truncated = entries.length > OFFICE_WORKSPACE_MAX_ENTRIES;
    return {
      workspace,
      currentPath,
      entries: truncated ? entries.slice(0, OFFICE_WORKSPACE_MAX_ENTRIES) : entries,
      truncated,
    };
  }

  async function getFile(
    companyId: string,
    workspaceKey: string,
    options: { path: string; agentId?: string | null },
  ): Promise<OfficeWorkspaceFileResponse> {
    const workspace = await resolveWorkspaceTarget(companyId, workspaceKey, options.agentId);
    const relPath = normalizeWorkspaceRelativePath(options.path);
    if (!relPath) {
      throw badRequest("File path is required");
    }

    const { targetReal } = await resolveSafeWorkspacePath(workspace.cwd, relPath);
    const stat = await fs.stat(targetReal).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw badRequest("Target path is not a file");
    }

    const handle = await fs.open(targetReal, "r");
    try {
      const readLimit = OFFICE_WORKSPACE_MAX_FILE_BYTES + 1;
      const buffer = Buffer.allocUnsafe(readLimit);
      const { bytesRead } = await handle.read(buffer, 0, readLimit, 0);
      const slice = buffer.subarray(0, bytesRead);
      const probeLen = Math.min(slice.length, BINARY_PROBE_BYTES);
      const isBinary = slice.subarray(0, probeLen).includes(0);

      if (isBinary) {
        return {
          workspace,
          path: relPath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          isBinary: true,
          truncated: false,
          content: null,
        };
      }

      const truncated = bytesRead > OFFICE_WORKSPACE_MAX_FILE_BYTES || stat.size > OFFICE_WORKSPACE_MAX_FILE_BYTES;
      const contentBytes = slice.subarray(0, Math.min(bytesRead, OFFICE_WORKSPACE_MAX_FILE_BYTES));

      return {
        workspace,
        path: relPath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        isBinary: false,
        truncated,
        content: contentBytes.toString("utf8"),
      };
    } finally {
      await handle.close();
    }
  }

  return {
    listWorkspaces,
    getTree,
    getFile,
  };
}
