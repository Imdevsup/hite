import { z } from "zod";
import { BadRequestError, zodMessage } from "@/lib/api/errors";

/**
 * Read + validate a JSON request body.
 *
 * Every route used to write `Schema.parse(await req.json())`, which throws a raw `ZodError` (or a
 * `SyntaxError` for truncated JSON). `withAuth` only converted `UnauthorizedError`, so both escaped
 * as a Next 500 — a *client* contract violation reported as a server outage, which both misleads the
 * caller and poisons 5xx alerting. This throws `BadRequestError` instead: a 400 whose message names
 * the offending field(s) via the same `zodMessage` the AI routes render into the chat bubble.
 *
 *     const body = await parseJsonBody(req, Create);   // 400 on bad input, typed on success
 *
 * Generic over the SCHEMA (`S extends z.ZodTypeAny`) rather than over a value type, so the result is
 * `z.infer<S>` — the schema's OUTPUT type, with `.default()`s applied. `z.ZodType<T>` would ask TS to
 * unify a schema's input and output types, which silently widens every field that has a default.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  return parseJsonText(await req.text(), schema);
}

/**
 * Same contract as `parseJsonBody` for callers that already hold the raw text — e.g. a route that
 * must size-cap the body before parsing it. One owner for the wording either way.
 *
 * Text that is not JSON at all (empty, truncated, `text/plain`) is the same class of failure as text
 * that fails the schema, so it takes the same 400 path with an explicit message rather than being
 * coerced to `null` and reported as "expected object, received null".
 */
export function parseJsonText<S extends z.ZodTypeAny>(raw: string, schema: S): z.infer<S> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new BadRequestError("body: expected a JSON object");
  }
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
  return parsed.data;
}
