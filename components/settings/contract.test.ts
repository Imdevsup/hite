import { describe, expect, test } from "vitest";
import { GET } from "@/app/api/settings/route";
import { PROVIDER_KEY_HEADER as SERVER_HEADER } from "@/lib/ai/providers/credential";
import { BYOK_DISCLOSURE } from "@/lib/ai/keys";
import { EFFORT_LEVELS, clampEffort, type Effort } from "@/lib/ai/effort";
import { DEFAULT_PROVIDER_ID } from "@/lib/ai/providers/request";
import { clampToCeiling } from "./effortPreference";
import { PROVIDER_KEY_HEADER, parseSettingsSnapshot } from "./providerKey";
import { settingsBody } from "./fixture.test-support";

/**
 * THE DRIFT GATES — §20: "The settings UI drifts from lib/ai/keys.ts → Disclosure, help link, rung
 * names, ceilings and the key fingerprint all render from GET /api/settings."
 *
 * Every assertion compares this unit against the REAL server module, never against a value written
 * down twice. A settings surface that quietly disagrees with the code it configures is worse than
 * no settings surface, so these are the tests that must fail loudly when the ladder is re-tuned or
 * the header moves.
 *
 * THE ROUTE IS NOW ASSERTED AGAINST DIRECTLY, and that is a deliberate reversal.
 *
 * This suite used to say: "`app/api/settings/route.ts` is owned by another unit and is mid-change…
 * importing it would make this suite fail for someone else's reason and would pin a shape that is
 * deliberately in motion." That reasoning was sound while the shape was moving. It has expired — the
 * multi-provider route has landed — and the cost of the deferral is now visible: every parser test
 * below still passes against `fixture.test-support.ts`, a body the route no longer returns, while the
 * real body does not parse at all. A green suite over a settings sheet that cannot render a key field
 * is exactly the failure a drift gate exists to prevent, and a fixture is only a drift gate while
 * something proves it still matches the server.
 *
 * So the fixture tests stay (they pin the parser's DEGRADATION behaviour, which is still worth
 * pinning) and `the mounted sheet can read the real route` is added beside them as the one test that
 * fails when the two sides part company.
 */

describe("the header has one owner", () => {
  test("the client copy is byte-identical to the server constant", () => {
    // The client cannot import `lib/ai/providers/credential` (it parses Requests and reaches the
    // registry), so this is the seam where the two could drift. If this fails, every BYOK request
    // the editor makes is anonymous.
    expect(PROVIDER_KEY_HEADER).toBe(SERVER_HEADER);
  });
});

describe("the snapshot is narrowed, never asserted", () => {
  test("the body the route declares today parses", () => {
    const parsed = parseSettingsSnapshot(settingsBody());
    expect(parsed).not.toBeNull();
    expect(parsed?.byok.disclosure).toBe(BYOK_DISCLOSURE);
    expect(parsed?.byok.defaultProviderId).toBe(DEFAULT_PROVIDER_ID);
    expect(parsed?.keyHeader).toBe(SERVER_HEADER);
  });

  test("a body missing the disclosure is rejected — it is the one string that may not be absent", () => {
    const body = settingsBody();
    delete (body.byok as Record<string, unknown>).disclosure;
    expect(parseSettingsSnapshot(body)).toBeNull();
  });

  test("a blank disclosure is rejected too — an empty claim about a key is not a claim", () => {
    const body = settingsBody();
    (body.byok as Record<string, unknown>).disclosure = "   ";
    expect(parseSettingsSnapshot(body)).toBeNull();
  });

  test("a body with no provider is rejected — there is nothing to ask for a key FOR", () => {
    const body = settingsBody();
    body.providers = [];
    expect(parseSettingsSnapshot(body)).toBeNull();
  });

  test("a body missing the key block is rejected rather than half-trusted", () => {
    const body = settingsBody();
    delete body.key;
    expect(parseSettingsSnapshot(body)).toBeNull();
  });

  test("the optional fields degrade rather than fail", () => {
    // Everything a route may honestly decline to publish: the header echo, the named default, a
    // provider's key page, and speech-to-text. None of them is completed with a guess.
    const body = settingsBody();
    delete body.keyHeader;
    delete (body.byok as Record<string, unknown>).keyHeader;
    delete (body.byok as Record<string, unknown>).defaultProvider;
    delete body.transcription;
    body.providers = [{ id: "google" }];

    const parsed = parseSettingsSnapshot(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.keyHeader).toBeNull();
    // Falls back to the first provider the route published — never to a hardcoded id.
    expect(parsed?.byok.defaultProviderId).toBe("google");
    expect(parsed?.providers[0].label).toBe("google");
    expect(parsed?.providers[0].getKey).toBeNull();
    expect(parsed?.transcription.groqConfigured).toBe(false);
  });

  test("non-objects are rejected", () => {
    expect(parseSettingsSnapshot(null)).toBeNull();
    expect(parseSettingsSnapshot("{}")).toBeNull();
    expect(parseSettingsSnapshot([])).toBeNull();
  });

  /**
   * THE SEAM. `ProviderKeyField` is the credential control in §14.3's 402 flow
   * (`components/editor/Composer.tsx` → `KeyRequest` → `fetchSettings` → `parseSettingsSnapshot`),
   * and on `null` the editor renders "HITE couldn't read what this deployment does with a key, so it
   * will not ask you for one" — with no field at all.
   *
   * So this one assertion decides whether a visitor can enter a provider key. If it fails, BYOK is
   * unusable end to end and every planner request 402s — no matter how green the two units on either
   * side of it are. Asserted against the REAL route handler, never a fixture, because a fixture is
   * what let the two sides part company in the first place: this parser spent its whole life reading
   * a Gemini-only body the route had already stopped returning, and every fixture test passed.
   */
  test("the mounted key field can read the REAL route body", async () => {
    const body: unknown = await GET(new Request("https://hite.test/api/settings")).json();
    const parsed = parseSettingsSnapshot(body);
    expect(
      parsed,
      "GET /api/settings no longer answers in the shape parseSettingsSnapshot reads — the editor's " +
        "402 flow will render its 'could not read what this deployment does with a key' state and no " +
        "key can be entered. Re-derive parseSettingsSnapshot from the body the route returns.",
    ).not.toBeNull();
    // Not merely parseable: the three claims the field puts on screen must be real.
    expect(parsed?.byok.disclosure).toBe(BYOK_DISCLOSURE);
    expect(parsed?.providers.map((p) => p.id)).toContain(DEFAULT_PROVIDER_ID);
    expect(parsed?.keyHeader).toBe(SERVER_HEADER);
  });
});

describe("the client clamp agrees with the server clamp", () => {
  /**
   * The control must never offer a rung the server would take away. `clampToCeiling` derives rank
   * from the level's INDEX in `effort.levels`; `clampEffort` uses its own `RANK` map. These are two
   * expressions of one ordering, so every pair is checked rather than a sample.
   */
  test("every requested/ceiling pair resolves identically", () => {
    const levels = [...EFFORT_LEVELS] as Effort[];
    for (const requested of levels) {
      for (const ceiling of levels) {
        expect(clampToCeiling(requested, ceiling, levels)).toBe(clampEffort(requested, ceiling));
      }
    }
  });
});
