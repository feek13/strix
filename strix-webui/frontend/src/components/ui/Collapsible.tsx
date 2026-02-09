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
        "grid transition-[grid-template-rows] duration-300 ease-spring will-change-[grid-template-rows]",
        isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        className
      )}
    >
      <div
        className={clsx(
          "overflow-hidden transition-opacity duration-300 ease-spring",
          isExpanded ? "opacity-100" : "opacity-0"
        )}
      >
        {children}
      </div>
    </div>
  );
}
