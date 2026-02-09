import { useEffect, useCallback } from "react";
import clsx from "clsx";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  side?: "left" | "right";
  width?: string;
  children: React.ReactNode;
}

export default function MobileDrawer({
  isOpen,
  onClose,
  side = "left",
  width = "w-72",
  children,
}: MobileDrawerProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [isOpen]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-black/60 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className={clsx(
          "fixed top-0 z-50 h-full bg-strix-card border-strix-border-subtle transition-transform duration-300 ease-in-out flex flex-col",
          width,
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          side === "left"
            ? (isOpen ? "translate-x-0" : "-translate-x-full")
            : (isOpen ? "translate-x-0" : "translate-x-full")
        )}
      >
        {children}
      </div>
    </>
  );
}
