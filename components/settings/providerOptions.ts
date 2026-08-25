import { EFFORT_LEVELS, clampEffort, rungCeiling, rungCeilingReason, type Effort } from "@/lib/ai/effort";
import {
  DEFAULT_KEY_MAX_LENGTH,
  PROVIDERS,
  capabilitiesFor,
  findProviderModel,
} from "@/lib/ai/providers/registry";
import { verificationFor, type Verification, type VerificationState } from "@/lib/ai/providers/verification";
import type { ModelSurface, ProviderAuth, ProviderEntry, ProviderId } from "@/lib/ai/providers/types";

/**
 * WHAT THE PICKER RENDERS, DERIVED — never declared.
 *
 * This file owns no facts. Which providers exist and what they can do comes from
 * `lib/ai/providers/registry.ts`; whether a model actually drives HITE's planner comes from
 * `lib/ai/providers/verification.ts`, which reads the harness's committed result file and nothing
 * else; how far a provider can climb the ladder comes from `rungCeiling(capabilities)` in
 * `lib/ai/effort.ts`. All three are client-safe by construction — the registry imports no provider
 * SDK precisely so a settings UI can render from it with zero bytes of `@ai-sdk/*` in the browser
 * chunk — so the picker reads the real thing instead of a wire copy that could drift from it.
 *
 * THAT IS THE HONESTY MECHANISM, and it is structural. `ProviderModel` has no `verified` field, so
 * there is nowhere for this file to read one, and nothing here can invent one: a green badge exists
 * only where `scripts/verify-provider.ts` wrote a passing run against the real planner. Everything
 * ships `untested` today, Gemini included, and the picker says so at the point of selection.
 *
 * WHAT STILL HAS TO COME FROM THE SERVER, and why it is a short list:
 *   · the BYOK disclosure — `lib/ai/keys.ts` imports `node:crypto`, so it cannot be pulled into a
 *     client bundle for one string, and the picker must never author its own claim about keys;
 *   · the deployer's effort brake and whether the self-hosted provider is switched on — both read
 *     `process.env` at call time, which on the client resolves to "unset" and would quietly show a
 *     rung or a provider the server will refuse.
 * `readDeploymentPolicy` narrows exactly those, and nothing else.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   DEPLOYMENT POLICY — the only part that crosses the wire
   ────────────────────────────────────────────────────────────────────────── */

export interface DeploymentPolicy {
  /** `BYOK_DISCLOSURE`, rendered verbatim. Required: without the key layer's own words about where
   *  a key goes, this surface has no honest way to ask for one. */
  readonly disclosure: string;
  /** `HITE_BYOK_EFFORT_CEILING`. `null` ⇒ the deployer set no brake. */
  readonly deployerCeiling: Effort | null;
  /** `HITE_ALLOW_LOCAL_PROVIDER=1`. Fails closed: unknown means off, which is right for a hosted
   *  deployment where `localhost` would mean the SERVER's localhost. */
  readonly localEnabled: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function level(value: unknown): Effort | null {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value) ? (value as Effort) : null;
}

/**
 * Narrow `GET /api/settings`. `null` when the body carries no BYOK disclosure — a designed state in
 * the panel ("this deployment has not published its key policy"), not a crash and not an invented
 * default, because a fabricated sentence about where someone's credential goes is the one thing this
 * surface must never produce.
 *
 * Deliberately tolerant about everything else. The route is being rebuilt for BYOK in another unit,
 * so the two optional fields are read from either of the two places they plausibly land, and their
 * absence resolves to the conservative value rather than to a parse failure.
 */
