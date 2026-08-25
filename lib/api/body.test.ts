import { describe, expect, test } from "vitest";
import { z } from "zod";
import { parseJsonBody, parseJsonText } from "./body";
import { BadRequestError } from "./errors";

/**
 * The regression these guard: `Schema.parse(await req.json())` threw a raw ZodError (or a SyntaxError
 * for truncated JSON) that `withAuth` rethrew, so a CLIENT contract violation surfaced as a Next 500
 * — misleading to the caller and 5xx noise on the dashboards.
 */

const Create = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(120),
});

function post(body: string): Request {
  return new Request("http://localhost/api/things", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("parseJsonBody", () => {
  test("returns the parsed body, typed, when it satisfies the schema", async () => {
    const body = await parseJsonBody(
      post(JSON.stringify({ projectId: "22222222-2222-4222-8222-222222222222", title: "Cut" })),
      Create,
    );
    expect(body.title).toBe("Cut");
  });

  test("a schema violation is a 400 naming every offending field, not a 500", async () => {
    const err = await parseJsonBody(post(JSON.stringify({ projectId: "nope", title: "" })), Create).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BadRequestError);
    const res = (err as BadRequestError).response;
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("projectId:");
    expect(json.error).toContain("title:");
    expect(json.error).not.toContain('[{"'); // never the raw ZodError issues JSON
  });

  test("truncated JSON is a 400, not the SyntaxError-shaped 500 it used to be", async () => {
    const err = await parseJsonBody(post("{ not json"), Create).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as BadRequestError).response.status).toBe(400);
    expect((err as BadRequestError).message).toBe("body: expected a JSON object");
  });

  test("an empty body is a 400 with the same wording (not 'expected object, received null')", async () => {
    const err = await parseJsonBody(post(""), Create).catch((e: unknown) => e);
    expect((err as BadRequestError).message).toBe("body: expected a JSON object");
  });

  test("a JSON array or scalar fails the schema rather than being coerced", async () => {
    await expect(parseJsonBody(post("[]"), Create)).rejects.toBeInstanceOf(BadRequestError);
    await expect(parseJsonBody(post("42"), Create)).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("parseJsonText", () => {
  test("same contract for a caller that already read (and size-capped) the body", () => {
    expect(parseJsonText(JSON.stringify({ message: "boom" }), z.object({ message: z.string() }))).toEqual({
      message: "boom",
    });
    expect(() => parseJsonText("nope", z.object({ message: z.string() }))).toThrow(BadRequestError);
  });
});
