"use client";
import { useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFORT, EFFORT_LEVELS, type Effort } from "@/lib/ai/effort";
import type { ModelSurface, ProviderId } from "@/lib/ai/providers/types";
import type { Verification, VerificationState } from "@/lib/ai/providers/verification";
import {
  BASE_URL_MESSAGE,
  KEY_SHAPE_MESSAGE,
  checkKeyShape,
  checkLocalBaseUrl,
  describeVerification,
  isSelectableModel,
  rungState,
  sortModels,
  typedModelOption,
  type BaseUrlProblem,
  type KeyShapeProblem,
  type ModelOption,
  type ProviderOption,
} from "./providerOptions";

/**
 * THE PROVIDER PICKER — pick a provider, hand over a credential, pick a model, pick a rung.
 *
 * Four steps in one column, in that order, all four always on screen. There is no wizard and no
 * hidden step: this surface was rejected twice for complexity, and a state machine over four fields
 * is exactly the complexity that gets rejected a third time.
 *
 * IT CLAIMS NOTHING, AND IT STRUCTURALLY CANNOT. Every word about whether something works comes from
 * `Verification`, which `lib/ai/providers/verification.ts` derives from the harness's committed
 * result file and nothing else. `ProviderModel` has no `verified` field, so there is no lever here
 * to pull. Untested providers and untested models are OFFERED and labelled AT THE POINT OF SELECTION
 * rather than in a tooltip; known-broken ones are greyed with the measured reason and reachable only
 * through an override that repeats it. That is how "tons of providers … that work" is satisfied —
 * breadth plus an honest badge, never breadth plus silence.
 *
 * PRESENTATIONAL ON PURPOSE. It fetches nothing and holds no credential; `ProviderPickerPanel` does
 * both. The one thing it keeps is the draft in the credential field, and it keeps that in an
 * UNCONTROLLED input read through a ref — see `CredentialStep`.
 */

export interface ProviderSelection {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly surface: ModelSurface | null;
  readonly effort: Effort;
}

/** The four states of ART-DIRECTION §14.1, plus the in-flight one. `held` is a credential we have but
 *  have not checked this session — it is not "working", and must not be drawn as if it were. */
export type CredentialState =
  | { readonly status: "absent" }
  | { readonly status: "held"; readonly fingerprint: string | null }
  | { readonly status: "checking" }
  | { readonly status: "valid"; readonly fingerprint: string }
  | { readonly status: "invalid"; readonly message: string };

export interface ProviderPickerProps {
  readonly providers: readonly ProviderOption[];
  /** `BYOK_DISCLOSURE`, from the server. This component never authors its own claim about keys. */
  readonly disclosure: string;
  readonly deployerCeiling: Effort | null;
  readonly selection: ProviderSelection;
  readonly onSelectionChange: (next: ProviderSelection) => void;
  readonly credential: CredentialState;
  /** The pasted key, or the base URL for a self-hosted provider. Handed off, never stored here. */
  readonly onSubmitCredential: (secret: string) => void;
  readonly onClearCredential: () => void;
}

const DOT: Record<VerificationState, string> = {
  verified: "bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent-glow)]",
  untested: "bg-[var(--color-line-4)]",
  broken: "bg-[var(--color-hit)]",
};

const BADGE_TEXT: Record<VerificationState, string> = {
  verified: "text-[var(--color-accent)]",
  untested: "text-[var(--color-muted)]",
  broken: "text-[var(--color-hit)]",
};

const BADGE_WORD: Record<VerificationState, string> = {
  verified: "VERIFIED",
  untested: "UNTESTED",
  broken: "KNOWN ISSUE",
};

const ROW_BASE = "block rounded-[var(--radius-sm)] border p-[var(--space-3)] motion-base";
const ROW_ON = "border-[var(--color-accent-dim)] bg-[var(--color-accent-faint)]";
const ROW_OFF = "border-[var(--color-line-2)] bg-[var(--s-1)] hover:border-[var(--color-line-3)]";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--line-1)] pt-[var(--space-4)] first:border-t-0 first:pt-0">
      {/* The separator is load-bearing. `t-label` is uppercase mono, so the number ran straight into
          the noun and step one read as the COUNT "1 PROVIDER" over a list of eight of them. */}
      <h4 className="t-label mb-[var(--space-3)] flex items-baseline gap-2">
        <span className="tnum text-[var(--color-accent)]">{n}</span>
        <span aria-hidden="true" className="text-[var(--t-4)]">
          ·
        </span>
        {title}
      </h4>
      {children}
    </section>
  );
}

