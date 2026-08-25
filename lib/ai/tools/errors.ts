/**
 * The ONE error convention for AI SDK tools: THROW a `ToolError` from `execute`.
 *
 * The AI SDK turns a thrown tool error into a typed `tool-error` stream part (with `errorText`),
 * which the route surfaces as a real failure. A `{ error: "..." }` RETURN value would instead look
 * to the model like a successful tool result it can reason over — the exact conflation of
 * "tool failed" with "tool returned something" that produced confidently-wrong edits. The one tool
 * that used the sentinel-return anti-pattern (`sampleFramesForVLM`) has been deleted, so this file
 * is now the only convention in `lib/ai/tools`.
 *
 * Kinds are deliberately minimal: only what is actually thrown lives here.
 */

export const ToolErrorKinds = {
  /** The query itself failed (outage, bad service key, rate limit). NEVER "there is no data". */
  DB_ERROR: "db_error",
  /** A row that must exist for the request to make sense does not. */
  NOT_FOUND: "not_found",
} as const;

export type ToolErrorKind = (typeof ToolErrorKinds)[keyof typeof ToolErrorKinds];

export class ToolError extends Error {
  readonly kind: ToolErrorKind;
  constructor(kind: ToolErrorKind, message: string) {
    super(message);
    this.name = "ToolError";
    this.kind = kind;
  }
}
