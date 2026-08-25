/**
 * objects/ChatPanel.ts — L2 (z −320): the chat mockup, six planes separated in depth.
 *
 * It does not fade in. It arrives from z −1400 at 0.62 scale, then unpacks into six planes — back
 * plate, thread container, message bubbles, tool-call rail, input row, header chrome — each at its
 * own Z offset, each arriving 90ms after the previous. The parallax between them as the camera
 * wobbles is what makes it read as a physical object rather than a picture of one.
 *
 * Text is rasterised onto canvases and re-drawn only when the state it shows has changed. The
 * typing is a human-irregular schedule baked once: 18–55ms per character, two ~180ms hesitations
 * at word boundaries, normalised to 0..1 so a single scrubbed number drives it forward and back.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { THREAD, TOOL_CALLS, type ToolCall } from "../choreography/script";
import { FLAT } from "./paths";

export const PANEL_W = 132;
export const PANEL_H = 176;
export const PANEL_Z = -320;
export const PANEL_FAR_Z = -1400;
/** Settled world scale. The owner wants the thread readable through the ribbon, so it is large. */
export const PANEL_SCALE = 1.35;
/** How far below the timeline the whole rounded box sits. Purely compositional. */
export const PANEL_DROP = 13;
/**
 * How far LEFT of centre the panel sits on a wide screen.
 *
 * The desktop composition is asymmetric on purpose — the hero copy holds the left third and the
 * ribbon exits right — so the panel is nudged off centre to sit in the gap. A phone has no such
 * gap: the copy is above the piece, not beside it, and the same offset just reads as a panel that
 * failed to line up with the timeline crossing it. On mobile the caller passes 0.
 */
export const PANEL_X = -6;
/**
 * Extra scale applied on a phone.
 *
 * The panel is 132 world units wide before PANEL_SCALE, which is wider than the frustum at a 390px
 * viewport — so on mobile it ran off BOTH edges and "centred" was something you had to take on
 * trust, because neither edge was on screen. At this factor the whole window fits with a margin,
 * which is the only way the centring reads at all.
 */
export const PANEL_MOBILE_SCALE = 0.62;
/** Canvas pixels per world unit. */
const PX = 6;

export interface PanelFonts {
  readonly sans: string;
  readonly mono: string;
}

interface Plane {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial | ShaderMaterial>;
  /** Resting Z relative to the panel body. */
  readonly z: number;
  readonly yDrift: number;
  readonly scaleDrift: number;
}

const CATEGORY_RULE: Record<ToolCall["category"], string> = {
  analysis: "#22D3EE",
  edit: "#FF4D7D",
  advisor: "#6E56F8",
  registry: "#F5A524",
  terminal: "#34D399",
};

/** Deterministic per-character reveal times, normalised so the last character lands at 1. */
export function typingSchedule(text: string): Float32Array {
  const times = new Float32Array(text.length);
  let t = 0;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const words = text.split(" ").length;
  const hesitateAt = new Set([Math.floor(words * 0.35), Math.floor(words * 0.7)]);
  let word = 0;
  for (let i = 0; i < text.length; i++) {
    t += 18 + rnd() * 37;
    if (text[i] === " ") {
      word++;
      if (hesitateAt.has(word)) t += 180;
    }
    times[i] = t;
  }
  for (let i = 0; i < times.length; i++) times[i] /= t;
  return times;
}

const GLASS_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const GLASS_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTint;
uniform vec3 uGlow;
uniform float uSweep;
uniform float uBeat;
uniform float uOpacity;
uniform vec2 uSize;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;

