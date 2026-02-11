import { useRef, useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

interface EdgeSwipeNavProps {
  disabled?: boolean;
}

// Geometry
const EDGE_ZONE = 15;
const DEAD_ZONE = 10;
const TRIGGER_THRESHOLD = 80;
const RUBBER_BAND_FACTOR = 0.3;
const Y_DAMPING = 0.85;
const INDICATOR_SIZE = 36;
const INDICATOR_RADIUS = INDICATOR_SIZE / 2;
const GLOW_RATIO = 0.6;

// Haptic patterns
const HAPTIC_LOCK = 5;
const HAPTIC_THRESHOLD_IN: VibratePattern = [8, 30, 8];
const HAPTIC_THRESHOLD_OUT = 5;
const HAPTIC_TRIGGER: VibratePattern = [10, 40, 15];

// Animation transitions
const DISMISS_EASE = "cubic-bezier(.25,.1,.25,1)";
const DISMISS_TRANSITION = `transform 300ms ${DISMISS_EASE}, opacity 300ms ease-out`;
const DISMISS_GLOW_TRANSITION = `width 300ms ${DISMISS_EASE}, opacity 300ms ease-out`;
const DISMISS_TIMEOUT = 350;
const TRIGGER_TRANSITION = "transform 200ms ease-out, opacity 200ms ease-out";
const TRIGGER_GLOW_TRANSITION = "opacity 200ms ease-out";
const TRIGGER_TIMEOUT = 250;

// Glow gradients
const GLOW_BACK = "linear-gradient(to right, rgb(var(--color-strix-accent) / 0.08), transparent)";
const GLOW_FORWARD = "linear-gradient(to left, rgb(var(--color-strix-accent) / 0.08), transparent)";

/** Parse translate3d(x, y, ...) from a CSS transform string. */
function parseTranslate(transform: string): { x: number; y: number } {
  const m = transform.match(/translate3d\(([^,]+)px,\s*([^,]+)px/);
  return { x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0 };
}

export default function EdgeSwipeNav({ disabled = false }: EdgeSwipeNavProps) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const [mounted, setMounted] = useState(false);
  const mountedRef = useRef(false);

  const indicatorRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);

  const activeRef = useRef(false);
  const directionRef = useRef<"back" | "forward" | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lockedRef = useRef(false);
  const passedThresholdRef = useRef(false);
  const disabledRef = useRef(disabled);
  const rafRef = useRef(0);
  const animatingRef = useRef(false);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const doMount = useCallback(() => {
    mountedRef.current = true;
    setMounted(true);
  }, []);

  const doUnmount = useCallback(() => {
    mountedRef.current = false;
    animatingRef.current = false;
    setMounted(false);
  }, []);

  /** Reset all swipe-tracking refs and cancel any pending rAF. */
  const resetSwipeState = useCallback(() => {
    activeRef.current = false;
    directionRef.current = null;
    lockedRef.current = false;
    passedThresholdRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const applyIndicatorStyle = useCallback(
    (distance: number, touchY: number, progress: number, pastThreshold: boolean) => {
      const el = indicatorRef.current;
      const glow = glowRef.current;
      const icon = iconRef.current;
      if (!el || !glow) return;

      const isBack = directionRef.current === "back";
      const scale = pastThreshold ? 1.1 : 0.8 + progress * 0.2;
      const opacity = 0.15 + progress * 0.85;

      // Indicator position via translate3d (GPU composited)
      const dampedY = startYRef.current + (touchY - startYRef.current) * Y_DAMPING;
      const tx = isBack ? distance - INDICATOR_RADIUS : window.innerWidth - distance - INDICATOR_RADIUS;
      const ty = dampedY - INDICATOR_RADIUS;
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
      el.style.backgroundColor = `rgb(var(--color-strix-accent) / ${opacity})`;
      el.style.transition = "none";
      el.style.opacity = "1";

      // Icon opacity + direction flip
      if (icon) {
        icon.style.opacity = String(Math.max(0.4, progress));
        icon.style.transform = isBack ? "" : "scaleX(-1)";
      }

      // Glow
      const glowWidth = distance * GLOW_RATIO;
      glow.style.width = `${glowWidth}px`;
      glow.style.left = isBack ? "0" : "auto";
      glow.style.right = isBack ? "auto" : "0";
      glow.style.background = isBack ? GLOW_BACK : GLOW_FORWARD;
      glow.style.transition = "none";
      glow.style.opacity = "1";
    },
    [],
  );

  const runDismissAnimation = useCallback(() => {
    const el = indicatorRef.current;
    const glow = glowRef.current;
    if (!el || !glow) {
      doUnmount();
      return;
    }

    animatingRef.current = true;

    const { x, y } = parseTranslate(el.style.transform);
    const isBack = x < window.innerWidth / 2;
    const edgeX = isBack ? -INDICATOR_SIZE : window.innerWidth;

    el.style.transition = DISMISS_TRANSITION;
    el.style.transform = `translate3d(${edgeX}px, ${y}px, 0) scale(0.5)`;
    el.style.opacity = "0";

    glow.style.transition = DISMISS_GLOW_TRANSITION;
    glow.style.width = "0px";
    glow.style.opacity = "0";

    const tid = setTimeout(() => doUnmount(), DISMISS_TIMEOUT);
    el.addEventListener(
      "transitionend",
      () => {
        clearTimeout(tid);
        doUnmount();
      },
      { once: true },
    );
  }, [doUnmount]);

  const runTriggerAnimation = useCallback(
    (direction: "back" | "forward") => {
      const el = indicatorRef.current;
      const glow = glowRef.current;
      if (!el || !glow) {
        navigateRef.current(direction === "back" ? -1 : 1);
        doUnmount();
        return;
      }

      animatingRef.current = true;
      navigator.vibrate?.(HAPTIC_TRIGGER);

      const { x, y } = parseTranslate(el.style.transform);

      el.style.transition = TRIGGER_TRANSITION;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.4)`;
      el.style.opacity = "0";

      glow.style.transition = TRIGGER_GLOW_TRANSITION;
      glow.style.opacity = "0";

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        navigateRef.current(direction === "back" ? -1 : 1);
        doUnmount();
      };

      const tid = setTimeout(finish, TRIGGER_TIMEOUT);
      el.addEventListener(
        "transitionend",
        () => {
          clearTimeout(tid);
          finish();
        },
        { once: true },
      );
    },
    [doUnmount],
  );

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || animatingRef.current || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const x = touch.clientX;
      const screenW = window.innerWidth;

      let direction: "back" | "forward" | null = null;
      if (x <= EDGE_ZONE) direction = "back";
      else if (x >= screenW - EDGE_ZONE) direction = "forward";
      if (!direction) return;

      activeRef.current = true;
      directionRef.current = direction;
      startXRef.current = x;
      startYRef.current = touch.clientY;
      lockedRef.current = false;
      passedThresholdRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!activeRef.current || e.touches.length !== 1) {
        if (activeRef.current) {
          resetSwipeState();
          if (mountedRef.current) runDismissAnimation();
        }
        return;
      }

      const touch = e.touches[0];
      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      if (!lockedRef.current) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < DEAD_ZONE) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          activeRef.current = false;
          directionRef.current = null;
          return;
        }
        lockedRef.current = true;
        navigator.vibrate?.(HAPTIC_LOCK);
      }

      const isBack = directionRef.current === "back";
      const rawDistance = isBack ? dx : -dx;
      if (rawDistance < 0) return;

      e.preventDefault();

      let distance = rawDistance;
      if (distance > TRIGGER_THRESHOLD) {
        distance = TRIGGER_THRESHOLD + (distance - TRIGGER_THRESHOLD) * RUBBER_BAND_FACTOR;
      }

      const progress = Math.min(rawDistance / TRIGGER_THRESHOLD, 1);
      const pastThreshold = rawDistance >= TRIGGER_THRESHOLD;

      // Haptic at threshold crossing
      if (pastThreshold && !passedThresholdRef.current) {
        passedThresholdRef.current = true;
        navigator.vibrate?.(HAPTIC_THRESHOLD_IN);
      } else if (!pastThreshold && passedThresholdRef.current) {
        passedThresholdRef.current = false;
        navigator.vibrate?.(HAPTIC_THRESHOLD_OUT);
      }

      if (!mountedRef.current) doMount();

      const touchY = touch.clientY;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyIndicatorStyle(distance, touchY, progress, pastThreshold);
      });
    };

    const onTouchEnd = () => {
      if (!activeRef.current) return;

      const wasPastThreshold = passedThresholdRef.current;
      const direction = directionRef.current;
      resetSwipeState();

      if (wasPastThreshold && direction) {
        runTriggerAnimation(direction);
      } else if (mountedRef.current) {
        runDismissAnimation();
      }
    };

    const onTouchCancel = () => {
      if (!activeRef.current && !mountedRef.current) return;
      resetSwipeState();
      if (mountedRef.current) runDismissAnimation();
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [doMount, resetSwipeState, applyIndicatorStyle, runDismissAnimation, runTriggerAnimation]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* Edge glow */}
      <div
        ref={glowRef}
        style={{
          position: "absolute",
          top: 0,
          height: "100%",
          width: 0,
          opacity: 0,
          willChange: "width, opacity",
        }}
      />
      {/* Indicator */}
      <div
        ref={indicatorRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: INDICATOR_SIZE,
          height: INDICATOR_SIZE,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0,
          willChange: "transform, opacity",
        }}
      >
        <svg
          ref={iconRef}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.4 }}
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </div>
    </div>
  );
}
