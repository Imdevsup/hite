"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook for "set a value after the pointer has hovered for N ms". Skimming
 * over rows doesn't fire the delayed action, but a brief pause does. Used
 * to gate expensive preview loads in palette lists.
 *
 * @returns [value, onEnter, onLeave]
 */
export function useHoverDelay<T>(delayMs = 150): [T | null, (v: T) => void, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = useCallback((v: T) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setValue(v), delayMs);
  }, [delayMs]);

  const onLeave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setValue(null);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return [value, onEnter, onLeave];
}
