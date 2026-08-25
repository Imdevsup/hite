"use client";

/**
 * components/landing3d/Scene.tsx — the island. Boots the world, binds scroll, runs the frame.
 *
 * One fixed canvas for the whole page and normal document scroll (spec §2): no pins. Lenis smooths
 * the scroll and feeds ScrollTrigger; one master GSAP timeline is scrubbed across `#l3d-scroll`
 * (≈980vh); every frame reads `SceneState` and writes the renderer. The "next section" moment is
 * camera travel in world space, so the 3D never cuts.
 *
 * Two modes share every line of this file: `scroll` (the page) and `stills` (reduced motion — the
 * same scene rendered once per act into images, see Landing3D.tsx).
 */
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, AdditiveBlending, Vector3 } from "three";
import { Stage } from "./stage/Stage";
import { Post } from "./stage/Post";
import { Lighting } from "./stage/Lighting";
import { FocusRig } from "./stage/FocusRig";
import { Ribbon } from "./objects/Ribbon";
import { TimelineState } from "./objects/TimelineState";
import { buildDigitStrip, buildLabelAtlas, buildPosterAtlas, buildScoreWaveform, buildWaveform } from "./objects/ClipLabels";
import { Backdrop } from "./objects/Backdrop";
import { Dust } from "./objects/Dust";
import { ChatPanel, PANEL_MOBILE_SCALE, PANEL_X, PANEL_Z } from "./objects/ChatPanel";
import { ToolChips } from "./objects/ToolChips";
import { ClipCards, CARD_COUNT } from "./objects/ClipCards";
import { CaptionTicks, CAPTION_PHRASES } from "./objects/CaptionTicks";
import { Playhead } from "./objects/Furniture";
import { evalSpine, FLAT, FLAT_LIVE, sphericalToPosition } from "./objects/paths";
import { buildMaster, createSceneState, type SceneState } from "./choreography/master";
import { SCORE_BPM, TOOL_CALLS } from "./choreography/script";
import { DomLayer, IDS, type Projected } from "./ui/dom";
import { DebugHarness } from "./ui/debug";

export interface SceneFonts {
  readonly sans: string;
  readonly mono: string;
}

export interface BootOptions {
  readonly canvas: HTMLCanvasElement;
  readonly fonts: SceneFonts;
  readonly mobile: boolean;
  readonly debug: boolean;
  readonly mode: "scroll" | "stills";
}

export interface World {
  readonly dispose: () => void;
  /** Stills mode only: render the scene at `p` and return it as a data URL. */
  readonly still: (p: number) => string;
}

/** Act frames for reduced motion: the overlap, the flat hold, the panel, mid-conversation, the end. */
export const STILL_FRAMES = [0.13, 0.33, 0.415, 0.78, 0.96] as const;

const UP = new Vector3(0, 1, 0);

