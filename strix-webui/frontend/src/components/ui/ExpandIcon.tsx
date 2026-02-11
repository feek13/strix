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
        "transition-transform duration-200 ease-out",
        isExpanded && "rotate-90",
        className
      )}
    />
  );
}
