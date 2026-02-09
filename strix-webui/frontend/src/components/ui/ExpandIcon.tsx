import { ChevronRight } from "lucide-react";
import clsx from "clsx";

interface ExpandIconProps {
  isExpanded: boolean;
  size?: number;
  className?: string;
}

export function ExpandIcon({ isExpanded, size = 12, className }: ExpandIconProps) {
  return (
    <ChevronRight
      size={size}
      className={clsx(
        "transition-transform duration-300 ease-spring will-change-transform",
        isExpanded && "rotate-90",
        className
      )}
    />
  );
}
