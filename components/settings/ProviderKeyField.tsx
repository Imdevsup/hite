"use client";

import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { KiteMark } from "@/components/editor/KiteMark";
import styles from "./settings.module.css";
import { checkProviderKey, clearProviderKey, storeProviderKey } from "./providerKey";
import { readProviderPreference } from "./providerPreference";
import type { KeyCheckFailure, SettingsSnapshot, SnapshotProvider } from "./types";

/**
 * THE KEY — §14.1.
 *
 * "There is no reveal affordance. The input is `type="password"` until submit; on submit it is
 * replaced by a non-input element holding the fingerprint, so there is no field to inspect, no
 * autofill to trigger, no value in the DOM."
 *
 * That is enforced structurally, not by discipline. The input is UNCONTROLLED: its value is read
 * once, from the ref, at submit, handed to `storeProviderKey`, and the field is blanked in the same
 * tick. The secret is never assigned to React state, so it cannot reach a re-render, a component
 * snapshot, a devtools tree or an error boundary's props dump. The only thing this component ever
 * displays about a key is the server's `fingerprintKey` — eight hex, non-reversible — which
 * `lib/ai/keys.ts` provides precisely so a UI can show key state "WITHOUT the server ever echoing
 * key material — which is exactly what a 'last 4 characters' chip would do".
 *
 * Exported on its own as well as through the sheet, because §14.3 puts the same field inline in the
 * editor's prompt input for the 402 flow. One field, one contract, one place to review it.
 */

/**
 * Every failure the check route can produce, in the visitor's terms.
 *
 * §14.1's table asks for "the provider's real error text, verbatim". The route does not have it and
 * will not get it: `app/api/settings/provider-key/check/route.ts` never reads the upstream response
 * body — "Google's 4xx bodies can quote request metadata, and text that is never parsed cannot be
 * forwarded" — and returns a coarse reason instead. Writing a plausible provider sentence here would
 * be a fabricated measurement, so each real outcome gets its own honest line and none of them
 * pretends to quote Google.
 */
const FAILURE_LINE: Readonly<Record<KeyCheckFailure, string>> = {
  invalid: "The provider would not accept this key.",
  quota: "The provider is rate-limiting this key right now.",
  network: "Could not reach the provider, so the key was not graded.",
  // The route refuses to grade a key for a provider this deployment will not run, "or the endpoint
  // becomes a validity oracle for a path the product will not take anyway".
  unsupported: "This deployment does not run that provider, so it will not grade a key for it.",
  missing: "The key is no longer held in this tab.",
  unauthorized: "This session cannot check a key. Reload the editor and try again.",
  "rate-limited": "Too many checks from this network. Wait a minute.",
  server: "The check failed on this server.",
};

type Phase =
  | { readonly kind: "resting" }
  | { readonly kind: "checking" }
  | { readonly kind: "working" }
  | { readonly kind: "failed"; readonly failure: KeyCheckFailure };

export interface ProviderKeyFieldProps {
  readonly snapshot: SettingsSnapshot;
  /** The parent re-reads `GET /api/settings`, which is the only source of `present` / `usable` /
   *  `fingerprint`. Nothing about key state is computed on the client. */
  readonly onKeyChanged: () => void;
  /** Renders the section heading. The 402 flow (§14.3) mounts the field without one. */
  readonly showHeading?: boolean;
}

/**
 * WHICH provider this field is asking for a key to.
 *
 * The remembered choice when this deployment still publishes it, else the deployment's own default.
 * It is resolved here rather than hardcoded because the label, the placeholder and the "get a key"
 * link are all claims about a specific vendor: a field that says "Gemini API key" while the planner
 * resolves the request to Anthropic asks for the wrong secret and then reports a real key as
 * invalid. Nothing is invented — every string comes from the route's own provider list.
 */
function askingFor(snapshot: SettingsSnapshot): SnapshotProvider {
  const remembered = readProviderPreference()?.providerId ?? null;
  return (
    snapshot.providers.find((p) => p.id === remembered) ??
    snapshot.providers.find((p) => p.id === snapshot.byok.defaultProviderId) ??
    snapshot.providers[0]
  );
}

