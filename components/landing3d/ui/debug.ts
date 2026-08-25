/**
 * ui/debug.ts — the `?debug` harness (spec §12): fps, current `p`, active act, arrow-key scrubbing
 * of the master timeline, toggles for each post pass, the curl's clearance metric and the live
 * ribbon length. Built in the first hour, used constantly.
 */
import { actAt } from "../choreography/script";
import type { PassName, Post } from "../stage/Post";
import { CURL, measureClearance } from "../objects/paths";

export interface DebugHooks {
  readonly post: Post;
  /** The WebGL context, for the renderer string. */
  readonly gl: WebGL2RenderingContext | WebGLRenderingContext;
  readonly scrollTo: (p: number) => void;
  readonly getP: () => number;
  readonly getLiveLength: () => number;
  /** Where the flat timeline's two ends land in NDC, and whether both are off screen. */
  readonly getSpan: () => string;
}

const PASSES: readonly PassName[] = ["ao", "bloom", "dof", "aberration", "vignette", "grain"];

export class DebugHarness {
  private readonly root: HTMLDivElement;
  private readonly readout: HTMLPreElement;
  private frames = 0;
  private last = performance.now();
  private fps = 0;
  private readonly hooks: DebugHooks;
  private readonly onKey = (e: KeyboardEvent): void => {
    const p = this.hooks.getP();
    const step = e.shiftKey ? 0.05 : 0.005;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      this.hooks.scrollTo(Math.min(1, p + step));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      this.hooks.scrollTo(Math.max(0, p - step));
    }
  };

  constructor(hooks: DebugHooks) {
    this.hooks = hooks;
    this.root = document.createElement("div");
    this.root.id = "l3d-debug";
    this.root.setAttribute("aria-hidden", "true");
    this.readout = document.createElement("pre");
    this.root.append(this.readout);
    const toggles = document.createElement("div");
    toggles.className = "l3d-debug-toggles";
    for (const pass of PASSES) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = hooks.post.enabled[pass];
      input.addEventListener("change", () => hooks.post.setEnabled(pass, input.checked));
      label.append(input, ` ${pass}`);
      toggles.append(label);
    }
    this.root.append(toggles);
    const clearance = measureClearance();
    const note = document.createElement("p");
    note.textContent = `curl clearance ${clearance.toFixed(1)}u · ${clearance > CURL.width * 2 ? "✓ above 2× width" : "✗ below 2× width"}`;
    this.root.append(note);
    // Which GPU/driver is drawing this — the first thing to read when a frame looks wrong.
    const gpu = document.createElement("p");
    const info = hooks.gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(hooks.gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "renderer hidden";
    gpu.textContent = `${renderer.slice(0, 60)} · ${window.innerWidth}×${window.innerHeight} @${(window.devicePixelRatio || 1).toFixed(2)}`;
    this.root.append(gpu);
    document.body.append(this.root);
    window.addEventListener("keydown", this.onKey);
  }

  tick(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.last > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.last));
      this.frames = 0;
      this.last = now;
    }
    const p = this.hooks.getP();
    this.readout.textContent = `${this.fps} fps\np ${p.toFixed(3)}  ${actAt(p).name}\nlength ${(this.hooks.getLiveLength() * 100).toFixed(0)}%\n${this.hooks.getSpan()}\n← → scrub · shift ×10`;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKey);
    this.root.remove();
  }
}
