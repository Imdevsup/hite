import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaStatus, MediaStatusView, type MediaStatusInput } from "./MediaStatus";

const idle: MediaStatusInput = { uploadingName: null, queueLabel: null, progress: 0, lastLoadedName: null };
const render = (input: Partial<MediaStatusInput>) => renderToStaticMarkup(<MediaStatusView {...idle} {...input} />);

/**
 * The regression: a drop onto the WORKING screen produced no visible result of any kind.
 *
 * `EmptyState` owns the progress bar and the "n files added" line, and `EditorFrame` unmounts it the
 * instant an EDL exists. A new asset does not join the timeline by itself either — nothing mutates
 * the EDL except an `EditCommand` — so the second file a user dropped uploaded, registered, became
 * addressable by the model, and changed nothing on screen. That is indistinguishable from a page
 * that ignores drops, which is the reading a user actually arrives at.
 */
describe("MediaStatus", () => {
  test("renders nothing when no upload has happened", () => {
    expect(render({})).toBe("");
    // And the wired component agrees, from the store's real defaults.
    expect(renderToStaticMarkup(<MediaStatus />)).toBe("");
  });

  test("names the file and its real percentage while bytes are going up", () => {
    const html = render({ uploadingName: "take-2.mp4", progress: 0.42 });
    expect(html).toContain("take-2.mp4");
    expect(html).toContain("42%");
  });

  test("a multi-file drop shows its position in the queue", () => {
    expect(render({ uploadingName: "b.mp4", queueLabel: "2/3", progress: 0.1 })).toContain("2/3");
  });

  /**
   * The sentence carries the mechanism because the mechanism is not guessable: every asset is listed
   * to the model as `id :: filename :: length` (`assetContextLines`), so naming the file in a prompt
   * is exactly how a second take reaches the timeline. A filename with no instruction would be an
   * honest report the user still cannot act on.
   */
  test("once the asset exists it says so, and says how to use it", () => {
    const html = render({ lastLoadedName: "take-2.mp4" });
    expect(html).toContain("take-2.mp4");
    expect(html).toMatch(/name it in a prompt/i);
  });

  test("progress wins while a file is still going up, so the two never both show", () => {
    const html = render({ uploadingName: "c.mp4", progress: 0.5, lastLoadedName: "b.mp4" });
    expect(html).toContain("c.mp4");
    expect(html).not.toMatch(/name it in a prompt/i);
  });

  /**
   * The line is an INSTRUCTION, and these two rules keep it from becoming furniture. The store only
   * sets `lastLoadedName` for a drop that happened while a timeline already existed — the upload that
   * CREATES the timeline needs no sentence, because the timeline appearing is the feedback — and the
   * planner clears it when a prompt is sent, which is the user carrying the instruction out. Both are
   * store-side; what this file pins is that the view says nothing when the name is absent.
   */
  test("says nothing once the name is cleared, whatever else is in flight", () => {
    expect(render({ lastLoadedName: null, progress: 0.9 })).toBe("");
  });

  /**
   * §13's affordance budget is enforced by a count of TAB STOPS on the first screen
   * (`affordances.ts`, `firstScreen.test.tsx`). A readout may be added; a control may not.
   */
  test("carries no focusable element, so the affordance count is unchanged", () => {
    const html = render({ lastLoadedName: "take-2.mp4" });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("<a ");
  });
});
