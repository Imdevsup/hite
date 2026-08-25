/**
 * objects/Ribbon.ts — the timeline. The most important object in the scene.
 *
 * One `PlaneGeometry(1, 1, 2048, 16)` built at boot and shared by every lane. Each lane is a mesh
 * with its own small uniform block (kind, offset, height, reveal) layered over ONE shared uniform
 * object, so a single write to `uMorph` or `uScanT` moves all of them together. The state texture
 * is the only other input; every tool call is a tween on `TimelineState.controls` plus a few of the
 * scalars here.
 *
 * Lanes (top → bottom once flat): ruler · V2 overlays · V1 main · effects sub-lane · captions ·
 * A1 dialogue · A2 music. Only V1 exists in Act 1 — the others extrude into being as the story
 * needs them. A second additive V1 rides 6% behind the head as the motion trail.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type IUniform,
  type Texture,
} from "three";
import { CURL, pathUniforms } from "./paths";
import { RIBBON_VERT } from "./ribbon.vert";
import { RIBBON_FRAG } from "./ribbon.frag";
import { SLOTS, TimelineState } from "./TimelineState";
import { SCORE_BPM } from "../choreography/script";
import { blankTexture } from "./ClipLabels";

export type LaneId = "ruler" | "v2" | "v1" | "fx" | "captions" | "a1" | "a2";

interface LaneSpec {
  readonly id: LaneId;
  readonly kind: number;
  /** Offset in multiples of the flat ribbon width. */
  readonly offset: number;
  /** Height in multiples of the flat ribbon width. */
  readonly height: number;
  readonly bloom: boolean;
}

const LANES: readonly LaneSpec[] = [
  { id: "ruler", kind: 4, offset: 2.05, height: 0.5, bloom: false },
  { id: "v2", kind: 1, offset: 1.12, height: 0.82, bloom: true },
  { id: "v1", kind: 0, offset: 0, height: 1, bloom: true },
  { id: "fx", kind: 5, offset: -0.64, height: 0.22, bloom: false },
  { id: "captions", kind: 6, offset: -0.9, height: 0.22, bloom: true },
  { id: "a1", kind: 2, offset: -1.36, height: 0.62, bloom: false },
  { id: "a2", kind: 3, offset: -2.08, height: 0.62, bloom: false },
];

/** The flat timeline is the readable object: 2.2× the curl's width (owner asked for an expanded view). */
export const WIDTH_FLAT_MULTIPLIER = 2.2;

export interface RibbonAtlases {
  readonly labels: Texture;
  readonly posters: Texture;
  readonly wave: Texture;
  readonly scoreWave: Texture;
  readonly digits: Texture;
}

export class Ribbon {
  readonly group = new Group();
  readonly state: TimelineState;
  readonly shared: Record<string, IUniform>;
  readonly lanes = new Map<LaneId, Mesh<PlaneGeometry, ShaderMaterial>>();
  readonly trail: Mesh<PlaneGeometry, ShaderMaterial>;
  /** Meshes the selective bloom should pick up. */
  readonly bloomTargets: Mesh[] = [];
  private readonly geometry: PlaneGeometry;
  private readonly laneUniforms = new Map<LaneId, Record<string, IUniform>>();

  private static readonly COLUMNS = 2048;
  private static readonly ROWS = 8;
  /** Must match PREFIX_STEPS in ribbon.vert.ts. */
  private static readonly PREFIX_STEPS = 128;
  /** The ripple, resampled every frame into 129 uniform floats. See ribbon.vert.ts. */
  private readonly prefix = new Float32Array(Ribbon.PREFIX_STEPS + 1);