export function ProviderKeyField({ snapshot, onKeyChanged, showHeading = true }: ProviderKeyFieldProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "resting" });
  const [storageBlocked, setStorageBlocked] = useState(false);

  const { key } = snapshot;
  const { disclosure } = snapshot.byok;
  const provider = askingFor(snapshot);

  /** Held, and the server could read it. `present && !usable` is a key with a stray character in
   *  it — `readProviderKey` reports that as `malformed` rather than failing the request. */
  const usable = key.present && key.usable;
  const malformed = key.present && !key.usable;

  const runCheck = useCallback(async () => {
    setPhase({ kind: "checking" });
    try {
      // The provider travels with the key: the check route is registry-driven and would otherwise
      // grade this key against its default rather than against the one that issued it.
      const outcome = await checkProviderKey(provider.id);
      setPhase(outcome.ok ? { kind: "working" } : { kind: "failed", failure: outcome.failure });
    } catch {
      // The only throw `checkProviderKey` re-raises is an abort, which cannot happen here (no
      // signal is passed). Anything else reaching this point is still a failed check, not a pass.
      setPhase({ kind: "failed", failure: "server" });
    }
  }, [provider.id]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const field = inputRef.current;
      if (field === null) return;
      const value = field.value;
      // Blank the field in the same tick the value leaves it. Nothing re-reads it after this.
      field.value = "";
      if (value.trim().length === 0) return;

      // Bound to the provider selected right now, read at save time rather than at render: this
      // field can outlive a provider switch made in another tab.
      const stored = storeProviderKey(value, readProviderPreference()?.providerId);
      if (!stored.ok) {
        setStorageBlocked(true);
        return;
      }
      setStorageBlocked(false);
      onKeyChanged();
      void runCheck();
    },
    [onKeyChanged, runCheck],
  );

  const onReplace = useCallback(() => {
    clearProviderKey();
    setPhase({ kind: "resting" });
    onKeyChanged();
  }, [onKeyChanged]);

  const ring = malformed || phase.kind === "failed" ? "hit" : usable ? "live" : "rest";

  return (
    <section className={styles.section} aria-labelledby={showHeading ? `${inputId}-heading` : undefined}>
      {showHeading ? (
        <h3 className={styles.sectionTitle} id={`${inputId}-heading`}>
          Provider key
        </h3>
      ) : null}

      {/* §14.1 correction 2: BYOK_DISCLOSURE, verbatim, unsoftened, ABOVE the field — rendered from
          the export so it cannot drift. Never retyped in this repository outside lib/ai/keys.ts. */}
      <p className={styles.prose}>{disclosure}</p>

      {usable ? (
        <>
          <div className={styles.fieldRow}>
            <div className={styles.field} data-ring={ring}>
              <span className={styles.fingerprint}>key {key.fingerprint}</span>
              <Verdict phase={phase} />
            </div>
          </div>
          {/* §14.1: "You can replace it. You can't read it back." */}
          <p className={styles.note}>You can replace it. You can&rsquo;t read it back.</p>
          <div className={styles.actions}>
            {phase.kind === "resting" ? (
              <button type="button" className={styles.ghost} onClick={() => void runCheck()}>
                Check it
              </button>
            ) : null}
            {phase.kind === "failed" ? (
              <button type="button" className={styles.ghost} onClick={() => void runCheck()}>
                Try again
              </button>
            ) : null}
            <button type="button" className={styles.ghost} onClick={onReplace}>
              Replace key
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <label className={styles.fieldLabel} htmlFor={inputId}>
            {provider.label} API key
          </label>
          <div className={styles.fieldRow}>
            <div className={styles.field} data-ring={ring}>
              <input
                id={inputId}
                ref={inputRef}
                className={styles.input}
                type="password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                placeholder={`Paste a ${provider.label} API key`}
                aria-describedby={malformed ? `${inputId}-verdict` : undefined}
              />
            </div>
            <button type="submit" className={styles.ghost}>
              Add key
            </button>
          </div>
          {malformed ? (
            <p className={styles.note} id={`${inputId}-verdict`} role="status">
              This tab is sending something the server cannot read as a key — check for a stray space
              or quote, and paste it again.
            </p>
          ) : null}
        </form>
      )}

      {storageBlocked ? (
        <p className={styles.note} role="status">
          This browser is blocking storage, so the key cannot be kept for this tab.
        </p>
      ) : null}

      {phase.kind === "failed" ? (
        <p className={styles.note} role="status">
          {FAILURE_LINE[phase.failure]}
        </p>
      ) : null}

      {/* Only links the SERVER published, and only the chosen provider's. A settings surface may not
          invent a URL, so an absent link is simply absent rather than guessed. */}
      {provider.getKey === null ? null : (
        <div className={styles.links}>
          <a className={styles.link} href={provider.getKey} target="_blank" rel="noreferrer noopener">
            Get a {provider.label} key ↗
          </a>
        </div>
      )}
    </section>
  );
}

/** The status inside the ring. §14.1: "the ring colour is the status". */
function Verdict({ phase }: { readonly phase: Phase }) {
  if (phase.kind === "checking") {
    return (
      <span className={styles.verdict}>
        {/* §10: any pending state on the property is the kite, and it sways — never a spinner. */}
        <KiteMark size={16} spin muted />
        Checking
      </span>
    );
  }
  if (phase.kind === "working") {
    return (
      <span className={styles.verdict}>
        <svg
          className={styles.tick}
          viewBox="0 0 16 16"
          width={16}
          height={16}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.6}
          strokeLinecap="square"
          strokeLinejoin="miter"
          aria-hidden="true"
        >
          <path d="M2 8 L6 12 L14 4" />
        </svg>
        Working
      </span>
    );
  }
  if (phase.kind === "failed") {
    return (
      <span className={styles.verdict} data-tone="hit">
        Not working
      </span>
    );
  }
  return null;
}
