/**
 * lib/remotion/Root.tsx — the Remotion composition registry for SERVER rendering (export).
 *
 * One composition, "hite", whose component is HiteRoot (the same tree the preview <Player> uses).
 * Dimensions / fps / duration are derived from the supplied IR via calculateMetadata, so a single
 * registration renders any project at any aspect. The bundler entry (./index.ts) registers this.
 */
import { Composition } from "remotion";
import { HiteRoot } from "./HiteRoot";
import type { RenderIR } from "@/lib/render/ir";

/** A structurally-valid empty IR so the composition is registrable before real props arrive. */
const PLACEHOLDER_IR: RenderIR = {
  schema: "RenderIR.1",
  timebase: { ticksPerSecond: 30000 },
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationTicks: 30000,
  durationInFrames: 30,
  meta: { edlContentHash: "", engineFingerprint: "", quality: "full" },
  scene: { kind: "stack", id: "root", hash: "", layers: [] },
  rootHash: "",
  diagnostics: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="hite"
      component={HiteRoot}
      durationInFrames={PLACEHOLDER_IR.durationInFrames}
      fps={PLACEHOLDER_IR.fps}
      width={PLACEHOLDER_IR.resolution.width}
      height={PLACEHOLDER_IR.resolution.height}
      defaultProps={{ ir: PLACEHOLDER_IR }}
      calculateMetadata={({ props }) => {
        const ir = props.ir;
        return {
          durationInFrames: Math.max(1, ir.durationInFrames),
          fps: Math.round(ir.fps),
          width: ir.resolution.width,
          height: ir.resolution.height,
        };
      }}
    />
  );
};
