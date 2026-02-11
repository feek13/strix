import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useScanStore } from "../store/scanStore";
import { History, Trash2, Loader2, ChevronRight, X } from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import { STATUS_DOT, STATUS_TEXT } from "../lib/statusStyles";
import { API_BASE_URL } from "../lib/config";
import { useIsMobile } from "../hooks/useIsMobile";

/** Width of the swipe-revealed delete button (px). */
const SWIPE_BTN_W = 80;

export default function ScanHistory() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { scans, setScans, removeScan } = useScanStore();

  // Desktop: inline confirmation
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Shared: loading + exit animation
  const [deleting, setDeleting] = useState<string | null>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>();

  // ─── Mobile swipe state ──────────────────────────────────────
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const cardEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const mobileListRef = useRef<HTMLDivElement>(null);
  const swipe = useRef({
    on: false,
    id: "",
    x0: 0,
    y0: 0,
    dir: null as "h" | "v" | null,
    base: 0, // starting offset (0 or -SWIPE_BTN_W)
  });

  // ─── Load scans ──────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/scans`)
      .then((r) => r.json())
      .then(setScans)
      .catch(() => {});
  }, [setScans]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  // ─── Keyboard: Escape closes confirmation / swipe ────────────
  useEffect(() => {
    if (!confirmId && !swipeOpenId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmId) setConfirmId(null);
      if (swipeOpenId) {
        snapCard(swipeOpenId, 0);
        setSwipeOpenId(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [confirmId, swipeOpenId]);

  // ─── Swipe helpers ───────────────────────────────────────────

  /** Animate a card to a target translateX with a spring curve. */
  const snapCard = useCallback((id: string, x: number) => {
    const el = cardEls.current.get(id);
    if (!el) return;
    el.style.transition = "transform 300ms cubic-bezier(.25,.1,.25,1)";
    el.style.transform = `translateX(${x}px)`;
  }, []);

  const onSwipeStart = useCallback(
    (e: React.TouchEvent, scanId: string) => {
      if (exitingId) return;
      // Close previously-open card
      if (swipeOpenId && swipeOpenId !== scanId) {
        snapCard(swipeOpenId, 0);
        setSwipeOpenId(null);
      }
      const t = e.touches[0];
      const el = cardEls.current.get(scanId);
      if (el) el.style.transition = "none";
      swipe.current = {
        on: true,
        id: scanId,
        x0: t.clientX,
        y0: t.clientY,
        dir: null,
        base: swipeOpenId === scanId ? -SWIPE_BTN_W : 0,
      };
    },
    [swipeOpenId, exitingId, snapCard],
  );

  // touchmove — attached imperatively so we can use { passive: false }
  useEffect(() => {
    const container = mobileListRef.current;
    if (!container) return;

    const onMove = (e: TouchEvent) => {
      const s = swipe.current;
      if (!s.on) return;

      const t = e.touches[0];
      const dx = t.clientX - s.x0;
      const dy = t.clientY - s.y0;

      // Determine direction once past dead-zone
      if (s.dir === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        s.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
        if (s.dir === "v") {
          s.on = false;
          return;
        }
      }
      if (s.dir !== "h") return;

      e.preventDefault(); // lock scroll while swiping

      const el = cardEls.current.get(s.id);
      if (!el) return;

      const raw = s.base + dx;
      let offset: number;
      if (raw > 0) {
        // Resist rightward drag (rubber-band)
        offset = raw * 0.15;
      } else if (raw < -SWIPE_BTN_W) {
        // Rubber-band past the button
        const over = -raw - SWIPE_BTN_W;
        offset = -SWIPE_BTN_W - over * 0.25;
      } else {
        offset = raw;
      }
      el.style.transform = `translateX(${offset}px)`;
    };

    container.addEventListener("touchmove", onMove, { passive: false });
    return () => container.removeEventListener("touchmove", onMove);
  }, []);

  const onSwipeEnd = useCallback(() => {
    const s = swipe.current;
    if (!s.on || s.dir !== "h") {
      s.on = false;
      return;
    }
    s.on = false;

    const el = cardEls.current.get(s.id);
    if (!el) return;

    // Read where the card actually is right now
    const cur = new DOMMatrix(getComputedStyle(el).transform).m41;

    el.style.transition = "transform 300ms cubic-bezier(.25,.1,.25,1)";

    if (cur < -SWIPE_BTN_W / 2) {
      // Snap open → reveal delete button
      el.style.transform = `translateX(-${SWIPE_BTN_W}px)`;
      setSwipeOpenId(s.id);
    } else {
      // Snap closed
      el.style.transform = "translateX(0)";
      setSwipeOpenId((prev) => (prev === s.id ? null : prev));
    }
  }, []);

  // ─── Delete handler (shared desktop + mobile) ───────────────

  const handleDelete = useCallback(
    async (scanId: string) => {
      setDeleting(scanId);
      try {
        const res = await fetch(`${API_BASE_URL}/api/scans/${scanId}/history`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error();

        // Haptic feedback on mobile
        if (isMobile && navigator.vibrate) navigator.vibrate(50);

        setDeleting(null);
        setConfirmId(null);
        setSwipeOpenId(null);

        // Mobile: slide the card fully off-screen via the ref
        if (isMobile) {
          const el = cardEls.current.get(scanId);
          if (el) {
            el.style.transition =
              "transform 300ms ease-out, opacity 250ms ease-out";
            el.style.transform = "translateX(-100%)";
            el.style.opacity = "0";
          }
        }

        // Trigger wrapper collapse (desktop: row fade; mobile: height collapse)
        setExitingId(scanId);

        exitTimer.current = setTimeout(() => {
          removeScan(scanId);
          setExitingId(null);
        }, 400);
        return;
      } catch {
        // ignore
      }
      setDeleting(null);
      setConfirmId(null);
    },
    [removeScan, isMobile],
  );

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <History size={20} className="text-strix-text-muted" />
        <h1 className="text-xl font-semibold">Scan History</h1>
        <span className="text-xs text-strix-text-muted bg-strix-elevated px-2 py-0.5 rounded">
          {scans.length} scans
        </span>
      </div>

      {scans.length === 0 ? (
        <div className="text-center py-16 text-strix-text-muted">
          <History size={40} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">No scans yet. Start one from the Dashboard.</p>
        </div>
      ) : (
        <>
          {/* ═══════════ Desktop: table ═══════════ */}
          <div className="hidden md:block bg-strix-card border border-strix-border-subtle rounded-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-strix-border-subtle text-strix-text-muted text-xs">
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Target</th>
                  <th className="text-left px-4 py-3 font-medium">Mode</th>
                  <th className="text-left px-4 py-3 font-medium">Findings</th>
                  <th className="text-left px-4 py-3 font-medium">Started</th>
                  <th className="text-left px-4 py-3 font-medium">Duration</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => {
                  const dur = scanDuration(scan);
                  const isConfirming = confirmId === scan.id;
                  const isDel = deleting === scan.id;
                  const isExit = exitingId === scan.id;

                  return (
                    <tr
                      key={scan.id}
                      style={{
                        opacity: isExit ? 0 : 1,
                        transform: isExit ? "translateX(-30px)" : "none",
                        transition:
                          "opacity 300ms ease-out, transform 300ms ease-out",
                      }}
                      className={clsx(
                        "border-b border-strix-border-subtle last:border-0 transition-colors group",
                        isConfirming
                          ? "bg-severity-high/5"
                          : "hover:bg-strix-elevated/50 cursor-pointer",
                      )}
                      onClick={() =>
                        !isConfirming && !isExit && navigate(`/scan/${scan.id}`)
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className={clsx(
                              "w-2 h-2 rounded-full",
                              STATUS_DOT[scan.status],
                            )}
                          />
                          <span
                            className={clsx(
                              "text-xs capitalize",
                              STATUS_TEXT[scan.status],
                            )}
                          >
                            {scan.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium truncate max-w-[300px]">
                        {scan.target}
                      </td>
                      <td className="px-4 py-3 text-strix-text-muted capitalize">
                        {scan.mode}
                      </td>
                      <td className="px-4 py-3">
                        {scan.findings > 0 ? (
                          <span className="text-severity-high font-medium">
                            {scan.findings}
                          </span>
                        ) : (
                          <span className="text-strix-text-muted">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-strix-text-muted">
                        {format(new Date(scan.createdAt), "MMM d, HH:mm")}
                      </td>
                      <td className="px-4 py-3 text-strix-text-muted">
                        {dur !== null
                          ? `${Math.floor(dur / 60)}m ${dur % 60}s`
                          : scan.status === "running"
                            ? "..."
                            : "-"}
                      </td>
                      <td
                        className="px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isConfirming ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleDelete(scan.id)}
                              disabled={isDel}
                              className="px-2 py-1 text-[11px] font-medium rounded bg-severity-high text-white hover:bg-severity-high/90 transition-colors disabled:opacity-50"
                            >
                              {isDel ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                "Delete"
                              )}
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              className="p-0.5 text-strix-text-muted hover:text-strix-text transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmId(scan.id)}
                            className="p-1.5 rounded text-strix-text-muted/0 group-hover:text-strix-text-muted hover:!text-severity-high hover:bg-severity-high/10 transition-all"
                            title="Delete scan"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ═══════════ Mobile: swipe-to-delete cards ═══════════ */}
          <div ref={mobileListRef} className="md:hidden space-y-2">
            {scans.map((scan) => {
              const dur = scanDuration(scan);
              const isExit = exitingId === scan.id;
              const isDel = deleting === scan.id;
              const isOpen = swipeOpenId === scan.id;

              return (
                /* Outer wrapper — collapses height after slide-out */
                <div
                  key={scan.id}
                  style={{
                    maxHeight: isExit ? 0 : 500,
                    transition: isExit
                      ? "max-height 250ms ease-out 150ms"
                      : "none",
                    overflow: "hidden",
                  }}
                >
                  {/* Swipe container — clips the card + delete zone */}
                  <div className="relative overflow-hidden rounded-card">
                    {/* Delete button (sits behind the card) */}
                    <button
                      onClick={() => handleDelete(scan.id)}
                      disabled={isDel}
                      className="absolute inset-y-0 right-0 flex items-center justify-center bg-severity-high text-white active:bg-severity-high/80 disabled:opacity-60"
                      style={{ width: SWIPE_BTN_W }}
                    >
                      {isDel ? (
                        <Loader2 size={20} className="animate-spin" />
                      ) : (
                        <Trash2 size={20} />
                      )}
                    </button>

                    {/* Slideable card content */}
                    <div
                      ref={(el) => {
                        if (el) cardEls.current.set(scan.id, el);
                        else cardEls.current.delete(scan.id);
                      }}
                      onTouchStart={(e) => onSwipeStart(e, scan.id)}
                      onTouchEnd={onSwipeEnd}
                      onTouchCancel={onSwipeEnd}
                      onClick={() => {
                        // If swiped open, tap closes it
                        if (isOpen) {
                          snapCard(scan.id, 0);
                          setSwipeOpenId(null);
                        } else if (!isExit) {
                          navigate(`/scan/${scan.id}`);
                        }
                      }}
                      className="relative bg-strix-card border border-strix-border-subtle p-3 select-none"
                      style={{ willChange: "transform" }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div
                            className={clsx(
                              "w-1.5 h-1.5 rounded-full",
                              STATUS_DOT[scan.status],
                            )}
                          />
                          <span
                            className={clsx(
                              "text-xs capitalize",
                              STATUS_TEXT[scan.status],
                            )}
                          >
                            {scan.status}
                          </span>
                          <span className="text-xs text-strix-text-muted capitalize">
                            {scan.mode}
                          </span>
                        </div>
                        <ChevronRight
                          size={14}
                          className="text-strix-text-muted"
                        />
                      </div>
                      <div className="text-sm font-medium truncate mb-1">
                        {scan.target}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-strix-text-muted">
                        <span>
                          {format(new Date(scan.createdAt), "MMM d, HH:mm")}
                        </span>
                        <span>
                          {dur !== null
                            ? `${Math.floor(dur / 60)}m ${dur % 60}s`
                            : scan.status === "running"
                              ? "..."
                              : "-"}
                        </span>
                        {scan.findings > 0 && (
                          <span className="text-severity-high font-medium">
                            {scan.findings} findings
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Compute scan duration in seconds, or null. */
function scanDuration(scan: { startedAt?: string | null; completedAt?: string | null }): number | null {
  if (!scan.startedAt || !scan.completedAt) return null;
  return Math.floor(
    (new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000,
  );
}
