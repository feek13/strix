interface StrixIconProps {
  size?: number | string;
  className?: string;
}

/**
 * Strix owl icon — simplified version of the favicon.
 * Uses `currentColor` so it works with Tailwind text-color classes
 * just like lucide-react icons.
 */
export function StrixIcon({ size = 24, className }: StrixIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      {/* Ear tufts */}
      <path
        d="M7.5 8L5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16.5 8L19 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Head */}
      <path
        d="M12 22C6.5 22 3 17.5 3 12.5S6.5 3.5 12 3.5s9 4.5 9 9-3.5 9.5-9 9.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="currentColor"
        fillOpacity="0.08"
      />
      {/* Eye sockets */}
      <circle cx="8.5" cy="12" r="3.2" fill="currentColor" fillOpacity="0.12" />
      <circle cx="15.5" cy="12" r="3.2" fill="currentColor" fillOpacity="0.12" />
      {/* Irises */}
      <circle cx="8.5" cy="12" r="2" fill="currentColor" />
      <circle cx="15.5" cy="12" r="2" fill="currentColor" />
      {/* Beak */}
      <path
        d="M11.2 16L12 18l.8-2"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />
    </svg>
  );
}