  constructor(state: TimelineState) {
    this.state = state;
    this.geometry = new PlaneGeometry(1, 1, Ribbon.COLUMNS, Ribbon.ROWS);

    const blank = blankTexture();
    this.shared = {
      ...pathUniforms(),
      uState: { value: state.texture },
      uLabels: { value: blank },
      uPosters: { value: blank },
      uWave: { value: blank },
      uDigits: { value: blank },
      uClipCount: { value: state.clips.length },
      uTotalSeconds: { value: state.totalSeconds },
      uLiveLength: { value: 1 },
      uMorph: { value: 0 },
      uDelay: { value: 0.9 },
      uTwist: { value: (CURL.twistPeakDeg * Math.PI) / 180 },
      uVelTwist: { value: 0 },
      uWidth: { value: CURL.width },
      uWidthFlat: { value: WIDTH_FLAT_MULTIPLIER },
      uFaceCamera: { value: 0.62 },
      uHead: { value: 0 },
      uHeadTEff: { value: 0 },
      uPrefix: { value: this.prefix },
      uCompress: { value: 0 },
      uColA: { value: new Color("#6E56F8") },
      uColB: { value: new Color("#22D3EE") },
      uColA2: { value: new Color("#3B2FB8") },
      uColB2: { value: new Color("#14A7A3") },
      uGrade: { value: 0 },
      uGradeT: { value: -1 },
      uRim: { value: new Color("#7FE6FF") },
      uKeyDir: { value: new Vector3(-0.55, 0.72, 0.42).normalize() },
      uFogColor: { value: new Color("#05060C") },
      uFogDensity: { value: 0.0024 },
      uAmber: { value: new Color("#F5A524") },
      uRose: { value: new Color("#FF4D7D") },
      uMint: { value: new Color("#34D399") },
      uSelect: { value: new Color("#E6F4FF") },
      uFurniture: { value: 0 },
      uLabelOpacity: { value: 0.15 },
      uAnalyzed: { value: -1 },
      uScanT: { value: -1 },
      uPlayheadT: { value: 0 },
      uPlayheadOn: { value: 0 },
      uBeat: { value: 0 },
      uBeatPulse: { value: 0 },
      uBeatGrid: { value: 0 },
      uBeatSnap: { value: 0 },
      uBeatsPerSecond: { value: SCORE_BPM / 60 },
      uExportFill: { value: 0 },
      uTime: { value: 0 },
      uEmissive: { value: 0.34 },
      uSilencePulse: { value: 1 },
    };

    for (const lane of LANES) {
      const own: Record<string, IUniform> = {
        uLaneKind: { value: lane.kind },
        uLaneOffset: { value: 0 },
        uLaneHeight: { value: lane.height },
        uLaneReveal: { value: lane.id === "v1" ? 1 : 0 },
        uOpacity: { value: 1 },
      };
      const material = new ShaderMaterial({
        vertexShader: RIBBON_VERT,
        fragmentShader: RIBBON_FRAG,
        uniforms: { ...this.shared, ...own },
        side: DoubleSide,
        transparent: true,
        depthWrite: true,
        blending: NormalBlending,
      });
      // A2 reads the music bed's waveform instead of the dialogue.
      if (lane.id === "a2") material.uniforms.uWave = { value: blank };
      const mesh = new Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = lane.id === "v1" ? 2 : 1;
      mesh.name = `ribbon:${lane.id}`;
      this.group.add(mesh);
      this.lanes.set(lane.id, mesh);
      this.laneUniforms.set(lane.id, material.uniforms);
      if (lane.bloom) this.bloomTargets.push(mesh);
    }

    // The motion trail: a larger additive copy lagging the head.
    const trailUniforms: Record<string, IUniform> = {
      ...this.shared,
      uHead: { value: 0 },
      uHeadTEff: { value: 0 },
      uWidth: { value: CURL.width * 1.7 },
      uFurniture: { value: 0 },
      uLabelOpacity: { value: 0 },
      uEmissive: { value: 0.9 },
      uLaneKind: { value: 0 },
      uLaneOffset: { value: 0 },
      uLaneHeight: { value: 1 },
      uLaneReveal: { value: 1 },
      uOpacity: { value: 0.22 },
    };
    const trailMaterial = new ShaderMaterial({
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      uniforms: trailUniforms,
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.trail = new Mesh(this.geometry, trailMaterial);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 0;
    this.trail.name = "ribbon:trail";
    this.group.add(this.trail);
    this.bloomTargets.push(this.trail);

    this.layoutLanes();
  }

  setAtlases(atlases: RibbonAtlases): void {
    this.shared.uLabels.value = atlases.labels;
    this.shared.uPosters.value = atlases.posters;
    this.shared.uWave.value = atlases.wave;
    this.shared.uDigits.value = atlases.digits;
    const a2 = this.laneUniforms.get("a2");
    if (a2) a2.uWave.value = atlases.scoreWave;
  }

  /** Lane offsets are multiples of the flat width, so they follow any width change. */
  private layoutLanes(): void {
    const flatWidth = (this.shared.uWidth.value as number) * (this.shared.uWidthFlat.value as number);
    for (const lane of LANES) {
      const u = this.laneUniforms.get(lane.id);
      if (u) u.uLaneOffset.value = lane.offset * flatWidth;
    }
  }

  lane(id: LaneId): Record<string, IUniform> {
    const u = this.laneUniforms.get(id);
    if (!u) throw new Error(`landing3d: unknown lane ${id}`);
    return u;
  }

  /** 0 → 1 extrudes a lane into being. V1 is always 1. */
  setLaneReveal(id: LaneId, reveal: number): void {
    this.lane(id).uLaneReveal.value = reveal;
  }

  /** Per frame: bake the state texture and the per-vertex path positions, sync the trail, advance time. */
  update(time: number, headLag: number, velocityTwist: number): void {
    this.state.update();
    this.bakePathPositions();
    this.shared.uLiveLength.value = this.state.liveLength;
    this.shared.uTime.value = time;
    this.shared.uVelTwist.value = velocityTwist;
    const head = this.shared.uHead.value as number;
    this.shared.uHeadTEff.value = this.state.tEffAt(head * SLOTS);
    const trailHead = Math.max(0, head - headLag);
    this.trail.material.uniforms.uHead.value = trailHead;
    this.trail.material.uniforms.uHeadTEff.value = this.state.tEffAt(trailHead * SLOTS);
    this.trail.material.uniforms.uLiveLength.value = this.state.liveLength;
    this.trail.material.uniforms.uTime.value = time;
  }

  /** Resample this frame's prefix sums into the uniform array, normalised 0..1. */
  private bakePathPositions(): void {
    const live = Math.max(0.05, this.state.liveLength);
    for (let i = 0; i <= Ribbon.PREFIX_STEPS; i++) {
      const tEff = this.state.tEffAt((i / Ribbon.PREFIX_STEPS) * SLOTS);
      this.prefix[i] = Math.min(1, Math.max(0, tEff / live));
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const mesh of this.lanes.values()) mesh.material.dispose();
    this.trail.material.dispose();
  }
}
