/**
 * ui/dom.ts — L6: the DOM layer, driven from SceneState every frame.
 *
 * The page server-renders every element here (hero copy, subtitles, HUD, eyebrow, final CTA); this
 * module only finds them by id and writes transforms, opacities and text. Nothing is created, so a
 * visitor without JS sees the complete, static page, and the honesty tests can read the copy from
 * the SSR output.
 */
import { SUBTITLES, formatClock, formatTimecode } from "../choreography/script";
import type { SceneState } from "../choreography/master";

export const IDS = {
  root: "l3d",
  canvas: "l3d-canvas",
  scroll: "l3d-scroll",
  hero: "l3d-hero",
  hint: "l3d-hint",
  eyebrow: "l3d-eyebrow",
  subtitle: "l3d-subtitle",
  hud: "l3d-hud",
  hudDuration: "l3d-hud-duration",
  hudSilences: "l3d-hud-silences",
  timecode: "l3d-timecode",
  headers: "l3d-headers",
  badge: "l3d-badge",
  final: "l3d-final",
  flash: "l3d-flash",
  debug: "l3d-debug",
} as const;

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

export class DomLayer {
  private readonly hero = byId(IDS.hero);
  private readonly hint = byId(IDS.hint);
  private readonly eyebrow = byId(IDS.eyebrow);
  private readonly subtitle = byId(IDS.subtitle);
  private readonly hud = byId(IDS.hud);
  private readonly hudDuration = byId(IDS.hudDuration);
  private readonly hudSilences = byId(IDS.hudSilences);
  private readonly timecode = byId(IDS.timecode);
  private readonly headers = byId(IDS.headers);
  private readonly badge = byId(IDS.badge);
  private readonly final = byId(IDS.final);
  private readonly flash = byId(IDS.flash);
  private readonly canvas = byId(IDS.canvas);
  private activeSubtitle = -1;
  private lastDuration = "";
  private lastSilences = "";
  private lastTimecode = "";

  /** Build the per-word spans once so the reveal is a class toggle, not a re-render. */
  constructor() {
    const subtitle = this.subtitle;
    if (subtitle) {
      subtitle.replaceChildren();
      SUBTITLES.forEach((s, i) => {
        const line = document.createElement("p");
        line.className = "l3d-sub";
        line.dataset.index = String(i);
        s.text.split(" ").forEach((word, w) => {
          const span = document.createElement("span");
          span.textContent = word;
          span.style.setProperty("--w", String(w));
          line.append(span, " ");
        });
        subtitle.append(line);
      });
    }
  }

  update(S: SceneState, p: number, playhead: Projected, badge: Projected, headers: readonly Projected[], totalSeconds: number): void {
    const d = S.dom;
    if (this.hero) {
      const lift = d.heroLift;
      this.hero.style.transform = `translate3d(0, ${-lift * 42}vh, 0)`;
      this.hero.style.opacity = String(1 - Math.min(1, lift * 1.4));
      this.hero.style.filter = lift > 0.01 ? `blur(${lift * 14}px)` : "";
      this.hero.style.pointerEvents = lift > 0.5 ? "none" : "";
    }
    if (this.hint) this.hint.style.opacity = String(d.scrollHint);
    if (this.eyebrow) {
      this.eyebrow.style.opacity = String(d.eyebrow);
      this.eyebrow.style.transform = `translate3d(0, ${(1 - d.eyebrow) * 28}px, 0)`;
      // It has done its job once the panel arrives.
      const fade = p > 0.36 ? Math.max(0, 1 - (p - 0.36) / 0.03) : 1;
      this.eyebrow.style.opacity = String(d.eyebrow * fade);
    }
    if (this.canvas) this.canvas.style.opacity = String(d.canvasOpacity);
    if (this.flash) this.flash.style.opacity = String(d.flash * 0.85);
    if (this.final) {
      this.final.style.opacity = String(d.finalCta * d.canvasOpacity);
      this.final.style.transform = `translate3d(0, ${(1 - d.finalCta) * 24}px, 0)`;
      this.final.style.pointerEvents = d.finalCta > 0.5 ? "" : "none";
    }

    // Subtitles: one at a time, per-word reveal, fully out between beats.
    let active = -1;
    for (let i = SUBTITLES.length - 1; i >= 0; i--) {
      if (p >= SUBTITLES[i].p && p < SUBTITLES[i].p + 0.055) { active = i; break; }
    }
    if (active !== this.activeSubtitle && this.subtitle) {
      this.subtitle.querySelectorAll<HTMLElement>(".l3d-sub").forEach((el) => {
        el.dataset.on = el.dataset.index === String(active) ? "true" : "false";
      });
      this.activeSubtitle = active;
    }

    // HUD counters. Text writes only when the value changes.
    if (this.hud) this.hud.style.opacity = String(d.hudOn * d.canvasOpacity);
    const dur = formatClock(d.hudDuration);
    if (this.hudDuration && dur !== this.lastDuration) {
      this.hudDuration.textContent = dur;
      this.lastDuration = dur;
    }
    const sil = d.hudSilences > 0.5 ? `${Math.round(d.hudSilences)} found` : "";
    if (this.hudSilences && sil !== this.lastSilences) {
      this.hudSilences.textContent = sil;
      this.lastSilences = sil;
    }
    if (this.timecode) {
      const tc = formatTimecode(S.ribbon.playheadT * totalSeconds);
      if (tc !== this.lastTimecode) {
        this.timecode.textContent = tc;
        this.lastTimecode = tc;
      }
      this.timecode.style.opacity = String(S.ribbon.playheadOn * (playhead.visible ? 1 : 0) * d.canvasOpacity);
      this.timecode.style.transform = `translate3d(${playhead.x}px, ${playhead.y}px, 0) translate(-50%, -100%)`;
    }
    if (this.headers) {
      // Pinned at the frame's left edge; each row rides its lane's projected height.
      const on = S.ribbon.furniture * d.canvasOpacity * (headers[1]?.visible ? 1 : 0);
      this.headers.style.opacity = String(on * 0.3);
      this.headers.querySelectorAll<HTMLElement>("span").forEach((el, i) => {
        const h = headers[i];
        if (h) el.style.transform = `translate3d(0, ${h.y}px, 0) translateY(-50%)`;
      });
      this.headers.dataset.v2 = S.lanes.v2 > 0.5 ? "true" : "false";
      this.headers.dataset.a1 = S.lanes.a1 > 0.5 ? "true" : "false";
      this.headers.dataset.a2 = S.lanes.a2 > 0.5 ? "true" : "false";
    }
    if (this.badge) {
      this.badge.style.opacity = String(d.retimeBadge * (badge.visible ? 1 : 0));
      this.badge.style.transform = `translate3d(${badge.x}px, ${badge.y - d.retimeBadge * 40}px, 0) translate(-50%, -100%)`;
    }
  }
}
