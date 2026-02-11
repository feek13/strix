import clsx from "clsx";
import type { ReactNode } from "react";

interface CollapsibleProps {
  isExpanded: boolean;
  children: ReactNode;
  className?: string;
}

export function Collapsible({ isExpanded, children, className }: CollapsibleProps) {
  return (
    <div
      className={clsx(
        "grid transition-[grid-template-rows] duration-200 ease-out",
        isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        className
      )}
    >
      <div className="overflow-hidden">
        {children}
      </div>
    </div>
  );
}
