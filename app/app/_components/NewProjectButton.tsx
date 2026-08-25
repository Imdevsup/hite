"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * START A CUT.
 *
 * Two things changed beyond the label. It used to say `NEW PROJECT` in uppercase mono behind a plus
 * icon — the documentation voice §13 kills — and, more importantly, a failure was a `console.error`
 * and a button that quietly re-enabled itself. Pressing it and having nothing happen, twice, with no
 * explanation, is the failure class this whole unit is about. The server's own words are shown.
 */
export function NewProjectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled cut" }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      router.push(`/app/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-[var(--space-2)]">
      <button
        type="button"
        onClick={() => void create()}
        aria-disabled={busy}
        className="inline-flex h-[var(--tap)] items-center rounded-[var(--r-sm)] px-[var(--space-5)] text-[15px] font-medium"
        style={{ background: "var(--color-accent-cta)", color: "var(--color-on-accent)", boxShadow: "var(--shadow-cta)" }}
      >
        {busy ? "Opening" : "Start a cut"}
      </button>
      {error && (
        <p role="alert" className="max-w-[46ch] text-center text-[13px] leading-relaxed" style={{ color: "var(--color-hit)" }}>
          HITE couldn&rsquo;t open a new cut — {error}
        </p>
      )}
    </div>
  );
}
