import { useMemo, useCallback } from "react";
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
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAgentStore } from "../../store/agentStore";
import { useToolStore } from "../../store/toolStore";
import { useScanStore } from "../../store/scanStore";
import { useVulnerabilityStore } from "../../store/vulnerabilityStore";
import clsx from "clsx";
import { Globe, Bot, Wrench, ShieldAlert } from "lucide-react";

// ==================== Custom Nodes ====================

function TargetNode({ data }: { data: { label: string; status: string } }) {
  return (
    <div className="bg-strix-elevated border-2 border-strix-accent rounded-card px-4 py-3 min-w-[140px] text-center shadow-lg shadow-strix-accent/10">
      <Handle type="source" position={Position.Bottom} className="!bg-strix-accent !w-2 !h-2" />
      <Globe size={20} className="text-strix-accent mx-auto mb-1" />
      <div className="text-xs font-medium text-white truncate max-w-[160px]">{data.label}</div>
      <div className="text-[10px] text-strix-text-muted capitalize">{data.status}</div>
    </div>
  );
}

function AgentNode({ data }: { data: { label: string; status: string; task: string } }) {
  return (
    <div
      className={clsx(
        "bg-strix-card border rounded-card px-3 py-2 min-w-[120px] shadow-md",
        data.status === "running" ? "border-strix-accent" : "border-strix-border-subtle"
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-strix-border !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-strix-border !w-2 !h-2" />
      <div className="flex items-center gap-1.5 mb-1">
        <Bot size={14} className={data.status === "running" ? "text-strix-accent" : "text-strix-text-muted"} />
        <span className="text-xs font-medium text-white truncate max-w-[100px]">{data.label}</span>
      </div>
      <div className={clsx(
        "text-[10px]",
        data.status === "running" ? "text-strix-accent" : "text-strix-text-muted"
      )}>
        {data.status === "running" && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-strix-accent animate-pulse mr-1" />
        )}
        {data.status}
      </div>
    </div>
  );
}

function ToolNode({ data }: { data: { label: string; status: string; duration?: number } }) {
  return (
    <div
      className={clsx(
        "bg-strix-bg border rounded-lg px-2 py-1.5 min-w-[100px]",
        data.status === "running" ? "border-strix-accent/50" : "border-strix-border-subtle"
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-strix-border !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1">
        <Wrench size={10} className={data.status === "running" ? "text-strix-accent" : "text-strix-text-muted"} />
        <span className="text-[10px] text-strix-text-secondary truncate max-w-[80px]">{data.label}</span>
      </div>
      {data.duration !== undefined && (
        <div className="text-[9px] text-strix-text-muted">{(data.duration / 1000).toFixed(1)}s</div>
      )}
    </div>
  );
}

function FindingNode({ data }: { data: { label: string; severity: string } }) {
  const colors: Record<string, string> = {
    critical: "border-severity-critical text-severity-critical",
    high: "border-severity-high text-severity-high",
    medium: "border-severity-medium text-severity-medium",
    low: "border-severity-low text-severity-low",
    info: "border-strix-text-muted text-strix-text-muted",
  };

  return (
    <div className={clsx("bg-strix-bg border rounded-lg px-2 py-1.5 min-w-[100px]", colors[data.severity] || colors.info)}>
      <Handle type="target" position={Position.Top} className="!bg-severity-critical !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1">
        <ShieldAlert size={10} />
        <span className="text-[10px] truncate max-w-[90px]">{data.label}</span>
      </div>
      <div className="text-[9px] uppercase font-medium">{data.severity}</div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  target: TargetNode,
  agent: AgentNode,
  tool: ToolNode,
  finding: FindingNode,
};

// ==================== Layout ====================

function calculateLayout(
  agents: ReturnType<typeof useAgentStore.getState>["agents"],
  tools: ReturnType<typeof useToolStore.getState>["tools"],
  vulns: ReturnType<typeof useVulnerabilityStore.getState>["vulnerabilities"],
  scan: ReturnType<typeof useScanStore.getState>["activeScan"]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (!scan) return { nodes, edges };

  const X_GAP = 180;
  const Y_GAP = 100;

  // Target node at top center
  nodes.push({
    id: "target",
    type: "target",
    position: { x: 400, y: 0 },
    data: { label: scan.target, status: scan.status },
  });

  // Agents by level
  const agentArr = Array.from(agents.values());
  const rootAgents = agentArr.filter((a) => !a.parentId);
  const childAgents = agentArr.filter((a) => a.parentId);

  // Root agents
  rootAgents.forEach((agent, i) => {
    const x = 400 + (i - (rootAgents.length - 1) / 2) * X_GAP;
    nodes.push({
      id: agent.id,
      type: "agent",
      position: { x, y: Y_GAP },
      data: { label: agent.name, status: agent.status, task: agent.task },
    });
    edges.push({
      id: `target-${agent.id}`,
      source: "target",
      target: agent.id,
      animated: agent.status === "running",
      style: { stroke: agent.status === "running" ? "#22C55E" : "#3A3A3A", strokeWidth: 1.5 },
    });
  });

  // Child agents
  const childrenByParent = new Map<string, typeof childAgents>();
  childAgents.forEach((a) => {
    const list = childrenByParent.get(a.parentId!) || [];
    list.push(a);
    childrenByParent.set(a.parentId!, list);
  });

  childrenByParent.forEach((children, parentId) => {
    const parentNode = nodes.find((n) => n.id === parentId);
    if (!parentNode) return;

    children.forEach((agent, i) => {
      const x = parentNode.position.x + (i - (children.length - 1) / 2) * (X_GAP * 0.8);
      nodes.push({
        id: agent.id,
        type: "agent",
        position: { x, y: parentNode.position.y + Y_GAP },
        data: { label: agent.name, status: agent.status, task: agent.task },
      });
      edges.push({
        id: `${parentId}-${agent.id}`,
        source: parentId,
        target: agent.id,
        animated: agent.status === "running",
        style: { stroke: agent.status === "running" ? "#22C55E" : "#3A3A3A", strokeDasharray: "5 5" },
      });
    });
  });

  // Recent tools (only running + last 5 completed per agent)
  const toolArr = Array.from(tools.values());
  const toolsByAgent = new Map<string, typeof toolArr>();
  toolArr.forEach((t) => {
    const list = toolsByAgent.get(t.agentId) || [];
    list.push(t);
    toolsByAgent.set(t.agentId, list);
  });

  toolsByAgent.forEach((agentTools, agentId) => {
    const agentNode = nodes.find((n) => n.id === agentId);
    if (!agentNode) return;

    const running = agentTools.filter((t) => t.status === "running");
    const completed = agentTools.filter((t) => t.status === "completed").slice(-3);
    const toShow = [...running, ...completed];

    toShow.forEach((tool, i) => {
      const x = agentNode.position.x + (i - (toShow.length - 1) / 2) * 120;
      const y = agentNode.position.y + Y_GAP * 0.8;
      nodes.push({
        id: tool.id,
        type: "tool",
        position: { x, y },
        data: { label: tool.toolName, status: tool.status, duration: tool.duration },
      });
      edges.push({
        id: `${agentId}-${tool.id}`,
        source: agentId,
        target: tool.id,
        animated: tool.status === "running",
        style: { stroke: tool.status === "running" ? "#22C55E33" : "#2A2A2A" },
      });
    });
  });

  // Findings
  vulns.forEach((v, i) => {
    const y = 50 + i * 50;
    nodes.push({
      id: `vuln-${v.id}`,
      type: "finding",
      position: { x: 750, y },
      data: { label: v.title, severity: v.severity },
    });
  });

  return { nodes, edges };
}

// ==================== Component ====================

export default function NetworkTopology() {
  const agents = useAgentStore((s) => s.agents);
  const tools = useToolStore((s) => s.tools);
  const vulns = useVulnerabilityStore((s) => s.vulnerabilities);
  const scan = useScanStore((s) => s.activeScan);
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => calculateLayout(agents, tools, vulns, scan),
    [agents, tools, vulns, scan]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Sync layout when data changes
  useMemo(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "agent") {
        setSelectedAgent(node.id);
      }
    },
    [setSelectedAgent]
  );

  if (!scan) {
    return (
      <div className="flex items-center justify-center h-full text-strix-text-muted text-sm">
        Start a scan to see the attack topology
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} color="#1F1F1F" />
      <Controls showInteractive={false} />
      <MiniMap
        nodeStrokeWidth={3}
        nodeColor={(n) => {
          if (n.type === "target") return "#22C55E";
          if (n.type === "finding") return "#FF0000";
          if (n.type === "agent") return "#3A3A3A";
          return "#2A2A2A";
        }}
        maskColor="#0A0A0Acc"
      />
    </ReactFlow>
  );
}
