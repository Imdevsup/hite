"use client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_EFFORT, clampEffort, isEffort, type Effort } from "@/lib/ai/effort";
import { isProviderId, type ProviderId } from "@/lib/ai/providers/types";
import { ProviderPicker, type CredentialState, type ProviderSelection } from "./ProviderPicker";
import {
  isSelectableModel,
  providerOptions,
  reachableCeiling,
  readDeploymentPolicy,
  type DeploymentPolicy,
  type ProviderOption,
} from "./providerOptions";
import { readEffortPreference, storeEffortPreference } from "./effortPreference";
import { readProviderPreference, storeProviderPreference } from "./providerPreference";
import { providerSelectionHeaders } from "./providerHeaders";
import {
  clearProviderKey,
  getServerProviderKeySnapshot,
  hasProviderKey,
  providerKeyHeaders,
  storeProviderKey,
  subscribeProviderKey,
} from "./providerKey";
import type { KeyCheckFailure } from "./types";

/**
 * THE PROVIDER PICKER'S CONTAINER — the deployment policy read, the credential hand-off, the check.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN, because every one of these already had an owner:
 *   · which providers exist, what they can do, and whether a model is verified →
 *     `lib/ai/providers/registry.ts` + `verification.ts`, imported directly. They import no provider
 *     SDK, so this costs the browser zero bytes of `@ai-sdk/*` and the picker renders the REAL
 *     registry rather than a wire copy that could drift from it.
 *   · the key → `providerKey.ts`. Session-scoped, module-private, readable only as a boolean or as a
 *     request header. No key is held in this component's state, props or storage.
 *   · the rung → `effortPreference.ts`; the provider/model/base-URL choice → `providerPreference.ts`.
 *
 * WHAT IT ADDS is the one thing none of them can: WHICH provider, chosen honestly. `ProviderKeyField`
 * and `EffortControl` render the single-provider view of `GET /api/settings`; this renders the eight
 * the registry knows, each with the badge its measured evidence earns.
 *
 * WHY THE CHECK IS CALLED HERE RATHER THAN THROUGH `providerKey.checkProviderKey()`. That helper
 * sends the key header and nothing else, which was right when the check route hardcoded Google. The
 * route is registry-driven now and reads WHICH provider to ask from `x-hite-provider` (and a
 * self-hosted address from `x-hite-base-url`), so the call below adds those through
 * `providerHeaders.ts` while still taking the key header from `providerKeyHeaders()` — the single
 * owner of how the secret travels. A selection sent any other way is not an error, which is the
 * danger: the route would fall back to its default provider and grade an OpenAI key against Google.
 * `checkProviderKey` should grow a selection argument and absorb this call.
 */

type Load =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly policy: DeploymentPolicy }
  /** The route answered, but published no BYOK disclosure. */
  | { readonly phase: "unpublished" }
  | { readonly phase: "unreachable"; readonly status: number | null };

/** The local half of credential state. PRESENCE comes from `providerKey.ts`, never from here. */
export type CheckPhase =
  | { readonly kind: "resting" }
  | { readonly kind: "checking" }
  | { readonly kind: "working"; readonly fingerprint: string; readonly provider: ProviderId }
  | { readonly kind: "failed"; readonly failure: KeyCheckFailure };

/**
 * Every failure the check route can produce, in the holder's terms.
 *
 * None of these quotes the provider, and none can: the route never reads the upstream response body,
 * because "text that is never parsed cannot be forwarded". Writing a plausible provider sentence here
 * would be a fabricated measurement, so each real outcome gets its own honest line instead.
 */
const FAILURE_LINE: Readonly<Record<KeyCheckFailure, string>> = {
  invalid: "The provider would not accept this key.",
  quota: "This key is over its quota right now. It is a real key — it just cannot spend anything yet.",
  network: "We could not reach the provider to ask, so the key was not graded.",
  missing: "The key is no longer held in this tab.",
  unauthorized: "This session cannot check a key. Reload the page and try again.",
  "rate-limited": "Too many key checks from this network. Wait a minute and try again.",
  server: "The check failed on this server.",
  // The route refuses to grade a key for a provider it will not run, so it does not become a
  // validity oracle for a path the product would decline anyway.
  unsupported: "This deployment will not run that provider, so it will not grade a key for it either.",
};

const CHECK_URL = "/api/settings/provider-key/check";
const CHECK_STATUS_FAILURE: Readonly<Record<number, KeyCheckFailure>> = {
  400: "missing",
  401: "unauthorized",
  403: "unauthorized",
  429: "rate-limited",
};

/**
 * Presence comes from the storage owner; the verdict comes from the last check. They are kept apart
 * on purpose — a key that is HELD is not a key that WORKS, and drawing the two the same way is how a
 * picker ends up claiming something nobody measured.
 *
 * A pass is scoped to the provider it was actually graded against — the id the route echoes back, not
 * the one we asked for — so switching providers with the same key still held drops honestly back to
 * `held`. A key that OpenAI accepted is not evidence about Anthropic.
 */
