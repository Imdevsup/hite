"use client";

/**
 * app/_landing/FilmPlayer.tsx — the film section's player.
 *
 * It plays itself when it scrolls into view and stops when it leaves, so nobody has to decide to
 * press anything, and it costs nothing to a visitor who never scrolls that far.
 *
 * MUTED IS NOT A STYLE CHOICE. Every browser blocks autoplay with sound, and a page that starts
 * making noise at you is a page people close. So it starts muted and carries one control — a sound
 * toggle — which is also the only affordance here: no chrome, no border, no play button sitting on
 * top of the picture. Unmuting is a real user gesture, which is what lets the audio start at all.
 *
 * `preload="metadata"` deliberately: the file is ~10 MB and a visitor who bounces off the hero
 * should never pay for it.
 */
import { useEffect, useRef, useState } from "react";

export function FilmPlayer({ src, label }: { readonly src: string; readonly label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A visitor who has asked for less motion gets a still first frame and the controls to start it
    // themselves; autoplaying a 25-second cut at them is exactly what that setting is about.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.controls = true;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // play() rejects when the browser declines (a policy block, or the tab is hidden). That is
          // not an error worth surfacing — the sound toggle is still there — but it must be caught
          // or it becomes an unhandled rejection.
          if (e.isIntersecting) void el.play().catch(() => undefined);
          else el.pause();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="l3d-film-stage">
      <video
        ref={ref}
        className="l3d-film-video"
        src={src}
        aria-label={label}
        muted={muted}
        loop
        playsInline
        preload="metadata"
      />
      <button
        type="button"
        className="l3d-film-sound"
        aria-pressed={!muted}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          const next = !muted;
          el.muted = next;
          setMuted(next);
          if (!next) void el.play().catch(() => undefined);
        }}
      >
        {muted ? "Sound on" : "Sound off"}
      </button>
    </div>
  );
}
