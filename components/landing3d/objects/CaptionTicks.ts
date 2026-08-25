/**
 * objects/CaptionTicks.ts — L4: caption phrases that detach from the caption lane and fly toward
 * the camera, readable, then dissolve.
 *
 * The dense tick lane itself is painted by the ribbon shader (lane kind 6). These are the four
 * phrases that lift off it. They are lines the staged demo's transcript would plausibly carry and
 * are labelled as such; nothing here is a quote from a real recording.
 */
import {
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
} from "three";

export const CAPTION_PHRASES = [
  "so the first cut is never the one you keep",
  "we shot the rooftop at dusk for exactly this",
  "nobody tells you how much is silence",
  "that's the take",
] as const;

const PX = 10;
const PH_H = 9;

interface Phrase {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly width: number;
  progress: number;
}

export class CaptionTicks {
  readonly group = new Group();
  readonly phrases: Phrase[] = [];
  readonly bloomTargets: Mesh[] = [];
  /** Lane anchors, one per phrase, set by the choreography. */
  readonly anchors: Vector3[] = CAPTION_PHRASES.map(() => new Vector3());
  private readonly tmp = new Vector3();

  constructor(sans: string) {
    CAPTION_PHRASES.forEach((text, i) => {
      const measure = document.createElement("canvas").getContext("2d");
      if (!measure) throw new Error("landing3d: 2D canvas context unavailable");
      measure.font = `600 ${5.2 * PX}px ${sans}`;
      const w = Math.ceil(measure.measureText(text).width / PX) + 8;
      const canvas = document.createElement("canvas");
      canvas.width = w * PX;
      canvas.height = PH_H * PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("landing3d: 2D canvas context unavailable");
      ctx.scale(PX, PX);
      ctx.fillStyle = "rgba(4,5,10,0.55)";
      ctx.fillRect(0, 0, w, PH_H);
      ctx.fillStyle = "#34D399";
      ctx.fillRect(0, 0, 0.6, PH_H);
      ctx.fillStyle = "#F2F4F8";
      ctx.font = `600 5.2px ${sans}`;
      ctx.textBaseline = "middle";
      ctx.fillText(text, 3, PH_H / 2 + 0.2);
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = false;
      const mesh = new Mesh(new PlaneGeometry(w, PH_H), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide, opacity: 0 }));
      mesh.visible = false;
      mesh.renderOrder = 14;
      mesh.name = `caption:${i}`;
      this.group.add(mesh);
      this.phrases.push({ mesh, width: w, progress: 0 });
      this.bloomTargets.push(mesh);
    });
  }

  setProgress(index: number, progress: number): void {
    const p = this.phrases[index];
    if (p) p.progress = progress;
  }

  update(camera: PerspectiveCamera): void {
    this.phrases.forEach((p, i) => {
      const t = p.progress;
      p.mesh.visible = t > 0.001 && t < 0.999;
      if (!p.mesh.visible) return;
      // Rise quickly, HOLD readable for most of the window, then dissolve. A caption that flashes
      // past is worse than none.
      const rise = 1 - Math.pow(1 - Math.min(1, t / 0.25), 3);
      const fade = Math.min(1, Math.max(0, (t - 0.82) / 0.18));
      this.tmp.copy(camera.position).sub(this.anchors[i]).normalize();
      p.mesh.position.copy(this.anchors[i]).addScaledVector(this.tmp, 36 * rise).add(new Vector3((i % 2 ? 1 : -1) * 10 * rise, 18 * rise, 0));
      p.mesh.quaternion.copy(camera.quaternion);
      const s = 0.55 + 0.25 * rise + fade * 0.08;
      p.mesh.scale.set(s, s, 1);
      p.mesh.material.opacity = Math.min(1, t * 6) * (1 - fade);
    });
  }

  dispose(): void {
    for (const p of this.phrases) {
      p.mesh.geometry.dispose();
      p.mesh.material.map?.dispose();
      p.mesh.material.dispose();
    }
  }
}
