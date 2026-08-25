import { describe, expect, test, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  httpStatusForDbError,
  dbErrorResponse,
  notFoundOrDbError,
  zodMessage,
  errorMessage,
  HttpError,
  BadRequestError,
} from "./errors";

describe("httpStatusForDbError", () => {
  test("RLS / insufficient privilege → 403", () => {
    expect(httpStatusForDbError({ code: "42501" })).toBe(403);
    expect(httpStatusForDbError({ code: "PGRST301" })).toBe(403);
  });

  test("no-rows from .single() → 404", () => {
    expect(httpStatusForDbError({ code: "PGRST116" })).toBe(404);
  });

  test("everything else → 500 (real fault, must not be masked as 404)", () => {
    expect(httpStatusForDbError({ code: "08006" })).toBe(500); // connection failure
    expect(httpStatusForDbError({})).toBe(500);
    expect(httpStatusForDbError(null)).toBe(500);
    expect(httpStatusForDbError(undefined)).toBe(500);
  });
});

describe("dbErrorResponse", () => {
  afterEach(() => vi.restoreAllMocks());

  test("never forwards the Postgres message or code to the client", async () => {
    // Regression: the body used to be `{ error: error.message, code: error.code }`, handing any
    // authed caller column/constraint/policy names straight out of the driver.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = dbErrorResponse({
      code: "23505",
      message: 'duplicate key value violates unique constraint "asset_project_id_blob_url_key"',
    });
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string; ref: string; code?: string };
    expect(json.error).toBe("request failed");
    expect(json.code).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("asset_project_id_blob_url_key");
    // ...but the detail IS logged server-side, under the ref the client can quote.
    expect(json.ref).toMatch(/^[0-9a-f]{8}$/);
    const line = logged.mock.calls[0][0] as string;
    expect(line).toContain(`ref=${json.ref}`);
    expect(line).toContain("23505");
    expect(line).toContain("asset_project_id_blob_url_key");
  });

  test("sets the mapped status with safe wording per status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const denied = dbErrorResponse({ code: "42501", message: "permission denied for table project" });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe("not allowed");

    const missing = dbErrorResponse({ code: "PGRST116", message: "0 rows" });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("not found");
  });

  test("a generic DB error is a 500, never a 404", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(dbErrorResponse({ code: "XX000", message: "boom" }).status).toBe(500);
  });
});

describe("HttpError", () => {
  test("carries its own response so a route can abort by throwing", async () => {
    const err = new HttpError(429, "daily limit reached");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(429);
    expect(err.response.status).toBe(429);
    expect(await err.response.json()).toEqual({ error: "daily limit reached" });
  });

  test("BadRequestError is a 400 HttpError (so withAuth converts it, not Next's 500 handler)", async () => {
    const err = new BadRequestError("prompt: String must contain at least 1 character(s)");
    expect(err).toBeInstanceOf(HttpError);
    expect(err.response.status).toBe(400);
    expect((await err.response.json()).error).toContain("prompt:");
  });
});

/**
 * Shared by /api/plan and /api/refine — both render into the same chat bubble, so the phrasing has
 * to be one owner's, not two copies that drift.
 */
describe("zodMessage / errorMessage", () => {
  const Body = z.object({ projectId: z.string().uuid(), prompt: z.string().min(1) });

  test("names the failing field instead of dumping the raw issues JSON", () => {
    const err = Body.safeParse({ projectId: "undefined", prompt: "" });
    expect(err.success).toBe(false);
    const msg = zodMessage(err.error!);
    expect(msg).toContain("projectId:");
    expect(msg).toContain("prompt:");
    expect(msg).not.toContain('[{"');
  });

  test("caps at five issues and counts the rest", () => {
    const Wide = z.object(Object.fromEntries([...Array(8)].map((_, i) => [`f${i}`, z.string()])));
    const msg = zodMessage(Wide.safeParse({}).error!);
    expect(msg.split("; ")).toHaveLength(6);
    expect(msg).toContain("(+3 more)");
  });

  test("errorMessage routes a ZodError through zodMessage and anything else through .message", () => {
    expect(errorMessage(Body.safeParse({}).error)).toContain("projectId:");
    expect(errorMessage(new Error("couldn't save the edit"))).toBe("couldn't save the edit");
    expect(errorMessage("plain string")).toBe("plain string");
  });
});

describe("notFoundOrDbError", () => {
  afterEach(() => vi.restoreAllMocks());

  test("no error → 404 not found", async () => {
    const res = notFoundOrDbError({ data: null, error: null });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  test("RLS error → 403 (not 404)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(notFoundOrDbError({ data: null, error: { code: "PGRST301", message: "no" } }).status).toBe(403);
  });
});
