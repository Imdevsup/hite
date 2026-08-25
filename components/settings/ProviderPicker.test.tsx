import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BYOK_DISCLOSURE } from "@/lib/ai/keys";
import { EFFORT } from "@/lib/ai/effort";
import { ProviderPicker, describeRung, type CredentialState, type ProviderSelection } from "./ProviderPicker";
import { credentialState, type CheckPhase } from "./ProviderPickerPanel";
import type { ModelOption, ProviderOption } from "./providerOptions";

/**
 * WHAT THIS SUITE IS FOR.
 *
 * The picker's one job is to offer a lot of providers without ever claiming that one works. Every
 * test below asserts a property of the RENDERED markup, because that is the only place the claim is
 * actually made — a badge computed correctly and then rendered inside a `title` attribute nobody
 * opens is not a disclosure, and a broken model quietly omitted from the list is not honesty either.
 *
 * `vitest.config.ts` runs in the `node` environment with no DOM library, so these render to static
 * markup and assert on it — the same approach `components/editor/*.test.tsx` already uses.
 */

function verifiedModel(): ModelOption {
  return {
    id: "verified-model-1",
    label: "Verified model",
    surface: "chat",
    note: null,
    verification: { state: "verified", at: "2026-08-21", rung: "standard", runs: 3 },
    rungCeiling: "max",
    rungCeilingReason: null,
  };
}

function untestedModel(): ModelOption {
  return {
    id: "untested-model-1",
    label: "Untested model",
    surface: null,
    note: "1M context",
    verification: { state: "untested" },
    rungCeiling: "max",
    rungCeilingReason: null,
  };
}

function brokenModel(): ModelOption {
  return {
    id: "broken-model-1",
    label: "Broken model",
    surface: null,
    note: null,
    verification: {
      state: "broken",
      at: "2026-08-21",
      reason: "passes structural cuts; drops the requested transition in 2 of 3 runs",
    },
    rungCeiling: "max",
    rungCeilingReason: null,
  };
}

const KEYED: ProviderOption = {
  id: "openai",
  label: "OpenAI",
  auth: { kind: "apiKey", maxLength: 512, keyHint: null },
  models: [verifiedModel(), untestedModel(), brokenModel()],
  catalogue: null,
  help: { getKey: "https://example.invalid/keys", docs: "https://example.invalid/docs" },
  available: true,
  unavailableReason: null,
  verification: "verified",
  rungCeiling: "max",
  rungCeilingReason: null,
};

const CAPPED: ProviderOption = {
  id: "local",
  label: "Local / OpenAI-compatible",
  auth: { kind: "baseUrl", defaultBaseUrl: "http://localhost:11434/v1", loopbackOnly: true },
  models: [],
  catalogue: { url: "https://example.invalid/models", requiresKey: false },
  help: { getKey: null, docs: "https://example.invalid/local" },
  available: false,
  unavailableReason: "Self-host only. Set HITE_ALLOW_LOCAL_PROVIDER=1 when running HITE yourself.",
  verification: "untested",
  rungCeiling: "standard",
  rungCeilingReason: "It does not enforce tool_choice, so a grounded rung can end the turn with no batch.",
};

const SELECTION: ProviderSelection = {
  providerId: "openai",
  modelId: "untested-model-1",
  surface: null,
  effort: "high",
};

function render(over: Partial<Parameters<typeof ProviderPicker>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ProviderPicker, {
      providers: [KEYED, CAPPED],
      disclosure: BYOK_DISCLOSURE,
      deployerCeiling: null,
      selection: SELECTION,
      onSelectionChange: () => undefined,
      credential: { status: "absent" } satisfies CredentialState,
      onSubmitCredential: () => undefined,
      onClearCredential: () => undefined,
      ...over,
    }),
  );
}

/* ── the three states, at the point of selection ───────────────────────────── */

describe("nothing untested is dressed up as working", () => {
  test("the untested sentence is rendered as text, not hidden in a tooltip", () => {
    const markup = render();
    expect(markup).toContain("UNTESTED");
    expect(markup).toContain("It may work; we have not measured it.");
    // If it only lived in a title/aria attribute, this is where that would show up.
    expect(markup).not.toMatch(/title="[^"]*may work/);
  });

  test("a verified model states the date and the rung it was verified at", () => {
    const markup = render();
    expect(markup).toContain("VERIFIED");
    expect(markup).toContain("2026-08-21");
    expect(markup).toContain("standard rung");
  });

  test("a known-broken model is shown, greyed behind a disclosure that repeats the reason", () => {
    const markup = render();
    expect(markup).toContain("KNOWN ISSUE");
    expect(markup).toContain("drops the requested transition in 2 of 3 runs");

    // It exists, and it is inside the <details> override — not in the plain list above it.
    const details = markup.slice(markup.indexOf("<details"));
    expect(details).toContain("broken-model-1");
    const beforeDetails = markup.slice(0, markup.indexOf("<details"));
    expect(beforeDetails).not.toContain("broken-model-1");
    expect(markup).toContain("show anyway");
  });

  test("an unavailable provider is greyed with its reason, never silently dropped", () => {
    const markup = render();
    expect(markup).toContain("Local / OpenAI-compatible");
    expect(markup).toContain("Set HITE_ALLOW_LOCAL_PROVIDER=1");
    // The row is present AND unselectable — the two halves of "shown greyed".
    // React emits the disabled attribute before the value one, so the order here follows the
    // renderer rather than the source.
    expect(markup).toMatch(/disabled[^>]*value="local"/);
  });
});

/* ── the key ───────────────────────────────────────────────────────────────── */

