"use client";
import React from "react";
import { KiteMark } from "./KiteMark";

interface State {
  error: Error | null;
}

/**
 * THE LAST LINE. A crash anywhere inside the editor renders this instead of whitescreening the page.
 *
 * Two things about the copy, both of which the previous version got wrong. It said "The workshop hit
 * a snag" — WORKSHOP is the first item on ART-DIRECTION §13's kill list, and it was the one word
 * standing between the user and the only thing they actually want to know, which is whether their
 * work is gone. It is not: every edit is persisted through the 500ms autosave debounce and the
 * timeline is reloaded from the database on the next request, so a reload really is the whole fix.
 * Saying so is the difference between a crash screen and an apology.
 *
 * The engine's own message stays, verbatim and selectable, because it is the only thing worth pasting
 * into a bug report and hiding it would trade one dishonesty for another.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[editor] crash:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-full w-full flex-col items-center justify-center gap-[var(--space-5)] px-[var(--gutter)]">
        <KiteMark size={48} stroke={1.6} accent />
        <p className="italic-serif text-center" style={{ fontSize: "44px", lineHeight: 1.05, color: "var(--t-2)" }}>
          Something broke
        </p>
        <p className="max-w-[46ch] text-center text-[15px] leading-relaxed text-[var(--t-3)]">
          Your cut is saved. Reloading this page picks it back up from where it was.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="inline-flex h-[var(--tap)] items-center rounded-[var(--r-sm)] px-[var(--space-5)] text-[15px] font-medium"
          style={{ background: "var(--color-accent-cta)", color: "var(--color-on-accent)", boxShadow: "var(--shadow-cta)" }}
        >
          Try again
        </button>
        <code className="max-w-[62ch] whitespace-pre-wrap break-words text-center font-mono text-[12px] text-[var(--t-4)]">
          {this.state.error.message.slice(0, 500)}
        </code>
      </main>
    );
  }
}
