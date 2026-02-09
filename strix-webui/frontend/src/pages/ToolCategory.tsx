import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { TOOL_CATEGORIES, SKILL_CATEGORIES } from "../types";
import {
  Globe, Network, Terminal, Code, FileEdit, ShieldAlert, StickyNote,
  Brain, Box, Users, Search, Syringe, Lock, Workflow, Server, Target, Play,
} from "lucide-react";
import clsx from "clsx";

const iconMap: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  globe: Globe, network: Network, terminal: Terminal, code: Code,
  "file-edit": FileEdit, "shield-alert": ShieldAlert, "sticky-note": StickyNote,
  brain: Brain, box: Box, users: Users, search: Search, syringe: Syringe,
  lock: Lock, workflow: Workflow, server: Server, target: Target,
};

const skillDescriptions: Record<string, string> = {
  recon: "Map the attack surface - discover endpoints, technologies, and potential entry points.",
  injection: "Test for SQL injection, XSS, command injection, XXE, and path traversal vulnerabilities.",
  auth: "Test authentication flows, JWT tokens, IDOR, CSRF, and broken access control.",
  logic: "Test business logic flaws - race conditions, mass assignment, workflow bypasses.",
  platform: "Platform-specific testing for GraphQL, FastAPI, Next.js, Firebase, Supabase.",
  redteam: "Full red team simulation with exploitation, persistence, and lateral movement.",
};

function SkillPage({ skill, navigate }: { skill: typeof SKILL_CATEGORIES[number]; navigate: ReturnType<typeof useNavigate> }) {
  const [target, setTarget] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const Icon = iconMap[skill.icon] || ShieldAlert;

  const handleStart = async () => {
    if (!target.trim() || isStarting) return;
    setIsStarting(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), mode: skill.id }),
      });
      if (res.ok) {
        const scan = await res.json();
        navigate(`/scan/${scan.id}`);
      } else {
        const err = await res.json();
        console.error("Failed to start scan:", err.error);
      }
    } catch (err) {
      console.error("Failed to start scan:", err);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-card bg-strix-accent/10 border border-strix-accent/20 flex items-center justify-center">
          <Icon size={20} className="text-strix-accent" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{skill.label}</h1>
          <p className="text-xs text-strix-text-muted">Security testing skill</p>
        </div>
      </div>

      <p className="text-sm text-strix-text-secondary mt-4 mb-6">
        {skillDescriptions[skill.id] || "Specialized security testing skill."}
      </p>

      <div className="bg-strix-card border border-strix-border-subtle rounded-card p-5">
        <h3 className="text-sm font-medium mb-3">Quick Start</h3>
        <p className="text-xs text-strix-text-secondary mb-4">
          Enter a target to start a focused {skill.label.toLowerCase()} assessment:
        </p>

        <div className="flex gap-3">
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
            placeholder="https://target.com"
            className="flex-1 bg-strix-elevated border border-strix-border rounded-btn px-3 py-2 text-sm text-strix-text placeholder:text-strix-text-muted focus:outline-none focus:border-strix-accent"
          />
          <button
            onClick={handleStart}
            disabled={!target.trim() || isStarting}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium transition-colors",
              target.trim() && !isStarting
                ? "bg-strix-accent text-strix-text-on-accent hover:bg-strix-accent-hover"
                : "bg-strix-elevated text-strix-text-muted cursor-not-allowed"
            )}
          >
            <Play size={14} />
            {isStarting ? "Starting..." : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ToolCategory() {
  const { category } = useParams();
  const navigate = useNavigate();

  // Check if this is a skill category
  const skill = SKILL_CATEGORIES.find((s) => s.id === category);
  const toolCat = TOOL_CATEGORIES.find((t) => t.id === category);

  if (skill) {
    return <SkillPage skill={skill} navigate={navigate} />;
  }

  if (toolCat) {
    const Icon = iconMap[toolCat.icon] || ShieldAlert;

    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-card bg-strix-elevated border border-strix-border-subtle flex items-center justify-center">
            <Icon size={20} className="text-strix-text-secondary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{toolCat.label}</h1>
            <p className="text-xs text-strix-text-muted">{toolCat.tools.length} tools</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {toolCat.tools.map((tool) => (
            <div
              key={tool}
              className="bg-strix-card border border-strix-border-subtle rounded-card p-4 hover:border-strix-border transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded bg-strix-elevated flex items-center justify-center">
                  <Code size={12} className="text-strix-text-muted" />
                </div>
                <span className="text-sm font-medium font-mono">{tool}</span>
              </div>
              <p className="text-xs text-strix-text-muted">
                MCP tool available during security scans
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 text-center text-strix-text-muted">
      <p>Category not found</p>
    </div>
  );
}