export function readDeploymentPolicy(body: unknown): DeploymentPolicy | null {
  const raw = record(body);
  const byok = raw && record(raw.byok);
  // Carried together so the narrowing survives: proving the disclosure is a string also proves the
  // block it came from is a record, and TypeScript cannot infer the second from the first.
  const disclosure =
    byok && typeof byok.disclosure === "string" && byok.disclosure.trim() !== ""
      ? { text: byok.disclosure, byok }
      : null;
  if (!disclosure) return null;

  const effort = raw && record(raw.effort);
  const providers = raw && record(raw.providers);
  const local = providers && record(providers.local);

  return {
    disclosure: disclosure.text,
    deployerCeiling: level(disclosure.byok.deployerCeiling) ?? (effort ? level(effort.deployerCeiling) : null),
    localEnabled: disclosure.byok.localEnabled === true || local?.enabled === true,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   THE VIEW MODEL
   ────────────────────────────────────────────────────────────────────────── */

export interface ModelOption {
  readonly id: string;
  readonly label: string;
  readonly surface: ModelSurface | null;
  /** A factual note from the registry. Never a reliability claim — that is `verification`. */
  readonly note: string | null;
  readonly verification: Verification;
  /** Derived from THIS model's capabilities, which may override the provider's. */
  readonly rungCeiling: Effort;
  readonly rungCeilingReason: string | null;
}

export interface ProviderOption {
  readonly id: ProviderId;
  readonly label: string;
  readonly auth: ProviderAuth;
  readonly models: readonly ModelOption[];
  readonly catalogue: { readonly url: string; readonly requiresKey: boolean } | null;
  readonly help: { readonly getKey: string | null; readonly docs: string };
  /** `false` ⇒ shown, greyed, with the reason. Never hidden: an option that vanishes teaches nothing. */
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** The provider-level badge. */
  readonly verification: VerificationState;
  readonly rungCeiling: Effort;
  readonly rungCeilingReason: string | null;
}

/**
 * Why a `selfHostOnly` provider is greyed out on this deployment.
 *
 * `registry.unavailableReason()` is the server's owner of this sentence, but it calls
 * `localProviderEnabled()`, which reads `process.env` — on the client that always resolves to
 * "unset", so calling it here would report the provider as off even on a self-host that enabled it.
 * The availability decision therefore comes from the policy the SERVER published, and the sentence
 * is kept in step with the registry's by `providerOptions.test.ts`.
 */
const SELF_HOST_ONLY_REASON =
  "Self-host only. This server would be the one making the request, so a local address here would " +
  "either fail or point at the server's own network. Set HITE_ALLOW_LOCAL_PROVIDER=1 when running HITE yourself.";

/** One model row, with its verification and its own ceiling. */
export function modelOptionFor(entry: ProviderEntry, id: string, surface: ModelSurface | null): ModelOption {
  const listed = findProviderModel(entry, id, surface);
  const capabilities = capabilitiesFor(entry, listed);
  return {
    id,
    label: listed?.label ?? id,
    surface: listed?.surface ?? surface,
    note: listed?.note ?? null,
    // A model the registry does not list is a free-text id, and `verificationFor` answers `untested`
    // for it — which is the truthful answer, not a gap (U8 §9.4).
    verification: verificationFor(entry.id, id, surface),
    rungCeiling: rungCeiling(capabilities),
    rungCeilingReason: rungCeilingReason(capabilities),
  };
}

/**
 * A model id the user typed rather than picked.
 *
 * It is looked up through the SAME `verificationFor` every listed model uses — so a typed id that
 * happens to have a committed run gets its real badge, and everything else gets `untested`, which is
 * the truthful answer rather than a gap (U8 §9.4). Its ceiling is the provider's, because the
 * registry has no per-model capability override to apply to an id it does not list.
 */
export function typedModelOption(provider: ProviderOption, id: string): ModelOption {
  return {
    id,
    label: id,
    surface: null,
    note: null,
    verification: verificationFor(provider.id, id, null),
    rungCeiling: provider.rungCeiling,
    rungCeilingReason: provider.rungCeilingReason,
  };
}

/**
 * The provider-level badge: one verified model makes the provider verified; a provider whose every
 * listed model is known-broken is broken; everything else — including a provider that lists no models
 * at all, which is normal for a catalogue-driven or self-hosted one — is untested.
 */
export function providerVerification(models: readonly ModelOption[]): VerificationState {
  if (models.some((m) => m.verification.state === "verified")) return "verified";
  if (models.length > 0 && models.every((m) => m.verification.state === "broken")) return "broken";
  return "untested";
}

/**
 * A catalogue the USER can open in a tab, or `null`.
 *
 * `ValidationCall`/`catalogue` urls are "absolute for a keyed provider, a PATH appended to the user's
 * baseUrl for `local`" (providers/types.ts). The picker renders one as an `href` with
 * `target="_blank"`, so the path form rendered `href="/models"` — a link to HITE's own origin, which
 * 404s. Caught by reading the rendered markup, not the source.
 *
 * Dropped rather than repaired, deliberately: the only base we could paste on is the registry's
 * DEFAULT (`http://localhost:11434/v1`), and the whole point of a self-hosted entry is that the user
 * supplies their own address — which lives in an uncontrolled field this component never reads. A
 * confident link to a server they are not running is a fabricated fact about someone else's machine,
 * and this file exists to avoid exactly that. The provider's docs link is unaffected.
 */
function browsableCatalogue(entry: ProviderEntry): ProviderOption["catalogue"] {
  const catalogue = entry.catalogue ?? null;
  if (!catalogue) return null;
  return /^https?:\/\//.test(catalogue.url) ? catalogue : null;
}

/** Every provider the registry knows, in registry order, with this deployment's policy applied. */
export function providerOptions(policy: DeploymentPolicy): readonly ProviderOption[] {
  return PROVIDERS.map((entry) => {
    const available = entry.availability === "always" || policy.localEnabled;
    const models = entry.models.map((model) => modelOptionFor(entry, model.id, model.surface));
    const capabilities = entry.capabilities;
    return {
      id: entry.id,
      label: entry.label,
      auth: entry.auth,
      models,
      catalogue: browsableCatalogue(entry),
      help: entry.help,
      available,
      unavailableReason: available ? null : SELF_HOST_ONLY_REASON,
      verification: providerVerification(models),
      rungCeiling: rungCeiling(capabilities),
      rungCeilingReason: rungCeilingReason(capabilities),
    };
  });
}

/** Verified first, untested next, broken last (U8 §9.3: verified is "yes, and sorted first"). */
const VERIFICATION_RANK: Record<VerificationState, number> = { verified: 0, untested: 1, broken: 2 };

export function sortModels(models: readonly ModelOption[]): ModelOption[] {
  return [...models].sort((a, b) => VERIFICATION_RANK[a.verification.state] - VERIFICATION_RANK[b.verification.state]);
}

/** A known-broken model is reachable only through the override disclosure, which repeats the reason. */
export function isSelectableModel(verification: Verification): boolean {
  return verification.state !== "broken";
}

/**
 * The sentence shown AT THE POINT OF SELECTION — never only in a tooltip (U8 §9.3: "a badge nobody
 * sees is not a disclosure").
 *
 * The verified line does not name a number of checks. The harness's prompt set is six today, and
 * hardcoding "all 6" here would turn a copy string into an unmaintained claim about a file this
 * component cannot see. The date and the rung ARE stated, because both are the claim's scope.
 */
export function describeVerification(verification: Verification): { badge: string; detail: string } {
  switch (verification.state) {
    case "verified": {
      const runs = verification.runs === null ? "" : ` ${verification.runs} runs per check.`;
      return {
        badge: "VERIFIED",
        detail: `Verified — HITE's provider check passed on ${verification.at} at the ${verification.rung} rung.${runs}`,
      };
    }
    case "broken": {
      const measured = verification.at === null ? "" : ` Measured ${verification.at}.`;
      return { badge: "KNOWN ISSUE", detail: `Known issue — ${verification.reason}.${measured}` };
    }
    case "untested":
      return {
        badge: "UNTESTED",
        detail:
          "Untested — nobody has run HITE's provider check against this model yet. It may work; we have not measured it.",
      };
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   CLIENT-SIDE PRE-CHECKS — mirrors of the server gates, never stricter
   ────────────────────────────────────────────────────────────────────────── */

export type KeyShapeProblem = "empty" | "too-short" | "too-long" | "charset";
export type KeyShapeVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: KeyShapeProblem };

/**
 * The exact bounds `isWellFormedKey` (lib/ai/providers/credential.ts) applies, mirrored so the field
 * can answer instantly and kindly instead of round-tripping to a 400 that names a header.
 *
 * MIRRORED, NOT INVENTED, and `providerOptions.test.ts` runs both over the same corpus and fails if
 * they ever disagree — a client check stricter than the server's rejects keys that would have worked,
 * and one looser sends a request that 400s with a message about a header the user never saw.
 *
 * Bounds only, by design: the tempting `/^AIza[A-Za-z0-9_-]{35}$/` is wrong (real Gemini keys are not
 * all `AIza`, not all 39 characters, and contain `.`), and with eight providers that risk multiplies
 * by eight. The provider is the authority, and the check call asks it.
 */
const KEY_MIN_LENGTH = 16;
const KEY_CHARSET = /^[A-Za-z0-9._~+/=-]+$/;

export function checkKeyShape(raw: string, maxLength: number = DEFAULT_KEY_MAX_LENGTH): KeyShapeVerdict {
  // The server trims before it validates, so trimming here keeps the two answering the same question.
  const key = raw.trim();
  if (key.length === 0) return { ok: false, reason: "empty" };
  if (key.length < KEY_MIN_LENGTH) return { ok: false, reason: "too-short" };
  if (key.length > maxLength) return { ok: false, reason: "too-long" };
  if (!KEY_CHARSET.test(key)) return { ok: false, reason: "charset" };
  return { ok: true };
}

/** Never quotes the value: the reason is an enum, so a key cannot reach a message by accident. */
export const KEY_SHAPE_MESSAGE: Record<KeyShapeProblem, string> = {
  empty: "Paste a key first.",
  "too-short": "That is shorter than any key a provider issues — it looks like part of one.",
  "too-long": "That is longer than this provider's keys. Check you copied the key and not the page.",
  charset:
    "That has a character a key cannot hold — usually a space, a line break or a quote picked up when copying.",
};

export type BaseUrlProblem = "empty" | "invalid" | "scheme" | "credentials" | "not-loopback";
export type BaseUrlVerdict =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: BaseUrlProblem };

const BASE_URL_MAX_LENGTH = 2048;

/** 127.0.0.0/8, `localhost`, IPv6 loopback — checked on the PARSED host, never the raw string, because
 *  `http://127.0.0.1@evil.example/` has a hostname of `evil.example` and a substring match passes it. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const octets = v4.slice(1).map(Number);
  return octets.every((n) => n <= 255) && octets[0] === 127;
}

/**
 * The mirror of `requireLoopbackBaseUrl`, which is the SSRF gate (U8 §11.1) and remains the
 * authority — this only stops a submission the server would certainly refuse, and says which of the
 * four reasons applies instead of a generic 400. `providerOptions.test.ts` drift-tests the pair.
 */
export function checkLocalBaseUrl(raw: string): BaseUrlVerdict {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.length > BASE_URL_MAX_LENGTH) return { ok: false, reason: "invalid" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (parsed.username !== "" || parsed.password !== "") return { ok: false, reason: "credentials" };
  if (!isLoopbackHost(parsed.hostname)) return { ok: false, reason: "not-loopback" };
  return { ok: true, url: parsed.toString().replace(/\/$/, "") };
}

export const BASE_URL_MESSAGE: Record<BaseUrlProblem, string> = {
  empty: "Enter the address your local model server listens on.",
  invalid: "That is not a URL. It should look like http://localhost:11434/v1.",
  scheme: "Only http:// and https:// addresses can be reached.",
  credentials: "A username or password in the address is not allowed. Take the part before the @ out.",
  "not-loopback":
    "Only an address on this machine is allowed. A remote one would make this server fetch it, which is how internal networks get read.",
};

/* ─────────────────────────────────────────────────────────────────────────────
   RUNGS — derived from capabilities, never from a vendor's model id
   ────────────────────────────────────────────────────────────────────────── */

export type RungState = "available" | "blocked-by-provider" | "blocked-by-deployer";

/**
 * `min(rungCeiling(capabilities), deployerCeiling)`, and WHICH of the two bound.
 *
 * The provider's ceiling is reported first when both bind, because the two are not the same kind of
 * fact. A provider ceiling is structural: a provider that does not enforce `toolChoice` cannot have
 * grounding enforced, so a rung with `groundSteps > 0` can end the turn with no batch at all. A
 * deployer ceiling is a setting somebody chose. Telling a user to ask the operator about a rung their
 * provider physically cannot serve would be a wrong instruction.
 */
export function rungState(level: Effort, providerCeiling: Effort, deployerCeiling: Effort | null): RungState {
  if (clampEffort(level, providerCeiling) !== level) return "blocked-by-provider";
  if (deployerCeiling !== null && clampEffort(level, deployerCeiling) !== level) return "blocked-by-deployer";
  return "available";
}

/** The highest rung actually reachable — what a restored or default selection is clamped to. */
export function reachableCeiling(providerCeiling: Effort, deployerCeiling: Effort | null): Effort {
  return deployerCeiling === null ? providerCeiling : clampEffort(providerCeiling, deployerCeiling);
}
