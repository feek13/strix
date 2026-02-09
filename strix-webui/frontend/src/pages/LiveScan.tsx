import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { useScanStore } from "../store/scanStore";
import ChatInterface from "../components/Chat/ChatInterface";
import NetworkTopology from "../components/Visualization/NetworkTopology";
import Timeline from "../components/Visualization/Timeline";
import TerminalLog from "../components/Logs/TerminalLog";
import NodeDetailPanel from "../components/NodeDetailPanel";
import MobileTabBar, { type MobileTab } from "../components/Layout/MobileTabBar";
import { useVulnerabilityStore } from "../store/vulnerabilityStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { useIsMobile } from "../hooks/useIsMobile";
import clsx from "clsx";
import { Network, Clock, ShieldAlert, MessageSquare, Terminal, X } from "lucide-react";
import type { SelectedNode } from "../types/nodeSelection";

type ViewTab = "topology" | "timeline";
type MobilePaneTab = "chat" | "topology" | "timeline" | "terminal";

const mobileTabs: MobileTab[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
  { id: "topology", label: "Attack Flow", icon: <Network size={14} /> },
  { id: "timeline", label: "Timeline", icon: <Clock size={14} /> },
  { id: "terminal", label: "Terminal", icon: <Terminal size={14} /> },
];

