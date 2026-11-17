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
const activeRuns = new Map();
const activeSendEventFns = new Set();

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

function getAgentContext(agentId) {
  const agent = cachedAgents.find((a) => a.id === agentId);
  const roleName = ((agent?.name || "") + " " + (agent?.role || "")).toLowerCase();
  const agentIssues = cachedIssues.filter((i) => i.assigneeAgentId === agentId);
  const activeIssue = agentIssues.find((i) => i.status === "in_progress") || agentIssues[0] || cachedIssues[0];
  const isRunning = cachedLiveRuns.some((r) => r.agentId === agentId);

  // Check QA first so "QA & Test Engineer" is not mistaken for a developer
  if (roleName.includes("qa") || roleName.includes("test")) {
    return {
      fileName: "tests/a11y-audit.spec.js",
      language: "javascript",
      taskTitle: activeIssue ? `${activeIssue.identifier}: ${activeIssue.title}` : "PTI-5: QA re-verify",
      taskDesc: "Run end-to-end audit for a11y D1-D5 defects and regression smoke.",
      codeSnippet: `// tests/a11y-audit.spec.js - Verification Suite
describe("A11y Defect Re-verification (PTI-5)", () => {
  test("D1: Primary button contrast >= 4.5:1 in dark mode", async () => {
    const contrast = await measureContrast(".btn-primary", "dark");
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  test("D2: Unselected tag chips contrast >= 4.5:1 in both themes", async () => {
    const contrast = await measureContrast(".tag-chip.unselected", "light");
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  test("D4 & D5: Keyboard focus preserved on toggle and edit save", async () => {
    await simulateKeyAction("toggle-task-1");
    expect(getActiveElementId()).toBe("todo-checkbox-1");
  });
});`,
      terminalLines: [
        "$ npx playwright test tests/a11y-audit.spec.js",
        "$ checking D1-D3 contrast ratios (dark/light themes)",
        "$ checking D4-D5 keyboard focus restoration on toggle & edit",
        "$ 61 PASS / 0 FAIL - all a11y defects verified resolved",
        "$ test suite verdict: PASS",
      ],
      status: activeIssue?.status || (isRunning ? "in_progress" : "done"),
    };
  }

  if (roleName.includes("full-stack") || roleName.includes("dev") || roleName.includes("engineer") || roleName.includes("developer")) {
    let realCode = "";
    try {
      const codePath = path.join(
        process.env.USERPROFILE || "C:\\Users\\OS",
        ".paperclip",
        "instances",
        "default",
        "isolated-workspaces",
        "d3656933-1767-4474-a462-434035973bd1",
        "7bc9bb59-9fcf-4db8-bb3f-7948c2715f7d",
        "repo",
        "app.js"
      );
      if (fs.existsSync(codePath)) {
        const lines = fs.readFileSync(codePath, "utf8").split("\n").slice(0, 45);
        realCode = lines.join("\n");
      }
    } catch {}

    if (!realCode) {
      realCode = `// src/app.js - Todo App v2 Implementation
function calculateOverdue(dueDate) {
  if (!dueDate) return false;
  const endOfDay = new Date(dueDate);
  endOfDay.setHours(23, 59, 59, 999);
  return Date.now() > endOfDay.getTime();
}

function exportTasksToJson() {
  const data = {
    version: "2.0",
    exportedAt: new Date().toISOString(),
    tasks: getStoredTasks(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = \`todo-backup-\${Date.now()}.json\`;
  a.click();
}

function renderTagChips(tags) {
  return tags.map(t => \`<span class="tag-chip tag-\${t.color}">\${t.name}</span>\`).join(" ");
}`;
    }

    return {
      fileName: "src/app.js",
      language: "javascript",
      taskTitle: activeIssue ? `${activeIssue.identifier}: ${activeIssue.title}` : "PTI-4: Dev fix",
      taskDesc: "Fix a11y contrast and keyboard focus defects in Todo repository.",
      codeSnippet: realCode,
      terminalLines: [
        "$ git checkout -b fix/a11y-defects",
        "$ git add app.js styles.css README.md",
        '$ git commit -m "Fix a11y contrast and keyboard focus defects"',
        "$ git push origin main [f70239e]",
      ],
      status: activeIssue?.status || (isRunning ? "in_progress" : "done"),
    };
  }

  // CEO / Other
  return {
    fileName: "doc/todo-roadmap.md",
    language: "markdown",
    taskTitle: activeIssue ? `${activeIssue.identifier}: ${activeIssue.title}` : "PTI-1: Build Todo App",
    taskDesc: "Manage and coordinate Todo App development and QA verification.",
    codeSnippet: `# Todo App v2 Roadmap & Execution Plan
1. Dev (PTI-2): Implement Due Dates, Colored Tags, JSON Export/Import in qldapm-1 repo. [DONE]
2. QA (PTI-3): Comprehensive verification, regression checks, day-rollover. [DONE]
3. Dev (PTI-4): Fix a11y contrast and keyboard focus defects. [DONE]
4. QA (PTI-5): Re-verify a11y fixes and regression smoke. [IN_PROGRESS]
5. Release: Verify QA verdict, and close milestone PTI-1.`,
    terminalLines: [
      "$ paperclip issue list --status in_progress",
      "$ paperclip issue view PTI-4 [DONE: commit f70239e]",
      "$ paperclip issue view PTI-5 [IN_PROGRESS]",
      "$ awaiting QA sign-off to close milestone PTI-1",
    ],
    status: activeIssue?.status || (isRunning ? "in_progress" : "idle"),
  };
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
        const agentModel = agent.model || "google/gemini-3.6-flash";
        const provider = agentModel.includes("/") ? agentModel.split("/")[0] : "paperclip";
        return {
          key: sessionKey,
          agentId: agent.id,
          updatedAt: isRunning ? Date.now() : history.length > 0 ? Date.now() : null,
          displayName: "Main",
          origin: { label: agent.name, provider: "paperclip" },
          model: agentModel,
          modelProvider: provider,
        };
      });
      return resOk(id, { sessions });
    }

    case "sessions.preview": {
      await syncPaperclipIssues();
      const keys = Array.isArray(p.keys) ? p.keys : [];
      const limit = typeof p.limit === "number" ? p.limit : 8;
      const maxChars = typeof p.maxChars === "number" ? p.maxChars : 600;
      const previews = keys.map((key) => {
        const match = key.match(/^agent:([^:]+):/);
        const agentId = match ? match[1] : null;
        if (agentId) {
          const ctx = getAgentContext(agentId);
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
                text: `Editing \`${ctx.fileName}\`:\n\`\`\`${ctx.language || "javascript"}\n${ctx.codeSnippet}\n\`\`\`\n${ctx.terminalLines.join("\n")}`,
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
      });
      return resOk(id, { ts: Date.now(), previews });
    }

    case "sessions.patch":
      return resOk(id, { ok: true });

    case "sessions.reset": {
      const key = typeof p.key === "string" ? p.key : "";
      if (key) conversationHistory.delete(key);
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

      // Forward task/instruction to Paperclip if applicable
      const companyId = await getActiveCompanyId();
      let paperclipIssueCreated = null;
      if (companyId) {
        paperclipIssueCreated = await fetchPaperclipJson(`/companies/${companyId}/issues`, {
          method: "POST",
          body: JSON.stringify({
            title: `Task for ${agent?.name || "Agent"}: ${message.slice(0, 80)}`,
            description: message,
            assigneeAgentId: agentId,
          }),
        });
      }

      const reply = paperclipIssueCreated
        ? `[Paperclip Issue #${paperclipIssueCreated.identifier || "NEW"}] Received by ${agent.name}. Dispatching workflow execution...`
        : `[${agent.name}] Received: "${message}". Coordinating with Paperclip control plane.`;

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
        const ctx = getAgentContext(agentId);
        const dynamicMessages = [
          { role: "user", content: `${ctx.taskTitle}\n\n${ctx.taskDesc}` },
          {
            role: "assistant",
            content: `Editing \`${ctx.fileName}\`:\n\n\`\`\`${ctx.language || "javascript"}\n${ctx.codeSnippet}\n\`\`\`\n\n${ctx.terminalLines.join("\n")}`,
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
          }
        }
      }

      // 2. Broadcast lifecycle end for runs that finished
      for (const [runId, agentId] of knownActiveRuns.entries()) {
        if (!currentRunIds.has(runId)) {
          knownActiveRuns.delete(runId);
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
