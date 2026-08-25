"use client";
import { useEffect } from "react";
import { KiteMark } from "@/components/editor/KiteMark";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="h-screen w-screen flex flex-col items-center justify-center bg-[var(--color-bg)] px-6">
      <KiteMark size={56} muted stroke={1.3} />
      <p className="empty-state mt-8">The workshop hit a snag.</p>
      <code className="label-mono mt-6 text-[var(--color-hit)] max-w-2xl text-center bg-[oklch(0.68_0.21_25_/_0.08)] border border-[oklch(0.68_0.21_25_/_0.30)] rounded-[var(--radius-sm)] px-4 py-3">
        {error.message.slice(0, 220)}
      </code>
      <button onClick={reset} className="btn btn-primary mt-8">
        TRY AGAIN
      </button>
    </main>
  );
}