export function credentialState(
  check: CheckPhase,
  provider: ProviderOption | null,
  keyHeld: boolean,
  baseUrl: string | null,
): CredentialState {
  const present = provider?.auth.kind === "baseUrl" ? baseUrl !== null : keyHeld;
  if (check.kind === "checking") return { status: "checking" };
  if (check.kind === "failed") return { status: "invalid", message: FAILURE_LINE[check.failure] };
  if (!present) return { status: "absent" };
  if (check.kind === "working" && provider !== null && check.provider === provider.id) {
    return { status: "valid", fingerprint: check.fingerprint };
  }
  return { status: "held", fingerprint: null };
}

/** The provider to open on: the remembered one when this deployment still offers it and has not
 *  switched it off, else the first one it will actually serve. */
function openingProvider(options: readonly ProviderOption[], rememberedId: string | null): ProviderOption {
  const remembered = options.find((p) => p.id === rememberedId && p.available);
  return remembered ?? options.find((p) => p.available) ?? options[0];
}

export function ProviderPickerPanel({ className }: { className?: string }) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [selection, setSelection] = useState<ProviderSelection | null>(null);
  const [check, setCheck] = useState<CheckPhase>({ kind: "resting" });
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);

  // One source of truth for "is a key held in this tab", shared with every other mounted control.
  const keyHeld = useSyncExternalStore(subscribeProviderKey, hasProviderKey, getServerProviderKeySnapshot);

  const options = useMemo(
    () => (load.phase === "ready" ? providerOptions(load.policy) : []),
    [load],
  );

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      let body: unknown;
      try {
        const res = await fetch("/api/settings", {
          headers: providerKeyHeaders(),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          setLoad({ phase: "unreachable", status: res.status });
          return;
        }
        body = await res.json();
      } catch {
        if (controller.signal.aborted) return;
        // No thrown value in the state: a fetch error can quote the request we just made.
        setLoad({ phase: "unreachable", status: null });
        return;
      }
      if (controller.signal.aborted) return;

      const policy = readDeploymentPolicy(body);
      if (!policy) {
        setLoad({ phase: "unpublished" });
        return;
      }

      const all = providerOptions(policy);
      const remembered = readProviderPreference();
      const provider = openingProvider(all, remembered?.providerId ?? null);
      const sameProvider = remembered?.providerId === provider.id;
      const listed = sameProvider ? provider.models.find((m) => m.id === remembered.modelId) : undefined;
      const fallback = provider.models.find((m) => isSelectableModel(m.verification));

      setBaseUrl(sameProvider ? remembered.baseUrl : null);
      setSelection({
        providerId: provider.id,
        // A model id belongs to one provider, so it is only restored alongside its own.
        modelId: sameProvider && remembered.modelId !== "" ? remembered.modelId : (fallback?.id ?? ""),
        surface: listed?.surface ?? (sameProvider ? null : (fallback?.surface ?? null)),
        effort: clampEffort(
          rememberedEffort(readEffortPreference()),
          reachableCeiling(listed?.rungCeiling ?? provider.rungCeiling, policy.deployerCeiling),
        ),
      });
      setLoad({ phase: "ready", policy });
    })();

    return () => controller.abort();
  }, []);

  const onSelectionChange = useCallback(
    (next: ProviderSelection) => {
      const providerChanged = selection !== null && selection.providerId !== next.providerId;
      if (providerChanged) {
        // A credential belongs to ONE provider. Carrying a Gemini key to Anthropic would come back as
        // "your key is invalid", which is a lie about the key.
        clearProviderKey();
        setBaseUrl(null);
        setCheck({ kind: "resting" });
      }
      setSelection(next);
      storeProviderPreference({
        providerId: next.providerId,
        modelId: next.modelId,
        baseUrl: providerChanged ? null : baseUrl,
      });
      storeEffortPreference(next.effort);
    },
    [baseUrl, selection],
  );

  const onClearCredential = useCallback(() => {
    clearProviderKey();
    setBaseUrl(null);
    setCheck({ kind: "resting" });
    setStorageBlocked(false);
    if (selection) {
      storeProviderPreference({ providerId: selection.providerId, modelId: selection.modelId, baseUrl: null });
    }
  }, [selection]);

  const onSubmitCredential = useCallback(
    (value: string) => {
      if (!selection) return;
      const provider = options.find((p) => p.id === selection.providerId);
      if (!provider) return;
      const isKey = provider.auth.kind === "apiKey";

      // One channel each (U8 §7.6): a key goes in the header and nowhere else; a base URL is not a
      // secret and must never enter the key header, where every planner request would then send it.
      if (isKey) {
        const stored = storeProviderKey(value, provider.id);
        if (!stored.ok) {
          setStorageBlocked(true);
          return;
        }
        setStorageBlocked(false);
      } else {
        setBaseUrl(value);
        storeProviderPreference({ providerId: provider.id, modelId: selection.modelId, baseUrl: value });
      }

      setCheck({ kind: "checking" });
      void (async () => {
        let res: Response;
        try {
          // HEADERS, not a body. `POST /api/settings/provider-key/check` reads the provider and the
          // base URL off the request headers; a selection sent in the body is silently ignored, which
          // does not fail — it grades an OpenAI key against Google and reports "invalid".
          res = await fetch(CHECK_URL, {
            method: "POST",
            cache: "no-store",
            headers: {
              ...providerSelectionHeaders({
                providerId: provider.id,
                modelId: selection.modelId,
                surface: selection.surface,
                baseUrl: isKey ? null : value,
              }),
              ...(isKey ? providerKeyHeaders() : {}),
            },
          });
        } catch {
          setCheck({ kind: "failed", failure: "network" });
          return;
        }

        if (!res.ok) {
          setCheck({ kind: "failed", failure: CHECK_STATUS_FAILURE[res.status] ?? "server" });
          return;
        }

        const parsed: unknown = await res.json().catch(() => null);
        const body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
        if (body?.ok === true && typeof body.fingerprint === "string") {
          // The route echoes the provider it actually asked. Scoping the pass to THAT rather than to
          // what we requested means a header the server ignored can never widen the claim.
          const graded = body.provider;
          setCheck({
            kind: "working",
            fingerprint: body.fingerprint,
            provider: isProviderId(graded) ? graded : provider.id,
          });
          return;
        }
        const reason = body?.reason;
        setCheck({
          kind: "failed",
          failure: reason === "invalid" || reason === "quota" || reason === "network" ? reason : "server",
        });
        // ONLY WHEN THE PROVIDER ACTUALLY REFUSED IT. This cleared the key on every failure, and
        // `quota` and `network` are not refusals of the credential — they are the provider being
        // rate-limited or the request never arriving. A perfectly good key was deleted by a blip,
        // silently, and the user was left with nothing and no reason. A refused key is still not
        // kept: leaving that one costs a round trip per request to be told the same thing.
        if (isKey && reason === "invalid") clearProviderKey();
      })();
    },
    [options, selection],
  );

  const provider = selection ? (options.find((p) => p.id === selection.providerId) ?? null) : null;

  return (
    <div
      className={cn(
        "w-full max-w-[520px] rounded-[var(--radius-lg)] border border-[var(--color-line-2)] bg-[var(--s-panel)]",
        "p-[var(--space-5)] shadow-[inset_0_1px_0_var(--color-warm-faint)]",
        className,
      )}
    >
      <h3 className="t-label mb-[var(--space-4)] text-[var(--t-1)]">Which AI runs your edits</h3>

      {load.phase === "loading" && (
        <p className="label-mono-sm flex items-center gap-2 text-[var(--color-muted)]">
          <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--color-warm)]" aria-hidden="true" />
          READING THIS DEPLOYMENT&rsquo;S SETTINGS
        </p>
      )}

      {load.phase === "unreachable" && (
        <Notice tone="hit" heading="The settings service did not answer">
          {load.status === null ? "The request did not complete." : `The settings service answered ${load.status}.`}{" "}
          Nothing changed, and no key was sent anywhere. Reload to try again.
        </Notice>
      )}

      {/* Not an error and not an empty list — a specific, nameable state. Without the key layer's own
          words about where a key goes, this surface has no honest way to ask for one. */}
      {load.phase === "unpublished" && (
        <Notice tone="muted" heading="This deployment has not published its key policy">
          The AI runs on your own API key, and what happens to that key is this server&rsquo;s statement
          to make, not ours. Until it publishes one there is nothing here to agree to.
        </Notice>
      )}

      {load.phase === "ready" && selection && (
        <div className="flex flex-col gap-[var(--space-4)]">
          {storageBlocked && (
            <Notice tone="muted" heading="This browser is blocking storage">
              The key could not be kept for this tab, so it was not saved and no check was run.
            </Notice>
          )}
          <ProviderPicker
            providers={options}
            disclosure={load.policy.disclosure}
            deployerCeiling={load.policy.deployerCeiling}
            selection={selection}
            onSelectionChange={onSelectionChange}
            credential={credentialState(check, provider, keyHeld, baseUrl)}
            onSubmitCredential={onSubmitCredential}
            onClearCredential={onClearCredential}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A remembered rung is honoured only when it is still a rung this build names. A level left over from
 * an older build is not a level, and inventing one would put the picker and the planner into
 * disagreement about what is going to run.
 */
function rememberedEffort(stored: string | null): Effort {
  return isEffort(stored) ? stored : DEFAULT_EFFORT;
}

function Notice({ tone, heading, children }: { tone: "hit" | "muted"; heading: string; children: ReactNode }) {
  return (
    <div
      role={tone === "hit" ? "alert" : undefined}
      className={cn(
        "flex flex-col gap-1.5 rounded-[var(--radius-sm)] border bg-[var(--s-1)] p-[var(--space-4)]",
        tone === "hit" ? "border-[var(--color-hit)]" : "border-[var(--color-line-2)]",
      )}
    >
      <span className={cn("t-label", tone === "hit" ? "text-[var(--color-hit)]" : "text-[var(--t-2)]")}>{heading}</span>
      <p className="text-[var(--fs-label)] leading-[1.55] text-[var(--t-3)]">{children}</p>
    </div>
  );
}