float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 px = (vUv - 0.5) * uSize;
  float d = roundedBox(px, uSize * 0.5, 7.0);
  float shape = 1.0 - smoothstep(-0.6, 0.6, d);
  if (shape < 0.01) discard;
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  // Refraction-ish shimmer near the edges.
  float edge = 1.0 - smoothstep(0.0, 10.0, -d);
  float n = hash(floor(px * 0.5)) * 0.04;
  vec3 col = uTint * (0.9 + n) + uGlow * (fres * 0.5 + edge * 0.25);
  // Specular sweep: a diagonal band that crosses once as it settles.
  float band = vUv.x * 0.6 + vUv.y * 0.4;
  // SQUARED BY MULTIPLICATION, never pow(x, 2.0): the base here is a signed distance and is negative
  // for half the band, and GLSL leaves pow() undefined for a negative base. On the GPU that already
  // cost this project days (a NaN from pow() deleted the whole flat timeline) this would return NaN,
  // and NaN colour paints the panel black.
  float sd = (band - (uSweep * 1.6 - 0.3)) / 0.06;
  float sweep = exp(-(sd * sd)) * step(0.001, uSweep) * step(uSweep, 0.999);
  col += vec3(0.9, 0.95, 1.0) * sweep * 0.55;
  // 1px inner light rule along the top edge.
  float topRule = 1.0 - smoothstep(0.0, 1.2, abs(px.y - (uSize.y * 0.5 - 1.2)));
  col += uGlow * topRule * 0.9 * step(abs(px.x), uSize.x * 0.5 - 8.0);
  // Border hairline.
  float border = 1.0 - smoothstep(0.0, 1.2, abs(d + 0.8));
  col += vec3(1.0) * border * 0.16;
  col *= 1.0 + 0.05 * pow(1.0 - uBeat, 5.0);
  gl_FragColor = vec4(col, (0.82 + fres * 0.15) * shape * uOpacity);
}
`;

export class ChatPanel {
  readonly group = new Group();
  readonly body = new Group();
  readonly planes: Plane[] = [];
  /** Tweened by the choreography. */
  readonly anim = {
    arriveZ: 0,
    arriveScale: 0,
    unpack: 0,
    sweep: 0,
    typed: 0,
    sent: 0,
    thinking: 0,
    streamed: 0,
    closing: 0,
    stat: 0,
    opacity: 0,
  };
  /** Per tool call: 0 pending, 0..1 active (ejecting), 1 done. */
  readonly chipState = new Float32Array(TOOL_CALLS.length);
  /** Per tool call with commentary: 0 → 1 streamed. */
  readonly commentary = new Float32Array(TOOL_CALLS.length);
  private readonly fonts: PanelFonts;
  private readonly schedule = typingSchedule(THREAD.user);
  private readonly canvases = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: CanvasTexture; key: string }>();
  private readonly glass: ShaderMaterial;
  private readonly wobble = new Vector3();

  constructor(fonts: PanelFonts) {
    this.fonts = fonts;
    this.glass = new ShaderMaterial({
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: {
        uTint: { value: new Color("#0A0C14") },
        uGlow: { value: new Color("#6E56F8") },
        uSweep: { value: 0 },
        uBeat: { value: 0 },
        uOpacity: { value: 1 },
        uSize: { value: [PANEL_W, PANEL_H] },
      },
      transparent: true,
      side: DoubleSide,
      depthWrite: true,
    });
    const back = new Mesh(new PlaneGeometry(PANEL_W, PANEL_H), this.glass);
    back.name = "panel:back";
    // Depth is SHALLOW on purpose: enough parallax to read as a physical object under the camera
    // wobble, not enough for the planes to drift apart and read as misaligned borders.
    this.addPlane(back, -14, -3, -0.015);

    // Layout, top to bottom, in panel units (origin at the centre, +y up):
    //   header  14 tall, 6 under the top edge
    //   thread  from the input's top + 6 up to the header's bottom − 4; inside it, messages above
    //           and the tool-call rail (40 tall) at its foot
    //   input   16 tall, 6 above the bottom edge
    const inner = PANEL_W - 12;
    const top = PANEL_H / 2;
    const headerH = 14;
    const inputH = 16;
    const railH = 40;
    const headerBottom = top - 6 - headerH;
    const inputTop = -top + 6 + inputH;
    const threadTop = headerBottom - 4;
    const threadBottom = inputTop + 6;
    const threadH = threadTop - threadBottom;
    const railBottom = threadBottom + 4;
    const messagesBottom = railBottom + railH + 4;
    const messagesTop = threadTop - 4;
    const messagesH = messagesTop - messagesBottom;

    this.addPlane(this.canvasPlane("thread", inner, threadH), -7, -2, -0.01);
    this.addPlane(this.canvasPlane("messages", inner - 8, messagesH), 0, -1, -0.005);
    this.addPlane(this.canvasPlane("rail", inner - 8, railH), 4, 1, 0.005);
    this.addPlane(this.canvasPlane("input", inner, inputH), 8, 2, 0.01);
    this.addPlane(this.canvasPlane("header", inner, headerH), 11, 3, 0.015);

    this.plane("header").mesh.position.y = top - 6 - headerH / 2;
    this.plane("thread").mesh.position.y = (threadTop + threadBottom) / 2;
    this.plane("messages").mesh.position.y = (messagesTop + messagesBottom) / 2;
    this.plane("rail").mesh.position.y = railBottom + railH / 2;
    this.plane("input").mesh.position.y = -top + 6 + inputH / 2;

    this.group.add(this.body);
    this.group.position.set(PANEL_X, 0, PANEL_FAR_Z);
    this.group.visible = false;
  }

  private plane(name: string): Plane {
    const p = this.planes.find((pl) => pl.mesh.name === `panel:${name}`);
    if (!p) throw new Error(`landing3d: panel plane ${name} missing`);
    return p;
  }

  private addPlane(mesh: Mesh<PlaneGeometry, MeshBasicMaterial | ShaderMaterial>, z: number, yDrift: number, scaleDrift: number): void {
    mesh.renderOrder = 5 + this.planes.length;
    this.planes.push({ mesh, z, yDrift, scaleDrift });
    this.body.add(mesh);
  }

  private canvasPlane(name: string, w: number, h: number): Mesh<PlaneGeometry, MeshBasicMaterial> {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * PX);
    canvas.height = Math.round(h * PX);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("landing3d: 2D canvas context unavailable");
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 4;
    const material = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide });
    const mesh = new Mesh(new PlaneGeometry(w, h), material);
    mesh.name = `panel:${name}`;
    this.canvases.set(name, { canvas, ctx, tex, key: "" });
    return mesh;
  }

  private draw(name: string, key: string, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const c = this.canvases.get(name);
    if (!c || c.key === key) return;
    c.key = key;
    c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.ctx.save();
    c.ctx.scale(PX, PX);
    paint(c.ctx, c.canvas.width / PX, c.canvas.height / PX);
    c.ctx.restore();
    c.tex.needsUpdate = true;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  private typedCount(): number {
    const t = this.anim.typed;
    let n = 0;
    while (n < this.schedule.length && this.schedule[n] <= t) n++;
    return n;
  }

  /** Words of `text` revealed at progress `p`. */
  private streamedText(text: string, p: number): string {
    const words = text.split(" ");
    const n = Math.round(Math.min(1, Math.max(0, p)) * words.length);
    return words.slice(0, n).join(" ");
  }

  /** World position of a chip's slot on the rail, for the ToolChips to eject from. */
  railAnchor(index: number, out: Vector3): Vector3 {
    const rail = this.plane("rail").mesh;
    const cols = 3;
    const col = index % cols;
    const rowIdx = Math.floor(index / cols) % 2;
    out.set(-PANEL_W / 2 + 18 + col * 36, 8 - rowIdx * 12, 0);
    rail.localToWorld(out);
    return out;
  }

  /** Multiplies the arrival scale. 1 on desktop; PANEL_MOBILE_SCALE on a phone, so the panel fits. */
  scaleMultiplier = 1;

  update(time: number, beat: number, cameraWobble: Vector3, yOffset = 0, x: number = PANEL_X): void {
    const a = this.anim;
    this.group.visible = a.opacity > 0.001;
    if (!this.group.visible) return;

    // Arrival: Z and scale on their own easings (the choreography tweens them separately).
    const z = PANEL_FAR_Z + (PANEL_Z - PANEL_FAR_Z) * a.arriveZ;
    const scale = (0.62 + 0.38 * a.arriveScale) * PANEL_SCALE * this.scaleMultiplier;
    // Rises to sit centred on the flat timeline (a touch below it), so the ribbon crosses its middle
    // and the panel reads centred in the frame rather than riding high. The extra drop keeps the
    // header bar clear of the ribbon: at the old height the two shared a band and the top of the
    // rounded box read as mis-set against the timeline running across it.
    const y = FLAT.y - 46 + 40 * a.arriveScale + yOffset - PANEL_DROP;
    this.group.position.set(x, y, z);
    this.group.scale.setScalar(scale);
    // Depth parallax: the body counter-wobbles a touch against the camera so the planes separate.
    this.wobble.copy(cameraWobble).multiplyScalar(-0.35);
    this.body.position.copy(this.wobble);

    // Unpack: each plane reaches its own Z 90ms (≈0.08 of the unpack) after the previous.
    this.planes.forEach((p, i) => {
      const local = Math.min(1, Math.max(0, (a.unpack - i * 0.08) / (1 - 5 * 0.08)));
      const e = 1 - Math.pow(1 - local, 3);
      p.mesh.position.z = p.z * e;
      const baseY = p.mesh.userData.baseY ?? (p.mesh.userData.baseY = p.mesh.position.y);
      p.mesh.position.y = baseY + p.yDrift * (1 - e);
      const s = 1 + p.scaleDrift * (1 - e);
      p.mesh.scale.set(s, s, 1);
    });

    const glassU = this.glass.uniforms;
    glassU.uSweep.value = a.sweep;
    glassU.uBeat.value = beat;
    glassU.uOpacity.value = a.opacity;
    for (const p of this.planes) {
      const m = p.mesh.material;
      if (m instanceof MeshBasicMaterial) m.opacity = a.opacity;
    }

    this.paint(time);
  }

  private paint(time: number): void {
    const { sans, mono } = this.fonts;
    const a = this.anim;
    const typed = this.typedCount();
    const caretOn = Math.floor(time * 2) % 2 === 0;

    this.draw("header", "static", (ctx, w, h) => {
      ctx.fillStyle = "rgba(18,21,31,0.9)";
      this.roundRect(ctx, 0, 0, w, h, 4);
      ctx.fill();
      ctx.fillStyle = "#F2F4F8";
      ctx.font = `600 5px ${sans}`;
      ctx.textBaseline = "middle";
      ctx.fillText("Hite", 6, h / 2);
      ctx.fillStyle = "#8A90A2";
      ctx.font = `500 3.6px ${mono}`;
      ctx.fillText("demo project · staged", 20, h / 2 + 0.2);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 0 ? "#34D399" : "rgba(255,255,255,0.16)";
        ctx.beginPath();
        ctx.arc(w - 6 - i * 6, h / 2, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    this.draw("thread", "static", (ctx, w, h) => {
      ctx.fillStyle = "rgba(10,12,20,0.55)";
      this.roundRect(ctx, 0, 0, w, h, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 0.4;
      this.roundRect(ctx, 0.2, 0.2, w - 0.4, h - 0.4, 5);
      ctx.stroke();
    });

    const msgKey = `${a.sent.toFixed(2)}|${a.thinking.toFixed(2)}|${a.streamed.toFixed(2)}|${a.closing.toFixed(2)}|${a.stat.toFixed(2)}|${Array.from(this.commentary).map((v) => v.toFixed(2)).join(",")}|${caretOn}`;
    this.draw("messages", msgKey, (ctx, w, h) => {
      // Paint once to measure, then again scrolled so the newest line is always in view.
      const end = this.paintThread(ctx, w, 0);
      const overflow = end - h + 2;
      if (overflow > 0) {
        ctx.clearRect(0, 0, w, h);
        this.paintThread(ctx, w, -overflow);
      }
    });

    const railKey = Array.from(this.chipState).map((v) => v.toFixed(2)).join(",");
    this.draw("rail", railKey, (ctx, w, h) => {
      ctx.fillStyle = "rgba(10,12,20,0.6)";
      this.roundRect(ctx, 0, 0, w, h, 3);
      ctx.fill();
      ctx.font = `500 3.2px ${mono}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#8A90A2";
      // The label fades in with the first chip. Drawn unconditionally it sat there reading "tool
      // calls" over an empty rail for the whole first half of the scroll — a heading for a list
      // that did not exist yet, and the first words a visitor read in the panel.
      const firstChip = this.chipState.reduce((m, v) => (v > m ? v : m), 0);
      ctx.globalAlpha = Math.min(1, firstChip * 4);
      ctx.fillText("tool calls", 3, 4);
      ctx.globalAlpha = 1;
      const cols = 3;
      TOOL_CALLS.forEach((call, i) => {
        const st = this.chipState[i];
        if (st <= 0.001) return;
        const col = i % cols;
        const rowIdx = Math.floor(i / cols);
        if (rowIdx > 3) return;
        const x = 3 + col * 36;
        const yy = 9 + rowIdx * 8;
        const done = st >= 0.999;
        ctx.globalAlpha = done ? 0.55 : 1;
        ctx.fillStyle = done ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.08)";
        this.roundRect(ctx, x, yy, 33, 6, 1.5);
        ctx.fill();
        ctx.fillStyle = done ? "#34D399" : CATEGORY_RULE[call.category];
        ctx.fillRect(x, yy, 0.8, 6);
        ctx.fillStyle = "#F2F4F8";
        ctx.font = `500 2.8px ${mono}`;
        ctx.fillText(call.name, x + 2.5, yy + 3, 29);
        ctx.globalAlpha = 1;
      });
    });

    const inputKey = `${typed}|${a.sent.toFixed(2)}|${caretOn}|${a.closing.toFixed(2)}`;
    this.draw("input", inputKey, (ctx, w, h) => {
      const compress = 1 - 0.08 * Math.sin(Math.min(1, a.sent * 2) * Math.PI);
      ctx.save();
      ctx.translate(0, (h * (1 - compress)) / 2);
      ctx.scale(1, compress);
      ctx.fillStyle = "rgba(18,21,31,0.95)";
      this.roundRect(ctx, 0, 0, w, h, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 0.4;
      this.roundRect(ctx, 0.2, 0.2, w - 0.4, h - 0.4, 4);
      ctx.stroke();
      ctx.textBaseline = "middle";
      ctx.font = `500 4.2px ${sans}`;
      const showTyped = a.sent < 0.02 ? THREAD.user.slice(0, typed) : "";
      if (showTyped.length === 0 && a.sent < 0.02) {
        ctx.fillStyle = "#5A6072";
        ctx.fillText("Describe the cut", 6, h / 2);
      } else {
        ctx.fillStyle = "#F2F4F8";
        // Keep the tail visible while typing.
        let text = showTyped;
        while (ctx.measureText(text).width > w - 26 && text.length > 1) text = text.slice(1);
        ctx.fillText(text, 6, h / 2);
      }
      if (a.sent < 0.02 && caretOn) {
        const cx = 6 + ctx.measureText(showTyped.length ? (() => { let t = showTyped; while (ctx.measureText(t).width > w - 26 && t.length > 1) t = t.slice(1); return t; })() : "").width + 0.5;
        ctx.fillStyle = "#22D3EE";
        ctx.fillRect(cx, h / 2 - 3, 0.7, 6);
      }
      // Send button.
      ctx.fillStyle = a.sent > 0.02 ? "rgba(110,86,248,0.35)" : "#6E56F8";
      this.roundRect(ctx, w - 14, 3, 11, h - 6, 2.5);
      ctx.fill();
      ctx.fillStyle = "#F2F4F8";
      ctx.font = `600 3.4px ${sans}`;
      ctx.fillText("Send", w - 12, h / 2);
      ctx.restore();
    });
  }

  /** The thread, painted from `offset` (≤ 0 scrolls it up). Returns the y just below the last line. */
  private paintThread(ctx: CanvasRenderingContext2D, w: number, offset: number): number {
    const { sans, mono } = this.fonts;
    const a = this.anim;
    let y = 4 + offset;
    ctx.textBaseline = "top";
    // The user's bubble rises in from the input as `sent` goes 0 → 1.
    if (a.sent > 0.001) {
      ctx.font = `500 4.4px ${sans}`;
      const lines = this.wrap(ctx, THREAD.user, w - 26);
      const bh = lines.length * 6 + 6;
      const rise = (1 - a.sent) * 60;
      const s = 0.94 + 0.06 * a.sent;
      ctx.save();
      ctx.globalAlpha = Math.min(1, a.sent * 1.6);
      ctx.translate(w - 4, y + rise);
      ctx.scale(s, s);
      ctx.fillStyle = "rgba(110,86,248,0.85)";
      this.roundRect(ctx, -(w - 20), 0, w - 20, bh, 4);
      ctx.fill();
      ctx.fillStyle = "#F2F4F8";
      lines.forEach((l, i) => ctx.fillText(l, -(w - 20) + 4, 3 + i * 6));
      ctx.restore();
      y += bh + 6;
    }
    // Thinking dots, then the first line streams in.
    if (a.thinking > 0.001 && a.streamed < 0.02) {
      for (let i = 0; i < 3; i++) {
        const on = Math.floor(a.thinking * 9 + i) % 3 === 0;
        ctx.fillStyle = on ? "#F2F4F8" : "rgba(242,244,248,0.3)";
        ctx.beginPath();
        ctx.arc(6 + i * 4, y + 3, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      y += 10;
    }
    const aiLine = (text: string, p: number): void => {
      if (p <= 0.001) return;
      ctx.font = `400 4.4px ${sans}`;
      ctx.fillStyle = "#F2F4F8";
      const shown = this.streamedText(text, p);
      const lines = this.wrap(ctx, shown, w - 12);
      lines.forEach((l, i) => ctx.fillText(l, 4, y + i * 6));
      y += Math.max(1, lines.length) * 6 + 3;
    };
    aiLine(THREAD.firstLine, a.streamed);
    TOOL_CALLS.forEach((call, i) => {
      if (call.commentary) aiLine(call.commentary, this.commentary[i]);
    });
    if (a.stat > 0.001) {
      ctx.font = `500 6px ${mono}`;
      ctx.fillStyle = "#34D399";
      ctx.globalAlpha = Math.min(1, a.stat * 2);
      ctx.fillText(THREAD.stat, 4, y);
      ctx.globalAlpha = 1;
      y += 9;
    }
    aiLine(THREAD.closing, a.closing);
    return y;
  }

  dispose(): void {
    for (const c of this.canvases.values()) c.tex.dispose();
    for (const p of this.planes) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
  }
}
