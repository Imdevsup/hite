import { describe, expect, test } from "vitest";
import { branchFailureText, errorText, redactUrls } from "./errors";

/**
 * `job.error` is written by the worker, stored in Postgres, and returned to the browser by the
 * status routes. It therefore has to be readable AND safe — a signed storage url in an ffmpeg
 * error is read access to the user's raw footage.
 */

describe("redactUrls", () => {
  test("strips the query string from a signed storage url", () => {
    const message =
      "could not download source media: HTTP 403 " +
      "https://xyz.supabase.co/storage/v1/object/sign/media/u/a/clip.mp4?token=eyJhbGciOi.SECRET&x=1";
    expect(redactUrls(message)).toBe(
      "could not download source media: HTTP 403 https://xyz.supabase.co/storage/v1/object/sign/media/u/a/clip.mp4",
    );
  });

  test("leaves urls without a query string alone", () => {
    expect(redactUrls("see https://remotion.dev/docs/target-closed for details")).toBe(
      "see https://remotion.dev/docs/target-closed for details",
    );
  });

  test("redacts every url in a message, not just the first", () => {
    const out = redactUrls("http://a/x?token=1 then https://b/y?token=2");
    expect(out).toBe("http://a/x then https://b/y");
  });
});

describe("errorText", () => {
  test("uses the message of a thrown Error", () => {
    expect(errorText(new Error("moov atom not found"))).toBe("moov atom not found");
  });

  test("appends the cause, where the real reason usually is", () => {
    const e = new Error("could not store the transcript", { cause: new Error("duplicate key value") });
    expect(errorText(e)).toBe("could not store the transcript: duplicate key value");
  });

  test("handles a non-Error throw rather than reporting [object Object]", () => {
    expect(errorText("plain string failure")).toBe("plain string failure");
    expect(errorText(42)).toBe("42");
  });

  test("never returns an empty string — a blank error reads as success to a person", () => {
    expect(errorText(new Error(""))).toBe("the job failed with no error message");
    expect(errorText(undefined)).toBe("undefined");
  });

  test("caps the length so a Chromium stack does not bloat every poll response", () => {
    const long = errorText(new Error("x".repeat(5_000)));
    expect(long.length).toBeLessThanOrEqual(2_001);
    expect(long.endsWith("…")).toBe(true);
  });

  test("redacts credentials on the way out", () => {
    expect(errorText(new Error("fetch https://s3/a.mp4?token=SECRET failed"))).not.toContain("SECRET");
  });
});

describe("branchFailureText", () => {
  test("names each failed branch, so a partial analysis is reported honestly", () => {
    // The case that matters: beats and scenes succeeded and their rows are already written; the
    // job must still say what did NOT happen instead of reporting success.
    expect(
      branchFailureText([
        { branch: "transcribe", error: new Error("GROQ_API_KEY is not set") },
        { branch: "scenes", error: new Error("ffmpeg exited 1: Invalid data found") },
      ]),
    ).toBe("transcribe: GROQ_API_KEY is not set — scenes: ffmpeg exited 1: Invalid data found");
  });

  test("a single failure reads as one plain sentence", () => {
    expect(branchFailureText([{ branch: "transcribe", error: new Error("rate limited") }])).toBe(
      "transcribe: rate limited",
    );
  });
});
