import clsx from "clsx";

export interface MobileTab {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface MobileTabBarProps {
  tabs: MobileTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export default function MobileTabBar({ tabs, activeTab, onTabChange }: MobileTabBarProps) {
  return (
    <div className="flex items-center bg-strix-card border-b border-strix-border-subtle shrink-0 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={clsx(
            "flex items-center justify-center gap-1.5 px-4 py-3 text-xs font-medium transition-colors whitespace-nowrap min-h-[44px] min-w-[44px] flex-1",
            activeTab === tab.id
              ? "text-strix-text border-b-2 border-strix-accent bg-strix-elevated/50"
              : "text-strix-text-muted"
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
