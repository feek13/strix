import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Smooth typewriter animation using requestAnimationFrame.
 * Adaptive speed: faster catch-up for long remaining text, slower for short tails.
 * Properly cleans up rAF on unmount to prevent memory leaks.
 */
export function useTypewriter() {
  const [text, setText] = useState("");
  const targetRef = useRef("");
  const posRef = useRef(0);
  const rafRef = useRef<number>(0);

  const tick = useCallback(() => {
    const target = targetRef.current;
    const pos = posRef.current;
    if (pos < target.length) {
      const remaining = target.length - pos;
      const step = remaining > 500 ? 40 : remaining > 200 ? 20 : remaining > 50 ? 8 : 3;
      const newPos = Math.min(pos + step, target.length);
      posRef.current = newPos;
      setText(target.slice(0, newPos));
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = 0;
    }
  }, []);

  const start = useCallback((fullText: string) => {
    targetRef.current = fullText;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (targetRef.current) {
      setText(targetRef.current);
    }
    targetRef.current = "";
    posRef.current = 0;
  }, []);

  const reset = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    targetRef.current = "";
    posRef.current = 0;
    setText("");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return { text, start, stop, reset };
}
