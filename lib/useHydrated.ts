"use client";
import { useSyncExternalStore } from "react";

/**
 * Has the client hydrated yet?
 *
 * `false` on the server AND on the hydration render, `true` from the first client render after
 * that — the gate for anything whose real value the server cannot know (a store seeded from
 * localStorage, a portal into `document.body`). Rendering the server's answer first and swapping
 * afterwards is what keeps the server HTML and the first client paint identical.
 *
 * `useSyncExternalStore` rather than `useState(false)` + `useEffect(() => setMounted(true))` — the
 * shape this replaced — for the same reason `useModifierKeys` (components/editor/platformKeys.ts)
 * uses it: hydration IS an external, one-way transition, so React can swap the server snapshot for
 * the client one itself instead of us triggering a cascading render from an effect.
 */
const NEVER_CHANGES = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(NEVER_CHANGES, hydratedSnapshot, serverSnapshot);
}