/** The badge and its sentence together, in the row being chosen from. Never a tooltip. */
function VerificationLine({ verification }: { verification: Verification }) {
  const { badge, detail } = describeVerification(verification);
  return (
    <span className="flex flex-col gap-1">
      <span className={cn("label-mono-sm flex items-center gap-1.5", BADGE_TEXT[verification.state])}>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[verification.state])} />
        {badge}
      </span>
      <span className="text-[var(--fs-label)] leading-[1.45] normal-case tracking-normal text-[var(--t-3)]">
        {detail}
      </span>
    </span>
  );
}

function Outbound({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="focus-inset inline-flex items-center gap-1 text-[var(--fs-label)] text-[var(--color-accent)] underline decoration-[var(--color-accent-dim)] underline-offset-2"
    >
      {children}
      <ArrowUpRight size={11} strokeWidth={2.2} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/* ── Step 1 · provider ─────────────────────────────────────────────────────── */

function ProviderStep({
  providers,
  selectedId,
  onSelect,
  name,
}: {
  providers: readonly ProviderOption[];
  selectedId: ProviderId;
  onSelect: (id: ProviderId) => void;
  name: string;
}) {
  return (
    /**
     * BOUNDED, AND STILL COMPLETE. Eight providers is eight rows, and the one under the last of them
     * is the credential field — the single control that unblocks the product. Unbounded, opening
     * Settings on an 860px editor showed step 1 and nothing else, so the thing the sheet exists for
     * was below the fold behind seven rows the visitor did not come for. The list keeps every row
     * ("an option that vanishes teaches nothing") and gives them their own scroller instead, so all
     * four steps are on one screen. `overscroll-contain` stops a flick here from scrolling the sheet.
     */
    <div
      role="radiogroup"
      aria-label="AI provider"
      className="flex max-h-[34vh] flex-col gap-1.5 overflow-y-auto overscroll-contain pr-1"
    >
      {providers.map((provider) => {
        const selected = provider.id === selectedId;
        return (
          <label
            key={provider.id}
            className={cn(
              ROW_BASE,
              provider.available ? "cursor-pointer" : "cursor-not-allowed opacity-55",
              selected ? ROW_ON : ROW_OFF,
            )}
          >
            <input
              type="radio"
              name={name}
              value={provider.id}
              className="peer sr-only"
              checked={selected}
              disabled={!provider.available}
              onChange={() => onSelect(provider.id)}
            />
            <span className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[13px] font-medium text-[var(--t-1)]">{provider.label}</span>
                {/* A greyed row with its reason teaches something. A missing row teaches nothing. */}
                {provider.available ? (
                  <span className="label-mono-sm text-[var(--color-muted)]">
                    {provider.models.length === 0
                      ? "MODEL ID TYPED BY HAND"
                      : `${provider.models.length} ${provider.models.length === 1 ? "MODEL" : "MODELS"} LISTED`}
                  </span>
                ) : (
                  <span className="text-[var(--fs-label)] leading-[1.45] text-[var(--t-3)]">
                    {provider.unavailableReason}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "label-mono-sm flex shrink-0 items-center gap-1.5 pt-0.5",
                  BADGE_TEXT[provider.verification],
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", DOT[provider.verification])} />
                {BADGE_WORD[provider.verification]}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* ── Step 2 · credential ───────────────────────────────────────────────────── */

/**
 * THE SECRET NEVER ENTERS REACT STATE.
 *
 * The input is uncontrolled and read once, through a ref, at submit; what `useState` holds is a
 * verdict and an emptiness flag, never the value. So no rendered `value` attribute exists, there is
 * nothing for a devtools tree or an error boundary's props dump to pick up, and no re-render can put
 * key material back into the DOM. After submit the field is UNMOUNTED and replaced by the fingerprint
 * chip (§14.1: "no field to inspect, no autofill to trigger, no value in the DOM"), which is also why
 * there is no reveal affordance anywhere on this surface.
 *
 * The server's `fingerprintKey` — a truncated SHA-256 — is the only representation of a key that is
 * ever displayed. A "last 4 characters" chip is the one display `lib/ai/keys.ts` rules out by name.
 */
function CredentialStep({
  provider,
  disclosure,
  credential,
  onSubmit,
  onClear,
}: {
  provider: ProviderOption;
  disclosure: string;
  credential: CredentialState;
  onSubmit: (secret: string) => void;
  onClear: () => void;
}) {
  const isKey = provider.auth.kind === "apiKey";
  const field = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<KeyShapeProblem | BaseUrlProblem | null>(null);
  // A base-URL field is pre-filled with the provider's own default, so it does not start empty.
  const [empty, setEmpty] = useState(isKey);
  // A credential the provider REFUSED is not held: the field comes back, because replacing it is the
  // only action that state has. `checking` keeps the chip so the check cannot be raced.
  const held = credential.status === "held" || credential.status === "checking" || credential.status === "valid";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const raw = field.current?.value ?? "";
    // Branched on the provider's auth kind rather than on the verdict's shape, so each side keeps its
    // own type: an address is handed on NORMALISED (the server compares a parsed URL), while a key is
    // handed on verbatim apart from the trim the server also applies — we do not touch a secret.
    if (provider.auth.kind === "baseUrl") {
      const verdict = checkLocalBaseUrl(raw);
      if (!verdict.ok) {
        setProblem(verdict.reason);
        return;
      }
      setProblem(null);
      onSubmit(verdict.url);
    } else {
      const verdict = checkKeyShape(raw, provider.auth.maxLength);
      if (!verdict.ok) {
        setProblem(verdict.reason);
        return;
      }
      setProblem(null);
      onSubmit(raw.trim());
    }
    // Hand-off done: drop our copy in the same tick rather than waiting for the unmount.
    if (field.current) field.current.value = "";
    setEmpty(true);
  };

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {/* The key layer's own words, rendered from the server's export and never retyped, so what is
          on screen cannot drift from what the code does. */}
      {isKey ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--color-line-2)] bg-[var(--s-1)] p-[var(--space-3)] text-[var(--fs-label)] leading-[1.55] text-[var(--t-2)]">
          {disclosure}
        </p>
      ) : (
        <p className="rounded-[var(--radius-sm)] border border-[var(--color-line-2)] bg-[var(--s-1)] p-[var(--space-3)] text-[var(--fs-label)] leading-[1.55] text-[var(--t-2)]">
          This server, not your browser, is what connects to that address, and nothing about it is a
          secret. Only an address on this machine is allowed.
        </p>
      )}

      {held ? (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "chip chip-sm",
              credential.status === "valid" && "chip-accent",
              credential.status === "checking" && "text-[var(--color-warm)]",
            )}
          >
            {credential.status === "valid" && <Check size={10} strokeWidth={3} aria-hidden="true" />}
            {credential.status === "checking" && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-warm)]" aria-hidden="true" />
            )}
            {isKey ? "KEY" : "ADDRESS"}
            {"fingerprint" in credential && credential.fingerprint ? ` ${credential.fingerprint}` : ""}
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={credential.status === "checking"}
            className="chip chip-sm focus-inset cursor-pointer"
          >
            {isKey ? "REPLACE KEY" : "CHANGE ADDRESS"}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2">
          <label htmlFor={`${provider.id}-credential`} className="t-label">
            {isKey ? `${provider.label} API key` : "Server address"}
          </label>
          <div className="flex gap-2">
            <input
              id={`${provider.id}-credential`}
              ref={field}
              type={isKey ? "password" : "url"}
              // `undefined`, not `""`, for a key field: React renders `defaultValue` as a `value`
              // attribute, and the field must carry no value attribute at all.
              defaultValue={provider.auth.kind === "baseUrl" ? provider.auth.defaultBaseUrl : undefined}
              placeholder={
                provider.auth.kind === "baseUrl" ? provider.auth.defaultBaseUrl : `Paste your ${provider.label} key`
              }
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              aria-describedby={problem ? `${provider.id}-credential-problem` : undefined}
              aria-invalid={problem !== null}
              className={cn("input flex-1", problem && "border-[var(--color-hit)]")}
              onChange={(event) => {
                // Only the emptiness is lifted out of the field. The value stays in the DOM node.
                setEmpty(event.currentTarget.value.trim() === "");
                if (problem) setProblem(null);
              }}
            />
            <button type="submit" disabled={empty} className="cta focus-inset shrink-0 px-4 text-[13px]">
              {isKey ? "Check key" : "Connect"}
            </button>
          </div>

          {problem && (
            <p
              id={`${provider.id}-credential-problem`}
              role="alert"
              className="text-[var(--fs-label)] leading-[1.45] text-[var(--color-hit)]"
            >
              {/* Keyed off the FIELD's kind, not the problem's name — "empty" exists in both tables
                  and would otherwise tell someone entering an address to paste a key. */}
              {isKey ? KEY_SHAPE_MESSAGE[problem as KeyShapeProblem] : BASE_URL_MESSAGE[problem as BaseUrlProblem]}
            </p>
          )}

          {/* Advisory only, and only where a primary source documented the prefix. A shape regex that
              encodes a remembered format rejects a real key the day a vendor changes it. */}
          {provider.auth.kind === "apiKey" && provider.auth.keyHint && (
            <p className="text-[var(--fs-label)] text-[var(--t-3)]">
              {provider.label} keys usually start with <code className="t-code">{provider.auth.keyHint}</code>. We do
              not check that — the provider does.
            </p>
          )}

          {isKey && (
            <p className="text-[var(--fs-label)] text-[var(--t-3)]">You can replace it. You can&rsquo;t read it back.</p>
          )}
        </form>
      )}

      {credential.status === "invalid" && (
        <p role="alert" className="text-[var(--fs-label)] leading-[1.45] text-[var(--color-hit)]">
          {credential.message}
        </p>
      )}
      {credential.status === "held" && (
        <p className="text-[var(--fs-label)] leading-[1.45] text-[var(--t-3)]">
          Held in this browser, not checked yet.
        </p>
      )}

      {provider.help.getKey && (
        <p className="text-[var(--fs-label)] text-[var(--t-3)]">
          <Outbound href={provider.help.getKey}>Get a {provider.label} key</Outbound>
        </p>
      )}
    </div>
  );
}

