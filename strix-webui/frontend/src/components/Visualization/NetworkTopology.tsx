import { memo, useMemo, useCallback, useEffect, useState, useRef, type CSSProperties } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAgentStore } from "../../store/agentStore";
import { useToolStore } from "../../store/toolStore";
import { useScanStore } from "../../store/scanStore";
import { useVulnerabilityStore } from "../../store/vulnerabilityStore";
import clsx from "clsx";
import { Globe, Wrench, ShieldAlert } from "lucide-react";
import { StrixIcon } from "../ui/StrixIcon";
import type { SelectedNode } from "../../types/nodeSelection";
import { TOOL_CATEGORIES } from "../../types";
import { useTheme } from "../../hooks/useTheme";
import { getThemeColors } from "../../lib/themeColors";
import { SEVERITY_STROKE, SEVERITY_ORDER, SEVERITY_TEXT, SEVERITY_BADGE } from "../../lib/severityStyles";

// ==================== Constants ====================

const Y_LEVEL_GAP = 120;
const MIN_X_GAP = 160;
const TOOL_Y_OFFSET = 80;
const TOOL_X_GAP = 120;
const NODE_WIDTH = 140;
const FINDING_COLUMN_GAP = 280; // gap between rightmost tree node and findings column
const FINDING_Y_GAP = 70;
const FINDING_TOP_Y = 60; // findings start at this Y

// ==================== Tool Name Helpers ====================

/** Strip mcp__strix-sandbox__ or mcp__*__ prefixes for clean display */
function cleanToolName(name: string): string {
  return name
    .replace(/^mcp__strix-sandbox__/, "")
    .replace(/^mcp__[^_]+__/, "");
}

function isVulnReportTool(toolName: string): boolean {
  return toolName.includes("create_vulnerability_report");
}

// ==================== Tool Category Lookup ====================

function getToolCategory(toolName: string): string {
  const clean = cleanToolName(toolName);
  for (const cat of TOOL_CATEGORIES) {
    if (cat.tools.includes(clean) || cat.tools.includes(toolName)) return cat.id;
  }
  return "other";
}

const TOOL_CATEGORY_COLORS: Record<string, { border: string; text: string }> = {
  browser: { border: "border-blue-500/50", text: "text-blue-400" },
  proxy: { border: "border-purple-500/50", text: "text-purple-400" },
  terminal: { border: "border-yellow-500/50", text: "text-yellow-400" },
  python: { border: "border-orange-500/50", text: "text-orange-400" },
  files: { border: "border-cyan-500/50", text: "text-cyan-400" },
  findings: { border: "border-red-500/50", text: "text-red-400" },
  notes: { border: "border-teal-500/50", text: "text-teal-400" },
  agents: { border: "border-green-500/50", text: "text-green-400" },
  sandbox: { border: "border-indigo-500/50", text: "text-indigo-400" },
  other: { border: "border-strix-border-subtle", text: "text-strix-text-muted" },
};

// ==================== Custom Nodes ====================

const TargetNode = memo(function TargetNode({ data }: { data: { label: string; status: string; selected?: boolean } }) {
  return (
    <div
      className={clsx(
        "bg-strix-elevated border-2 border-strix-accent rounded-card px-4 py-3 min-w-[140px] text-center",
        data.selected && "ring-2 ring-strix-accent ring-offset-1 ring-offset-strix-bg"
      )}
      style={{
        boxShadow: "0 0 20px rgba(34, 197, 94, 0.15), 0 0 40px rgba(34, 197, 94, 0.05)",
      }}
    >
      <Handle type="source" position={Position.Bottom} className="!bg-strix-accent !w-2 !h-2" />
      <Globe size={20} className="text-strix-accent mx-auto mb-1" />
      <div className="text-xs font-medium text-strix-text truncate max-w-[160px]">{data.label}</div>
      <div className="flex items-center justify-center gap-1.5 mt-1">
        <span
          className={clsx(
            "inline-block w-1.5 h-1.5 rounded-full",
            data.status === "running" && "bg-strix-accent animate-pulse",
            data.status === "completed" && "bg-strix-text-muted",
            data.status === "failed" && "bg-red-500",
            !["running", "completed", "failed"].includes(data.status) && "bg-strix-border"
          )}
        />
        <span className="text-[10px] text-strix-text-muted capitalize">{data.status}</span>
      </div>
    </div>
  );
});

