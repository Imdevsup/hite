/**
 * Cross-tenant IDOR guard for analysis tools. These tools query with the RLS-bypassing admin
 * client using an `assetId` that comes from the model's tool-call arguments — so without a check a
 * crafted/guessed UUID could read another tenant's transcript, analysis, or blob_url. The planner
 * sets `experimental_context.allowedAssetIds` to the current project's asset ids; reject anything
 * outside that set.
 *
 * FAILS CLOSED. A missing allowlist used to mean "no restriction", so the only thing standing
 * between a guessed UUID and twelve admin-client reads was every future caller remembering to
 * populate the context — and `experimental_context` is an unstable SDK field that a version bump
 * can rename out from under us. Absent scope is now a refusal, which is also what lets
 * `lib/ai/tools/db.ts` treat a missing asset row as an integrity failure rather than a wrong id.
 * The failure mode is loud and immediate (every analysis tool errors at once), not silent.
 *
 * Direct callers — tests included — must therefore pass the allowlist the planner passes.
 */
export function assertAssetAllowed(assetId: string, ctx: unknown): void {
  const allowed = (ctx as { allowedAssetIds?: string[] } | undefined)?.allowedAssetIds;
  if (!Array.isArray(allowed)) {
    throw new Error(
      "asset access is unscoped: no allowedAssetIds in the tool context, so this asset cannot be read",
    );
  }
  if (!allowed.includes(assetId)) {
    throw new Error(`asset ${assetId} is not part of the current project`);
  }
}