export function bootScene(opts: BootOptions): World {
  const { canvas, fonts, mobile, debug, mode } = opts;
  gsap.registerPlugin(ScrollTrigger);

  const stage = new Stage({ canvas, fov: 38 });
  const post = new Post(stage);
  const lighting = new Lighting(stage.scene);
  const focus = new FocusRig(post.dof, stage.camera);
  if (mobile) {
    post.setEnabled("ao", false);
    post.setEnabled("dof", false);
  }

  const timeline = new TimelineState();
  const ribbon = new Ribbon(timeline);
  ribbon.setAtlases({
    labels: buildLabelAtlas(timeline.clips, fonts.mono),
    posters: buildPosterAtlas(timeline.clips),
    wave: buildWaveform(timeline.clips, (slot) => timeline.silences.some((s) => slot >= s.start && slot < s.end)),
    scoreWave: buildScoreWaveform(SCORE_BPM, timeline.totalSeconds),
    digits: buildDigitStrip(fonts.mono),
  });
  stage.scene.add(ribbon.group);

  const backdrop = new Backdrop();
  stage.scene.add(backdrop.mesh);
  const dust = new Dust(stage.pixelRatio);
  stage.scene.add(dust.points);
  const panel = new ChatPanel(fonts);
  // A phone's frustum is narrower than the panel is wide; without this it runs off both edges.
  panel.scaleMultiplier = mobile ? PANEL_MOBILE_SCALE : 1;
  stage.scene.add(panel.group);
  const chips = new ToolChips(fonts.mono);
  stage.scene.add(chips.group);
  const cards = new ClipCards(fonts.mono);
  stage.scene.add(cards.mesh);
  const captions = new CaptionTicks(fonts.sans);
  stage.scene.add(captions.group);
  const flatWidth = (ribbon.shared.uWidth.value as number) * (ribbon.shared.uWidthFlat.value as number);
  const playhead = new Playhead(flatWidth * 4.9);
  stage.scene.add(playhead.group);
  // The glow that announces the panel at the ribbon's midpoint.
  const midGlow = new Mesh(new PlaneGeometry(90, 90), new MeshBasicMaterial({ color: new Color("#6E56F8"), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
  midGlow.position.set(-6, FLAT.y + 8, PANEL_Z + 10);
  stage.scene.add(midGlow);

  post.bloomSelect(...ribbon.bloomTargets, ...chips.bloomTargets, ...captions.bloomTargets, ...playhead.bloomTargets, midGlow);

  const S: SceneState = createSceneState();
  const master = buildMaster(S, { state: timeline, mobile });

  let lenis: Lenis | null = null;
  let trigger: ScrollTrigger | null = null;
  let dom: DomLayer | null = null;
  let harness: DebugHarness | null = null;
  const tickLenis = (time: number): void => lenis?.raf(time * 1000);

  if (mode === "scroll") {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(tickLenis);
    gsap.ticker.lagSmoothing(0);
    trigger = ScrollTrigger.create({
      trigger: `#${IDS.scroll}`,
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
      animation: master,
      invalidateOnRefresh: true,
    });
    dom = new DomLayer();
    document.documentElement.dataset.l3d = "on";
    if (debug) {
      // Inspectable from the console while debugging: the scene state, the state texture, and the
      // live stage, so a probe can project the ribbon's own end into screen space.
      (window as Window & { __l3d?: unknown }).__l3d = { S, timeline, master, stage, ribbon };
      harness = new DebugHarness({
        post,
        gl: stage.renderer.getContext(),
        getSpan: () => spanReadout,
        getP: () => master.progress(),
        getLiveLength: () => timeline.liveLength,
        scrollTo: (p) => {
          const el = document.getElementById(IDS.scroll);
          if (!el || !lenis) return;
          const top = el.offsetTop + p * (el.offsetHeight - window.innerHeight);
          lenis.scrollTo(top, { immediate: true });
        },
      });
    }
  }

  /* ── per-frame scratch ───────────────────────────────────────────────────────────────── */
  const camTarget = new Vector3();
  const camPos = new Vector3();
  const wobble = new Vector3();
  const spine = new Vector3();
  const tangent = new Vector3();
  const tmp = new Vector3();
  const edgeRay = new Vector3();
  const railFrom = TOOL_CALLS.map(() => new Vector3());
  const chipTo = TOOL_CALLS.map(() => new Vector3());
  let scrollVelocity = 0;
  let smoothedVelocity = 0;
  const spanProbe = new Vector3();
  let spanReadout = "span —";

  /** World point on the ribbon for a slot (or tEff when `isTEff`), offset by lane in flat units. */
  const spinePoint = (slotOrT: number, laneUnits: number, out: Vector3, isTEff = false): Vector3 => {
    const tEff = isTEff ? slotOrT : timeline.tEffAt(slotOrT);
    // The flat span takes a normalised 0..1 position (see paths.ts): the ripple slides clips inside
    // it, so a chip still lands on the clip it modifies after the cut shortens. Centred with equal
    // margins, exactly as ribbon.vert.ts does it.
    const live = Math.max(0.2, timeline.liveLength);
    const tFlat = 0.5 + (Math.min(1, Math.max(0, tEff / live)) - 0.5) * live;
    evalSpine(tEff, S.ribbon.morph, 0.9, spine, tangent, tFlat);
    const fw = (ribbon.shared.uWidth.value as number) * (ribbon.shared.uWidthFlat.value as number);
    return out.copy(spine).addScaledVector(UP, laneUnits * fw * S.ribbon.morph);
  };

  const project = (v: Vector3, out: Projected): Projected => {
    tmp.copy(v).project(stage.camera);
    out.visible = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
    out.x = (tmp.x * 0.5 + 0.5) * stage.width;
    out.y = (-tmp.y * 0.5 + 0.5) * stage.height;
    return out;
  };
  const projPlayhead: Projected = { x: 0, y: 0, visible: false };
  const projBadge: Projected = { x: 0, y: 0, visible: false };
  // V2 · V1 · A1 · A2, in the order the DOM lists them.
  const HEADER_LANES = [1.12, 0, -1.36, -2.08] as const;
  const projHeaders: Projected[] = HEADER_LANES.map(() => ({ x: 0, y: 0, visible: false }));

  /** Chip targets: the exact clip range each call operates on. Recomputed each frame (ripple). */
  const chipTargetSlot = (effect: (typeof TOOL_CALLS)[number]["effect"]): { slot: number; lane: number } => {
    const mid = timeline.middle;
    switch (effect) {
      case "analyze": return { slot: timeline.clips[1].start, lane: 0 };
      case "silences": return { slot: timeline.silences[2].start, lane: 0 };
      case "ripple": return { slot: timeline.silences[Math.floor(timeline.silences.length / 2)].start, lane: 0 };
      case "retime": return { slot: timeline.introEndSlot / 2, lane: 0 };
      case "transitions": return { slot: timeline.transitions[0].slot, lane: 0 };
      case "search": return { slot: (mid.start + mid.end) / 2, lane: 1.12 };
      case "insert": return { slot: timeline.overlayBeats[0].start, lane: 1.12 };
      case "grade": return { slot: 24, lane: 0 };
      case "captions": return { slot: 256, lane: -0.9 };
      case "score": return { slot: 40, lane: -2.08 };
      case "beatsync": return { slot: 320, lane: 0 };
      case "export": return { slot: 256, lane: 0 };
    }
  };

  const frame = (dt: number, elapsed: number): void => {
    const p = master.progress();
    // Below the piece the canvas is invisible: stop drawing so the sections get the main thread.
    stage.idle = S.dom.canvasOpacity <= 0.001 && mode === "scroll";
    const beat = (elapsed * (SCORE_BPM / 60)) % 1;
    if (lenis) scrollVelocity = lenis.velocity;
    smoothedVelocity += (Math.min(1, Math.abs(scrollVelocity) / 60) - smoothedVelocity) * Math.min(1, dt * 6);

    // Camera: spherical pose + a permanent 0.4u wobble at 0.08Hz.
    camTarget.set(S.cam.tx, S.cam.ty, S.cam.tz);
    wobble.set(
      Math.sin(elapsed * 0.08 * Math.PI * 2) * 0.4,
      Math.cos(elapsed * 0.08 * Math.PI * 2 * 0.77 + 1.3) * 0.4,
      Math.sin(elapsed * 0.05 * Math.PI * 2 + 0.4) * 0.3,
    );
    // Idle at 92bpm once the score is in.
    wobble.y += Math.pow(1 - beat, 6) * 0.25 * S.ribbon.beatPulse;
    sphericalToPosition(S.cam.r, S.cam.theta, S.cam.phi, camTarget, camPos).add(wobble);
    stage.camera.position.copy(camPos);
    stage.camera.lookAt(camTarget);
    stage.camera.rotateZ(S.cam.roll);
    if (Math.abs(stage.camera.fov - S.cam.fov) > 0.01) {
      stage.camera.fov = S.cam.fov;
      stage.camera.updateProjectionMatrix();
    }
    stage.camera.updateMatrixWorld();

    // ── HOW FAR THE FLAT TIMELINE MUST REACH ──────────────────────────────────────────────────
    // TWO independent measurements, and the largest wins, because being too long costs nothing (the
    // ends run off frame by design) and being too short is the one thing that must never happen.
    //   a) ray-cast: unproject the screen's left and right edges and intersect the timeline's plane.
    //      Exact for any camera angle, but it depends on the projection matrix being current.
    //   b) analytic: the frustum half-width at the camera's distance to what it is looking at.
    //      Independent of unproject entirely.
    // The floor is only a guard against both measurements failing; it must stay well UNDER a real
    // frustum, or it inflates the span and a trimmed sequence still fills the frame.
    let reach = 60;
    for (const ndcX of [-1, 1]) {
      edgeRay.set(ndcX, 0, 0.5).unproject(stage.camera).sub(stage.camera.position).normalize();
      if (Math.abs(edgeRay.z) > 1e-4) {
        const hit = (0 - stage.camera.position.z) / edgeRay.z;
        if (hit > 0 && Number.isFinite(hit)) {
          reach = Math.max(reach, Math.abs(stage.camera.position.x + edgeRay.x * hit));
        }
      }
    }
    const distance = stage.camera.position.distanceTo(camTarget);
    const frustumHalf = distance * Math.tan((stage.camera.fov * Math.PI) / 360) * stage.camera.aspect;
    if (Number.isFinite(frustumHalf)) reach = Math.max(reach, frustumHalf);
    // Overshoot at full length so the bar runs OFF both edges; the ripple then shortens it to a
    // centred sequence with a real, equal margin either side (see ribbon.vert.ts).
    FLAT_LIVE.half = reach * 1.06;
    (ribbon.shared.uFlat.value as Vector3).x = FLAT_LIVE.half;
    if (debug) {
      const left = spanProbe.set(-FLAT_LIVE.half, FLAT.y, 0).project(stage.camera).x;
      const right = spanProbe.set(FLAT_LIVE.half, FLAT.y, 0).project(stage.camera).x;
      spanReadout = `span ${left.toFixed(2)}..${right.toFixed(2)} ${left <= -1 && right >= 1 ? "ok" : "SHORT"}`;
    }

    // Ribbon.
    const R = ribbon.shared;
    // The reveal belongs to Act 1 alone. Past the descent the head is pinned at 1 no matter what.
    R.uHead.value = p > 0.25 ? 1 : S.ribbon.head;
    R.uMorph.value = S.ribbon.morph;
    R.uFaceCamera.value = S.ribbon.faceCamera;
    R.uWidthFlat.value = S.ribbon.widthFlat;
    R.uFurniture.value = S.ribbon.furniture;
    R.uLabelOpacity.value = S.ribbon.labelOpacity;
    R.uAnalyzed.value = S.ribbon.analyzed;
    R.uScanT.value = S.ribbon.scanT;
    R.uGradeT.value = S.ribbon.gradeT;
    R.uGrade.value = S.ribbon.grade;
    R.uPlayheadT.value = S.ribbon.playheadT * timeline.liveLength;
    R.uPlayheadOn.value = S.ribbon.playheadOn * S.ribbon.furniture;
    R.uBeat.value = beat;
    R.uBeatPulse.value = S.ribbon.beatPulse;
    R.uBeatGrid.value = S.ribbon.beatGrid;
    R.uBeatSnap.value = S.ribbon.beatSnap;
    R.uCompress.value = Math.max(0, S.ribbon.compress);
    R.uExportFill.value = S.ribbon.exportFill;
    R.uEmissive.value = S.ribbon.emissive + smoothedVelocity * 0.15;
    R.uFogDensity.value = S.world.fogDensity;
    (R.uFogColor.value as Color).copy(lighting.live.fog);
    (R.uRim.value as Color).copy(lighting.live.rim);
    ribbon.trail.material.uniforms.uOpacity.value = S.ribbon.trailOpacity;
    ribbon.setLaneReveal("ruler", S.lanes.ruler);
    ribbon.setLaneReveal("v2", S.lanes.v2);
    ribbon.setLaneReveal("fx", S.lanes.fx);
    ribbon.setLaneReveal("captions", S.lanes.captions);
    ribbon.setLaneReveal("a1", S.lanes.a1);
    ribbon.setLaneReveal("a2", S.lanes.a2);
    // Scroll velocity feeds the twist; the lane layout follows the width.
    ribbon.update(elapsed, 0.06, smoothedVelocity * 0.35 * Math.sign(scrollVelocity || 1));
    ribbon.lane("v1").uLaneOffset.value = 0;

    // World.
    lighting.applyGrade(S.world.grade);
    backdrop.update(elapsed, lighting.live.fog, camPos.x, camPos.y, camPos.z);
    backdrop.setTint(S.world.grade > 0.5 ? new Color("#1E4E6A") : new Color("#3A2A8C"));
    dust.update(elapsed, lighting.live.dust, stage.pixelRatio);
    dust.points.material.uniforms.uStreak.value = S.world.dustStreak;
    dust.points.material.uniforms.uBeat.value = beat * S.ribbon.beatPulse;
    spinePoint(Math.max(0, Math.min(511, S.ribbon.head * 511)), 0, tmp);
    dust.setWake(tmp, S.world.dustWake);
    midGlow.material.opacity = S.world.midGlow * 0.55;
    midGlow.quaternion.copy(stage.camera.quaternion);

    // Panel.
    const P = S.panel;
    Object.assign(panel.anim, {
      opacity: P.opacity, arriveZ: P.arriveZ, arriveScale: P.arriveScale, unpack: P.unpack, sweep: P.sweep,
      typed: P.typed, sent: P.sent, thinking: P.thinking, streamed: P.streamed, closing: P.closing, stat: P.stat,
    });
    panel.chipState.set(P.chipState);
    panel.commentary.set(P.commentary);
    // Under 900px the panel sits above the ribbon instead of behind its middle.
    // CENTRED ON MOBILE, and centred against the CAMERA rather than against world origin.
    //
    // PANEL_X's leftward nudge is for the desktop composition, where the hero copy holds the left
    // third and the panel sits in the gap beside it. A phone has no such gap. But x = 0 does not
    // centre it either: the camera looks at S.cam.tx (the hero pose targets x = -46), so world origin
    // projects well right of the middle of the frame — which is exactly what it looked like, a panel
    // with a margin on the left and its right edge cut off by the screen. Aiming it at the camera's
    // own target puts it in the middle of the frame for whatever the camera is doing that frame.
    panel.update(elapsed, beat, wobble, mobile ? 62 : 0, mobile ? camTarget.x : PANEL_X);

    // Chips: from the rail slot to the exact clip range, recomputed so the ripple moves the target.
    TOOL_CALLS.forEach((call, i) => {
      if (S.chips[i] <= 0 || S.chips[i] >= 1.3) return;
      panel.railAnchor(i, railFrom[i]);
      const target = chipTargetSlot(call.effect);
      spinePoint(target.slot, target.lane, chipTo[i]);
      chipTo[i].z += 2;
      chips.setFlight(call.id, { from: railFrom[i], to: chipTo[i] });
    });
    TOOL_CALLS.forEach((call, i) => chips.setProgress(call.id, S.chips[i]));
    chips.update(stage.camera, dt);

    // Cards fan out above the middle and dock onto V2's overlay beats.
    spinePoint((timeline.middle.start + timeline.middle.end) / 2, 1.12, cards.origin);
    cards.origin.z += 12;
    for (let k = 0, survivor = 0; k < CARD_COUNT; k++) {
      if (k === 1 || k === 3) continue;
      const beatRange = timeline.overlayBeats[Math.min(3, survivor++)];
      spinePoint((beatRange.start + beatRange.end) / 2, 1.12, cards.dockTargets[k]);
      cards.dockTargets[k].z += 1.5;
    }
    cards.anim.fan = S.cards.fan;
    cards.anim.opacity = S.cards.opacity;
    cards.anim.reject = S.cards.reject;
    cards.dock.set(S.cards.dock);
    cards.update(stage.camera, elapsed);

    // Caption phrases lift off the caption lane.
    CAPTION_PHRASES.forEach((_, k) => {
      // Spread across the middle of the frame so a phrase never rises off an edge.
      spinePoint(150 + k * 85, -0.9, captions.anchors[k]);
      captions.setProgress(k, S.captions[k]);
    });
    captions.update(stage.camera);

    // Playhead + practical.
    spinePoint(S.ribbon.playheadT * timeline.liveLength, -0.55, tmp, true);
    playhead.place(tmp);
    playhead.opacity = S.ribbon.playheadOn * S.ribbon.furniture * S.dom.canvasOpacity;
    playhead.update();
    lighting.setPractical(tmp, playhead.opacity * 40 * (0.6 + 0.4 * S.ribbon.playheadT));

    // Focus: the ribbon where the camera looks, or the panel.
    focus.a.copy(camTarget);
    focus.b.copy(panel.group.position);
    focus.blend = S.focus.blend;
    focus.rangeFraction = S.focus.range;
    focus.update();

    // Post: bloom and aberration, both fed by scroll velocity.
    post.setBloomIntensity(S.post.bloom + smoothedVelocity * 0.25);
    post.setAberration(S.post.aberration + chips.aberrationDemand * 0.003 + smoothedVelocity * 0.0025);

    // DOM.
    if (dom) {
      project(playhead.tip, projPlayhead);
      spinePoint(timeline.introEndSlot / 2, 1.6, tmp);
      project(tmp, projBadge);
      // Lane heights at the camera's own X, so the rows sit level with the lanes they name.
      HEADER_LANES.forEach((lane, i) => {
        spinePoint(0.5 * timeline.liveLength, lane, tmp, true);
        tmp.x = camTarget.x;
        project(tmp, projHeaders[i]);
      });
      dom.update(S, p, projPlayhead, projBadge, projHeaders, timeline.totalSeconds);
    }
    harness?.tick();
  };

  const unsubscribe = stage.onFrame(frame);

  if (mode === "scroll") {
    stage.start();
    // Lenis changes the scroll height Turbopack-style HMR may have left stale.
    requestAnimationFrame(() => ScrollTrigger.refresh());
  }

  const still = (p: number): string => {
    master.progress(p);
    // Two frames so velocity-dependent terms settle.
    frame(1 / 60, p * 60);
    stage.render(1 / 60);
    frame(1 / 60, p * 60 + 1 / 60);
    stage.render(1 / 60);
    return canvas.toDataURL("image/jpeg", 0.86);
  };

  const dispose = (): void => {
    unsubscribe();
    harness?.dispose();
    trigger?.kill();
    master.kill();
    if (lenis) {
      gsap.ticker.remove(tickLenis);
      lenis.destroy();
    }
    delete document.documentElement.dataset.l3d;
    ribbon.dispose();
    backdrop.dispose();
    dust.dispose();
    panel.dispose();
    chips.dispose();
    cards.dispose();
    captions.dispose();
    playhead.dispose();
    midGlow.geometry.dispose();
    midGlow.material.dispose();
    timeline.dispose();
    lighting.dispose();
    post.dispose();
    stage.dispose();
  };

  return { dispose, still };
}

export interface SceneProps {
  readonly fonts: SceneFonts;
  readonly mobile: boolean;
  readonly debug: boolean;
}

export default function Scene({ fonts, mobile, debug }: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const world = bootScene({ canvas, fonts, mobile, debug, mode: "scroll" });
    return () => world.dispose();
  }, [fonts, mobile, debug]);
  return <canvas id={IDS.canvas} ref={ref} className="l3d-canvas" aria-hidden="true" />;
}
