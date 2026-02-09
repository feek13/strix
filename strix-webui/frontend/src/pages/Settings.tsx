import { useState } from "react";
import { Settings as SettingsIcon, Terminal, Globe, Key, Info, Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemePreference } from "../hooks/useTheme";
import clsx from "clsx";

const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [claudePath, setClaudePath] = useState("claude");
  const [wsPort, setWsPort] = useState("3001");
  const [apiPort, setApiPort] = useState("3000");

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon size={20} className="text-strix-text-muted" />
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>

      <div className="space-y-6">
        {/* Appearance */}
        <div className="bg-strix-card border border-strix-border-subtle rounded-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sun size={16} className="text-strix-accent" />
            <h3 className="text-sm font-medium">Appearance</h3>
          </div>

          <div className="flex gap-2">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={clsx(
                  "flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium transition-colors",
                  theme === opt.value
                    ? "bg-strix-accent text-strix-text-on-accent"
                    : "bg-strix-elevated text-strix-text-secondary hover:text-strix-text"
                )}
              >
                <opt.icon size={14} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Claude Code */}
        <div className="bg-strix-card border border-strix-border-subtle rounded-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Terminal size={16} className="text-strix-accent" />
            <h3 className="text-sm font-medium">Claude Code Integration</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-strix-text-muted mb-1 block">Claude CLI Path</label>
              <input
                type="text"
                value={claudePath}
                onChange={(e) => setClaudePath(e.target.value)}
                className="w-full bg-strix-elevated border border-strix-border rounded-btn px-3 py-2 text-sm text-strix-text focus:outline-none focus:border-strix-accent"
              />
            </div>

            <div className="flex items-start gap-2 p-3 bg-strix-elevated rounded-btn">
              <Info size={14} className="text-severity-low shrink-0 mt-0.5" />
              <div className="text-xs text-strix-text-secondary">
                Hooks are automatically installed when you run <code className="text-strix-accent">npm run install:hooks</code>.
                They intercept Claude Code tool calls and stream events to this UI.
              </div>
            </div>
          </div>
        </div>

        {/* Server */}
        <div className="bg-strix-card border border-strix-border-subtle rounded-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={16} className="text-strix-accent" />
            <h3 className="text-sm font-medium">Server Configuration</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-strix-text-muted mb-1 block">API Port</label>
              <input
                type="text"
                value={apiPort}
                onChange={(e) => setApiPort(e.target.value)}
                className="w-full bg-strix-elevated border border-strix-border rounded-btn px-3 py-2 text-sm text-strix-text focus:outline-none focus:border-strix-accent"
              />
            </div>
            <div>
              <label className="text-xs text-strix-text-muted mb-1 block">WebSocket Port</label>
              <input
                type="text"
                value={wsPort}
                onChange={(e) => setWsPort(e.target.value)}
                className="w-full bg-strix-elevated border border-strix-border rounded-btn px-3 py-2 text-sm text-strix-text focus:outline-none focus:border-strix-accent"
              />
            </div>
          </div>
        </div>

        {/* API Keys */}
        <div className="bg-strix-card border border-strix-border-subtle rounded-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Key size={16} className="text-strix-accent" />
            <h3 className="text-sm font-medium">Environment</h3>
          </div>

          <div className="text-xs text-strix-text-secondary space-y-2">
            <p>API keys are configured via environment variables in your shell:</p>
            <pre className="bg-strix-elevated rounded-btn p-3 font-mono text-[11px] text-strix-text-muted">
{`export STRIX_LLM="anthropic/claude-sonnet-4-5"
export LLM_API_KEY="sk-..."
export PERPLEXITY_API_KEY="pplx-..."  # optional`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