const AgentNode = memo(function AgentNode({ data }: { data: { label: string; status: string; task: string; selected?: boolean } }) {
  const isRunning = data.status === "running";
  return (
    <div
      className={clsx(
        "bg-strix-card border rounded-card px-3 py-2 min-w-[120px] shadow-md",
        isRunning ? "border-strix-accent" : "border-strix-border-subtle",
        data.selected && "ring-2 ring-strix-accent ring-offset-1 ring-offset-strix-bg"
      )}
      style={isRunning ? { boxShadow: "0 0 12px rgba(34, 197, 94, 0.1)" } : undefined}
    >
      <Handle type="target" position={Position.Top} className="!bg-strix-border !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-strix-border !w-2 !h-2" />
      <div className="flex items-center gap-1.5 mb-1">
        <StrixIcon size={14} className={isRunning ? "text-strix-accent" : "text-strix-text-muted"} />
        <span className="text-xs font-medium text-strix-text truncate max-w-[100px]">{data.label}</span>
      </div>
      <div className={clsx("text-[10px] flex items-center gap-1", isRunning ? "text-strix-accent" : "text-strix-text-muted")}>
        <span
          className={clsx(
            "inline-block w-1.5 h-1.5 rounded-full shrink-0",
            isRunning && "bg-strix-accent animate-pulse",
            data.status === "completed" && "bg-strix-text-muted",
            data.status === "failed" && "bg-red-500",
            data.status === "waiting" && "bg-yellow-500",
            !["running", "completed", "failed", "waiting"].includes(data.status) && "bg-strix-border"
          )}
        />
        {data.status}
      </div>
    </div>
  );
});

