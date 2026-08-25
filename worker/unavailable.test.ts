import { describe, expect, test } from "vitest";
import { BranchUnavailableError, branchFailureText, errorText } from "./errors";

/**
 * The distinction between "this deployment cannot do that" and "this video could not be read".
 *
 * Before this existed, an analyze job that probed the file, measured its tempo and found every shot
 * boundary was marked FAILED because `GROQ_API_KEY` was absent, and the editor told the user "HITE
 * couldn't read this video" about a video it had read perfectly. The job outcome and the copy were
 * both false, produced by the software rather than by a person.
 */
describe("BranchUnavailableError", () => {
  test("is an Error, carries its branch, and keeps its message readable", () => {
    const e = new BranchUnavailableError("transcribe", "GROQ_API_KEY is not set, so speech was not transcribed.");
    expect(e).toBeInstanceOf(Error);
    expect(e.branchName).toBe("transcribe");
    expect(errorText(e)).toContain("GROQ_API_KEY is not set");
  });

  test("is distinguishable from a real branch failure by type, not by string matching", () => {
    const unavailable: unknown = new BranchUnavailableError("transcribe", "not configured");
    const failed: unknown = new Error("ffmpeg exited 1: Invalid data found");
    expect(unavailable instanceof BranchUnavailableError).toBe(true);
    expect(failed instanceof BranchUnavailableError).toBe(false);
  });

  test("a real failure still produces the job.error text a person can act on", () => {
    expect(branchFailureText([{ branch: "scenes", error: new Error("ffmpeg exited 1") }])).toBe(
      "scenes: ffmpeg exited 1",
    );
  });
});
