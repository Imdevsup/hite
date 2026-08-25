"use client";

/**
 * THE LANDING → EDITOR HANDOFF.
 *
 * A landing CTA links to `/app?prompt=<the edit>`. `/app` is the list of cuts, so when a sentence is
 * present a fresh cut is opened (the same `POST /api/projects` the button uses) and the sentence is
 * forwarded to `/app/[id]?prompt=…`, where the composer holds it as its initial value.
 *
 * ONE-SHOT AND REF-GUARDED, because a re-render must not open a second project. When the request
 * fails, the reason is shown with a way back — the previous version's overlay said
 * `OPENING A NEW CUT…` in uppercase mono over a blurred scrim and, on failure, dropped a raw error
 * string with a `Back to projects` button under it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export function DeepLinkPrompt() {
  const router = useRouter();
  const params = useSearchParams();
  const prompt = params.get("prompt");
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prompt || !prompt.trim() || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Untitled cut" }),
        });
        if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
        const { id } = (await res.json()) as { id: string };
        router.replace(`/app/${id}?prompt=${encodeURIComponent(prompt)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [prompt, router]);

  if (!prompt || !prompt.trim()) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex flex-col items-center justify-center gap-[var(--space-4)] px-[var(--gutter)] text-center"
      style={{ background: "var(--color-bg)" }}
    >
      {error ? (
        <>
          <p role="alert" className="max-w-[46ch] text-[15px] leading-relaxed" style={{ color: "var(--color-hit)" }}>
            HITE couldn&rsquo;t open a cut for that — {error}
          </p>
          <Link
            href="/app"
            className="inline-flex h-[var(--tap)] items-center rounded-[var(--r-sm)] px-[var(--space-5)] text-[15px] font-medium"
            style={{ background: "var(--color-accent-cta)", color: "var(--color-on-accent)" }}
          >
            Go to your cuts
          </Link>
        </>
      ) : (
        <>
          <p role="status" aria-live="polite" className="text-[15px] text-[var(--t-3)]">
            Opening a cut for
          </p>
          <p className="max-w-[46ch] text-[19px] leading-snug text-[var(--t-1)]">&ldquo;{prompt}&rdquo;</p>
        </>
      )}
    </div>
  );
}
