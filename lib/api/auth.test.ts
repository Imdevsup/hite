import { describe, expect, test, vi, beforeEach } from "vitest";

// Mock the supabase server factory before importing the module under test.
const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
  }),
}));

import { requireUser, UnauthorizedError, withAuth } from "./auth";
import { BadRequestError, HttpError } from "./errors";

describe("requireUser", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
  });

  test("returns { user, supabase } when a user is present", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.com" } } });
    const ctx = await requireUser();
    expect(ctx.user.id).toBe("u1");
    expect(ctx.supabase).toBeDefined();
  });

  test("throws UnauthorizedError when getUser returns no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("UnauthorizedError carries a 401 Response", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    try {
      await requireUser();
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedError);
      const err = e as UnauthorizedError;
      expect(err.response.status).toBe(401);
      const body = await err.response.json();
      expect(body).toEqual({ error: "unauthorized" });
    }
  });

  test("propagates getUser errors (doesn't swallow)", async () => {
    mockGetUser.mockRejectedValue(new Error("network"));
    await expect(requireUser()).rejects.toThrow("network");
  });
});

describe("withAuth", () => {
  beforeEach(() => { mockGetUser.mockReset(); });

  test("invokes the handler with ctx when authed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await withAuth(async ({ user }) => ({ echoed: user.id }));
    expect(result).toEqual({ echoed: "u1" });
  });

  test("returns the 401 Response when UnauthorizedError thrown", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await withAuth(async () => "ok");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  test("rethrows non-Unauthorized errors", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    await expect(
      withAuth(async () => { throw new Error("handler blew up"); }),
    ).rejects.toThrow("handler blew up");
  });

  test("converts any HttpError to its response — a bad body is a 400, not a 500", async () => {
    // Regression: only UnauthorizedError was converted, so the ZodError from `Body.parse(...)`
    // escaped to Next and every malformed request read as a server outage.
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await withAuth(async () => {
      throw new BadRequestError("prompt: Required");
    });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(await (result as Response).json()).toEqual({ error: "prompt: Required" });

    const limited = await withAuth(async () => {
      throw new HttpError(429, "daily limit reached");
    });
    expect((limited as Response).status).toBe(429);
  });

  test("a bare ZodError still 500s — a server-side validation fault must not be relabelled 4xx", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const { z } = await import("zod");
    await expect(
      withAuth(async () => z.object({ a: z.string() }).parse({})),
    ).rejects.toThrow();
  });
});
