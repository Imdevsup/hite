"use client";

import styles from "./settings.module.css";
import { fetchSettings } from "./providerKey";
import type { SettingsSnapshot } from "./types";
import { useEffect, useState } from "react";

/**
 * §14.4 — WHAT LEAVES THIS BROWSER. "One list, ≤ 40 words, plain language: what is sent, to whom,
 * and what is not. No legal register, no accordion, no link to a policy page as a substitute for
 * saying it."
 *
 * Every row is a route that exists in this repository, not a category from a privacy template:
 *   · the key travels in a header on each request and is never persisted (`lib/ai/keys.ts`);
 *   · media is uploaded by the BROWSER straight into this deployment's Supabase storage
 *     (`components/editor/mediaUpload.ts` → `lib/storage/upload.ts`), so it does not pass through
 *     the planner and it never reaches a model provider;
 *   · audio reaches Groq only for speech-to-text (`lib/ai/transcribe.ts`), and only where the
 *     deployer configured it — which is why that row is gated on the route's own
 *     `transcription.groq.configured` rather than stated unconditionally.
 *
 * THE MODEL PROVIDER IS NOT NAMED, and that is the correction this file carries. It used to read
 * "This browser → this server → Google, on every request", which was true of a Gemini-only build and
 * is a fabricated claim about a destination on a build where the visitor picks one of eight. The row
 * names the mechanism — the provider YOU chose — because that is the part this surface can state
 * without knowing which one is selected in another component's state.
 *
 * It reads the route itself rather than taking a prop: the sheet's other half is
 * `ProviderPickerPanel`, which owns its own read, and threading one boolean through two components
 * to save a `no-store` GET is the coupling that made the last version of this sheet undeployable.
 */
export function DataFlow() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // A failed read means one CONDITIONAL row is not drawn. The two unconditional rows are facts
    // about this repository, not about the deployment, so they are stated either way.
    void fetchSettings(controller.signal)
      .then((next) => setSnapshot(next))
      .catch(() => setSnapshot(null));
    return () => controller.abort();
  }, []);

  return (
    <section className={styles.section} aria-labelledby="hite-settings-flow">
      <h3 className={styles.sectionTitle} id="hite-settings-flow">
        What leaves this browser
      </h3>
      <ul className={styles.flow}>
        <li className={styles.flowRow}>
          <span className={styles.flowWhat}>Your key</span>
          <span className={styles.flowWhere}>
            This browser → this server → the provider you picked, on every request. Never stored on
            the server.
          </span>
        </li>
        <li className={styles.flowRow}>
          <span className={styles.flowWhat}>Your video</span>
          <span className={styles.flowWhere}>
            Straight to this deployment&rsquo;s Supabase storage. Never to a model provider.
          </span>
        </li>
        {snapshot?.transcription.groqConfigured === true ? (
          <li className={styles.flowRow}>
            <span className={styles.flowWhat}>Your audio</span>
            <span className={styles.flowWhere}>This server, then Groq, for the transcript.</span>
          </li>
        ) : null}
      </ul>
      {/* §14.4: "Remotion's licence is disclosed here and in the FAQ." remotion@4.0.450 is a direct
          dependency of this app; the repository's own LICENSE is MIT. */}
      <p className={styles.note}>
        Preview and export both run on Remotion, which requires a paid company licence above its
        headcount threshold. HITE itself is MIT.
      </p>
    </section>
  );
}
