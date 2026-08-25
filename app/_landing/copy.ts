/** app/_landing/copy.ts — lines shared by more than one landing component. One owner each. */

/** The slogan, used everywhere on the landing: hero kicker and lede, close, footer. */
export const SLOGAN = "Vibe coding for video editing";

/**
 * The spec card in §"Go deeper", copied off the modules it names.
 *
 * Every signature and every number here is real and checkable: `reduceBatch` and `edlToRenderIR`
 * are the two functions the whole pipeline hangs off, `ticksToFrame` is the ONLY place ticks become
 * frames, `TICKS_PER_SECOND` is 30_000 (lib/edl/time.ts), `AiEditCommand` is a 15-variant union,
 * and `isRenderableEntry` passes 46 of the manifest's 76 entries. A decorative code block that said
 * something almost-true would be worse than the blank space this replaced.
 */
export interface Signature {
  readonly fn: string;
  readonly args: string;
  readonly ret: string;
  readonly note: string;
}

export const SIGNATURES: readonly Signature[] = [
  {
    fn: "reduceBatch",
    args: "(edl, batch, opts)",
    ret: " → { edl, forwardPatches, inversePatches }",
    note: "The only way the timeline changes. Validates, or throws — never half-applies.",
  },
  {
    fn: "edlToRenderIR",
    args: "(edl, env, resolver)",
    ret: " → RenderIR",
    note: "Pure. The same timeline compiles to the same scene graph, every time.",
  },
  {
    fn: "ticksToFrame",
    args: "(t, fps, tps)",
    ret: " → number",
    note: "The one place ticks become frames. Round-half-even, called only by the compiler.",
  },
];

/**
 * Built, not typed. §7.4's banned-phrase lint rejects a literal manifest count in landing copy, and
 * it is right to: the manifest has two legitimate numbers — what the RENDERER can paint, and what
 * the CATALOG on this page scopes to — and hardcoding either one is how they drift apart. The count
 * comes from `RENDERABLE_ENTRY_COUNT`, so the card can only ever say what the catalog really holds.
 */
export function specConstants(renderableEntries: number): readonly { readonly value: string; readonly label: string }[] {
  return [
    { value: "Edl.2", label: "schema" },
    { value: "30,000", label: "ticks per second" },
    { value: "15", label: "command variants" },
    { value: String(renderableEntries), label: "catalog entries live" },
  ];
}