const ToolNode = memo(function ToolNode({ data }: { data: { label: string; status: string; duration?: number; category: string; selected?: boolean } }) {
  const catColors = TOOL_CATEGORY_COLORS[data.category] || TOOL_CATEGORY_COLORS.other;
  const isRunning = data.status === "running";
  const isError = data.status === "error";
  const isVulnReport = data.label === "create_vulnerability_report";
  return (
    <div
      className={clsx(
        "bg-strix-bg border rounded-full px-2.5 py-1",
        isVulnReport ? "min-w-[100px] border-severity-high/60" :
        isError ? "min-w-[80px] border-red-500/50" :
        isRunning ? "min-w-[80px] border-strix-accent/50" :
        `min-w-[80px] ${catColors.border}`,
        data.selected && "ring-2 ring-strix-accent ring-offset-1 ring-offset-strix-bg"
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-strix-border !w-1.5 !h-1.5" />
      <Handle type="source" position={Position.Bottom} className="!bg-strix-border !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1">
        <Wrench
          size={9}
          className={clsx(
            isVulnReport ? "text-severity-high" :
            isError ? "text-red-400" :
            isRunning ? "text-strix-accent" :
            catColors.text
          )}
        />
        <span className="text-[10px] text-strix-text-secondary truncate max-w-[100px]">{data.label}</span>
      </div>
      {data.duration !== undefined && (
        <div className="text-[9px] text-strix-text-muted text-center">{(data.duration / 1000).toFixed(1)}s</div>
      )}
    </div>
  );
});

const FindingNode = memo(function FindingNode({ data }: { data: { label: string; severity: string; agentName?: string; selected?: boolean } }) {
  const borderColor = SEVERITY_STROKE[data.severity] || SEVERITY_STROKE.info;

  return (
    <div
      className={clsx(
        "bg-strix-bg border rounded-lg px-2.5 py-2 min-w-[140px] max-w-[200px]",
        data.selected && "ring-2 ring-strix-accent ring-offset-1 ring-offset-strix-bg"
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
    >
      <Handle type="target" position={Position.Left} className="!bg-strix-border !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1 mb-1">
        <ShieldAlert size={11} className={SEVERITY_TEXT[data.severity] || SEVERITY_TEXT.info} />
        <span className="text-[10px] text-strix-text-secondary truncate">{data.label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={clsx("text-[9px] uppercase font-semibold px-1 py-0.5 rounded", SEVERITY_BADGE[data.severity] || SEVERITY_BADGE.info)}>
          {data.severity}
        </span>
        {data.agentName && (
          <span className="text-[8px] text-strix-text-muted truncate max-w-[80px]">by {data.agentName}</span>
        )}
      </div>
    </div>
  );
});

const nodeTypes: NodeTypes = {
  target: TargetNode,
  agent: AgentNode,
  tool: ToolNode,
  finding: FindingNode,
};

// ==================== SVG Defs for Edge Glow ====================

function EdgeDefs({ accent, border }: { accent: string; border: string }) {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        <marker
          id="arrow-green"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={accent} />
        </marker>
        <marker
          id="arrow-gray"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={border} />
        </marker>
        <filter id="glow-green" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

// ==================== Recursive Tree Layout ====================

interface TreeNode {
  id: string;
  children: TreeNode[];
}

interface LayoutResult {
  width: number;
  x: number;
  positions: Map<string, { x: number; y: number }>;
}

function buildAgentTree(agents: Map<string, { id: string; parentId: string | null }>): TreeNode[] {
  const roots: TreeNode[] = [];
  const childMap = new Map<string, TreeNode[]>();

  for (const [id, agent] of agents) {
    if (agent.parentId && agents.has(agent.parentId)) {
      const siblings = childMap.get(agent.parentId) || [];
      siblings.push({ id, children: [] });
      childMap.set(agent.parentId, siblings);
    }
  }

  function buildNode(id: string): TreeNode {
    const children = (childMap.get(id) || []).map((c) => buildNode(c.id));
    return { id, children };
  }

  for (const [, agent] of agents) {
    if (!agent.parentId || !agents.has(agent.parentId)) {
      roots.push(buildNode(agent.id));
    }
  }

  return roots;
}

function layoutSubtree(node: TreeNode, depth: number, xOffset: number): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();

  if (node.children.length === 0) {
    positions.set(node.id, { x: xOffset + NODE_WIDTH / 2, y: depth * Y_LEVEL_GAP });
    return { width: NODE_WIDTH, x: xOffset + NODE_WIDTH / 2, positions };
  }

  let currentX = xOffset;
  for (const child of node.children) {
    const layout = layoutSubtree(child, depth + 1, currentX);
    for (const [id, pos] of layout.positions) {
      positions.set(id, pos);
    }
    currentX += layout.width + MIN_X_GAP;
  }

  const totalWidth = currentX - xOffset - MIN_X_GAP;
  const parentX = xOffset + totalWidth / 2;
  positions.set(node.id, { x: parentX, y: depth * Y_LEVEL_GAP });

  return { width: Math.max(totalWidth, NODE_WIDTH), x: parentX, positions };
}

// ==================== Main Layout ====================

function calculateLayout(
  agents: ReturnType<typeof useAgentStore.getState>["agents"],
  tools: ReturnType<typeof useToolStore.getState>["tools"],
  vulns: ReturnType<typeof useVulnerabilityStore.getState>["vulnerabilities"],
  scan: ReturnType<typeof useScanStore.getState>["activeScan"],
  themeColors?: { accent: string; border: string; borderSubtle: string }
): { nodes: Node[]; edges: Edge[] } {
  const tc = themeColors ?? { accent: "#22C55E", border: "#3A3A3A", borderSubtle: "#2A2A2A" };
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (!scan) return { nodes, edges };

  // -- Build agent tree and compute positions --
  const agentTrees = buildAgentTree(agents);
  const allPositions = new Map<string, { x: number; y: number }>();

  let currentX = 0;
  for (const tree of agentTrees) {
    const layout = layoutSubtree(tree, 1, currentX);
    for (const [id, pos] of layout.positions) {
      allPositions.set(id, pos);
    }
    currentX += layout.width + MIN_X_GAP;
  }

  // Center everything
  const totalTreeWidth = currentX > 0 ? currentX - MIN_X_GAP : 0;
  const centerOffset = -totalTreeWidth / 2;
  for (const [id, pos] of allPositions) {
    allPositions.set(id, { x: pos.x + centerOffset, y: pos.y });
  }

  // -- Target node at top center --
  nodes.push({
    id: "target",
    type: "target",
    position: { x: -NODE_WIDTH / 2, y: 0 },
    data: { label: scan.target, status: scan.status },
  });

  // -- Agent nodes --
  const agentArr = Array.from(agents.values());
  for (const agent of agentArr) {
    const pos = allPositions.get(agent.id);
    if (!pos) continue;

    nodes.push({
      id: agent.id,
      type: "agent",
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y },
      data: {
        label: agent.name,
        status: agent.status,
        task: agent.task,
      },
    });

    const sourceId = agent.parentId || "target";
    const isRunning = agent.status === "running";
    const isChild = !!agent.parentId;
    edges.push({
      id: `${sourceId}-${agent.id}`,
      source: sourceId,
      target: agent.id,
      animated: isRunning,
      style: {
        stroke: isRunning ? tc.accent : tc.border,
        strokeWidth: isRunning ? 2 : 1.5,
        ...(isRunning ? { filter: "url(#glow-green)", willChange: "transform" as const } : {}),
        ...(isChild ? { strokeDasharray: "5 5" } : {}),
      },
      markerEnd: isRunning ? "url(#arrow-green)" : "url(#arrow-gray)",
    });
  }

  // -- Tool nodes --
  // Always keep: running, errors, vuln-report tools, + last 5 completed
  const toolArr = Array.from(tools.values());
  const toolsByAgent = new Map<string, typeof toolArr>();
  for (const t of toolArr) {
    const list = toolsByAgent.get(t.agentId) || [];
    list.push(t);
    toolsByAgent.set(t.agentId, list);
  }

  // Track tool node positions for finding→tool edges
  const toolPositions = new Map<string, { x: number; y: number }>();
  // Track which vuln-report tools exist per agent (for finding linking)
  const vulnReportToolsByAgent = new Map<string, string[]>();

  const MAX_TOOLS_PER_ROW = 5;

  for (const [agentId, agentTools] of toolsByAgent) {
    const agentPos = allPositions.get(agentId);
    if (!agentPos) continue;

    const running = agentTools.filter((t) => t.status === "running");
    const errors = agentTools.filter((t) => t.status === "error");
    const vulnReports = agentTools.filter((t) => isVulnReportTool(t.toolName));
    const completed = agentTools
      .filter((t) => t.status === "completed" && !isVulnReportTool(t.toolName))
      .slice(-5);
    const toShow = [...running, ...errors, ...vulnReports, ...completed];

    // Deduplicate
    const seen = new Set<string>();
    const deduped = toShow.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    // Track vuln report tool IDs for this agent
    const reportIds = vulnReports.map((t) => t.id);
    if (reportIds.length > 0) {
      vulnReportToolsByAgent.set(agentId, reportIds);
    }

    const toolCount = deduped.length;
    for (let i = 0; i < toolCount; i++) {
      const tool = deduped[i];
      const row = Math.floor(i / MAX_TOOLS_PER_ROW);
      const col = i % MAX_TOOLS_PER_ROW;
      const rowCount = Math.min(toolCount - row * MAX_TOOLS_PER_ROW, MAX_TOOLS_PER_ROW);
      const x = agentPos.x + (col - (rowCount - 1) / 2) * TOOL_X_GAP;
      const y = agentPos.y + TOOL_Y_OFFSET + row * 50;
      const category = getToolCategory(tool.toolName);
      const displayName = cleanToolName(tool.toolName);

      const nodePos = { x: x - 50, y };
      toolPositions.set(tool.id, nodePos);

      nodes.push({
        id: tool.id,
        type: "tool",
        position: nodePos,
        data: {
          label: displayName,
          status: tool.status,
          duration: tool.duration,
          category,
        },
      });

      const isToolRunning = tool.status === "running";
      edges.push({
        id: `${agentId}-${tool.id}`,
        source: agentId,
        target: tool.id,
        animated: isToolRunning,
        style: {
          stroke: isVulnReportTool(tool.toolName)
            ? "#FF6B0066"
            : isToolRunning ? `${tc.accent}44` : tc.borderSubtle,
          strokeWidth: isVulnReportTool(tool.toolName) ? 1.5 : 1,
          ...(isToolRunning ? { willChange: "transform" as const } : {}),
        },
      });
    }
  }

  // -- Finding nodes: clean right-side column, sorted by severity --
  if (vulns.length > 0) {
    // Sort by severity
    const sortedVulns = [...vulns].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5)
    );

    // Compute rightmost X of the entire tree (agents + tools)
    let rightEdge = 200; // minimum
    for (const pos of allPositions.values()) {
      rightEdge = Math.max(rightEdge, pos.x + NODE_WIDTH);
    }
    for (const pos of toolPositions.values()) {
      rightEdge = Math.max(rightEdge, pos.x + 120);
    }

    const findingsX = rightEdge + FINDING_COLUMN_GAP;

    for (let i = 0; i < sortedVulns.length; i++) {
      const v = sortedVulns[i];
      const nodeId = `vuln-${v.id}`;
      const y = FINDING_TOP_Y + i * FINDING_Y_GAP;
      const agentName = agents.get(v.agentId)?.name;

      nodes.push({
        id: nodeId,
        type: "finding",
        position: { x: findingsX, y },
        data: {
          label: v.title,
          severity: v.severity,
          agentName,
        },
      });

      // Try to connect to a create_vulnerability_report tool from the same agent
      const reportToolIds = vulnReportToolsByAgent.get(v.agentId);
      const sevColor = SEVERITY_STROKE[v.severity] || SEVERITY_STROKE.info;

      if (reportToolIds && reportToolIds.length > 0) {
        // Pick the first available report tool (they are ordered chronologically)
        // Remove it so the next finding gets the next one
        const toolId = reportToolIds.shift()!;
        edges.push({
          id: `${toolId}-${nodeId}`,
          source: toolId,
          target: nodeId,
          style: {
            stroke: sevColor,
            strokeWidth: 2,
            strokeDasharray: "6 3",
          },
        });
      } else {
        // Fallback: connect from agent
        edges.push({
          id: `${v.agentId}-${nodeId}`,
          source: v.agentId,
          target: nodeId,
          style: {
            stroke: sevColor,
            strokeWidth: 2,
            strokeDasharray: "6 3",
          },
        });
      }
    }
  }

  return { nodes, edges };
}

// ==================== Legend Overlay ====================

type FilterableType = "agent" | "tool" | "finding";

interface LegendProps {
  hiddenTypes: Set<FilterableType>;
  onToggle: (type: FilterableType) => void;
}

function Legend({ hiddenTypes, onToggle }: LegendProps) {
  const items: { type: FilterableType | null; label: string; icon: React.ReactNode }[] = [
    {
      type: null,
      label: "Target",
      icon: <div className="w-3 h-3 rounded-sm border-2 border-strix-accent bg-strix-elevated" />,
    },
    {
      type: "agent",
      label: "Agent",
      icon: <div className="w-3 h-3 rounded-sm border border-strix-border bg-strix-card" />,
    },
    {
      type: "tool",
      label: "Tool",
      icon: <div className="w-3 h-1.5 rounded-full border border-strix-border-subtle bg-strix-bg" />,
    },
    {
      type: "finding",
      label: "Finding",
      icon: <ShieldAlert size={10} className="text-severity-high" />,
    },
  ];

  return (
    <div className="absolute top-3 right-3 bg-strix-bg/95 border border-strix-border-subtle rounded-lg px-3 py-2 z-10">
      <div className="text-[9px] uppercase tracking-wider text-strix-text-muted mb-1.5 font-semibold">Filter</div>
      <div className="space-y-1">
        {items.map((item) => {
          const ft = item.type;
          const isFilterable = ft !== null;
          const isHidden = ft !== null && hiddenTypes.has(ft);
          return (
            <button
              key={item.label}
              onClick={ft !== null ? () => onToggle(ft) : undefined}
              className={clsx(
                "flex items-center gap-2 w-full rounded px-1 py-0.5 transition-colors",
                isFilterable ? "hover:bg-strix-elevated cursor-pointer" : "cursor-default",
                isHidden && "opacity-30"
              )}
            >
              {item.icon}
              <span className="text-[10px] text-strix-text-secondary">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ==================== Stats Overlay ====================

interface StatsOverlayProps {
  agents: Map<string, { status: string }>;
  tools: Map<string, { status: string }>;
  vulns: { severity: string }[];
}

function StatsOverlay({ agents, tools, vulns }: StatsOverlayProps) {
  const agentArr = Array.from(agents.values());
  const runningAgents = agentArr.filter((a) => a.status === "running").length;
  const totalAgents = agentArr.length;
  const toolCount = tools.size;

  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const v of vulns) {
    if (v.severity in sevCounts) sevCounts[v.severity as keyof typeof sevCounts]++;
  }
  const totalFindings = vulns.length;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-strix-bg/95 border border-strix-border-subtle rounded-lg px-3 py-2 z-10">
      <div className="flex items-center gap-4 text-[10px]">
        <div className="flex items-center gap-1.5">
          <StrixIcon size={10} className="text-strix-accent" />
          <span className="text-strix-text-secondary">
            <span className="text-strix-text font-medium">{runningAgents}</span>
            <span className="text-strix-text-muted">/{totalAgents}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Wrench size={10} className="text-strix-text-muted" />
          <span className="text-strix-text font-medium">{toolCount}</span>
        </div>
        {totalFindings > 0 && (
          <div className="flex items-center gap-1.5">
            <ShieldAlert size={10} className="text-severity-high" />
            <span className="text-strix-text font-medium">{totalFindings}</span>
            {sevCounts.critical > 0 && (
              <span className="text-severity-critical font-semibold">{sevCounts.critical}C</span>
            )}
            {sevCounts.high > 0 && (
              <span className="text-severity-high font-semibold">{sevCounts.high}H</span>
            )}
            {sevCounts.medium > 0 && (
              <span className="text-severity-medium font-semibold">{sevCounts.medium}M</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Inner Component (needs ReactFlowProvider) ====================

interface NetworkTopologyInnerProps {
  onNodeSelect?: (selection: SelectedNode | null) => void;
  externalSelectedNode?: SelectedNode | null;
}

function NetworkTopologyInner({ onNodeSelect, externalSelectedNode }: NetworkTopologyInnerProps) {
  const agents = useAgentStore((s) => s.agents);
  const tools = useToolStore((s) => s.tools);
  const vulns = useVulnerabilityStore((s) => s.vulnerabilities);
  const scan = useScanStore((s) => s.activeScan);
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const reactFlowInstance = useReactFlow();
  const { resolved } = useTheme();
  const colors = getThemeColors(resolved);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Sync: when parent dismisses the panel, clear internal selection
  if (externalSelectedNode === null && selectedNodeId !== null) {
    setSelectedNodeId(null);
  }

  const [hiddenTypes, setHiddenTypes] = useState<Set<FilterableType>>(new Set());

  const toggleType = useCallback((type: FilterableType) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const themeColors = useMemo(() => ({
    accent: colors.accent,
    border: colors.border,
    borderSubtle: colors.borderSubtle,
  }), [colors.accent, colors.border, colors.borderSubtle]);

  const { nodes: rawNodes, edges: layoutEdges } = useMemo(
    () => calculateLayout(agents, tools, vulns, scan, themeColors),
    [agents, tools, vulns, scan, themeColors]
  );

  // Lightweight: only nodes whose selection state changed get a new reference
  const layoutNodes = useMemo(() =>
    rawNodes.map(n => {
      const shouldSelect = n.id === selectedNodeId;
      if (shouldSelect === !!n.data.selected) return n; // keep same reference
      return { ...n, data: { ...n.data, selected: shouldSelect } };
    }),
    [rawNodes, selectedNodeId]
  );

  // Filter nodes/edges by hidden types
  const filteredNodes = useMemo(() => {
    if (hiddenTypes.size === 0) return layoutNodes;
    return layoutNodes.filter((n) => !n.type || !hiddenTypes.has(n.type as FilterableType));
  }, [layoutNodes, hiddenTypes]);

  const filteredEdges = useMemo(() => {
    if (hiddenTypes.size === 0) return layoutEdges;
    const visibleIds = new Set(filteredNodes.map((n) => n.id));
    return layoutEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  }, [layoutEdges, filteredNodes, hiddenTypes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(filteredNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(filteredEdges);

  // Sync layout when data changes
  useEffect(() => {
    setNodes(filteredNodes);
    setEdges(filteredEdges);
  }, [filteredNodes, filteredEdges, setNodes, setEdges]);

  // Auto-fit when node count changes
  const prevCountRef = useRef(0);
  useEffect(() => {
    const count = filteredNodes.length;
    if (count !== prevCountRef.current && count > 0) {
      const prev = prevCountRef.current;
      prevCountRef.current = count;
      const delta = Math.abs(count - prev);
      const timer = setTimeout(() => {
        reactFlowInstance?.fitView({ padding: 0.2, duration: delta > 3 ? 300 : 0 });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [filteredNodes.length, reactFlowInstance]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedAgent(null);
    onNodeSelect?.(null);
  }, [setSelectedAgent, onNodeSelect]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id === selectedNodeId) {
        setSelectedNodeId(null);
        setSelectedAgent(null);
        onNodeSelect?.(null);
        return;
      }

      setSelectedNodeId(node.id);

      let selection: SelectedNode | null = null;
      switch (node.type) {
        case "target":
          if (scan) selection = { type: "target", data: scan };
          break;
        case "agent": {
          const agent = agents.get(node.id);
          if (agent) {
            selection = { type: "agent", data: agent };
            setSelectedAgent(node.id);
          }
          break;
        }
        case "tool": {
          const tool = tools.get(node.id);
          if (tool) selection = { type: "tool", data: tool };
          break;
        }
        case "finding": {
          const vuln = vulns.find((v) => `vuln-${v.id}` === node.id);
          if (vuln) selection = { type: "finding", data: vuln };
          break;
        }
      }

      onNodeSelect?.(selection ?? null);
    },
    [selectedNodeId, scan, agents, tools, vulns, setSelectedAgent, onNodeSelect]
  );

  // Memoize MiniMap callbacks to avoid unnecessary re-renders
  const nodeColorFn = useCallback((n: Node) => {
    if (n.type === "target") return colors.accent;
    if (n.type === "finding") {
      const sev = (n.data as { severity?: string })?.severity;
      return SEVERITY_STROKE[sev || "info"] || colors.severityCritical;
    }
    if (n.type === "agent") {
      return (n.data as { status?: string })?.status === "running" ? colors.accent : colors.border;
    }
    return colors.borderSubtle;
  }, [colors]);

  const miniMapMask = useMemo(() => `${colors.bg}cc`, [colors.bg]);

  if (!scan) {
    return (
      <div className="flex items-center justify-center h-full text-strix-text-muted text-sm">
        Start a scan to see the attack topology
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <EdgeDefs accent={colors.accent} border={colors.border} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={colors.elevated} />
        <Controls showInteractive={false} />
        <div className="hidden md:block">
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={nodeColorFn}
            maskColor={miniMapMask}
          />
        </div>
      </ReactFlow>
      <Legend hiddenTypes={hiddenTypes} onToggle={toggleType} />
      <StatsOverlay agents={agents} tools={tools} vulns={vulns} />
    </div>
  );
}

// ==================== Exported Component ====================

interface NetworkTopologyProps {
  onNodeSelect?: (selection: SelectedNode | null) => void;
  selectedNode?: SelectedNode | null;
}

export default function NetworkTopology({ onNodeSelect, selectedNode }: NetworkTopologyProps) {
  return (
    <ReactFlowProvider>
      <NetworkTopologyInner onNodeSelect={onNodeSelect} externalSelectedNode={selectedNode ?? null} />
    </ReactFlowProvider>
  );
}