describe("the secret is never in the DOM", () => {
  test("the field is a password input with no value attribute", () => {
    const markup = render();
    const field = /<input[^>]*id="openai-credential"[^>]*>/.exec(markup)?.[0];
    expect(field).toBeDefined();
    expect(field).toContain('type="password"');
    expect(field).toContain('autoComplete="off"');
    // An uncontrolled field renders no `value`, which is what keeps key material out of the markup.
    expect(field).not.toMatch(/\svalue="/);
  });

  test("a held credential replaces the field entirely — there is nothing left to inspect", () => {
    const markup = render({ credential: { status: "valid", fingerprint: "3f9a2c81" } });
    expect(markup).not.toContain('id="openai-credential"');
    expect(markup).toContain("3f9a2c81");
    expect(markup).toContain("REPLACE KEY");
  });

  test("held is not the same as working, and does not draw itself as working", () => {
    const markup = render({ credential: { status: "held", fingerprint: null } });
    expect(markup).toContain("Held in this browser, not checked yet.");
  });

  test("a refused credential brings the field back and says so — no alert anywhere", () => {
    const markup = render({ credential: { status: "invalid", message: "The provider would not accept this key." } });
    expect(markup).toContain('id="openai-credential"');
    expect(markup).toContain("The provider would not accept this key.");
    expect(markup).toContain('role="alert"');
  });

  test("the disclosure is the key layer's own sentence, rendered verbatim", () => {
    const markup = render();
    expect(markup).toContain("Whoever runs this site can see it in transit");
    // Rendered from the prop, so it cannot be softened here without failing this.
    expect(BYOK_DISCLOSURE).toContain("Whoever runs this site can see it in transit");
  });

  test("a self-hosted provider gets an address field, never a password field", () => {
    const markup = render({
      providers: [{ ...CAPPED, available: true }],
      selection: { ...SELECTION, providerId: "local", modelId: "" },
    });
    const field = /<input[^>]*id="local-credential"[^>]*>/.exec(markup)?.[0];
    expect(field).toBeDefined();
    expect(field).toContain('type="url"');
    expect(field).toContain("http://localhost:11434/v1");
    // The BYOK key disclosure is about a key; there is no key here, so it must not be shown.
    expect(markup).not.toContain("Whoever runs this site can see it in transit");
  });
});

/* ── the rungs ─────────────────────────────────────────────────────────────── */

describe("effort shows the tradeoff and refuses to offer a rung that cannot run", () => {
  test("the tradeoff is stated in words, including whose money it is", () => {
    const markup = render();
    expect(markup).toContain("They take longer, and they spend more of your key.");
  });

  test("every rung's mechanics come from the ladder, not from retyped copy", () => {
    const markup = render();
    expect(markup).toContain(describeRung("high"));
    expect(describeRung("draft")).toContain("no self-check");
    expect(describeRung("draft")).toContain("may edit immediately");
    expect(describeRung("high")).toContain(`must investigate for ${EFFORT.high.groundSteps} steps`);
    expect(markup).toContain(`${Math.round(EFFORT.max.wallClockMs / 1000)}s budget`);
  });

  test("a rung above the provider's ceiling is disabled and says why, in the provider's terms", () => {
    const markup = render({
      providers: [{ ...CAPPED, available: true }],
      selection: { ...SELECTION, providerId: "local", modelId: "" },
    });
    expect(markup).toMatch(/disabled[^>]*value="max"/);
    expect(markup).toMatch(/disabled[^>]*value="high"/);
    expect(markup).toContain("It does not enforce tool_choice");
    // …and the rungs it CAN run are still offered.
    expect(markup).not.toMatch(/disabled[^>]*value="draft"/);
  });

  test("an operator's cap is a different sentence from a provider's ceiling", () => {
    const markup = render({ deployerCeiling: "standard" });
    expect(markup).toContain("The operator of this site capped effort at standard.");
    expect(markup).toMatch(/disabled[^>]*value="max"/);
  });
});

/* ── the panel's one pure decision ─────────────────────────────────────────── */

describe("credentialState keeps presence and verdict apart", () => {
  const resting: CheckPhase = { kind: "resting" };

  test("no key held is absent, whatever the last check said", () => {
    expect(credentialState(resting, KEYED, false, null)).toEqual({ status: "absent" });
  });

  test("a key held but unchecked is HELD, never valid", () => {
    expect(credentialState(resting, KEYED, true, null)).toEqual({ status: "held", fingerprint: null });
  });

  test("a pass is scoped to the provider it was measured against", () => {
    const pass: CheckPhase = { kind: "working", fingerprint: "3f9a2c81", provider: "openai" };
    expect(credentialState(pass, KEYED, true, null)).toEqual({ status: "valid", fingerprint: "3f9a2c81" });
    // Same key, different provider — the earlier pass is not evidence about this one.
    const other: ProviderOption = { ...KEYED, id: "anthropic", label: "Anthropic" };
    expect(credentialState(pass, other, true, null)).toEqual({ status: "held", fingerprint: null });
  });

  test("a self-hosted provider's presence is its address, not a key", () => {
    expect(credentialState(resting, CAPPED, true, null)).toEqual({ status: "absent" });
    expect(credentialState(resting, CAPPED, false, "http://localhost:11434/v1")).toEqual({
      status: "held",
      fingerprint: null,
    });
  });

  test("a failure explains itself without quoting the provider", () => {
    const failed = credentialState({ kind: "failed", failure: "quota" }, KEYED, true, null);
    expect(failed.status).toBe("invalid");
    expect(failed.status === "invalid" && failed.message).toContain("quota");
  });
});