export default function LiveScan() {
  const { id } = useParams();
  const { send, status } = useWebSocket();
  const isMobile = useIsMobile();
  const activeScan = useScanStore((s) => s.activeScan);
  const vulns = useVulnerabilityStore((s) => s.vulnerabilities);
  const [viewTab, setViewTab] = useState<ViewTab>("topology");
  const [mobilePaneTab, setMobilePaneTab] = useState<MobilePaneTab>("chat");
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  // Content currently displayed in the panel (persists during close animation)
  const [renderedNode, setRenderedNode] = useState<SelectedNode | null>(null);
  // Decoupled open state — drives the CSS translate
  const [panelOpen, setPanelOpen] = useState(false);
  // Pending node to switch to after slide-out completes
  const switchTargetRef = useRef<SelectedNode | null>(null);
  // Ref to read latest panelOpen without stale closure
  const panelOpenRef = useRef(false);
  panelOpenRef.current = panelOpen;

  // Called by NetworkTopology when a node is clicked (or deselected)
  const handleNodeSelect = useCallback((node: SelectedNode | null) => {
    if (!node) {
      // Close: slide out
      switchTargetRef.current = null;
      setSelectedNode(null);
      setPanelOpen(false);
      return;
    }

    setSelectedNode(node);

    if (!panelOpenRef.current) {
      // Fresh open: show content immediately, slide in
      setRenderedNode(node);
      setPanelOpen(true);
    } else {
      // Switch to different node while panel is open
      if (isMobile) {
        // Mobile: instant swap, no animation
        setRenderedNode(node);
      } else {
        // Desktop: slide out first, swap content on transitionEnd, slide back in
        switchTargetRef.current = node;
        setPanelOpen(false);
      }
    }
  }, [isMobile]);

  const dismissPanel = useCallback(() => {
    switchTargetRef.current = null;
    setSelectedNode(null);
    setPanelOpen(false);
  }, []);

  const handlePanelTransitionEnd = useCallback((e: React.TransitionEvent) => {
    // Only react to this element's own transform transition,
    // ignore bubbled transitionend events from child elements (buttons etc.)
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== "transform") return;

    if (!panelOpenRef.current && switchTargetRef.current) {
      // Slide-out finished during a switch — swap content & slide back in
      const next = switchTargetRef.current;
      switchTargetRef.current = null;
      setRenderedNode(next);
      // Use rAF to ensure the DOM updates before re-opening
      requestAnimationFrame(() => setPanelOpen(true));
    } else if (!panelOpenRef.current) {
      // Normal close finished — clear rendered content
      setRenderedNode(null);
    }
  }, []);

  // Subscribe to specific scan when navigated directly or WS reconnects
  useEffect(() => {
    if (id && status === "connected") {
      send({ type: "SUBSCRIBE_SCAN", payload: { scanId: id } });
    }
  }, [id, send, status]);

  // ---- Chat panel resize ----
  const chatRef = useRef<HTMLDivElement>(null);
  const [chatWidth, setChatWidth] = useState(288); // w-72
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatRef.current?.offsetWidth ?? chatWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const w = Math.min(480, Math.max(180, startW + ev.clientX - startX));
      if (chatRef.current) chatRef.current.style.width = `${w}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (chatRef.current) setChatWidth(chatRef.current.offsetWidth);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [chatWidth]);

  // ---- Terminal panel resize ----
  const termRef = useRef<HTMLDivElement>(null);
  const [termHeight, setTermHeight] = useState(256); // h-64
  const handleTermResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = termRef.current?.offsetHeight ?? termHeight;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      // Dragging up (negative delta) increases height
      const h = Math.min(600, Math.max(80, startH - (ev.clientY - startY)));
      if (termRef.current) termRef.current.style.height = `${h}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (termRef.current) setTermHeight(termRef.current.offsetHeight);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [termHeight]);

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const v of vulns) severityCounts[v.severity]++;

  // Mobile layout
  if (isMobile) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        {/* Scan header bar */}
        {activeScan && (
          <div className="h-10 bg-strix-card border-b border-strix-border-subtle flex items-center px-4 gap-4 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={clsx(
                  "w-2 h-2 rounded-full shrink-0",
                  activeScan.status === "running" && "bg-strix-accent animate-pulse",
                  activeScan.status === "completed" && "bg-strix-text-muted",
                  activeScan.status === "failed" && "bg-severity-critical"
                )}
              />
              <span className="text-sm font-medium truncate">{activeScan.target}</span>
            </div>
            <span className="text-xs text-strix-text-muted capitalize shrink-0">{activeScan.mode}</span>
          </div>
        )}

        {/* Mobile tab bar */}
        <MobileTabBar tabs={mobileTabs} activeTab={mobilePaneTab} onTabChange={(id) => setMobilePaneTab(id as MobilePaneTab)} />

        {/* Active pane */}
        <div className="flex-1 min-h-0">
          {mobilePaneTab === "chat" && <ChatInterface />}
          {mobilePaneTab === "topology" && <NetworkTopology onNodeSelect={handleNodeSelect} selectedNode={selectedNode} />}
          {mobilePaneTab === "timeline" && <Timeline />}
          {mobilePaneTab === "terminal" && <TerminalLog />}
        </div>

        {/* Node detail panel — full-screen overlay on mobile */}
        {panelOpen && renderedNode && activeScan && (
          <div className="fixed inset-0 z-50 bg-strix-bg flex flex-col">
            <div className="h-10 bg-strix-card border-b border-strix-border-subtle flex items-center px-4 shrink-0">
              <button onClick={dismissPanel} className="text-strix-text-muted hover:text-strix-text mr-3">
                <X size={18} />
              </button>
              <span className="text-sm font-medium">Details</span>
            </div>
            <div className="flex-1 overflow-auto">
              <NodeDetailPanel
                selection={renderedNode}
                scanId={activeScan.id}
                onClose={dismissPanel}
              />
            </div>
          </div>
        )}

        {/* Findings bar */}
        {vulns.length > 0 && (
          <div className="h-8 bg-strix-card border-t border-strix-border-subtle flex items-center px-4 gap-3 shrink-0">
            <ShieldAlert size={14} className="text-strix-text-muted" />
            <span className="text-xs text-strix-text-muted">{vulns.length} findings</span>
            <div className="flex gap-2 overflow-x-auto">
              {severityCounts.critical > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-critical/20 text-severity-critical shrink-0">
                  {severityCounts.critical} CRIT
                </span>
              )}
              {severityCounts.high > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-high/20 text-severity-high shrink-0">
                  {severityCounts.high} HIGH
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Scan header bar */}
      {activeScan && (
        <div className="h-10 bg-strix-card border-b border-strix-border-subtle flex items-center px-4 gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <div
              className={clsx(
                "w-2 h-2 rounded-full",
                activeScan.status === "running" && "bg-strix-accent animate-pulse",
                activeScan.status === "completed" && "bg-strix-text-muted",
                activeScan.status === "failed" && "bg-severity-critical"
              )}
            />
            <span className="text-sm font-medium">{activeScan.target}</span>
          </div>
          <span className="text-xs text-strix-text-muted capitalize">{activeScan.mode} mode</span>
        </div>
      )}

      {/* Main 3-pane layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Chat */}
        <div
          ref={chatRef}
          className="flex flex-col shrink-0"
          style={{ width: chatWidth }}
        >
          <ChatInterface />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="w-1 shrink-0 cursor-col-resize bg-strix-border-subtle hover:bg-strix-accent/40 active:bg-strix-accent transition-colors"
        />

        {/* Right: Visualization + Terminal + Detail Panel */}
        <div className="flex-1 flex min-w-0 relative overflow-hidden">
          {/* Visualization + Terminal stack */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Tab bar */}
            <div onClick={dismissPanel} className="h-9 bg-strix-card border-b border-strix-border-subtle flex items-center px-2 gap-1 shrink-0">
              <button
                onClick={() => setViewTab("topology")}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1 rounded-btn text-xs transition-colors",
                  viewTab === "topology"
                    ? "bg-strix-elevated text-strix-text"
                    : "text-strix-text-muted hover:text-strix-text-secondary"
                )}
              >
                <Network size={12} />
                Attack Flow
              </button>
              <button
                onClick={() => setViewTab("timeline")}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1 rounded-btn text-xs transition-colors",
                  viewTab === "timeline"
                    ? "bg-strix-elevated text-strix-text"
                    : "text-strix-text-muted hover:text-strix-text-secondary"
                )}
              >
                <Clock size={12} />
                Timeline
              </button>
            </div>

            {/* Visualization area */}
            <div className="flex-1 min-h-0">
              {viewTab === "topology" ? <NetworkTopology onNodeSelect={handleNodeSelect} selectedNode={selectedNode} /> : <Timeline />}
            </div>

            {/* Terminal resize handle */}
            <div
              onMouseDown={handleTermResizeStart}
              className="h-1 shrink-0 cursor-row-resize bg-strix-border-subtle hover:bg-strix-accent/40 active:bg-strix-accent transition-colors"
            />

            {/* Terminal log */}
            <div
              ref={termRef}
              onClick={dismissPanel}
              className="relative shrink-0"
              style={{ height: termHeight }}
            >
              <TerminalLog />
            </div>
          </div>

          {/* Node detail panel — GPU-composited slide */}
          <div
            className={clsx(
              "absolute top-0 right-0 h-full w-80 will-change-transform transition-transform ease-spring z-10",
              panelOpen ? "translate-x-0 duration-300" : "translate-x-full",
              // Faster slide-out when switching nodes (150ms), normal close (300ms)
              !panelOpen && (switchTargetRef.current ? "duration-150" : "duration-300")
            )}
            onTransitionEnd={handlePanelTransitionEnd}
          >
            {renderedNode && activeScan && (
              <NodeDetailPanel
                selection={renderedNode}
                scanId={activeScan.id}
                onClose={dismissPanel}
              />
            )}
          </div>
        </div>
      </div>

      {/* Findings bar */}
      {vulns.length > 0 && (
        <div className="h-8 bg-strix-card border-t border-strix-border-subtle flex items-center px-4 gap-3 shrink-0">
          <ShieldAlert size={14} className="text-strix-text-muted" />
          <span className="text-xs text-strix-text-muted">{vulns.length} findings</span>
          <div className="flex gap-2">
            {severityCounts.critical > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-critical/20 text-severity-critical">
                {severityCounts.critical} CRIT
              </span>
            )}
            {severityCounts.high > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-high/20 text-severity-high">
                {severityCounts.high} HIGH
              </span>
            )}
            {severityCounts.medium > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-severity-medium/20 text-severity-medium">
                {severityCounts.medium} MED
              </span>
            )}
            {(severityCounts.low + severityCounts.info) > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-strix-elevated text-strix-text-muted">
                {severityCounts.low + severityCounts.info} LOW
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
