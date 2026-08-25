/**
 * THE SETTINGS SURFACE — the client-side view of code that already exists.
 * ART-DIRECTION §14: "the UI is net-new and the contract is not. The sheet renders
 * GET /api/settings and invents nothing."
 *
 * WHY THESE TYPES ARE DECLARED HERE RATHER THAN IMPORTED AS VALUES.
 * `lib/ai/effort.ts` and `lib/ai/keys.ts` are SERVER modules — `keys.ts` pulls `node:crypto` and the
 * provider registry, and the credential module reads request headers. Importing either as a value
 * from a `"use client"` module would ship server code to the browser.
 *
 * TYPE-ONLY imports are erased by the compiler and cost nothing at runtime, so every type below is
 * still owned by the server module it came from — `Effort` is the real one. What crosses the wire is
 * validated in `parseSettingsSnapshot`, so the shape is checked rather than asserted.
 *
 * WHAT THIS SNAPSHOT IS FOR, AND WHY IT IS SMALL. It used to mirror the whole Gemini-only body —
 * the pool, the payer, the rung list, the ceiling and its reason. That body is gone: the route is
 * BYOK-only and registry-driven now, and the surface that renders providers, models and rungs
 * (`ProviderPickerPanel`) reads `lib/ai/providers/registry.ts` and `lib/ai/effort.ts` DIRECTLY —
 * they are client-safe by construction, so almost nothing has to cross the wire.
 *
 * What is left is exactly the half a client cannot derive for itself: the key layer's own words, the
 * state of the key THIS tab just sent, the provider labels and help links, and whether the deployer
 * configured speech-to-text. `ProviderKeyField` (§14.3's inline 402 field) and `DataFlow` (§14.4)
 * are the two consumers, and this type is the union of what those two need — nothing more, so there
 * is nothing here to drift.
 */
export type { Effort } from "@/lib/ai/effort";

/** One provider, as much of it as a key field needs to name it and link to its key page. */
export interface SnapshotProvider {
  readonly id: string;
  readonly label: string;
  /** The provider's own "get a key" page, or `null` when it publishes none. Never invented. */
  readonly getKey: string | null;
}

/** The body of `GET /api/settings`, narrowed to what this unit renders. */
export interface SettingsSnapshot {
  /** Where a key goes. Header only — never a query string, never the body. */
  readonly keyHeader: string | null;
  readonly key: {
    /** A key header was sent. */
    readonly present: boolean;
    /** …and the server could read it. `present && !usable` is a malformed key. */
    readonly usable: boolean;
    /** `fingerprintKey` — a non-reversible 8-hex label, never key material. */
    readonly fingerprint: string | null;
  };
  readonly byok: {
    /** `BYOK_DISCLOSURE`. Rendered verbatim from here, never retyped (§14.1 correction 2). */
    readonly disclosure: string;
    /** The provider a request that names none is served by (`DEFAULT_PROVIDER_ID`). */
    readonly defaultProviderId: string;
  };
  /** Every provider this deployment publishes, in the route's order. */
  readonly providers: readonly SnapshotProvider[];
  /** Speech-to-text, DEPLOYER-side only, and never conflated with "Groq as your LLM provider". */
  readonly transcription: { readonly groqConfigured: boolean };
}

/** Why a key check failed. The provider reasons are the route's own union; the rest are the
 *  transport outcomes that route can also produce (400 / 401 / 429 / 5xx). */
export type { KeyCheckReason } from "@/app/api/settings/provider-key/check/route";
import type { KeyCheckReason } from "@/app/api/settings/provider-key/check/route";

export type KeyCheckFailure = KeyCheckReason | "missing" | "unauthorized" | "rate-limited" | "server";

export type KeyCheckOutcome =
  | { readonly ok: true; readonly fingerprint: string }
  | { readonly ok: false; readonly failure: KeyCheckFailure };

/** Why the browser refused to keep the key. Surfaced, never swallowed. */
export type KeyStorageFailure = "unavailable";

export type KeyStoreResult = { readonly ok: true } | { readonly ok: false; readonly failure: KeyStorageFailure };