/* ── Step 3 · model ────────────────────────────────────────────────────────── */

function ModelRow({
  model,
  selected,
  onSelect,
  name,
}: {
  model: ModelOption;
  selected: boolean;
  onSelect: () => void;
  name: string;
}) {
  return (
    <label className={cn(ROW_BASE, "cursor-pointer", selected ? ROW_ON : ROW_OFF)}>
      <input
        type="radio"
        name={name}
        value={model.id}
        className="peer sr-only"
        checked={selected}
        onChange={onSelect}
      />
      <span className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3">
          <code className="t-code break-all text-[var(--t-1)]">{model.id}</code>
          {model.surface && <span className="label-mono-sm shrink-0">{model.surface}</span>}
        </span>
        {model.note && <span className="text-[var(--fs-label)] text-[var(--t-3)]">{model.note}</span>}
        <VerificationLine verification={model.verification} />
        <span className="label-mono-sm text-[var(--color-muted)]">TOP RUNG {model.rungCeiling}</span>
      </span>
    </label>
  );
}

function ModelStep({
  provider,
  selectedId,
  onSelect,
  name,
}: {
  provider: ProviderOption;
  selectedId: string;
  onSelect: (model: ModelOption) => void;
  name: string;
}) {
  const sorted = sortModels(provider.models);
  const offered = sorted.filter((m) => isSelectableModel(m.verification));
  const broken = sorted.filter((m) => !isSelectableModel(m.verification));
  const listed = new Set(provider.models.map((m) => m.id));
  const [typed, setTyped] = useState(selectedId !== "" && !listed.has(selectedId) ? selectedId : "");
  const typedOption = typed.trim() === "" ? null : typedModelOption(provider, typed.trim());

  const pick = (model: ModelOption) => {
    setTyped("");
    onSelect(model);
  };

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      {offered.length > 0 && (
        <div role="radiogroup" aria-label="Model" className="flex flex-col gap-1.5">
          {offered.map((model) => (
            <ModelRow
              key={`${model.id}:${model.surface ?? "default"}`}
              model={model}
              name={name}
              selected={model.id === selectedId && typed === ""}
              onSelect={() => pick(model)}
            />
          ))}
        </div>
      )}

      {/* Known-broken models stay reachable, but only behind a disclosure that repeats the measured
          reason on every row. Hiding them would be a different kind of dishonesty. */}
      {broken.length > 0 && (
        <details className="disclose rounded-[var(--radius-sm)] border border-[var(--color-line-2)] p-[var(--space-3)]">
          <summary className="t-label focus-inset cursor-pointer text-[var(--color-hit)]">
            {broken.length} {broken.length === 1 ? "model has" : "models have"} a measured failure — show anyway
          </summary>
          <div className="mt-[var(--space-3)] flex flex-col gap-1.5">
            {broken.map((model) => (
              <ModelRow
                key={`${model.id}:${model.surface ?? "default"}`}
                model={model}
                name={name}
                selected={model.id === selectedId && typed === ""}
                onSelect={() => pick(model)}
              />
            ))}
          </div>
        </details>
      )}

      {/* Hardcoded model lists go stale, and this repo has the scar: `gemini-2.5-pro` was pinned as
          the top rung and 404s for new accounts. Any id the provider accepts is typeable, and its
          verification is looked up the same way every other id's is. */}
      <div className="flex flex-col gap-2">
        <label htmlFor={`${provider.id}-typed-model`} className="t-label">
          Or type any model id
        </label>
        <input
          id={`${provider.id}-typed-model`}
          type="text"
          value={typed}
          placeholder="model id, exactly as the provider spells it"
          autoComplete="off"
          spellCheck={false}
          className="input"
          onChange={(event) => {
            const next = event.currentTarget.value;
            setTyped(next);
            if (next.trim() !== "") onSelect(typedModelOption(provider, next.trim()));
          }}
        />
        {typedOption && <VerificationLine verification={typedOption.verification} />}
        {provider.catalogue && (
          <p className="text-[var(--fs-label)] text-[var(--t-3)]">
            <Outbound href={provider.catalogue.url}>Browse {provider.label}&rsquo;s own model list</Outbound>
            {provider.catalogue.requiresKey ? " — needs your key." : ""}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Step 4 · effort ───────────────────────────────────────────────────────── */

/**
 * The rung's real mechanics, read off the frozen `EFFORT` ladder rather than retyped, in the order
 * `lib/ai/effort.ts` says they matter: verification against ground truth first, then forced
 * grounding, then thinking.
 */
export function describeRung(level: Effort): string {
  const rung = EFFORT[level];
  const check = rung.revisions === 0 ? "no self-check" : `${rung.revisions} self-check${rung.revisions === 1 ? "" : "s"}`;
  const ground = rung.groundSteps === 0 ? "may edit immediately" : `must investigate for ${rung.groundSteps} steps`;
  return `${check} · ${ground} · thinking ${rung.thinking}`;
}

function EffortStep({
  provider,
  modelCeiling,
  deployerCeiling,
  selected,
  onSelect,
  name,
}: {
  provider: ProviderOption;
  modelCeiling: Effort;
  deployerCeiling: Effort | null;
  selected: Effort;
  onSelect: (level: Effort) => void;
  name: string;
}) {
  const longest = Math.max(...EFFORT_LEVELS.map((level) => EFFORT[level].wallClockMs));

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <p className="text-[var(--fs-label)] leading-[1.55] text-[var(--t-2)]">
        Higher rungs investigate before they edit, and check their own work against the timeline they
        produced. They take longer, and they spend more of your key.
      </p>

      <div role="radiogroup" aria-label="Effort" className="flex flex-col gap-1.5">
        {EFFORT_LEVELS.map((level) => {
          const state = rungState(level, modelCeiling, deployerCeiling);
          const blocked = state !== "available";
          const seconds = Math.round(EFFORT[level].wallClockMs / 1000);
          // Two different facts, so two different sentences. A provider ceiling is structural: without
          // enforced `toolChoice` a grounded rung can end the turn with no batch at all. A deployer
          // ceiling is a setting somebody chose.
          const reason =
            state === "blocked-by-deployer"
              ? `The operator of this site capped effort at ${deployerCeiling}.`
              : (provider.rungCeilingReason ??
                `${provider.label} cannot run this rung — it tops out at ${modelCeiling}.`);

          return (
            <label
              key={level}
              className={cn(
                ROW_BASE,
                blocked ? "cursor-not-allowed opacity-55" : "cursor-pointer",
                level === selected && !blocked ? ROW_ON : "border-[var(--color-line-2)] bg-[var(--s-1)]",
              )}
            >
              <input
                type="radio"
                name={name}
                value={level}
                className="peer sr-only"
                checked={level === selected}
                disabled={blocked}
                onChange={() => onSelect(level)}
              />
              <span className="flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn("t-label text-[var(--t-1)]", blocked && "line-through")}>{level}</span>
                  <span className="label-mono-sm tnum shrink-0">{seconds}s budget</span>
                </span>

                {/* The only bar on this surface, and it is scaled from a real number the ladder owns
                    (`wallClockMs`). "Spends more of your key" gets words, not a bar, because nothing
                    has measured it. */}
                <span className="h-[3px] overflow-hidden rounded-full bg-[var(--color-line-2)]" aria-hidden="true">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      blocked ? "bg-[var(--color-line-4)]" : "bg-[var(--color-accent)]",
                    )}
                    style={{ width: `${Math.round((EFFORT[level].wallClockMs / longest) * 100)}%` }}
                  />
                </span>

                <span className="text-[var(--fs-label)] leading-[1.45] text-[var(--color-muted)]">
                  {describeRung(level)}
                </span>
                {blocked && <span className="text-[var(--fs-label)] leading-[1.45] text-[var(--t-3)]">{reason}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ── The surface ───────────────────────────────────────────────────────────── */

export function ProviderPicker({
  providers,
  disclosure,
  deployerCeiling,
  selection,
  onSelectionChange,
  credential,
  onSubmitCredential,
  onClearCredential,
}: ProviderPickerProps) {
  const group = useId();
  const provider = providers.find((p) => p.id === selection.providerId) ?? null;
  // The ceiling that binds is the SELECTED model's, which may override the provider's.
  const modelCeiling =
    provider === null
      ? EFFORT_LEVELS[0]
      : (provider.models.find((m) => m.id === selection.modelId)?.rungCeiling ?? provider.rungCeiling);

  return (
    <div className="flex max-w-[520px] flex-col gap-[var(--space-4)]">
      <Step n={1} title="Provider">
        <ProviderStep
          providers={providers}
          selectedId={selection.providerId}
          name={`${group}-provider`}
          onSelect={(providerId) => {
            const next = providers.find((p) => p.id === providerId);
            if (!next) return;
            const model = next.models.find((m) => isSelectableModel(m.verification)) ?? null;
            // A model id belongs to ONE provider. Carrying it across would send an OpenAI id to
            // Anthropic, and the failure would read as "your key is invalid".
            onSelectionChange({
              providerId,
              modelId: model?.id ?? "",
              surface: model?.surface ?? null,
              effort: selection.effort,
            });
          }}
        />
      </Step>

      <Step n={2} title={provider?.auth.kind === "baseUrl" ? "Address" : "Your key"}>
        {provider ? (
          <CredentialStep
            key={provider.id}
            provider={provider}
            disclosure={disclosure}
            credential={credential}
            onSubmit={onSubmitCredential}
            onClear={onClearCredential}
          />
        ) : (
          <PickProviderFirst />
        )}
      </Step>

      <Step n={3} title="Model">
        {provider ? (
          <ModelStep
            key={provider.id}
            provider={provider}
            selectedId={selection.modelId}
            name={`${group}-model`}
            onSelect={(model) =>
              onSelectionChange({ ...selection, modelId: model.id, surface: model.surface })
            }
          />
        ) : (
          <PickProviderFirst />
        )}
      </Step>

      <Step n={4} title="Effort">
        {provider ? (
          <EffortStep
            provider={provider}
            modelCeiling={modelCeiling}
            deployerCeiling={deployerCeiling}
            selected={selection.effort}
            name={`${group}-effort`}
            onSelect={(effort) => onSelectionChange({ ...selection, effort })}
          />
        ) : (
          <PickProviderFirst />
        )}
      </Step>
    </div>
  );
}

function PickProviderFirst() {
  return <p className="empty-state-sm text-left">Pick a provider first.</p>;
}
