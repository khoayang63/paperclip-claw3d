import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPERCLIP_API = (process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100/api").replace(/\/$/, "");

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".vite",
  "coverage",
  ".turbo",
  "playwright-report",
  "test-results",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".DS_Store",
]);

const EXTENSION_LANGUAGE: Record<string, string> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".json": "json",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".py": "python",
  ".sh": "shell",
  ".ps1": "powershell",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sql": "sql",
};

type ProjectFileItem = {
  name: string;
  path: string;
  language: string;
  content: string;
  lines: string[];
  description?: string;
};

async function fetchPaperclipJson<T>(endpoint: string): Promise<T | null> {
  try {
    const res = await fetch(`${PAPERCLIP_API}${endpoint}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function scoreIssueStatus(status: string | undefined): number {
  switch (status) {
    case "in_progress":
      return 1;
    case "in_review":
      return 2;
    case "todo":
      return 3;
    case "blocked":
      return 4;
    case "done":
      return 5;
    default:
      return 9;
  }
}

function pickWorkspaceRoot(rawCwd: string): string | null {
  if (!rawCwd || !fs.existsSync(rawCwd)) return null;
  const repoSubdir = path.join(rawCwd, "repo");
  try {
    const directEntries = fs.readdirSync(rawCwd).filter((e) => !IGNORED_DIRS.has(e) && !e.startsWith("."));
    const hasDirectCode = directEntries.some((entry) => {
      const full = path.join(rawCwd, entry);
      if (!fs.statSync(full).isFile()) return false;
      return Boolean(EXTENSION_LANGUAGE[path.extname(entry).toLowerCase()]);
    });
    if (hasDirectCode) return rawCwd;
    if (fs.existsSync(repoSubdir) && fs.statSync(repoSubdir).isDirectory()) {
      return repoSubdir;
    }
  } catch {
    return rawCwd;
  }
  return rawCwd;
}

function scanWorkspaceFiles(rootDir: string, maxFiles = 40): ProjectFileItem[] {
  const results: ProjectFileItem[] = [];

  const walk = (dir: string, relPrefix: string, depth: number) => {
    if (depth > 3 || results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(fullPath, relPath, depth + 1);
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        const language = EXTENSION_LANGUAGE[ext];
        if (!language) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 150_000) continue;
          const content = fs.readFileSync(fullPath, "utf8");
          const lines = content.replace(/\r\n/g, "\n").split("\n");
          results.push({
            name: relPath,
            path: relPath,
            language,
            content,
            lines,
          });
        } catch {
          // skip unreadable file
        }
      }
    }
  };

  walk(rootDir, "", 0);

  // Order nicely: primary app files first, then tests, then docs, then config
  const priority = (name: string): number => {
    const lower = name.toLowerCase();
    if (lower === "app.js" || lower === "index.js" || lower === "main.js") return 1;
    if (lower === "styles.css" || lower === "style.css") return 2;
    if (lower === "index.html") return 3;
    if (lower === "readme.md") return 4;
    if (lower.includes("test") || lower.includes("spec")) return 5;
    if (lower.endsWith(".md")) return 6;
    if (lower.endsWith(".json")) return 8;
    return 7;
  };
  results.sort((a, b) => priority(a.name) - priority(b.name) || a.name.localeCompare(b.name));
  return results;
}

function readWorkspaceTerminalLines(rootDir: string, issue?: { identifier?: string; title?: string; status?: string } | null): string[] {
  const lines: string[] = [];
  if (issue?.identifier) {
    lines.push(`$ paperclip issue view ${issue.identifier} [${issue.status || "active"}]`);
    if (issue.title) {
      lines.push(`$ task: ${issue.title.slice(0, 90)}`);
    }
  }
  lines.push(`$ pwd: ${rootDir}`);

  if (fs.existsSync(path.join(rootDir, ".git"))) {
    try {
      const gitLog = execFileSync("git", ["log", "-n", "6", "--oneline"], {
        cwd: rootDir,
        encoding: "utf8",
        timeout: 2000,
      }).trim();
      if (gitLog) {
        for (const commit of gitLog.split(/\r?\n/)) {
          if (commit.trim()) lines.push(`$ git commit ${commit.trim()}`);
        }
      }
    } catch {
      // ignore git errors
    }
  }

  return lines;
}

function fallbackLatestIsolatedWorkspace(): string | null {
  const isolatedBase = path.join(
    process.env.USERPROFILE || process.env.HOME || "C:\\Users\\OS",
    ".paperclip",
    "instances",
    "default",
    "isolated-workspaces",
  );
  if (!fs.existsSync(isolatedBase)) return null;

  let bestDir: string | null = null;
  let bestMtime = 0;
  try {
    for (const companyDir of fs.readdirSync(isolatedBase)) {
      const cPath = path.join(isolatedBase, companyDir);
      if (!fs.statSync(cPath).isDirectory()) continue;
      for (const issueDir of fs.readdirSync(cPath)) {
        const iPath = path.join(cPath, issueDir);
        if (!fs.statSync(iPath).isDirectory()) continue;
        const picked = pickWorkspaceRoot(iPath);
        if (!picked) continue;
        const files = scanWorkspaceFiles(picked, 3);
        if (files.length === 0) continue;
        const mtime = fs.statSync(picked).mtimeMs;
        if (mtime > bestMtime) {
          bestMtime = mtime;
          bestDir = picked;
        }
      }
    }
  } catch {
    return null;
  }
  return bestDir;
}

type ActivityItem = {
  kind: "tool" | "thinking" | "assistant";
  text: string;
  live?: boolean;
  timestamp?: number;
  timeStr?: string;
};

async function fetchRecentRunActivities(
  issueId: string | null,
  agentId: string | null,
): Promise<ActivityItem[]> {
  if (!issueId) return [];
  const runs = await fetchPaperclipJson<
    Array<{ runId?: string; id?: string; agentId?: string; status?: string; logBytes?: number | null }>
  >(`/issues/${issueId}/runs`);
  if (!Array.isArray(runs) || runs.length === 0) return [];

  const chosen =
    (agentId ? runs.find((r) => r.agentId === agentId && (r.status === "running" || r.logBytes)) : null) ||
    runs.find((r) => r.status === "running") ||
    runs.find((r) => (r.logBytes ?? 0) > 0) ||
    runs[0];
  const runId = chosen?.runId || chosen?.id;
  if (!runId) return [];

  const totalBytes = Number(chosen.logBytes || 0);
  const offset = totalBytes > 200_000 ? totalBytes - 200_000 : 0;
  const logRes = await fetchPaperclipJson<{ content?: string }>(
    `/heartbeat-runs/${runId}/log?offset=${offset}&limitBytes=262144`,
  );
  if (!logRes?.content) return [];

  const isLive = chosen.status === "running";
  const items: ActivityItem[] = [];
  const lines = logRes.content.split(/\r?\n/);
  const startIdx = offset > 0 ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine) continue;
    let outer: { stream?: string; chunk?: string; ts?: string };
    try {
      outer = JSON.parse(rawLine) as { stream?: string; chunk?: string; ts?: string };
    } catch {
      continue;
    }
    if (outer.stream !== "stdout" || typeof outer.chunk !== "string") continue;

    for (const chunkLine of outer.chunk.split(/\r?\n/)) {
      const trimmed = chunkLine.trim();
      if (!trimmed.startsWith("{")) continue;
      let ev: {
        type?: string;
        timestamp?: number;
        part?: {
          text?: string;
          tool?: string;
          state?: { input?: Record<string, unknown>; title?: string; status?: string };
        };
      };
      try {
        ev = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const tsNum = typeof ev.timestamp === "number" ? ev.timestamp : (outer.ts ? new Date(outer.ts).getTime() : undefined);
      const timeStr = tsNum ? new Date(tsNum).toLocaleTimeString("vi-VN", { hour12: false }) : undefined;

      if (ev.type === "reasoning" && typeof ev.part?.text === "string" && ev.part.text.trim()) {
        items.push({
          kind: "thinking",
          text: ev.part.text.trim().replace(/\s+/g, " ").slice(0, 260),
          live: isLive,
          timestamp: tsNum,
          timeStr,
        });
      } else if (ev.type === "tool_use" && ev.part?.tool) {
        const toolName = ev.part.tool;
        const input = ev.part.state?.input || {};
        const target =
          (typeof input.filePath === "string" && input.filePath) ||
          (typeof input.path === "string" && input.path) ||
          (typeof input.command === "string" && input.command.slice(0, 140)) ||
          (typeof input.pattern === "string" && input.pattern) ||
          (typeof ev.part.state?.title === "string" && ev.part.state.title.slice(0, 140)) ||
          "";
        items.push({
          kind: "tool",
          text: target ? `${toolName}: ${target}` : toolName,
          live: isLive,
          timestamp: tsNum,
          timeStr,
        });
      } else if (ev.type === "text" && typeof ev.part?.text === "string" && ev.part.text.trim()) {
        items.push({
          kind: "assistant",
          text: ev.part.text.trim().slice(0, 320),
          live: isLive,
          timestamp: tsNum,
          timeStr,
        });
      }
    }
  }

  return items.slice(-50);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId")?.trim() || null;

    let resolvedDir: string | null = null;
    let resolvedLabel = "workspace";
    let targetIssue: {
      id: string;
      identifier?: string;
      title?: string;
      status?: string;
      updatedAt?: string;
      assigneeAgentId?: string | null;
      currentExecutionWorkspace?: { cwd?: string | null; repoUrl?: string | null; name?: string | null } | null;
    } | null = null;

    const companies = await fetchPaperclipJson<Array<{ id: string }>>("/companies");
    const companyId = Array.isArray(companies) && companies.length > 0 ? companies[0].id : null;

    if (companyId) {
      const [liveRuns, issues] = await Promise.all([
        fetchPaperclipJson<Array<{ id: string; agentId?: string; issueId?: string; status?: string }>>(
          `/companies/${companyId}/live-runs`,
        ),
        fetchPaperclipJson<
          Array<{
            id: string;
            identifier?: string;
            title?: string;
            status?: string;
            updatedAt?: string;
            assigneeAgentId?: string | null;
            currentExecutionWorkspace?: { cwd?: string | null; repoUrl?: string | null; name?: string | null } | null;
          }>
        >(`/companies/${companyId}/issues`),
      ]);

      const issueList = Array.isArray(issues) ? issues : [];
      const nonCancelled = issueList.filter((i) => i.status !== "cancelled");

      const candidates: typeof issueList = [];

      // 1. Live run's issue for this agent
      if (agentId && Array.isArray(liveRuns)) {
        const activeRun = liveRuns.find((r) => r.status === "running" && r.agentId === agentId && r.issueId);
        if (activeRun?.issueId) {
          const match = issueList.find((i) => i.id === activeRun.issueId);
          if (match) candidates.push(match);
        }
      }

      // 2. Issues assigned to this agent, ordered by status & recency
      if (agentId) {
        const mine = nonCancelled
          .filter((i) => i.assigneeAgentId === agentId)
          .sort((a, b) => {
            const sa = scoreIssueStatus(a.status);
            const sb = scoreIssueStatus(b.status);
            if (sa !== sb) return sa - sb;
            return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
          });
        candidates.push(...mine);
      }

      // 3. Company-wide most recently updated active/completed non-cancelled issues
      const companyWide = [...nonCancelled].sort((a, b) => {
        const sa = scoreIssueStatus(a.status);
        const sb = scoreIssueStatus(b.status);
        if (sa !== sb) return sa - sb;
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
      candidates.push(...companyWide);

      const triedIds = new Set<string>();
      for (const candidate of candidates) {
        if (!candidate || triedIds.has(candidate.id)) continue;
        triedIds.add(candidate.id);

        let rawCwd = candidate.currentExecutionWorkspace?.cwd || null;
        let repoUrl = candidate.currentExecutionWorkspace?.repoUrl || null;
        let wsName = candidate.currentExecutionWorkspace?.name || null;
        if (!rawCwd) {
          const detail = await fetchPaperclipJson<{
            currentExecutionWorkspace?: { cwd?: string | null; repoUrl?: string | null; name?: string | null } | null;
          }>(`/issues/${candidate.id}`);
          rawCwd = detail?.currentExecutionWorkspace?.cwd || null;
          repoUrl = repoUrl || detail?.currentExecutionWorkspace?.repoUrl || null;
          wsName = wsName || detail?.currentExecutionWorkspace?.name || null;
        }
        if (!rawCwd) continue;
        let picked = pickWorkspaceRoot(rawCwd);
        let scanned = picked ? scanWorkspaceFiles(picked, 3) : [];

        // Check if agent saved files directly in isolated-workspaces/<companyId>/<candidate.identifier>
        if (scanned.length === 0 && candidate.identifier) {
          const idCandidate = path.join(
            process.env.USERPROFILE || process.env.HOME || "C:\\Users\\OS",
            ".paperclip",
            "instances",
            "default",
            "isolated-workspaces",
            companyId,
            candidate.identifier,
          );
          if (fs.existsSync(idCandidate)) {
            const pickedId = pickWorkspaceRoot(idCandidate);
            if (pickedId) {
              const scannedId = scanWorkspaceFiles(pickedId, 3);
              if (scannedId.length > 0) {
                picked = pickedId;
                scanned = scannedId;
              }
            }
          }
        }

        // Also check if candidate.id directly has an isolated-workspace folder
        if (scanned.length === 0 && candidate.id) {
          const idCandidate = path.join(
            process.env.USERPROFILE || process.env.HOME || "C:\\Users\\OS",
            ".paperclip",
            "instances",
            "default",
            "isolated-workspaces",
            companyId,
            candidate.id,
          );
          if (fs.existsSync(idCandidate)) {
            const pickedId = pickWorkspaceRoot(idCandidate);
            if (pickedId) {
              const scannedId = scanWorkspaceFiles(pickedId, 3);
              if (scannedId.length > 0) {
                picked = pickedId;
                scanned = scannedId;
              }
            }
          }
        }

        if (!picked || scanned.length === 0) continue;

        resolvedDir = picked;
        targetIssue = candidate;
        if (repoUrl) {
          const repoName = repoUrl.split("/").pop()?.replace(/\.git$/i, "");
          resolvedLabel = repoName || wsName || candidate.identifier || path.basename(picked);
        } else {
          resolvedLabel = candidate.identifier || wsName || path.basename(picked);
        }
        break;
      }
    }

    if (!resolvedDir) {
      resolvedDir = fallbackLatestIsolatedWorkspace();
      if (resolvedDir) {
        resolvedLabel = path.basename(resolvedDir).slice(0, 14);
      }
    }

    const files = resolvedDir ? scanWorkspaceFiles(resolvedDir, 40) : [];
    const baseTerminalLines = resolvedDir
      ? readWorkspaceTerminalLines(resolvedDir, targetIssue)
      : ["$ No active workspace files found yet."];
    const recentActivities = await fetchRecentRunActivities(targetIssue?.id ?? null, agentId);

    // Extract tool commands from recent activities into terminal lines with timestamps
    const toolTerminalLines: string[] = [];
    for (const act of recentActivities) {
      if (act.kind === "tool") {
        const timePrefix = act.timeStr ? `[${act.timeStr}] ` : "";
        toolTerminalLines.push(`${timePrefix}$ ${act.text}`);
      }
    }

    const terminalLines = toolTerminalLines.length > 0
      ? [...baseTerminalLines.slice(0, 2), ...toolTerminalLines.slice(-50)]
      : baseTerminalLines;

    return NextResponse.json({
      ok: true,
      repoLabel: resolvedLabel,
      workspaceCwd: resolvedDir,
      issueIdentifier: targetIssue?.identifier || null,
      files,
      terminalLines,
      recentActivities,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load project files.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
