/**
 * stage/Stage.ts — renderer, scene, camera, resize and the single RAF.
 *
 * One WebGL2 context for the whole page, alive from boot to unmount. DPR is capped at 2 and drops
 * to 1.5 adaptively when the frame time stays over 20ms for 30 consecutive frames (spec §12).
 * The loop is the only place `requestAnimationFrame` is called; everything else registers a frame
 * callback. `dispose()` tears down everything it created so React Strict Mode's double mount never
 * leaks a context.
 */
import { PerspectiveCamera, Scene, WebGLRenderer, Color } from "three";

export type FrameCallback = (dt: number, elapsed: number) => void;

export interface StageOptions {
  readonly canvas: HTMLCanvasElement;
  readonly fov?: number;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  private lastFrameAt = 0;
  private elapsed = 0;
  width = 1;
  height = 1;
  pixelRatio = 1;
  /** Set by Post once the composer exists; until then the stage renders directly. */
  render: (dt: number) => void;
  /** True while the canvas is invisible (below the piece): callbacks still run, nothing is drawn. */
  idle = false;
  private reportedFrameError = false;
  private readonly callbacks = new Set<FrameCallback>();
  private raf = 0;
  private running = false;
  private slowFrames = 0;
  private readonly onResize = (): void => this.resize();
  private readonly resizeListeners = new Set<(w: number, h: number, dpr: number) => void>();
  private contextLost = false;
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
  };

  constructor({ canvas, fov = 38 }: StageOptions) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(new Color("#04050A"), 1);
    this.renderer.autoClear = true;
    this.camera = new PerspectiveCamera(fov, 1, 1, 4000);
    this.render = (): void => {
      this.renderer.render(this.scene, this.camera);
    };
    canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);
    window.addEventListener("resize", this.onResize);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.resize();
  }

  get isContextLost(): boolean {
    return this.contextLost;
  }

  onFrame(cb: FrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  onResized(cb: (w: number, h: number, dpr: number) => void): () => void {
    this.resizeListeners.add(cb);
    return () => this.resizeListeners.delete(cb);
  }

  resize(): void {
    // The CANVAS's own box, not the window's: a classic scrollbar, a browser zoom or a page that
    // overflows all make `innerWidth` disagree with the element being drawn into, and every camera
    // fit downstream inherits that error.
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width) || window.innerWidth);
    this.height = Math.max(1, Math.round(rect.height) || window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    for (const cb of this.resizeListeners) cb(this.width, this.height, this.pixelRatio);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(Math.max(0, (now - this.lastFrameAt) / 1000), 0.1);
      this.lastFrameAt = now;
      this.elapsed += dt;
      const elapsed = this.elapsed;
      if (this.contextLost) return;
      // One thrown frame must never stop the loop: the page would freeze with no way back. Report
      // the first failure loudly, keep running.
      try {
        for (const cb of this.callbacks) cb(dt, elapsed);
        if (this.idle) return;
        const t0 = performance.now();
        this.render(dt);
        this.adapt(performance.now() - t0);
      } catch (error) {
        if (!this.reportedFrameError) {
          this.reportedFrameError = true;
          console.error("landing3d: frame failed", error);
        }
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Drop to DPR 1.5 after 30 consecutive frames over 20ms. Never climbs back: hysteresis is noise. */
  private adapt(frameMs: number): void {
    if (this.pixelRatio <= 1.5) return;
    this.slowFrames = frameMs > 20 ? this.slowFrames + 1 : 0;
    if (this.slowFrames >= 30) {
      this.pixelRatio = 1.5;
      this.slowFrames = 0;
      this.resize();
    }
  }

  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.callbacks.clear();
    this.resizeListeners.clear();
    // No forceContextLoss(): React Strict Mode mounts twice on the SAME canvas, and a canvas whose
    // context was forced lost hands the second WebGLRenderer a dead context (getShaderPrecisionFormat
    // returns null). dispose() releases the GPU resources; the context itself is reused.
    this.renderer.dispose();
  }
}
