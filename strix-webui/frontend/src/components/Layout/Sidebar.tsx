import { useState, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Radio, History, FileText, Settings,
  Search, Syringe, Lock, Workflow, Server, Target,
  Globe, Network, Terminal, Code, FileEdit,
  ShieldAlert, StickyNote, Brain, Box, Users,
  Plug, Zap, Wrench,
} from "lucide-react";
import clsx from "clsx";
import { StrixIcon } from "../ui/StrixIcon";
import { Collapsible } from "../ui/Collapsible";
import { ExpandIcon } from "../ui/ExpandIcon";

const iconMap: Record<string, React.ComponentType<{ size?: number | string }>> = {
  search: Search, syringe: Syringe, lock: Lock, workflow: Workflow,
  server: Server, target: Target, globe: Globe, network: Network,
  terminal: Terminal, code: Code, "file-edit": FileEdit,
  "shield-alert": ShieldAlert, "sticky-note": StickyNote, brain: Brain,
  box: Box, users: Users,
};

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
}

interface SubCategory {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
  items: NavItem[];
}

const mainNav: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/scan", label: "Active Scan", icon: Radio },
  { path: "/ask", label: "Ask AI", icon: StrixIcon },
];

const toolsSubCategories: SubCategory[] = [
  {
    id: "mcp",
    label: "MCP Tools",
    icon: Plug,
    items: [
      { path: "/tools/browser", label: "Browser", icon: Globe },
      { path: "/tools/proxy", label: "HTTP Proxy", icon: Network },
      { path: "/tools/terminal", label: "Terminal", icon: Terminal },
      { path: "/tools/python", label: "Python", icon: Code },
      { path: "/tools/files", label: "File Editor", icon: FileEdit },
      { path: "/tools/findings", label: "Findings", icon: ShieldAlert },
      { path: "/tools/notes", label: "Notes", icon: StickyNote },
      { path: "/tools/sandbox", label: "Sandbox", icon: Box },
      { path: "/tools/thinking", label: "Thinking", icon: Brain },
      { path: "/tools/prompts", label: "Prompt Modules", icon: Brain },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    icon: Users,
    items: [
      { path: "/tools/agents", label: "Agents", icon: Users },
    ],
  },
  {
    id: "skills",
    label: "Skills",
    icon: Zap,
    items: [
      { path: "/tools/recon", label: "Recon", icon: Search },
      { path: "/tools/injection", label: "Injection Testing", icon: Syringe },
      { path: "/tools/auth", label: "Auth Testing", icon: Lock },
      { path: "/tools/logic", label: "Logic Testing", icon: Workflow },
      { path: "/tools/platform", label: "Platform Testing", icon: Server },
      { path: "/tools/redteam", label: "Red Team Ops", icon: Target },
    ],
  },
];

const resultsNav: NavItem[] = [
  { path: "/findings", label: "Findings", icon: ShieldAlert },
  { path: "/reports", label: "Reports", icon: FileText },
  { path: "/history", label: "Scan History", icon: History },
];

interface SidebarProps {
  onNavClick?: () => void;
}

function isItemActive(pathname: string, itemPath: string): boolean {
  if (itemPath === "/") return pathname === "/";
  if (itemPath === "/scan")
    return pathname === "/scan" || (pathname.startsWith("/scan/") && !pathname.endsWith("/report"));
  if (itemPath === "/reports")
    return pathname === "/reports" || pathname.endsWith("/report");
  return pathname.startsWith(itemPath);
}

function NavSection({ title, items, onNavClick }: { title?: string; items: NavItem[]; onNavClick?: () => void }) {
  const { pathname } = useLocation();

  return (
    <div className="mb-2">
      {title && (
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-strix-text-muted">
          {title}
        </div>
      )}
      {items.map((item) => {
        const active = isItemActive(pathname, item.path);
        return (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavClick}
            className={clsx(
              "flex items-center gap-3 px-3 py-3 md:py-2 mx-2 rounded-btn text-sm transition-colors",
              active
                ? "bg-strix-elevated text-strix-text"
                : "text-strix-text-secondary hover:text-strix-text hover:bg-strix-elevated/50"
            )}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}

function CollapsibleToolsSection({
  subCategories,
  onNavClick,
}: {
  subCategories: SubCategory[];
  onNavClick?: () => void;
}) {
  const { pathname } = useLocation();

  // Determine which sub-category contains the active route
  const activeSubCategoryId = useMemo(() => {
    for (const sub of subCategories) {
      for (const item of sub.items) {
        if (isItemActive(pathname, item.path)) return sub.id;
      }
    }
    return null;
  }, [pathname, subCategories]);

  // Top-level open if any child is active, otherwise default open
  const [topOpen, setTopOpen] = useState(true);

  // Sub-categories: auto-expand the one containing the active route
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(() => {
    return activeSubCategoryId ? new Set([activeSubCategoryId]) : new Set<string>();
  });

  const toggleSub = (id: string) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // If pathname changes and lands in a sub-category, auto-expand it
  useMemo(() => {
    if (activeSubCategoryId && !expandedSubs.has(activeSubCategoryId)) {
      setExpandedSubs((prev) => new Set(prev).add(activeSubCategoryId));
    }
    if (activeSubCategoryId && !topOpen) {
      setTopOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubCategoryId]);

  return (
    <div className="mb-2">
      {/* Top-level "Tools" header */}
      <button
        onClick={() => setTopOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-strix-text-muted hover:text-strix-text transition-colors"
      >
        <ExpandIcon isExpanded={topOpen} size={12} />
        <Wrench size={12} />
        <span>Tools</span>
      </button>

      {/* Sub-categories */}
      <Collapsible isExpanded={topOpen}>
          {subCategories.map((sub) => {
            const isSubExpanded = expandedSubs.has(sub.id);
            const hasActiveChild = sub.id === activeSubCategoryId;

            return (
              <div key={sub.id}>
                {/* Sub-category header */}
                <button
                  onClick={() => toggleSub(sub.id)}
                  className={clsx(
                    "w-full flex items-center gap-2.5 pl-5 pr-3 py-2 md:py-1.5 text-xs transition-colors rounded-btn mx-1",
                    hasActiveChild
                      ? "text-strix-text"
                      : "text-strix-text-secondary hover:text-strix-text"
                  )}
                >
                  <ExpandIcon isExpanded={isSubExpanded} size={10} className="shrink-0" />
                  <span className="shrink-0"><sub.icon size={14} /></span>
                  <span>{sub.label}</span>
                  <span className="ml-auto text-[10px] text-strix-text-muted">{sub.items.length}</span>
                </button>

                {/* Sub-category children */}
                <Collapsible isExpanded={isSubExpanded}>
                    {sub.items.map((item) => {
                      const active = isItemActive(pathname, item.path);
                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={onNavClick}
                          className={clsx(
                            "flex items-center gap-2.5 pl-10 pr-3 py-2 md:py-1.5 mx-2 rounded-btn text-xs transition-colors",
                            active
                              ? "bg-strix-elevated text-strix-text"
                              : "text-strix-text-secondary hover:text-strix-text hover:bg-strix-elevated/50"
                          )}
                        >
                          <span className="shrink-0"><item.icon size={14} /></span>
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                </Collapsible>
              </div>
            );
          })}
      </Collapsible>
    </div>
  );
}

export default function Sidebar({ onNavClick }: SidebarProps) {
  return (
    <aside className="w-full md:w-56 h-full bg-strix-card border-r border-strix-border-subtle flex flex-col overflow-y-auto">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-strix-border-subtle">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-strix-accent flex items-center justify-center">
            <ShieldAlert size={16} className="text-strix-text-on-accent" />
          </div>
          <span className="font-semibold text-base">Strix</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-strix-elevated text-strix-text-muted">beta</span>
        </div>
      </div>

      <div className="flex-1 py-2 overflow-y-auto">
        <NavSection items={mainNav} onNavClick={onNavClick} />

        <div className="mx-4 my-2 border-t border-strix-border-subtle" />
        <CollapsibleToolsSection subCategories={toolsSubCategories} onNavClick={onNavClick} />

        <div className="mx-4 my-2 border-t border-strix-border-subtle" />
        <NavSection title="Results" items={resultsNav} onNavClick={onNavClick} />
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-strix-border-subtle">
        <NavLink
          to="/settings"
          onClick={onNavClick}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-3 px-3 py-3 md:py-2 mx-0 rounded-btn text-sm transition-colors",
              isActive
                ? "bg-strix-elevated text-strix-text"
                : "text-strix-text-secondary hover:text-strix-text hover:bg-strix-elevated/50"
            )
          }
        >
          <Settings size={16} />
          <span>Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
