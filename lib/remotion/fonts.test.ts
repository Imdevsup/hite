import { describe, expect, test } from "vitest";
import { captionStyle, captionAnchor, CAPTION_FONT_FAMILY } from "./fonts";

/**
 * captionStyle is the WYSIWYG contract behind the TextWindow style picker: every style id the UI can
 * emit must render DISTINCTLY, otherwise the picker is theater (a user picks "Typewriter" and silently
 * gets the default look). These tests pin that contract — they fail if a style stops differing or a
 * picker option is added without a matching renderer branch.
 */

// The exact set of ids TextWindow can dispatch: renderer-native + the `text` registry keys it lists.
const PICKER_IDS = ["default", "karaoke", "text-typewriter", "text-lower-third-basic", "text-hashtag-sticker"] as const;

describe("captionStyle — every picker style renders distinctly", () => {
  test("all known styles carry the shared brand font family", () => {
    for (const id of PICKER_IDS) {
      expect(captionStyle(id).fontFamily).toBe(CAPTION_FONT_FAMILY);
    }
  });

  test("no two picker styles produce identical CSS (the anti-theater guard)", () => {
    const seen = new Map<string, string>();
    for (const id of PICKER_IDS) {
      const serialized = JSON.stringify(captionStyle(id));
      const prior = [...seen.entries()].find(([, v]) => v === serialized);
      expect(prior, `"${id}" renders identically to "${prior?.[0]}"`).toBeUndefined();
      seen.set(id, serialized);
    }
    expect(seen.size).toBe(PICKER_IDS.length);
  });

  test("default — solid dark plate, off-white, 42px", () => {
    const s = captionStyle("default");
    expect(s.fontSize).toBe(42);
    expect(s.color).toBe("#F2EFE9");
    expect(s.background).toBe("rgba(10,10,10,0.78)");
    expect(s.textAlign).toBe("center");
  });

  test("karaoke — no plate, oversized toxic-yellow with a stroke", () => {
    const s = captionStyle("karaoke");
    expect(s.background).toBe("transparent");
    expect(s.color).toBe("#FFE600");
    expect(s.fontSize).toBe(56);
    expect(s.WebkitTextStroke).toBeTruthy();
  });

  test("text-typewriter — teal mono, tight tracking, smaller", () => {
    const s = captionStyle("text-typewriter");
    expect(s.color).toBe("#C6F24E");
    expect(s.fontSize).toBe(38);
    expect(s.letterSpacing).toBe("0.06em");
  });

  test("text-lower-third-basic — left-aligned with an accent rule, no full plate", () => {
    const s = captionStyle("text-lower-third-basic");
    expect(s.textAlign).toBe("left");
    expect(s.borderLeft).toContain("#C6F24E");
    expect(s.maxWidth).toBe("70%");
  });

  test("text-hashtag-sticker — filled accent pill, uppercase, dark ink", () => {
    const s = captionStyle("text-hashtag-sticker");
    expect(s.background).toBe("#C6F24E");
    expect(s.color).toBe("#0A0A0A");
    expect(s.textTransform).toBe("uppercase");
    expect(s.borderRadius).toBe(999);
  });

  test("an unknown style id falls back to default (never throws / never blank)", () => {
    // An AI-emitted or legacy style must render plainly, not crash the composition.
    expect(captionStyle("does-not-exist")).toEqual(captionStyle("default"));
    expect(captionStyle("")).toEqual(captionStyle("default"));
  });
});

describe("captionAnchor — screen placement matches the style (the positioning half of WYSIWYG)", () => {
  test("default + typewriter share the bottom-center subtitle band", () => {
    const def = captionAnchor("default");
    expect(def).toEqual({ justifyContent: "flex-end", alignItems: "center", inset: "0 0 8% 0" });
    // Typewriter is a typographic variant of the band, not a repositioning → same anchor as default.
    expect(captionAnchor("text-typewriter")).toEqual(def);
  });

  test("lower-third hugs the bottom-LEFT (matches its left accent rule + left text-align)", () => {
    const a = captionAnchor("text-lower-third-basic");
    expect(a.justifyContent).toBe("flex-end"); // bottom
    expect(a.alignItems).toBe("flex-start"); // left
    // captionStyle left-aligns the lower-third; the anchor must left-align it too or textAlign is moot.
    expect(captionStyle("text-lower-third-basic").textAlign).toBe("left");
  });

  test("hashtag sticker sits in the top-RIGHT corner, clear of the subtitle band", () => {
    const a = captionAnchor("text-hashtag-sticker");
    expect(a.justifyContent).toBe("flex-start"); // top
    expect(a.alignItems).toBe("flex-end"); // right
  });

  test("karaoke lifts off the lower edge toward center (lyric/AMV convention)", () => {
    expect(captionAnchor("karaoke").justifyContent).toBe("center");
  });

  test("a style with a distinct look also gets a distinct anchor (no positioning theater)", () => {
    // The two styles whose whole point is placement (lower-third = a left bar, sticker = a corner tag)
    // must NOT land in the default bottom-center box, or the picker lies about where they go.
    const def = JSON.stringify(captionAnchor("default"));
    expect(JSON.stringify(captionAnchor("text-lower-third-basic"))).not.toBe(def);
    expect(JSON.stringify(captionAnchor("text-hashtag-sticker"))).not.toBe(def);
    expect(JSON.stringify(captionAnchor("karaoke"))).not.toBe(def);
  });

  test("an unknown style id falls back to the default band (parity with captionStyle)", () => {
    expect(captionAnchor("does-not-exist")).toEqual(captionAnchor("default"));
    expect(captionAnchor("")).toEqual(captionAnchor("default"));
  });
});
