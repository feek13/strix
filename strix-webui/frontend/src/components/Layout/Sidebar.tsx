import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Radio, History, FileText, Settings,
  Search, Syringe, Lock, Workflow, Server, Target,
  Globe, Network, Terminal, Code, FileEdit,
  ShieldAlert, StickyNote, Brain, Box, Users, Bot,
} from "lucide-react";
import clsx from "clsx";

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

const mainNav: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/scan", label: "Active Scan", icon: Radio },
  { path: "/ask", label: "Ask AI", icon: Bot },
];

const testingNav: NavItem[] = [
  { path: "/tools/recon", label: "Recon", icon: Search },
  { path: "/tools/injection", label: "Injection Testing", icon: Syringe },
  { path: "/tools/auth", label: "Auth Testing", icon: Lock },
  { path: "/tools/logic", label: "Logic Testing", icon: Workflow },
  { path: "/tools/platform", label: "Platform Testing", icon: Server },
  { path: "/tools/redteam", label: "Red Team Ops", icon: Target },
];

const toolsNav: NavItem[] = [
  { path: "/tools/browser", label: "Browser", icon: Globe },
  { path: "/tools/proxy", label: "HTTP Proxy", icon: Network },
  { path: "/tools/terminal", label: "Terminal", icon: Terminal },
  { path: "/tools/python", label: "Python", icon: Code },
  { path: "/tools/files", label: "File Editor", icon: FileEdit },
];

const resultsNav: NavItem[] = [
  { path: "/findings", label: "Findings", icon: ShieldAlert },
  { path: "/reports", label: "Reports", icon: FileText },
  { path: "/history", label: "Scan History", icon: History },
];

function NavSection({ title, items }: { title?: string; items: NavItem[] }) {
  return (
    <div className="mb-2">
      {title && (
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-strix-text-muted">
          {title}
        </div>
      )}
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-3 px-3 py-2 mx-2 rounded-btn text-sm transition-colors",
              isActive
                ? "bg-strix-elevated text-white"
                : "text-strix-text-secondary hover:text-white hover:bg-strix-elevated/50"
            )
          }
        >
          <item.icon size={16} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}

export default function Sidebar() {
  return (
    <aside className="w-56 h-full bg-strix-card border-r border-strix-border-subtle flex flex-col overflow-y-auto">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-strix-border-subtle">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-strix-accent flex items-center justify-center">
            <ShieldAlert size={16} className="text-black" />
          </div>
          <span className="font-semibold text-base">Strix</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-strix-elevated text-strix-text-muted">beta</span>
        </div>
      </div>

      <div className="flex-1 py-2 overflow-y-auto">
        <NavSection items={mainNav} />

        <div className="mx-4 my-2 border-t border-strix-border-subtle" />
        <NavSection title="Testing" items={testingNav} />

        <div className="mx-4 my-2 border-t border-strix-border-subtle" />
        <NavSection title="Tools" items={toolsNav} />

        <div className="mx-4 my-2 border-t border-strix-border-subtle" />
        <NavSection title="Results" items={resultsNav} />
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-strix-border-subtle">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-3 px-3 py-2 mx-0 rounded-btn text-sm transition-colors",
              isActive
                ? "bg-strix-elevated text-white"
                : "text-strix-text-secondary hover:text-white hover:bg-strix-elevated/50"
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
