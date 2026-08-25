/**
 * The export tier, DERIVED server-side.
 *
 * Why this is a function and not a request field (`tier-client-trusted-watermark-bypass`):
 * POST /api/render accepted `tier` in the JSON body and wrote it straight onto the export row, and
 * `edlToRenderIR` only injects the watermark overlay when `tier === "free"`. Anyone could therefore
 * `curl -d '{"tier":"pro"}'` for a watermark-free render. A value that decides what the product
 * gives away cannot come from the party receiving it.
 *
 * What it returns today: `"free"`, for everyone. That is not a placeholder — it is the truth. This
 * schema has no subscription, entitlement or billing table (migrations 001–006), so there is no
 * paid account to read, and the Export window says so in as many words ("Pro is coming"). Returning
 * anything else would be inventing an entitlement.
 *
 * When billing lands: read it here, from the user's own row, and this file stays the only place
 * that decides. The two callers — POST /api/render (writes the export row) and the render worker
 * (compiles the IR) — both go through it, so neither can drift from the other.
 */
export type ExportTier = "free" | "pro";

export function resolveExportTier(): ExportTier {
  return "free";
}
