"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shouldPreferBrowserScreenshot } from "@/lib/office/browserPreview";
import type { OfficeDeskMonitor } from "@/lib/office/deskMonitor";

type BrowserPreviewSnapshot = {
  mediaUrl: string | null;
  browserUrl: string | null;
  error: string | null;
  loading: boolean;
  capturedAt: number | null;
};

const BROWSER_EMBED_FALLBACK_MS = 2500;

function useBrowserPreviewScreenshot(params: {
  browserUrl: string | null;
  enabled: boolean;
  live: boolean;
}) {
  const { browserUrl, enabled, live } = params;
  const [snapshot, setSnapshot] = useState<BrowserPreviewSnapshot>({
    mediaUrl: null,
    browserUrl: browserUrl ?? null,
    error: null,
    loading: false,
    capturedAt: null,
  });
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !browserUrl) {
      requestIdRef.current += 1;
      setSnapshot({
        mediaUrl: null,
        browserUrl: browserUrl ?? null,
        error: null,
        loading: false,
        capturedAt: null,
      });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSnapshot((current) => ({
      ...current,
      browserUrl,
      error: null,
      loading: true,
    }));

    try {
      const params = new URLSearchParams({
        url: browserUrl,
        ts: String(Date.now()),
      });
      const response = await fetch(`/api/office/browser-preview?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        error?: string;
        mediaUrl?: string;
        browserUrl?: string;
        capturedAt?: number;
      };

      if (!response.ok) {
        throw new Error(payload.error?.trim() || "Unable to capture browser preview.");
      }
      if (requestIdRef.current !== requestId) return;

      setSnapshot({
        mediaUrl: payload.mediaUrl?.trim() || null,
        browserUrl: payload.browserUrl?.trim() || browserUrl,
        error: null,
        loading: false,
        capturedAt:
          typeof payload.capturedAt === "number" ? payload.capturedAt : Date.now(),
      });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setSnapshot((current) => ({
        ...current,
        browserUrl,
        error:
          error instanceof Error ? error.message : "Unable to capture browser preview.",
        loading: false,
      }));
    }
  }, [browserUrl, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !browserUrl) return;
    const intervalMs = live ? 7_000 : 12_000;
    const intervalId = window.setInterval(() => {
      void refresh();
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [browserUrl, enabled, live, refresh]);

  return {
    ...snapshot,
    refresh,
  };
}

function MonitorBrowserContent({
  monitor,
  browserUrl,
  prefersScreenshot,
  onSwitchToCode,
}: {
  monitor: OfficeDeskMonitor;
  browserUrl: string;
  prefersScreenshot: boolean;
  onSwitchToCode?: () => void;
}) {
  const [browserView, setBrowserView] = useState<"embed" | "screenshot">(
    prefersScreenshot ? "screenshot" : "embed",
  );
  const [allowAutoFallback, setAllowAutoFallback] = useState(!prefersScreenshot);
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const embedFrameRef = useRef<HTMLIFrameElement | null>(null);
  const browserPreview = useBrowserPreviewScreenshot({
    browserUrl,
    enabled: true,
    live: monitor.live,
  });

  useEffect(() => {
    if (
      prefersScreenshot ||
      browserView !== "embed" ||
      embedLoaded ||
      !allowAutoFallback
    ) {
      return;
    }
    if (browserPreview.error || (!browserPreview.loading && !browserPreview.mediaUrl)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAllowAutoFallback(false);
      setBrowserView((current) => (current === "embed" ? "screenshot" : current));
    }, BROWSER_EMBED_FALLBACK_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    allowAutoFallback,
    browserPreview.error,
    browserPreview.loading,
    browserPreview.mediaUrl,
    browserView,
    embedLoaded,
    prefersScreenshot,
  ]);

  const handleEmbedLoad = useCallback(() => {
    const frame = embedFrameRef.current;
    if (!frame) {
      setEmbedLoaded(true);
      return;
    }

    try {
      const loadedUrl = frame.contentWindow?.location?.href?.trim() ?? "";
      const loadedText = frame.contentDocument?.body?.innerText?.trim() ?? "";
      if (loadedUrl === "about:blank" && !loadedText) {
        setAllowAutoFallback(false);
        setBrowserView("screenshot");
        return;
      }
    } catch {
      // Cross-origin iframe content is expected for successful embeds.
    }

    setEmbedLoaded(true);
  }, []);

  return (
    <div className="absolute inset-0 bg-[#050809]">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#0d1117] px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="min-w-0 flex-1 truncate rounded-full border border-white/10 bg-black/30 px-4 py-2 font-mono text-[14px] text-white/70">
            {browserPreview.browserUrl ?? monitor.browserUrl}
          </div>
          {onSwitchToCode ? (
            <button
              type="button"
              onClick={onSwitchToCode}
              className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-300 transition-colors hover:bg-emerald-500/25"
            >
              💻 Code View
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setAllowAutoFallback(false);
              setEmbedLoaded(false);
              setBrowserView((current) =>
                current === "embed" ? "screenshot" : "embed",
              );
            }}
            className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-white/72 transition-colors hover:bg-white/10"
          >
            {browserView === "screenshot" ? "Live Embed" : "Screenshot"}
          </button>
          {browserView === "screenshot" ? (
            <button
              type="button"
              onClick={() => void browserPreview.refresh()}
              className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-emerald-200 transition-colors hover:bg-emerald-400/20"
            >
              Refresh Shot
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              window.open(monitor.browserUrl ?? "", "_blank", "noopener,noreferrer")
            }
            className="rounded-full border border-sky-400/25 bg-sky-400/10 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-sky-200 transition-colors hover:bg-sky-400/20"
          >
            Open Browser
          </button>
        </div>
        <div className="relative flex-1 bg-[#f4f7fb]">
          {browserView === "screenshot" ? (
            <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#0a0f12]">
              {browserPreview.mediaUrl ? (
                <Image
                  alt={`${monitor.agentName} browser screenshot`}
                  src={browserPreview.mediaUrl}
                  fill
                  unoptimized
                  sizes="100vw"
                  className="object-contain"
                />
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-center font-mono text-[14px] text-white/68">
                  {browserPreview.loading
                    ? "Capturing browser screenshot..."
                    : browserPreview.error || "Waiting for browser screenshot."}
                </div>
              )}
              <div className="pointer-events-none absolute right-4 top-4 rounded-full border border-white/10 bg-black/45 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white/70">
                {browserPreview.loading
                  ? "Refreshing"
                  : browserPreview.capturedAt
                    ? `Screenshot ${new Date(browserPreview.capturedAt).toLocaleTimeString()}`
                    : "Screenshot fallback"}
              </div>
            </div>
          ) : (
            <iframe
              ref={embedFrameRef}
              title={`${monitor.agentName} browser preview`}
              src={monitor.browserUrl ?? undefined}
              className="h-full w-full"
              onLoad={handleEmbedLoad}
              onError={() => {
                setAllowAutoFallback(false);
                setBrowserView("screenshot");
                setEmbedLoaded(false);
              }}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-black/10 bg-gradient-to-t from-black/50 to-transparent px-6 py-4 font-mono text-[13px] text-white/80">
            {monitor.entries.length > 0
              ? monitor.entries[monitor.entries.length - 1]?.text
              : "Waiting for browser activity."}
          </div>
        </div>
      </div>
    </div>
  );
}

type ProjectFile = {
  name: string;
  path: string;
  language: string;
  content: string;
  lines: string[];
  description?: string;
};

export function MonitorImmersiveContent({
  monitor,
}: {
  monitor: OfficeDeskMonitor;
}) {
  const browserUrl = monitor.browserUrl;
  const prefersScreenshot = shouldPreferBrowserScreenshot(browserUrl);
  const [activeView, setActiveView] = useState<"code" | "browser">("code");

  if (activeView === "browser" && browserUrl) {
    return (
      <MonitorBrowserContent
        key={browserUrl}
        monitor={monitor}
        browserUrl={browserUrl}
        prefersScreenshot={prefersScreenshot}
        onSwitchToCode={() => setActiveView("code")}
      />
    );
  }

  const editor = monitor.editor;
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [repoLabel, setRepoLabel] = useState<string>("workspace");
  const [repoTerminalLines, setRepoTerminalLines] = useState<string[]>([]);
  const [recentActivities, setRecentActivities] = useState<OfficeDeskMonitor["entries"]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [closedTabs, setClosedTabs] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const lineNoRef = useRef<HTMLDivElement | null>(null);
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSelectedFile("");
    setClosedTabs(new Set());
    setRecentActivities([]);
  }, [monitor.agentId]);

  const loadFiles = useCallback(
    async (manual = false) => {
      if (manual) setIsRefreshing(true);
      const query = monitor.agentId
        ? `?agentId=${encodeURIComponent(monitor.agentId)}&ts=${Date.now()}${manual ? "&refresh=1" : ""}`
        : `?ts=${Date.now()}${manual ? "&refresh=1" : ""}`;
      try {
        const res = await fetch(`/api/office/project-files${query}`, { cache: "no-store" });
        const data = await res.json();
        if (!isMountedRef.current || !data.ok) return;
        if (Array.isArray(data.files) && data.files.length > 0) {
          setProjectFiles(data.files);
        }
        if (typeof data.repoLabel === "string" && data.repoLabel.trim()) {
          setRepoLabel(data.repoLabel.trim());
        }
        if (Array.isArray(data.terminalLines)) {
          setRepoTerminalLines(
            data.terminalLines.filter((line: unknown): line is string => typeof line === "string"),
          );
        }
        if (Array.isArray(data.recentActivities)) {
          setRecentActivities(data.recentActivities);
        }
        setLastSyncedAt(Date.now());
      } catch {
        // ignore transient network errors
      } finally {
        if (manual && isMountedRef.current) {
          window.setTimeout(() => {
            if (isMountedRef.current) setIsRefreshing(false);
          }, 250);
        }
      }
    },
    [monitor.agentId],
  );

  useEffect(() => {
    void loadFiles(false);
    const intervalId = window.setInterval(() => {
      void loadFiles(false);
    }, monitor.live ? 4000 : 12000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadFiles, monitor.live]);

  const availableFiles = useMemo<ProjectFile[]>(() => {
    if (projectFiles.length > 0) return projectFiles;
    if (editor) {
      return [
        {
          name: editor.fileName,
          path: `src/${editor.fileName}`,
          language: editor.language,
          content: editor.lines.join("\n"),
          lines: editor.lines,
        },
      ];
    }
    return [
      {
        name: "app.js",
        path: "src/app.js",
        language: "javascript",
        content: "// Loading project files...",
        lines: ["// Loading project files..."],
      },
    ];
  }, [projectFiles, editor]);

  const openFiles = useMemo(() => {
    const list = availableFiles.filter((f) => !closedTabs.has(f.name));
    return list.length > 0 ? list : availableFiles.slice(0, 1);
  }, [availableFiles, closedTabs]);

  const activeFile = useMemo<ProjectFile>(() => {
    if (selectedFile) {
      const found = openFiles.find((f) => f.name === selectedFile || f.path === selectedFile);
      if (found) return found;
    }
    if (editor?.fileName) {
      const cleanEditorFile = editor.fileName.split("/").pop() || editor.fileName;
      const match = openFiles.find(
        (f) =>
          f.name === cleanEditorFile ||
          cleanEditorFile.includes(f.name) ||
          f.path.includes(cleanEditorFile),
      );
      if (match) return match;
    }
    const role = (monitor.agentName || "").toLowerCase();
    if (role.includes("qa") || role.includes("test")) {
      const qaFile = openFiles.find(
        (f) => f.name.toLowerCase().includes("test") || f.name.toLowerCase().includes("spec") || f.name.toLowerCase().includes("qa"),
      );
      if (qaFile) return qaFile;
    }
    if (role.includes("ceo")) {
      const ceoFile = openFiles.find(
        (f) => f.name.toLowerCase().includes("readme") || f.name.toLowerCase().includes("roadmap") || f.name.toLowerCase().endsWith(".md"),
      );
      if (ceoFile) return ceoFile;
    }
    return openFiles[0] || availableFiles[0];
  }, [openFiles, availableFiles, selectedFile, monitor.agentName, editor?.fileName]);

  const handleCodeScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (lineNoRef.current) {
      lineNoRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleTabsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  };

  const handleCloseTab = (e: React.MouseEvent, fileName: string) => {
    e.stopPropagation();
    setClosedTabs((prev) => {
      const next = new Set(prev);
      next.add(fileName);
      return next;
    });
    if (activeFile.name === fileName) {
      const remaining = openFiles.filter((f) => f.name !== fileName);
      if (remaining.length > 0) {
        setSelectedFile(remaining[0].name);
      }
    }
  };

  const handleOpenFile = (fileName: string) => {
    setClosedTabs((prev) => {
      const next = new Set(prev);
      next.delete(fileName);
      return next;
    });
    setSelectedFile(fileName);
  };

  const terminalLines = useMemo(() => {
    const combined: string[] = [];
    if (editor?.terminalLines && editor.terminalLines.length > 0) {
      for (const line of editor.terminalLines) {
        if (line && !combined.includes(line)) combined.push(line);
      }
    }
    for (const line of repoTerminalLines) {
      if (line && !combined.includes(line)) combined.push(line);
    }
    if (combined.length === 0) {
      return ["$ paperclip workspace ready", `$ agent: ${monitor.agentName} (${monitor.title})`];
    }
    return combined.slice(-50);
  }, [editor?.terminalLines, repoTerminalLines, monitor.agentName, monitor.title]);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [terminalLines.length]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#1e1f22] text-[#d4d4d4]">
      <div className="flex h-full flex-col">
        <div className="flex h-10 items-center justify-between border-b border-white/6 bg-[#2a2b2f] px-4">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="text-[12px] font-medium text-white/65">
            openclaw-control-center
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <span>[v]</span>
            <span>[^]</span>
            <span>[]</span>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[54px] flex-col items-center gap-3 border-r border-white/6 bg-[#18191d] py-4">
            <div className="h-8 w-8 rounded-lg bg-white/8 ring-1 ring-white/6" />
            <div className="h-8 w-8 rounded-lg bg-[#2b2d31]" />
            <div className="h-8 w-8 rounded-lg bg-[#2b2d31]" />
            <div className="h-8 w-8 rounded-lg bg-[#2b2d31]" />
            <div className="mt-auto h-8 w-8 rounded-lg bg-[#2b2d31]" />
          </div>
          <div className="flex w-[240px] flex-col border-r border-white/6 bg-[#1f2024]">
            <div className="border-b border-white/6 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45 flex items-center justify-between">
              <span>Files</span>
              <span className="text-[10px] text-emerald-400 font-mono truncate max-w-[120px]">{repoLabel}</span>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3 font-mono text-[12px]">
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-white/35">Project Repo</div>
              {availableFiles.map((file) => {
                const isActive = file.name === activeFile.name;
                const isOpen = openFiles.some((f) => f.name === file.name);
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => handleOpenFile(file.name)}
                    className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                      isActive
                        ? "bg-[#2a2d33] text-emerald-300 font-medium"
                        : isOpen
                          ? "text-white/70 hover:bg-white/5 hover:text-white/90"
                          : "text-white/40 hover:bg-white/5 hover:text-white/70"
                    }`}
                  >
                    <span className="truncate">{file.name}</span>
                    <span className="text-[10px] text-white/30 font-normal">{file.lines.length}L</span>
                  </button>
                );
              })}

              <div className="mt-5 px-2 text-[11px] uppercase tracking-[0.2em] text-white/28">
                Agent
              </div>
              <div className="rounded-md border border-white/6 bg-black/20 px-3 py-2 text-white/82">
                {monitor.agentName}
              </div>
              <div className="rounded-md px-3 py-2 text-[11px] leading-5 text-white/42">
                {monitor.title} · {monitor.subtitle}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col bg-[#1e1f22]">
            <div className="flex items-center justify-between border-b border-white/6 bg-[#25262b] px-3">
              <div
                ref={tabsContainerRef}
                onWheel={handleTabsWheel}
                className="flex items-end gap-1 overflow-x-auto no-scrollbar scroll-smooth flex-1 min-w-0 pr-2"
              >
                {openFiles.map((file) => {
                  const isActive = file.name === activeFile.name;
                  return (
                    <div
                      key={file.name}
                      onClick={() => setSelectedFile(file.name)}
                      className={`group flex items-center gap-2 px-3 py-2 font-mono text-[12px] border-t border-x transition-colors cursor-pointer select-none shrink-0 whitespace-nowrap ${
                        isActive
                          ? "border-white/10 bg-[#1f2024] text-white font-medium shadow-sm"
                          : "border-transparent bg-[#18191d]/50 text-white/40 hover:text-white/80 hover:bg-[#1f2024]/60"
                      }`}
                    >
                      <span className="text-[10px] text-white/40 uppercase">
                        {file.language === "javascript" ? "js" : file.language}
                      </span>
                      <span>{file.name}</span>
                      <button
                        type="button"
                        onClick={(e) => handleCloseTab(e, file.name)}
                        className="ml-1 rounded px-1 text-[11px] text-white/20 hover:text-white hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                        title="Close tab"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {browserUrl ? (
                  <button
                    type="button"
                    onClick={() => setActiveView("browser")}
                    className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 font-mono text-[11px] text-sky-300 hover:bg-sky-500/20 transition-colors cursor-pointer"
                  >
                    🌐 Browser
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void loadFiles(true)}
                  disabled={isRefreshing}
                  title={
                    lastSyncedAt
                      ? `Refresh code & files (last synced ${new Date(lastSyncedAt).toLocaleTimeString()})`
                      : "Refresh code & files"
                  }
                  aria-label="Refresh code and files"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-white/75 hover:bg-white/12 hover:text-white disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-3 w-3 ${isRefreshing ? "animate-spin text-emerald-300" : ""}`}
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <path d="M21 3v6h-6" />
                  </svg>
                  <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
                </button>
                <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-200/90">
                  {monitor.live ? "Live" : "Idle"}
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="grid min-h-0 flex-1 grid-cols-[56px_minmax(0,1fr)] overflow-hidden bg-[#1e1f22] font-mono">
                  <div
                    ref={lineNoRef}
                    className="overflow-hidden border-r border-white/6 bg-[#18191d] py-4 text-right text-[13px] leading-8 text-white/20 select-none"
                  >
                    {activeFile.lines.map((_, index) => (
                      <div key={`line-no-${index}`} className="pr-3">
                        {index + 1}
                      </div>
                    ))}
                  </div>
                  <div
                    onScroll={handleCodeScroll}
                    className="relative overflow-y-auto overflow-x-auto py-4 pr-6 text-[15px] leading-8 text-[#d4d4d4] select-text"
                  >
                    {activeFile.lines.map((line, index) => (
                      <div key={`editor-line-${index}`} className="whitespace-pre pl-5">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="relative z-10 h-[30%] shrink-0 border-t border-white/6 bg-[#18191d] flex flex-col">
                  <div className="border-b border-white/6 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/35 flex items-center justify-between">
                    <span>Terminal</span>
                    <span className="text-[10px] text-white/25">Scrollable ({terminalLines.length} lines)</span>
                  </div>
                  <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-2.5 font-mono text-[13px] text-[#9cdcfe] select-text">
                    {terminalLines.map((line, index) => {
                      const match = line.match(/^(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*(.*)$/);
                      if (match) {
                        const [, time, rest] = match;
                        return (
                          <div
                            key={`terminal-${index}`}
                            className="whitespace-pre-wrap break-words leading-relaxed font-mono flex items-baseline gap-2"
                          >
                            <span className="text-white/35 select-none text-[11px] shrink-0">{time}</span>
                            {rest.startsWith("$") ? (
                              <span className="text-emerald-400 font-semibold">{rest}</span>
                            ) : (
                              <span className="text-white/70">{rest}</span>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={`terminal-${index}`}
                          className="whitespace-pre-wrap break-words leading-relaxed font-mono"
                        >
                          {line.startsWith("$") ? (
                            <span className="text-emerald-400 font-semibold">{line}</span>
                          ) : (
                            <span className="text-white/70">{line}</span>
                          )}
                        </div>
                      );
                    })}
                    <div ref={terminalEndRef} />
                  </div>
                </div>
              </div>
              <div className="flex w-[320px] flex-col border-l border-white/6 bg-[#1f2024]">
                <div className="border-b border-white/6 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45 flex items-center justify-between">
                  <span>Agent Movement And Behavior</span>
                  <span className="text-[10px] text-white/30 font-mono tracking-normal">
                    ({(monitor.entries.length > 0 ? monitor.entries : recentActivities).length})
                  </span>
                </div>
                <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
                  {(monitor.entries.length > 0 ? monitor.entries : recentActivities).length > 0 ? (
                    (monitor.entries.length > 0 ? monitor.entries : recentActivities).map((entry, index) => (
                      <div
                        key={`${monitor.agentId}-panel-${entry.kind}-${index}`}
                        className={`rounded-lg border px-3 py-3 ${
                          entry.kind === "user"
                            ? "border-amber-400/10 bg-amber-400/8"
                            : entry.kind === "tool"
                              ? "border-sky-400/10 bg-sky-400/8"
                              : entry.kind === "thinking"
                                ? "border-fuchsia-400/10 bg-fuchsia-400/8"
                                : "border-white/8 bg-white/[0.04]"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-white/28">
                          <span className="font-semibold">{entry.kind}{entry.live ? " · live" : ""}</span>
                          {entry.timeStr ? (
                            <span className="font-mono text-[10px] text-white/45 tracking-normal lowercase">{entry.timeStr}</span>
                          ) : null}
                        </div>
                        <div className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-white/76">
                          {entry.text}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-4 text-[12px] text-white/40">
                      No live activity yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/6 bg-[#0e639c] px-4 py-2 font-mono text-[11px] text-white">
              <div className="flex items-center gap-4">
                <span className="uppercase font-semibold">{activeFile.language}</span>
                <span>UTF-8</span>
                <span>Spaces: 2</span>
                <span className="text-white/60">Path: {activeFile.path}</span>
              </div>
              <div className="flex items-center gap-4 text-white/85">
                <span>Lines: {activeFile.lines.length}</span>
                <span>Col 1</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
