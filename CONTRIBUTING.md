# Contributing to HITE

Thanks for looking. This file covers the four things that are specific to this codebase and easy to get wrong: **adding an effect**, **adding an AI tool**, **the determinism rule**, and **the no-fabricated-data rule**. Everything else is ordinary TypeScript work.

Start with [README.md](README.md) for setup and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the layers fit together.

## Before you open a PR

```bash
pnpm typecheck          # tsc --noEmit — must be clean
pnpm exec vitest run    # must be green
pnpm lint               # eslint . — includes the determinism guard
```

If your change touches the database, storage, the job queue or the worker, also run the integration suites against a local Supabase stack (see [Running the tests](README.md#running-the-tests)). A change to any of those is not verified by unit tests, because unit tests mock exactly the thing that breaks.

Two house rules that show up in review:

- **A bug fix ships with the regression test that catches it,** in the same commit.
- **Don't claim it works because it compiles.** Run it. If you could not run something, say so in the PR and list what is unverified — that is always a better outcome than confident silence.

---

## Adding an effect, look, transition or overlay

An effect exists in two places, and it only *works* when both agree: the **catalog entry** (what the AI and the UI are allowed to ask for) and the **renderer** (what actually paints pixels). The gate between them is enforced, so you cannot ship half of it.

### 1. Author the catalog entry

Add one JSON file under `entries/<category>/<key>.json`. The shape is `RegistryEntry` in `lib/registry/types.ts`; categories are `color`, `luts`, `glitch`, `transitions`, `overlays`, `text`, `looks`, `audio`, `procedural`.

```json
{
  "key": "vignette-soft",
  "label": "Vignette · Soft",
  "category": "color",
  "tags": ["color", "vignette", "cinema"],
  "engine": "ffmpeg",
  "ffmpegFilter": "vignette",
  "params": [
    { "key": "angle", "label": "Falloff", "kind": "range", "default": 4, "min": 2, "max": 8 }
  ],
  "stability": "stable",
  "description": "Subtle corner darkening — the grading-suite default."
}
```

`key` is globally unique and is the string the model emits, so treat it as API surface. `description` is what the advisor tools rank on, so write it for a model reading it cold.

`scripts/build-registry.ts` expands `entries/**/*.json` into `public/registry/manifest.json`. It runs automatically in `predev`/`prebuild`, is fully offline, and is deterministic — if re-running it produces a diff, that is a bug in your entry, not noise to commit.

### 2. Register the renderer

For a **clip effect** (`color`, `luts`, `glitch`), write a component in `lib/remotion/fx/` implementing `EffectRendererProps` and register it in `lib/remotion/registry.tsx`:

```tsx
registerEffectRenderer("vignette-soft", Vignette);
```

`frame`, `startFrame` and `endFrame` arrive **clip-relative** (0 = clip start). The component wraps `children`, so effects compose by nesting.

The other categories render through their own paths, not the effect registry:

| Category | Rendered by |
| --- | --- |
| `color`, `luts`, `glitch` | the effect renderer map → `ClipFx` in `HiteRoot.tsx` |
| `transitions` | `lib/remotion/fx/transition.ts` + `TransitionView` — a boundary treatment over the cut |
| `overlays` | `OverlayView` → `OverlayProcedural.tsx`, or an asset under `public/overlays/` |
| `text` | `CaptionView` + `captionStyle`/`captionAnchor` in `lib/remotion/fonts.ts` |
| `looks` | not rendered directly — the compiler expands the `recipe` into other entries |

### 3. Satisfy the renderable gate

This is the part that is unique to HITE, and the reason for it is worth understanding.

The reducer accepts **any** key, and `ClipFx` silently skips an effect with no renderer (`if (!R) continue`). So without a gate, the model can emit a key nothing can paint, report *"added a plate reverb"*, and hand back a byte-identical video. A confident lie about the user's own footage is the worst failure this product has.

Two mechanisms prevent it, and both are **derived** — never hand-maintained lists:

- **`lib/remotion/renderable.ts`** answers "can the pipeline paint this key?" by reading the live renderer map and the transition classifier. Register a renderer and the answer widens by itself.
- **`lib/ai/tools/renderableEntry.ts`** answers the registry-level question — including whether every step of a look's recipe lands — and returns a *reason string* when the answer is no. Every advisor tool filters through `partitionRenderableEntries()` and passes the withheld reason to the model as a `note`, so an empty result says *"this build cannot do that"* rather than *"nothing matched"*.

`scripts/lint-registry.ts` runs in `prebuild` and **fails the build** if an entry in a clip-effect category has no renderer. If you add a `color`/`luts`/`glitch` entry without step 2, CI stops you at the moment you author it.

For the other categories the build cannot check it for you, so check it yourself: add a case to `lib/remotion/renderable.test.ts`. That file pins exactly which keys are currently in the hole — when your work fills one, a test fails and you shorten the exclusion list. That failure is the point.

**Do not widen `RENDERABLE_TRANSITION_STEMS` without doing the work.** 23 of the 36 transitions are withheld because clips abut end-to-end in the IR and v1 cannot blend or move two clips' pixels. Adding `crossfade` to that set does not make a crossfade; it makes a dip to black that lies about its name. Earning those keys back means real blended transitions.

### 4. Adding a new *kind* of edit

A new edit operation is not a registry entry — it is a change to the command union, and it must land in four places together or the layers drift:

1. a new variant in `lib/edl/commands.ts`
2. a case in `lib/edl/reducer.ts`
3. render support in `lib/render/compile.ts` and `lib/remotion/`
4. the flat AI mapper in `lib/ai/edit-batch-flat.ts`

---

## Adding an AI tool

Tools are how the planner learns about the project's real data and real catalog. One file per tool.

### 1. Write the spec

Create `lib/ai/tools/generated/<name>.ts` exporting a `ToolSpec`:

```ts
import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";

export const spec: ToolSpec = {
  name: "suggestTransition",              // must equal the key the model calls
  tier: "motion",
  whenToUse: "Pick a transition key for a style (whip, glitch, fade, crossfade, cube).",
  tool: tool({
    description: "…what it returns, and what an empty result means…",
    inputSchema: z.object({ style: z.string().describe("desired transition style") }),
    execute: async ({ style }) => { /* … */ },
  }),
};
```

### 2. Register it

Import it in `lib/ai/tools/generated/index.ts` and add it to `GENERATED_TOOLS`. That is the only wiring — the planner and the reducer do not change.

### 3. Pick the tier, and respect the ceiling

`tier` is what the router keys on. The tiers are `registry`, `speech`, `rhythm`, `structure`, `vision`, `color`, `audio`, `text`, `motion`, `planning`.

LLM tool-selection accuracy collapses past roughly 16 tools, so `lib/ai/tools/router.ts` exposes only the tiers a request actually hits. If a prompt should reach your tool, widen that tier's **keywords** — do not add a tier to the default fallback set, which is deliberately sized to land just under the ceiling.

Router keywords are written as **stems**, and the trailing "e" is dropped (`rambl`, `dissolv`, `remov`) because the matcher appends up to three letters to the whole stem. `ramble` matches `rambles`/`rambled` but never `rambling` — which is exactly how "take out the rambling" once reached no tier at all.

### 4. Keep the schema Gemini-safe

Gemini's function-calling **rejects `z.union`, `z.tuple`, `z.record` and mixed-type unions.** Model-facing schemas may use only `z.string` / `z.number` / `z.boolean` / `z.enum` / `z.optional`, kept flat and shallow. This is why `lib/ai/edit-batch-flat.ts` exists at all: the model emits a flat batch and `flatBatchToEditBatch()` maps it onto the real command union.

### 5. Rules for what a tool may return

- **Read the database, never invent it.** Analysis tools return honest empty defaults when a row is absent (`{ tracks: [], analyzed: false }`), and *throw* when the query itself fails. Those are different outcomes and must not be collapsed.
- **Gate registry results.** Anything that hands the model a registry key goes through `partitionRenderableEntries()` + `withheldNote()`.
- **Times are ticks.** Anything time-shaped crossing the model boundary is in ticks at 30000/sec, with `TICKS_UNITS_NOTE` attached.
- **Check ownership.** Tools that take an `assetId` call `assertAssetAllowed` first, so the planner cannot be talked into reading another tenant's data.

### 6. If you edit a prompt

`lib/ai/prompts/*.md` are the source of truth, but the runtime imports `prompts.generated.ts` — prompts are bundled because a serverless function has no repo on disk to `readFileSync` from. After editing a `.md`, regenerate:

```bash
pnpm tsx scripts/build-prompts.ts
```

and commit the generated file. **This is not yet wired into `prebuild` and there is no drift test**, so an un-regenerated prompt change ships as a silent no-op. Until that gap is closed, it is on you to run it.

### 7. If you add or vouch for an AI provider

HITE is **bring-your-own-key only**. There is no deployer key pool and nothing falls back to one, so
a request with no usable credential is a 402 pointing at settings. `GEMINI_API_KEYS` is not a product
path any more — it survives as a developer convenience read by exactly one file, the harness below.

**Adding a provider** is four edits, all in `lib/ai/providers/`:

1. `pnpm add "@ai-sdk/<name>@^<major matching ai@6>"` — see the version wall below.
2. an entry in `registry.ts` (data only: models, auth shape, validation call, help links, capabilities);
3. a `case` in `factory.ts` (`await import()` — never a static import, or every cold start pays for it);
4. a row in `options.ts`'s thinking table, taken from that package's **shipped** provider-options
   schema, not from memory.

`versions.test.ts`, `registry.test.ts` and `options.test.ts` will tell you if you missed one.

**⚠ The version wall.** `ai@6` speaks `@ai-sdk/provider@3.x`. Every `@ai-sdk/*` provider has since
shipped a 4.x line built on the AI SDK **7** interface, and `latest` points at it — so `pnpm add
@ai-sdk/openai` with no range installs a package that cannot drive this repo, and the failure reads
as "the SDK is broken" rather than "wrong major". Three packages have an OFFSET major
(`@ai-sdk/deepseek`, `@ai-sdk/openai-compatible` and `@openrouter/ai-sdk-provider` are on 2.x).
`lib/ai/providers/versions.test.ts` walks the installed tree and fails `pnpm test` if any of them
disagrees with `ai`.

**A provider SDK must never reach the browser.** `registry.ts` imports no provider package, which is
what lets the settings UI render eight providers with zero bytes of `@ai-sdk/*` in a client chunk.
`registry.test.ts` guards it at the source level and `pnpm check:bundle` guards what actually ships.

**You cannot mark a model as working.** `ProviderModel` has no `verified` field — there is nowhere to
assert one. A green badge exists only where the harness wrote a passing run:

```bash
pnpm verify:provider -- --provider openai --model gpt-5.4-mini --dry-run   # prints the call plan
HITE_VERIFY_KEY=… pnpm verify:provider -- --provider openai --model gpt-5.4-mini --yes
```

It drives the **real** planner, router, flat mapper and reducer against a committed fixture timeline
(offline: only each analysis tool's `execute` is swapped, so the tool surface the model sees is
byte-identical and the single variable is the model). Six canonical prompts × 3 runs; it grades
itself and merges the result into `public/providers/verified.json`, which is the only input to every
badge in the UI. Commit that file to publish the result.

Three things it will not do: take the key as a flag (env only — a flag lands in shell history);
write a key into its output; or grade your own quota as a model failure — a 429 or a 401 **aborts**
the run and records nothing, because "your free tier ran out" says nothing about the model. Free
tiers are per-minute, so pass `--pause 40000` when running on one.

---

## The determinism rule

`lib/edl/**`, `lib/render/**` and `lib/remotion/**` must be **pure functions of their input**. ESLint enforces it (`eslint.config.mjs`), and these are errors, not warnings:

| Banned | Use instead |
| --- | --- |
| `Math.random()` | `lib/edl/ids.ts` |
| `Date.now()` | pass the timestamp in from the boundary |
| `crypto.randomUUID()` | `lib/edl/ids.ts`, or the envelope ULID minted once at the command boundary |
| `new Date()` (no args) | pass it in |
| `setInterval(…)` | — |

Tests under those paths are exempt: they legitimately need seeded randomness and fixed clocks.

**Why it is an error and not a style preference.** Two properties depend on it:

- **IR hashing and segment caching.** The Render IR is content-hashed so unchanged segments can be reused instead of re-rendered. If a node's output depends on the wall clock or a random number, its hash stops meaning "this produces the same pixels" — and the cache starts serving output that no longer matches the edit. That failure is silent and, because caching is per-segment, it shows up as one wrong stretch of an otherwise correct video.
- **Preview must equal export.** The same composition runs in the browser `<Player>` and in headless Chromium months apart. A `Math.random()` in a grain shader means the frame you approved is not the frame you download.

This guard had silently stopped running for an entire release cycle: `next lint` was removed in Next 16 and ESLint 9 no longer reads `.eslintrc.json`, so `pnpm lint` exited non-zero without linting anything. If you change the lint setup, prove the guard still fires — add `Math.random()` to a file under `lib/edl/` and confirm `pnpm lint` fails.

---

## The no-fabricated-data rule

More of this codebase's structure comes from this rule than from any other single decision, so it is worth stating plainly.

**Never present a number, a result or a success message that nothing measured.**

In practice:

- **Missing analysis is reported as missing.** No face pipeline exists, so `lib/render/resolver.ts` returns an *empty* face track and `recipeVars` is not implemented. The compiler degrades to a visible centered placement and records a diagnostic. It does not resolve a missing variable to `0` and carry on.
- **An unrenderable key is withheld with a reason,** not silently dropped — see the renderable gate above.
- **A failure keeps its own error text.** Worker jobs write the real reason into `job.error` (`ffprobe exited 1: moov atom not found`), and each analysis branch persists independently, so a missing `GROQ_API_KEY` costs you the transcript and *only* the transcript — it is not reported as overall success either.
- **A progress bar measures bytes.** `lib/storage/upload.ts` speaks Supabase Storage's wire protocol over XHR rather than using the one-line SDK call, purely because the SDK is `fetch`-based and cannot report progress. An animated bar that is not measuring anything is the same class of lie.
- **Test fixtures are derived, not hand-authored.** The landing page's demo EDL is produced by running the real reducer and asserting the batch and the one-at-a-time replay land on the same content hash.

**On the landing page and marketing copy this is a hard rule.** No invented metrics, testimonials, logos, user counts or claims about real creators' footage. If a capability is partial, the docs say so — see the catalog table in the README, which exists because a contributor who discovers the gap themselves is right to stop trusting everything else we wrote.
