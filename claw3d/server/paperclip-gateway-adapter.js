"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");

const ADAPTER_PORT = parseInt(process.env.PAPERCLIP_ADAPTER_PORT || process.env.DEMO_ADAPTER_PORT || "18789", 10);
const PAPERCLIP_API = process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100/api";
const MAIN_KEY = "main";

let cachedCompanyId = null;
let cachedCompanyName = "PTIT";
let cachedAgents = [];
let cachedModels = [];
let cachedLiveRuns = [];
let cachedIssues = [];
let lastIssuesFetchAt = 0;
let lastModelsFetchAt = 0;
let lastPollAt = 0;

const conversationHistory = new Map();
const sessionSettings = new Map();
const activeRuns = new Map();
const activeSendEventFns = new Set();
const liveAgentActivity = new Map(); // agentId -> { actionText, filePath, toolName, terminalLine, updatedAt }

function extractFileBasename(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) return "";
  const cleaned = rawPath.trim().replace(/\\/g, "/");
  return cleaned.split("/").filter(Boolean).pop() || cleaned;
}

function describeToolAction(toolName, rawInput) {
  const name = String(toolName || "tool").toLowerCase().trim();
  const input = rawInput && typeof rawInput === "object" ? rawInput : {};
  const filePath =
    typeof input.filePath === "string"
      ? input.filePath
      : typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string"
          ? input.path
          : "";
  const baseName = extractFileBasename(filePath);

  if (name === "read" || name === "read_file" || name === "view_file") {
    const label = baseName ? `Reading ${baseName}` : "Reading file";
    return { actionText: label, filePath: filePath || null, terminalLine: `$ [read] ${baseName || filePath || "file"}` };
  }

  if (name === "edit" || name === "edit_file" || name === "patch" || name === "replace" || name === "multiedit") {
    const label = baseName ? `Editing ${baseName}` : "Editing code";
    return { actionText: label, filePath: filePath || null, terminalLine: `$ [edit] ${baseName || filePath || "file"}` };
  }

  if (name === "write" || name === "write_file" || name === "create_file") {
    const label = baseName ? `Writing ${baseName}` : "Writing file";
    return { actionText: label, filePath: filePath || null, terminalLine: `$ [write] ${baseName || filePath || "file"}` };
  }

  if (name === "grep" || name === "glob" || name === "search" || name === "find" || name === "list") {
    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : typeof input.query === "string" ? input.query.trim() : "";
    const shortPat = pattern.length > 18 ? `${pattern.slice(0, 18)}…` : pattern;
    const label = shortPat ? `Searching ${shortPat}` : "Searching codebase";
    return { actionText: label, filePath: null, terminalLine: `$ [${name}] ${pattern || "."}` };
  }

  if (name === "bash" || name === "shell" || name === "exec" || name === "terminal" || name === "run_command") {
    const rawCmd = typeof input.command === "string" ? input.command : typeof input.cmd === "string" ? input.cmd : "";
    const firstLine = rawCmd
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#")) || "";

    // Detect Paperclip API calls (comments, subtasks, status updates)
    if (/\/api\/.*\/comments/i.test(rawCmd)) {
      return { actionText: "Posting issue update", filePath: null, terminalLine: `$ [api] post issue comment` };
    }
    if (/\/api\/.*\/issues/i.test(rawCmd) && /POST|Method\s+Post/i.test(rawCmd)) {
      return { actionText: "Creating subtask", filePath: null, terminalLine: `$ [api] create subtask` };
    }
    if (/\/api\/.*\/issues/i.test(rawCmd) && /PATCH|Method\s+Patch/i.test(rawCmd)) {
      return { actionText: "Updating issue status", filePath: null, terminalLine: `$ [api] update issue status` };
    }
    if (/\/api\/.*\/checkout/i.test(rawCmd)) {
      return { actionText: "Checking out task", filePath: null, terminalLine: `$ [api] checkout task` };
    }

    // Detect test commands
    const testCmdMatch = rawCmd.match(/\b((?:npm|pnpm|yarn)\s+(?:run\s+)?test(?::[a-z0-9_-]+)?|node\s+--test[^\n;&|]*|npx\s+(?:vitest|jest|playwright)[^\n;&|]*|pytest[^\n;&|]*)/i);
    if (testCmdMatch) {
      const shortTest = testCmdMatch[1].replace(/\s+/g, " ").trim();
      const display = shortTest.length > 26 ? `${shortTest.slice(0, 26)}…` : shortTest;
      return { actionText: `Running ${display}`, filePath: null, terminalLine: `$ ${shortTest.slice(0, 90)}` };
    }

    // Detect git commands
    const gitMatch = rawCmd.match(/\b(git\s+[a-z-]+(?:\s+[^\n;&|]{0,24})?)/i);
    if (gitMatch) {
      const shortGit = gitMatch[1].replace(/\s+/g, " ").trim();
      const display = shortGit.length > 26 ? `${shortGit.slice(0, 26)}…` : shortGit;
      return { actionText: `Running ${display}`, filePath: null, terminalLine: `$ ${shortGit.slice(0, 90)}` };
    }

    // Detect node/python script execution
    const cleaned = firstLine
      .replace(/^(?:cd\s+[^;&|]+(?:&&|;)\s*)+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const shortCmd = cleaned.length > 26 ? `${cleaned.slice(0, 26)}…` : cleaned;
    return {
      actionText: shortCmd ? `Running ${shortCmd}` : "Running terminal command",
      filePath: null,
      terminalLine: `$ ${(cleaned || firstLine || "bash").slice(0, 90)}`,
    };
  }

  if (name === "webfetch" || name === "websearch" || name === "browser") {
    return { actionText: "Browsing web", filePath: null, terminalLine: `$ [${name}] fetching resource` };
  }

  if (name === "task" || name === "subagent" || name === "todowrite") {
    return { actionText: name === "todowrite" ? "Updating task plan" : "Delegating subtask", filePath: null, terminalLine: `$ [${name}]` };
  }

  return { actionText: `Using ${toolName}`, filePath: filePath || null, terminalLine: `$ [${name}]` };
}

function randomId() {
  return randomUUID().replace(/-/g, "");
}

function sessionKeyFor(agentId) {
  return `agent:${agentId}:${MAIN_KEY}`;
}

function getHistory(sessionKey) {
  if (!conversationHistory.has(sessionKey)) {
    conversationHistory.set(sessionKey, []);
  }
  return conversationHistory.get(sessionKey);
}

function resOk(id, payload) {
  return { type: "res", id, ok: true, payload: payload ?? {} };
}

function resErr(id, code, message) {
  return { type: "res", id, ok: false, error: { code, message } };
}

function broadcastEvent(frame) {
  for (const send of activeSendEventFns) {
    try {
      send(frame);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Paperclip REST API Client
// ---------------------------------------------------------------------------
async function fetchPaperclipJson(endpoint, options = {}) {
  const url = `${PAPERCLIP_API}${endpoint}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Paperclip API ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.warn(`[paperclip-adapter] Request to ${url} failed:`, err.message);
    return null;
  }
}

async function getActiveCompanyId() {
  if (cachedCompanyId) return cachedCompanyId;
  const companies = await fetchPaperclipJson("/companies");
  if (Array.isArray(companies) && companies.length > 0) {
    cachedCompanyId = companies[0].id;
    if (companies[0].name) {
      cachedCompanyName = String(companies[0].name).toUpperCase();
    }
    return cachedCompanyId;
  }
  return null;
}

async function syncPaperclipAgents() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return cachedAgents;

  const rawAgents = await fetchPaperclipJson(`/companies/${companyId}/agents`);
  if (Array.isArray(rawAgents) && rawAgents.length > 0) {
    cachedAgents = rawAgents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.title || a.role || "Agent",
      fullName: a.name,
      workspace: `/paperclip/${a.urlKey || a.id}`,
      status: a.status || "idle",
      adapterType: a.adapterType || "opencode_local",
      model: a.adapterConfig?.model || "google/gemini-3.6-flash",
      identity: {
        name: a.name,
        emoji: a.role === "ceo" ? "👔" : a.role === "engineer" ? "💻" : a.role === "qa" ? "🧪" : a.role === "pm" ? "📊" : "🤖",
      },
    }));
  }
  lastPollAt = Date.now();
  return cachedAgents;
}

async function syncPaperclipIssues() {
  if (Date.now() - lastIssuesFetchAt < 4000 && cachedIssues.length > 0) {
    return cachedIssues;
  }
  const companyId = await getActiveCompanyId();
  if (!companyId) return cachedIssues;
  const issues = await fetchPaperclipJson(`/companies/${companyId}/issues`);
  if (Array.isArray(issues)) {
    cachedIssues = issues;
    lastIssuesFetchAt = Date.now();
  }
  return cachedIssues;
}

const agentContextCache = new Map();

async function getAgentContext(agentId) {
  const cached = agentContextCache.get(agentId);
  if (cached && Date.now() - cached.ts < 3500) {
    return cached.data;
  }

  const agent = cachedAgents.find((a) => a.id === agentId);
  const roleName = ((agent?.name || "") + " " + (agent?.role || "")).toLowerCase();
  const agentIssues = cachedIssues.filter((i) => i.assigneeAgentId === agentId);
  const inProgressIssue = agentIssues.find((i) => i.status === "in_progress");
  const isRunning = cachedLiveRuns.some((r) => r.agentId === agentId);
  const isAgentActive = Boolean(inProgressIssue || isRunning);
  const activeIssue = inProgressIssue || agentIssues[0] || cachedIssues[0];

  const companyId = await getActiveCompanyId();

  // 1. Resolve workspace directory dynamically from Paperclip API
  let workspaceDir = null;
  if (activeIssue?.id) {
    try {
      const wsRes = await fetchPaperclipJson(`/issues/${activeIssue.id}/workspace`);
      if (wsRes?.workspace?.cwd && fs.existsSync(wsRes.workspace.cwd)) {
        workspaceDir = wsRes.workspace.cwd;
      }
    } catch {}
  }

  if (!workspaceDir && companyId && activeIssue?.id) {
    const candidate = path.join(
      process.env.USERPROFILE || "",
      ".paperclip",
      "instances",
      "default",
      "isolated-workspaces",
      companyId,
      activeIssue.id
    );
    if (fs.existsSync(candidate)) {
      workspaceDir = candidate;
    }
  }

  if (workspaceDir && fs.existsSync(path.join(workspaceDir, "repo"))) {
    workspaceDir = path.join(workspaceDir, "repo");
  }

  // 2. Scan workspace files dynamically
  let foundFiles = [];
  if (workspaceDir && fs.existsSync(workspaceDir)) {
    try {
      function scanDir(dir, depth = 0) {
        if (depth > 2) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile()) {
            const relPath = path.relative(workspaceDir, fullPath).replace(/\\/g, "/");
            foundFiles.push({ name: entry.name, relativePath: relPath, fullPath });
          } else if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          }
        }
      }
      scanDir(workspaceDir);
    } catch {}
  }

  // Check if workspace files were created in isolated-workspaces/<companyId>/<identifier>
  if (foundFiles.length === 0 && companyId && activeIssue?.identifier) {
    const idDir = path.join(
      process.env.USERPROFILE || "",
      ".paperclip",
      "instances",
      "default",
      "isolated-workspaces",
      companyId,
      activeIssue.identifier,
    );
    if (fs.existsSync(idDir)) {
      workspaceDir = idDir;
      try {
        function scanIdDir(dir, depth = 0) {
          if (depth > 2) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile()) {
              const relPath = path.relative(workspaceDir, fullPath).replace(/\\/g, "/");
              foundFiles.push({ name: entry.name, relativePath: relPath, fullPath });
            } else if (entry.isDirectory()) {
              scanIdDir(fullPath, depth + 1);
            }
          }
        }
        scanIdDir(workspaceDir);
      } catch {}
    }
  }

  // Fallback to Paperclip file-resources API if local filesystem scan found nothing
  if (foundFiles.length === 0 && activeIssue?.id) {
    try {
      const listRes = await fetchPaperclipJson(`/issues/${activeIssue.id}/file-resources/list?path=repo`);
      if (Array.isArray(listRes?.items)) {
        foundFiles = listRes.items
          .filter((it) => it.kind === "file")
          .map((it) => ({
            name: it.title,
            relativePath: it.relativePath,
            fullPath: null,
          }));
      }
    } catch {}
  }

  // 3. Select the best file for this agent (prefer real active file from live tool calls first!)
  let targetFile = null;
  const liveActivity = liveAgentActivity.get(agentId) || null;
  if (isAgentActive && liveActivity?.filePath) {
    const normalizedLive = liveActivity.filePath.replace(/\\/g, "/").toLowerCase();
    const liveBase = extractFileBasename(liveActivity.filePath).toLowerCase();
    targetFile =
      foundFiles.find((f) => f.fullPath && f.fullPath.replace(/\\/g, "/").toLowerCase() === normalizedLive) ||
      foundFiles.find((f) => f.relativePath.toLowerCase() === normalizedLive) ||
      foundFiles.find((f) => f.name.toLowerCase() === liveBase) ||
      (fs.existsSync(liveActivity.filePath)
        ? {
            name: extractFileBasename(liveActivity.filePath),
            relativePath:
              workspaceDir && liveActivity.filePath.toLowerCase().startsWith(workspaceDir.toLowerCase())
                ? path.relative(workspaceDir, liveActivity.filePath).replace(/\\/g, "/")
                : extractFileBasename(liveActivity.filePath),
            fullPath: liveActivity.filePath,
          }
        : null);
  }
  if (!targetFile) {
    if (roleName.includes("qa") || roleName.includes("test")) {
      targetFile =
        foundFiles.find((f) => /\.spec\.|\.test\.|a11y/i.test(f.name)) ||
        foundFiles.find((f) => /\.(js|ts|jsx|tsx)$/i.test(f.name));
    } else if (roleName.includes("dev") || roleName.includes("engineer") || roleName.includes("code")) {
      targetFile =
        foundFiles.find((f) => /\.(js|ts|jsx|tsx|css|html|py)$/i.test(f.name) && !/\.spec\.|\.test\./i.test(f.name)) ||
        foundFiles.find((f) => /\.(js|ts|jsx|tsx)$/i.test(f.name));
    } else {
      targetFile =
        foundFiles.find((f) => /\.(md|markdown|txt|json)$/i.test(f.name)) ||
        foundFiles[0];
    }
  }

  if (!targetFile && foundFiles.length > 0) {
    targetFile = foundFiles[0];
  }

  // 4. Read real file content
  let realCode = "";
  const resolvedFileName = targetFile ? targetFile.relativePath : "workbench.js";
  if (targetFile?.fullPath && fs.existsSync(targetFile.fullPath)) {
    try {
      realCode = fs.readFileSync(targetFile.fullPath, "utf8");
    } catch {}
  } else if (targetFile?.relativePath && activeIssue?.id) {
    try {
      const fileContentRes = await fetchPaperclipJson(
        `/issues/${activeIssue.id}/file-resources/content?path=${encodeURIComponent(targetFile.relativePath)}`
      );
      if (fileContentRes?.content?.data) {
        realCode = fileContentRes.content.data;
      }
    } catch {}
  }

  if (!realCode) {
    realCode = `// ${resolvedFileName}\n// Task: ${activeIssue ? activeIssue.identifier + " - " + activeIssue.title : "Ready"}\n// Status: ${activeIssue ? activeIssue.status : "idle"}\n`;
  }

  // 5. Language detection
  const ext = path.extname(resolvedFileName).toLowerCase();
  const languageMap = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".css": "css",
    ".html": "html",
    ".json": "json",
    ".md": "markdown",
    ".py": "python",
    ".sh": "bash",
  };
  const language = languageMap[ext] || "javascript";

  // 6. Dynamic terminal lines from real heartbeat run logs (formatted cleanly from OpenCode NDJSON)
  let terminalLines = [];
  if (companyId) {
    try {
      const runs = await fetchPaperclipJson(`/companies/${companyId}/heartbeat-runs?limit=10`);
      const agentRun = (Array.isArray(runs) ? runs : []).find((r) => r.agentId === agentId);
      if (agentRun) {
        const totalBytes = Number(agentRun.lastOutputBytes || agentRun.logBytes || 0);
        const offset = totalBytes > 200000 ? totalBytes - 200000 : 0;
        const logRes = await fetchPaperclipJson(`/heartbeat-runs/${agentRun.id}/log?offset=${offset}&limitBytes=262144`);
        if (logRes?.content) {
          const parsedLines = [];
          for (const rawLine of logRes.content.split("\n")) {
            if (!rawLine.trim()) continue;
            try {
              const obj = JSON.parse(rawLine);
              if (obj.chunk) {
                for (const c of obj.chunk.split(/\r?\n/)) {
                  const trimmed = c.trim();
                  if (!trimmed || trimmed.includes("[paperclip] Failed to inject")) continue;
                  if (trimmed.startsWith("{")) {
                    try {
                      const ev = JSON.parse(trimmed);
                      const tsNum = typeof ev.timestamp === "number" ? ev.timestamp : (obj.ts ? new Date(obj.ts).getTime() : null);
                      const timeStr = tsNum ? new Date(tsNum).toLocaleTimeString("vi-VN", { hour12: false }) : null;
                      const timePrefix = timeStr ? `[${timeStr}] ` : "";

                      if (ev.type === "tool_use" && ev.part?.tool) {
                        const described = describeToolAction(ev.part.tool, ev.part.state?.input);
                        if (described.terminalLine) parsedLines.push(`${timePrefix}${described.terminalLine}`);
                      } else if (ev.type === "text" && typeof ev.part?.text === "string" && ev.part.text.trim()) {
                        const first = ev.part.text.trim().split(/\r?\n/)[0].slice(0, 90);
                        if (first) parsedLines.push(`${timePrefix}> ${first}`);
                      }
                    } catch {}
                  } else {
                    parsedLines.push(trimmed.startsWith("$") ? trimmed : `$ ${trimmed.slice(0, 100)}`);
                  }
                }
              }
            } catch {}
          }
          if (parsedLines.length > 0) {
            terminalLines = parsedLines.slice(-50);
          }
        }
      }
    } catch {}
  }

  if (terminalLines.length === 0) {
    if (activeIssue) {
      terminalLines = [
        `$ paperclip issue view ${activeIssue.identifier}`,
        `$ task: ${activeIssue.title}`,
        `$ status: ${activeIssue.status}`,
        isAgentActive ? `$ agent running task ${activeIssue.identifier}...` : `$ standing by for next task`,
      ];
    } else {
      terminalLines = [
        `$ paperclip agent status`,
        `$ status: idle`,
        `$ ready for tasks`,
      ];
    }
  }

  const result = {
    fileName: resolvedFileName,
    language,
    taskTitle: activeIssue ? `${activeIssue.identifier}: ${activeIssue.title}` : "Ready for tasks",
    taskDesc: activeIssue?.description ? activeIssue.description.slice(0, 160) : "Standing by for instructions.",
    codeSnippet: realCode,
    terminalLines,
    status: activeIssue?.status || (isRunning ? "in_progress" : "done"),
    isAgentActive,
    actionText: isAgentActive && liveActivity?.actionText ? liveActivity.actionText : null,
  };

  agentContextCache.set(agentId, { ts: Date.now(), data: result });
  return result;
}

async function fetchPaperclipModels() {
  if (cachedModels.length > 0 && Date.now() - lastModelsFetchAt < 60_000) {
    return cachedModels;
  }
  const companyId = await getActiveCompanyId();
  if (!companyId) return cachedModels;

  const adapterType = cachedAgents[0]?.adapterType || "opencode_local";
  const rawModels = await fetchPaperclipJson(`/companies/${companyId}/adapters/${adapterType}/models`);
  if (Array.isArray(rawModels) && rawModels.length > 0) {
    cachedModels = rawModels.map((m) => {
      const id = typeof m === "string" ? m : m.id;
      const label = typeof m === "object" && m.label ? m.label : id;
      const provider = id.includes("/") ? id.split("/")[0] : "paperclip";
      return {
        id,
        name: label,
        provider,
      };
    });
    lastModelsFetchAt = Date.now();
  }
  return cachedModels;
}

function agentListPayload() {
  if (cachedAgents.length === 0) {
    return [
      { id: "ceo-agent", name: "CEO", role: "Executive", workspace: "/paperclip/ceo", identity: { name: "CEO", emoji: "👔" } },
      { id: "dev-agent", name: "Developer", role: "Engineer", workspace: "/paperclip/dev", identity: { name: "Developer", emoji: "💻" } },
      { id: "ba-agent", name: "Business Analyst", role: "PM", workspace: "/paperclip/ba", identity: { name: "BA", emoji: "📊" } },
      { id: "qa-agent", name: "QA Engineer", role: "QA", workspace: "/paperclip/qa", identity: { name: "QA", emoji: "🧪" } },
      { id: "reviewer-agent", name: "Code Reviewer", role: "Reviewer", workspace: "/paperclip/reviewer", identity: { name: "Reviewer", emoji: "🔍" } },
    ];
  }
  return cachedAgents;
}

// ---------------------------------------------------------------------------
// Method Dispatcher
// ---------------------------------------------------------------------------
async function handleMethod(method, params, id, sendEvent) {
  const p = params || {};

  switch (method) {
    case "agents.list": {
      await syncPaperclipAgents();
      const agents = agentListPayload();
      const defaultId = agents[0]?.id || "ceo-agent";
      return resOk(id, { defaultId, mainKey: MAIN_KEY, agents });
    }

    case "config.get":
      return resOk(id, {
        config: { gateway: { reload: { mode: "hot" } } },
        hash: "paperclip-gateway",
        exists: true,
        path: "/paperclip/config.json",
      });

    case "config.patch":
    case "config.set":
      return resOk(id, { hash: "paperclip-gateway" });

    case "exec.approvals.get":
      return resOk(id, {
        path: "",
        exists: true,
        hash: "paperclip-approvals",
        file: { version: 1, defaults: { security: "full", ask: "off", autoAllowSkills: true }, agents: {} },
      });

    case "exec.approvals.set":
    case "exec.approval.resolve":
      return resOk(id, { ok: true });

    case "models.list": {
      const models = await fetchPaperclipModels();
      if (models.length > 0) {
        return resOk(id, { models });
      }
      return resOk(id, {
        models: [
          { id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash", provider: "google" },
          { id: "anthropic/claude-3-7-sonnet", name: "Claude 3.7 Sonnet", provider: "anthropic" },
          { id: "openai/gpt-4o", name: "GPT-4o", provider: "openai" },
        ],
      });
    }

    case "skills.status":
      return resOk(id, { skills: [] });

    case "cron.list":
      return resOk(id, { jobs: [] });

    case "sessions.list": {
      const agents = agentListPayload();
      const sessions = agents.map((agent) => {
        const sessionKey = sessionKeyFor(agent.id);
        const history = getHistory(sessionKey);
        const isRunning = cachedLiveRuns.some((r) => r.agentId === agent.id);
        const currentSetting = sessionSettings.get(sessionKey);
        const agentModel = currentSetting?.model || agent.model || "google/gemini-3.6-flash";
        const provider = agentModel.includes("/") ? agentModel.split("/")[0] : "paperclip";
        return {
          key: sessionKey,
          agentId: agent.id,
          updatedAt: isRunning ? Date.now() : history.length > 0 ? Date.now() : null,
          displayName: "Main",
          origin: { label: agent.name, provider: "paperclip" },
          model: agentModel,
          modelProvider: provider,
          thinkingLevel: currentSetting?.thinkingLevel || null,
        };
      });
      return resOk(id, { sessions });
    }

    case "sessions.preview": {
      await syncPaperclipIssues();
      const keys = Array.isArray(p.keys) ? p.keys : [];
      const limit = typeof p.limit === "number" ? p.limit : 8;
      const maxChars = typeof p.maxChars === "number" ? p.maxChars : 600;
      const previews = await Promise.all(
        keys.map(async (key) => {
          const match = key.match(/^agent:([^:]+):/);
          const agentId = match ? match[1] : null;
          if (agentId) {
            const ctx = await getAgentContext(agentId);
            return {
              key,
              status: "ok",
              items: [
                {
                  role: "user",
                  text: `${ctx.taskTitle}: ${ctx.taskDesc}`,
                  timestamp: Date.now() - 120000,
                },
                {
                  role: "assistant",
                  text: ctx.isAgentActive
                    ? `${ctx.actionText || `Editing \`${ctx.fileName}\``}:\n\`\`\`${ctx.language || "javascript"}\n${ctx.codeSnippet}\n\`\`\`\n${ctx.terminalLines.join("\n")}`
                    : `Standing by. Ready for tasks.\n\`\`\`${ctx.language || "javascript"}\n${ctx.codeSnippet}\n\`\`\`\n${ctx.terminalLines.join("\n")}`,
                  timestamp: Date.now(),
                },
              ],
            };
          }
          const history = getHistory(key);
          if (history.length === 0) return { key, status: "empty", items: [] };
          const items = history.slice(-limit).map((msg) => ({
            role: msg.role === "assistant" ? "assistant" : "user",
            text: String(msg.content || "").slice(0, maxChars),
            timestamp: Date.now(),
          }));
          return { key, status: "ok", items };
        })
      );
      if (knownActiveRuns.size > 0 && typeof sendEvent === "function") {
        setTimeout(() => replayActiveRunsToClient(sendEvent), 350);
      }
      return resOk(id, { ts: Date.now(), previews });
    }

    case "sessions.patch": {
      const key = typeof p.key === "string" ? p.key : "";
      if (key) {
        const current = sessionSettings.get(key) || {};
        if (p.model !== undefined) current.model = p.model || null;
        if (p.thinkingLevel !== undefined) current.thinkingLevel = p.thinkingLevel || null;
        sessionSettings.set(key, current);
        console.log(`[GatewayAdapter] Updated session settings for ${key}:`, current);
      }
      return resOk(id, { ok: true });
    }

    case "sessions.reset": {
      const key = typeof p.key === "string" ? p.key : "";
      if (key) {
        conversationHistory.delete(key);
        sessionSettings.delete(key);
      }
      return resOk(id, { ok: true });
    }

    case "chat.send": {
      const sessionKey = typeof p.sessionKey === "string" ? p.sessionKey : sessionKeyFor("default");
      const agentId = sessionKey.startsWith("agent:") ? sessionKey.split(":")[1] : "default";
      const agents = agentListPayload();
      const agent = agents.find((a) => a.id === agentId) || agents[0];
      const message = typeof p.message === "string" ? p.message.trim() : String(p.message || "").trim();
      const runId = typeof p.idempotencyKey === "string" && p.idempotencyKey ? p.idempotencyKey : randomId();
      if (!message) return resOk(id, { status: "no-op", runId });

      // Build model & reasoning effort override if configured for this session
      const sessionSetting = sessionSettings.get(sessionKey);
      let assigneeAdapterOverrides = null;
      if (sessionSetting && sessionSetting.model) {
        const adapterConfig = {
          model: sessionSetting.model,
        };
        if (sessionSetting.thinkingLevel) {
          const adapterType = agent?.adapterType || "opencode_local";
          if (adapterType === "opencode_local") {
            adapterConfig.variant = sessionSetting.thinkingLevel;
          } else if (adapterType === "codex_local" || adapterType === "paperclip_runner") {
            adapterConfig.modelReasoningEffort = sessionSetting.thinkingLevel;
          } else if (adapterType === "claude_local" || adapterType === "kimi_local") {
            adapterConfig.effort = sessionSetting.thinkingLevel;
          } else if (adapterType === "grok_local") {
            adapterConfig.reasoningEffort = sessionSetting.thinkingLevel;
          } else if (adapterType === "pi_local") {
            adapterConfig.thinking = sessionSetting.thinkingLevel;
          }
        }
        assigneeAdapterOverrides = { adapterConfig };
        console.log(`[GatewayAdapter] Forwarding task to Paperclip with model override for ${agent?.name}:`, assigneeAdapterOverrides);
      }

      // Forward task/instruction to Paperclip if applicable
      const companyId = await getActiveCompanyId();
      let paperclipIssueCreated = null;
      if (companyId) {
        const payload = {
          title: `Task for ${agent?.name || "Agent"}: ${message.slice(0, 80)}`,
          description: message,
          assigneeAgentId: agentId,
        };
        if (assigneeAdapterOverrides) {
          payload.assigneeAdapterOverrides = assigneeAdapterOverrides;
        }
        paperclipIssueCreated = await fetchPaperclipJson(`/companies/${companyId}/issues`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      const modelNote = sessionSetting?.model ? ` [Model: ${sessionSetting.model}]` : "";
      const reply = paperclipIssueCreated
        ? `[Paperclip Issue #${paperclipIssueCreated.identifier || "NEW"}] Received by ${agent.name}${modelNote}. Dispatching workflow execution...`
        : `[${agent.name}] Received: "${message}"${modelNote}. Coordinating with Paperclip control plane.`;

      let aborted = false;
      activeRuns.set(runId, {
        runId,
        sessionKey,
        agentId,
        abort() {
          aborted = true;
        },
      });

      setImmediate(async () => {
        let seq = 0;
        const emitChat = (state, extra) => {
          sendEvent({
            type: "event",
            event: "chat",
            seq: seq++,
            payload: { runId, sessionKey, state, ...extra },
          });
        };

        try {
          const words = reply.split(" ");
          let partial = "";
          for (const word of words) {
            if (aborted) break;
            partial = partial ? `${partial} ${word}` : word;
            emitChat("delta", { message: { role: "assistant", content: partial } });
            await new Promise((resolve) => setTimeout(resolve, 35));
          }

          if (aborted) {
            emitChat("aborted", {});
            return;
          }

          const history = getHistory(sessionKey);
          history.push({ role: "user", content: message });
          history.push({ role: "assistant", content: reply });
          emitChat("final", { stopReason: "end_turn", message: { role: "assistant", content: reply } });

          sendEvent({
            type: "event",
            event: "presence",
            seq: seq++,
            payload: {
              sessions: {
                recent: [{ key: sessionKey, updatedAt: Date.now() }],
                byAgent: [{ agentId, recent: [{ key: sessionKey, updatedAt: Date.now() }] }],
              },
            },
          });
        } finally {
          activeRuns.delete(runId);
        }
      });

      return resOk(id, { status: "started", runId });
    }

    case "chat.abort": {
      const runId = typeof p.runId === "string" ? p.runId.trim() : "";
      if (runId && activeRuns.has(runId)) {
        activeRuns.get(runId).abort();
        activeRuns.delete(runId);
      }
      return resOk(id, { ok: true });
    }

    case "chat.history": {
      await syncPaperclipIssues();
      const sessionKey = typeof p.sessionKey === "string" ? p.sessionKey : sessionKeyFor("default");
      const match = sessionKey.match(/^agent:([^:]+):/);
      const agentId = match ? match[1] : null;
      const history = getHistory(sessionKey);
      if (agentId) {
        const ctx = await getAgentContext(agentId);
        const dynamicMessages = [
          { role: "user", content: `${ctx.taskTitle}\n\n${ctx.taskDesc}` },
          {
            role: "assistant",
            content: ctx.isAgentActive
              ? `${ctx.actionText || `Editing \`${ctx.fileName}\``}:\n\n\`\`\`${ctx.language || "javascript"}\n${ctx.codeSnippet}\n\`\`\`\n\n${ctx.terminalLines.join("\n")}`
              : `Standing by. Ready for tasks.\n\n\`\`\`${ctx.language || "javascript"}\n${ctx.codeSnippet}\n\`\`\`\n\n${ctx.terminalLines.join("\n")}`,
          },
        ];
        return resOk(id, {
          sessionKey,
          messages: [...history, ...dynamicMessages],
        });
      }
      return resOk(id, { sessionKey, messages: history });
    }

    case "agent.wait": {
      const runId = typeof p.runId === "string" ? p.runId : "";
      const timeoutMs = typeof p.timeoutMs === "number" ? p.timeoutMs : 15000;
      const start = Date.now();
      while (activeRuns.has(runId) && Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return resOk(id, { status: activeRuns.has(runId) ? "running" : "done" });
    }

    case "status": {
      const agents = agentListPayload();
      const byAgent = agents.map((a) => {
        const isRunning = cachedLiveRuns.some((r) => r.agentId === a.id);
        return {
          agentId: a.id,
          recent: [{ key: sessionKeyFor(a.id), updatedAt: isRunning ? Date.now() : null }],
        };
      });
      const recent = byAgent
        .filter((b) => b.recent[0].updatedAt !== null)
        .map((b) => b.recent[0]);
      return resOk(id, {
        sessions: {
          recent,
          byAgent,
        },
      });
    }

    case "wake":
      return resOk(id, { ok: true });

    default:
      return resOk(id, {});
  }
}

// ---------------------------------------------------------------------------
// Background Live Telemetry Poller (Paperclip ➔ Claw3D)
// ---------------------------------------------------------------------------
// Paperclip Polling & Lifecycle Bridge
// ---------------------------------------------------------------------------
const knownActiveRuns = new Map();
const runLogState = new Map(); // runId -> { offset: number, recentEvents: Array<object> }

function compactToolInput(toolName, rawInput) {
  if (!rawInput || typeof rawInput !== "object") return rawInput ?? {};
  const out = {};
  for (const [k, v] of Object.entries(rawInput)) {
    if (k === "content" && typeof v === "string" && v.length > 120) {
      out[k] = `${v.slice(0, 100)}… (${v.length} chars)`;
    } else if ((k === "oldString" || k === "newString") && typeof v === "string" && v.length > 100) {
      out[k] = `${v.slice(0, 80)}…`;
    } else if (typeof v === "string" && v.length > 220) {
      out[k] = `${v.slice(0, 220)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseLogChunkToAgentEvents(runId, agentId, content, skipFirstPartialLine) {
  const sessionKey = sessionKeyFor(agentId);
  const lines = content.split(/\r?\n/);
  const startIdx = skipFirstPartialLine ? 1 : 0;
  const frames = [];

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;
    let outer;
    try {
      outer = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (outer.stream !== "stdout" || typeof outer.chunk !== "string") continue;

    for (const chunkLine of outer.chunk.split(/\r?\n/)) {
      const trimmed = chunkLine.trim();
      if (!trimmed.startsWith("{")) continue;
      let ev;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (ev.type === "reasoning" && typeof ev.part?.text === "string" && ev.part.text.trim()) {
        frames.push({
          type: "event",
          event: "agent",
          payload: {
            runId,
            sessionKey,
            stream: "thinking",
            data: { text: ev.part.text.trim().slice(0, 500) },
          },
        });
      } else if (ev.type === "tool_use" && ev.part?.tool) {
        const toolName = String(ev.part.tool);
        const callId = typeof ev.part.callID === "string" ? ev.part.callID : randomId();
        const input = compactToolInput(toolName, ev.part.state?.input);
        const described = describeToolAction(toolName, ev.part.state?.input);
        const prev = liveAgentActivity.get(agentId);
        liveAgentActivity.set(agentId, {
          actionText: described.actionText,
          filePath: described.filePath || prev?.filePath || null,
          toolName,
          terminalLine: described.terminalLine,
          updatedAt: Date.now(),
        });
        agentContextCache.delete(agentId);
        frames.push({
          type: "event",
          event: "agent",
          payload: {
            runId,
            sessionKey,
            stream: "tool",
            data: {
              phase: "start",
              name: toolName,
              toolCallId: callId,
              input,
              summary: described.actionText,
            },
          },
        });
      } else if (ev.type === "text" && typeof ev.part?.text === "string" && ev.part.text.trim()) {
        frames.push({
          type: "event",
          event: "agent",
          payload: {
            runId,
            sessionKey,
            stream: "assistant",
            data: { text: ev.part.text.trim().slice(0, 600) },
          },
        });
      }
    }
  }
  return frames;
}

async function pollRunLogActivity(runId, agentId, opts = {}) {
  const { broadcast = true, initialHintBytes = 0 } = opts;
  let state = runLogState.get(runId);
  const isFirstAttach = !state;
  if (!state) {
    const startOffset = initialHintBytes > 48000 ? initialHintBytes - 48000 : 0;
    state = { offset: startOffset, recentEvents: [] };
    runLogState.set(runId, state);
  }

  const logRes = await fetchPaperclipJson(
    `/heartbeat-runs/${runId}/log?offset=${state.offset}&limitBytes=65536`,
  );
  if (!logRes || typeof logRes.content !== "string" || logRes.content.length === 0) {
    return;
  }

  const prevOffset = state.offset;
  state.offset =
    typeof logRes.nextOffset === "number" && logRes.nextOffset >= state.offset
      ? logRes.nextOffset
      : state.offset + Buffer.byteLength(logRes.content, "utf8");

  const frames = parseLogChunkToAgentEvents(
    runId,
    agentId,
    logRes.content,
    isFirstAttach && prevOffset > 0,
  );
  if (frames.length === 0) return;

  // Keep only the last 8 events in memory for replay on browser reconnect
  for (const frame of frames) {
    state.recentEvents.push(frame);
  }
  if (state.recentEvents.length > 8) {
    state.recentEvents = state.recentEvents.slice(-8);
  }

  if (broadcast) {
    // Emit at most the latest 6 new frames per poll tick so UI stays snappy
    for (const frame of frames.slice(-6)) {
      broadcastEvent(frame);
    }
  }
}

function replayActiveRunsToClient(sendEvent) {
  if (typeof sendEvent !== "function" || knownActiveRuns.size === 0) return;
  for (const [runId, agentId] of knownActiveRuns.entries()) {
    console.log(`[paperclip-gateway] Replaying active run ${runId} for agent ${agentId} to client.`);
    sendEvent({
      type: "event",
      event: "agent",
      payload: {
        runId,
        sessionKey: sessionKeyFor(agentId),
        stream: "lifecycle",
        data: { phase: "start" },
      },
    });
    const state = runLogState.get(runId);
    if (state && state.recentEvents.length > 0) {
      for (const frame of state.recentEvents.slice(-6)) {
        sendEvent(frame);
      }
    }
  }
}

async function syncPaperclipLiveRuns() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return;
  const liveRuns = await fetchPaperclipJson(`/companies/${companyId}/live-runs`);
  cachedLiveRuns = Array.isArray(liveRuns) ? liveRuns.filter((r) => r.status === "running") : [];
  if (Array.isArray(liveRuns)) {
    for (const run of liveRuns) {
      if (run.status === "running" && run.agentId) {
        if (!knownActiveRuns.has(run.id)) {
          knownActiveRuns.set(run.id, run.agentId);
        }
        await pollRunLogActivity(run.id, run.agentId, {
          broadcast: false,
          initialHintBytes: Number(run.lastOutputBytes || 0),
        });
      }
    }
  }
}

async function startPaperclipTelemetryPoller() {
  setInterval(async () => {
    try {
      const companyId = await getActiveCompanyId();
      if (!companyId) return;

      // 1. Poll live active runs from Paperclip
      const liveRuns = await fetchPaperclipJson(`/companies/${companyId}/live-runs`);
      const currentRunIds = new Set();
      cachedLiveRuns = Array.isArray(liveRuns) ? liveRuns.filter((r) => r.status === "running") : [];

      if (Array.isArray(liveRuns)) {
        for (const run of liveRuns) {
          if (run.status === "running" && run.agentId) {
            currentRunIds.add(run.id);
            if (!knownActiveRuns.has(run.id)) {
              knownActiveRuns.set(run.id, run.agentId);
              console.log(`[paperclip-gateway] Agent ${run.agentId} started run ${run.id}. Broadcasting lifecycle start.`);
              broadcastEvent({
                type: "event",
                event: "agent",
                payload: {
                  runId: run.id,
                  sessionKey: sessionKeyFor(run.agentId),
                  stream: "lifecycle",
                  data: { phase: "start" },
                },
              });
            }
            // Stream real-time tool calls, thinking traces, and assistant text from Paperclip run logs
            await pollRunLogActivity(run.id, run.agentId, {
              broadcast: true,
              initialHintBytes: Number(run.lastOutputBytes || 0),
            });
          }
        }
      }

      // 2. Broadcast lifecycle end for runs that finished
      for (const [runId, agentId] of knownActiveRuns.entries()) {
        if (!currentRunIds.has(runId)) {
          knownActiveRuns.delete(runId);
          runLogState.delete(runId);
          liveAgentActivity.delete(agentId);
          agentContextCache.delete(agentId);
          console.log(`[paperclip-gateway] Agent ${agentId} finished run ${runId}. Broadcasting lifecycle end.`);
          broadcastEvent({
            type: "event",
            event: "agent",
            payload: {
              runId,
              sessionKey: sessionKeyFor(agentId),
              stream: "lifecycle",
              data: { phase: "end" },
            },
          });
        }
      }

      // 3. Poll agent status for presence summary
      const rawAgents = await fetchPaperclipJson(`/companies/${companyId}/agents`);
      if (!Array.isArray(rawAgents)) return;

      let changed = false;
      const activeSessions = [];

      for (const a of rawAgents) {
        const isRunning =
          a.status === "running" ||
          a.status === "active" ||
          Array.from(knownActiveRuns.values()).includes(a.id);
        if (isRunning) {
          activeSessions.push({
            key: sessionKeyFor(a.id),
            updatedAt: Date.now(),
          });
          changed = true;
        }
      }

      if (changed || activeSessions.length > 0) {
        broadcastEvent({
          type: "event",
          event: "presence",
          payload: {
            sessions: {
              recent: activeSessions,
              byAgent: rawAgents.map((a) => {
                const isRunning =
                  a.status === "running" ||
                  a.status === "active" ||
                  Array.from(knownActiveRuns.values()).includes(a.id);
                return {
                  agentId: a.id,
                  recent: [{ key: sessionKeyFor(a.id), updatedAt: isRunning ? Date.now() : null }],
                };
              }),
            },
          },
        });
      }
    } catch (err) {
      // ignore poll errors
    }
  }, 1500);
}

// ---------------------------------------------------------------------------
// WebSocket Gateway Server
// ---------------------------------------------------------------------------
function startAdapter() {
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Claw3D Paperclip Gateway Adapter\n");
  });

  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws) => {
    let connected = false;
    let globalSeq = 0;

    const send = (frame) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(frame));
    };

    const sendEventFn = (frame) => {
      if (frame.type === "event" && typeof frame.seq !== "number") {
        frame.seq = globalSeq++;
      }
      send(frame);
    };

    activeSendEventFns.add(sendEventFn);
    send({ type: "event", event: "connect.challenge", payload: { nonce: randomId() } });

    ws.on("message", async (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object" || frame.type !== "req") return;
      const { id, method, params } = frame;
      if (typeof id !== "string" || typeof method !== "string") return;

      if (method === "connect") {
        connected = true;
        await syncPaperclipAgents();
        await syncPaperclipLiveRuns();
        const agents = agentListPayload();

        send({
          type: "res",
          id,
          ok: true,
          payload: {
            type: "hello-ok",
            protocol: 3,
            adapterType: "openclaw",
            features: {
              methods: [
                "agents.list",
                "sessions.list",
                "sessions.preview",
                "sessions.patch",
                "sessions.reset",
                "chat.send",
                "chat.abort",
                "chat.history",
                "agent.wait",
                "status",
                "config.get",
                "config.set",
                "config.patch",
                "exec.approvals.get",
                "exec.approvals.set",
                "exec.approval.resolve",
                "wake",
                "skills.status",
                "models.list",
                "cron.list",
              ],
              events: ["chat", "presence", "heartbeat", "agent"],
            },
            snapshot: {
              health: {
                agents: agents.map((agent, i) => ({
                  agentId: agent.id,
                  name: agent.name,
                  isDefault: i === 0,
                })),
                defaultAgentId: agents[0]?.id || "ceo-agent",
              },
              sessionDefaults: { mainKey: MAIN_KEY },
            },
            auth: { role: "operator", scopes: ["operator.admin"] },
            policy: { tickIntervalMs: 30000 },
          },
        });
        return;
      }

      if (!connected) {
        send(resErr(id, "not_connected", "Send connect first."));
        return;
      }

      try {
        send(await handleMethod(method, params, id, sendEventFn));
      } catch (error) {
        send(resErr(id, "internal_error", error instanceof Error ? error.message : "Internal error"));
      }
    });

    ws.on("close", () => activeSendEventFns.delete(sendEventFn));
    ws.on("error", () => activeSendEventFns.delete(sendEventFn));
  });

  httpServer.listen(ADAPTER_PORT, "127.0.0.1", () => {
    console.log(`[paperclip-gateway] Listening on ws://localhost:${ADAPTER_PORT}`);
    console.log(`[paperclip-gateway] Connected to Paperclip API at ${PAPERCLIP_API}`);
  });

  startPaperclipTelemetryPoller();
}

if (require.main === module) {
  startAdapter();
}

module.exports = {
  handleMethod,
  startAdapter,
};
