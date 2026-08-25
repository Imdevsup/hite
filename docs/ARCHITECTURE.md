# HITE architecture

How the pieces fit, and — more usefully — *why* each seam is where it is. Everything here describes the code as it exists today; where something is unfinished it says so.

For setup see [../README.md](../README.md); for the rules you have to follow when changing this, see [../CONTRIBUTING.md](../CONTRIBUTING.md).

---

## 1. The spine

Four layers, one direction of flow. Each layer has exactly one owner, and nothing skips a step.

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ LAYER 0   EditCommand[]              "what the user or the AI intends"  │
  │           A discriminated union of typed operations. The AI and the UI  │
  │           emit the SAME union — there is no second mutation path.       │
  │           lib/edl/commands.ts                                           │
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 │  reduceBatch(edl, commands) → { edl, … }
                                 │  lib/edl/reducer.ts
                                 ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ LAYER 1   EDL.2                      "the canonical cut" — SINGLE TRUTH │
  │           Declarative, Zod-validated, versioned, content-hashed,        │
  │           persisted to Postgres as an `edit` row per version.           │
  │           lib/edl/schema.ts                                             │
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 │  edlToRenderIR(edl, env, resolver)
                                 │  lib/render/compile.ts
                                 ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ LAYER 2   Render IR                  "the resolved scene graph"         │
  │           Absolute frames, resolved asset URLs, expanded look recipes.  │
  │           Per-node SHA-256 hashes. lib/render/ir.ts, lib/render/hash.ts │
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 │  <HiteRoot ir={…} />
                                 │  lib/remotion/HiteRoot.tsx
                 ┌───────────────┴────────────────┐
                 ▼                                ▼
  ┌───────────────────────────┐   ┌──────────────────────────────────────┐
  │ LAYER 3a  PREVIEW          │   │ LAYER 3b  EXPORT                     │
  │ @remotion/player, browser  │ ══│ renderMedia() in the worker process, │
  │                            │   │ headless Chromium → MP4              │
  └───────────────────────────┘   └──────────────────────────────────────┘
                              ONE composition
```

**The double line is the whole design.** `HiteRoot` is the only compositor. The browser preview and the server export run the *same React tree* over the *same IR*; the differences are resolution, fps and where pixels are rasterised. There is no parallel server-side compositor to drift out of sync — the previous FFmpeg `filter_complex` compositor was deleted, and ffmpeg is now used only for decode, encode, probe and analysis.

### Invariants

- **Commands are the only way to mutate the EDL.** `lib/editor/store.ts` holds it and changes it exclusively via `dispatch(EditCommand[])` or `applyAiEdl`. Because both the AI and the UI go through one reducer, they share one undo/redo stack for free.
- **Time is integer ticks at 30000/sec** (`lib/edl/time.ts`). 30000 is frame-exact for 24/25/30/50/60 fps *and* millisecond-exact, so there is no float drift. Database analysis is in milliseconds and is multiplied by 30 on the way in. `ticksToFrame` is called in exactly one place — the compiler — so the tick→frame conversion has a single seam.
- **The compiler is synchronous and pure** given `(edl, env, resolver)`. All async work (asset URL lookup, analysis reads) happens at the boundary and is passed in through a `MediaResolver`. Same inputs ⇒ byte-identical IR ⇒ equal root hash.
- **`lib/edl`, `lib/render` and `lib/remotion` are lint-enforced pure.** See [the determinism rule](../CONTRIBUTING.md#the-determinism-rule).

### Adding an edit operation

Four places, together, or the layers drift:

1. a variant in `lib/edl/commands.ts`
2. a case in `lib/edl/reducer.ts`
3. render support in `lib/render/compile.ts` + `lib/remotion/`
4. the flat AI mapper in `lib/ai/edit-batch-flat.ts`

---

## 2. Why the IR is hashed

`lib/render/hash.ts` hashes every IR node with SHA-256 over a canonical JSON encoding: stable key order, integers only (the IR has no floats), with `id` and `hash` fields excluded by construction.

Excluding identity from the hash is deliberate — identity and cache key are orthogonal. Reseeding an id never busts the cache, and two structurally identical subtrees deduplicate to the same key.

SHA-256 rather than a cheap 53-bit hash because this is a **content-addressed render cache**: a collision does not mean a slow lookup, it means serving the wrong pixels. A non-cryptographic hash is fine for entity ids and is not fine here.

This is also the property the determinism rule protects. A `Date.now()` inside the compiler would make a node's hash stop meaning "this produces the same pixels", and the cache would begin serving stale output for an edit that had genuinely changed.

---

## 3. Honest degradation

The compiler's stated rule: **when the EDL asks for something it cannot express, degrade visibly or drop the step and record a `RenderDiagnostic` — never substitute a zero.**

The reason is specific. A strength-0 effect, a one-frame overlay and a scale-0 sticker all render as *nothing happened*, in preview and export alike, while every layer above cheerfully reports success. A visible fallback plus a diagnostic is strictly better than a silent no-op, because the user can see that something was off.

The same principle produces the **renderable gate**: `lib/remotion/renderable.ts` derives what the renderer can paint from the live renderer map, and `lib/ai/tools/renderableEntry.ts` decides whether emitting a whole registry entry would change anything — returning a reason string when it would not. Advisors filter on it, so the model is never handed a key that would produce a confident success message over an unchanged video. See [the catalog table](../README.md#the-effects-catalog--76-advertised-46-render) for what that currently excludes.

---

## 4. The AI layer

```
POST /api/plan        first ask          ──┐
POST /api/refine      follow-up          ──┤
                                           ▼
                        runPlanner()  lib/ai/agents/planner.ts
                        one streamText tool-loop over Gemini
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
      analysis tools              registry advisors            emitEditBatch
      (read the DB)               (read the manifest,          TERMINAL — ends
                                   gated on renderability)      the turn
                                           │
                                           ▼
                     flatBatchToEditBatch()   lib/ai/edit-batch-flat.ts
                                           │
                                           ▼
                     reduceBatch()  →  new EDL.2  →  persisted as an `edit` row
```

The model never writes the EDL. It emits a flat batch through one terminal tool; the route maps it onto the canonical command union, reduces it against the parent EDL, and persists the result. Everything is replayable and schema-validated on the way in.

Both routes stream Server-Sent Events: `text` narration deltas, `tool-call` activity for the UI log, the final `edl`, a one-line `summary`, `no-op` when the planner answered without an edit, then `edit-saved` / `error` / `[DONE]`.

**Three constraints drive the shape of this layer:**

1. **Gemini's function-calling rejects `z.union`, `z.tuple`, `z.record` and mixed-type unions.** Hence `FlatEditBatch` — a deliberately flat, shallow schema of strings, numbers, booleans and enums — and the mapper that turns it back into the real union. Every model-facing schema must stay flat.
2. **Tool-selection accuracy collapses past roughly 16 tools.** Hence the tiered library (`lib/ai/tools/registry.ts`, every tool a `ToolSpec {name, tier, whenToUse, tool}`) and the router (`lib/ai/tools/router.ts`) that exposes only the tiers a request hits. A prompt matching no tier gets a curated fallback spanning both readings of a vague ask — *cut it down* and *restyle it* — sized to land just under the ceiling.
3. **Serverless functions have no repo on disk.** Hence prompts are authored as `lib/ai/prompts/*.md` but bundled into `prompts.generated.ts` by `scripts/build-prompts.ts`, and the registry manifest is imported as a module rather than read with `fs` or fetched over HTTP. A runtime `readFileSync` of a prompt 500s in production.

**The provider layer is multi-provider and BYOK-only** (`lib/ai/providers/**`). The user brings their own key; there is no deployer key pool and no fallback to one, so a request with no usable credential is a 402 pointing at settings. Five modules, one job each:

| module | owns | client-safe? |
|---|---|---|
| `types.ts` | `ProviderId`, capabilities, entry/model/selection types | yes |
| `registry.ts` | WHICH providers exist and what they can do — the data | yes |
| `verification.ts` | whether a model is `verified` / `untested` / `broken`, **derived** from `public/providers/verified.json` | yes |
| `credential.ts` | the key header, the bounds-only shape check, two-pass redaction, the loopback SSRF gate | yes |
| `options.ts` | the per-provider wire shape for the thinking lever | yes |
| `fetch.ts` | retry-once-on-5xx, no fan-out | yes |
| `request.ts` | one call that turns a `Request` into provider + model + credential + rung | server |
| `factory.ts` | **the only module that imports a provider package**, via `await import()` | server |

Two rules carry the weight. **`registry.ts` never imports an `@ai-sdk/*` package**, which is what keeps the browser bundle at zero bytes of provider SDK while the settings UI renders eight providers, their models and their badges (`registry.test.ts` enforces it at the source level). And **verification is a derivation, never a field** — `ProviderModel` has no `verified` property, so the only way a model earns a green badge is `scripts/verify-provider.ts` driving the real planner and committing its output. Everything ships `untested`, Gemini included.

`lib/ai/gemini.ts` is what remains genuinely Google-specific: `safetySettings: BLOCK_NONE` (creative edit prompts get refused otherwise) and the per-family `thinkingBudget` ranges. The old key-rotating `fetch` over `GEMINI_API_KEYS` is **gone** — it existed to stack the deployer's free-tier keys, and with BYOK there is no pool to stack. `GEMINI_API_KEYS` survives only as a developer convenience read by `scripts/verify-provider.ts`.

Transcription is **not** Gemini: `lib/ai/transcribe.ts` is Groq Whisper — ASR, not an LLM call.

**Deliberately absent:** there is no "look at the video" tool. One previously claimed to be, and sampled zero frames — it sent a blob URL to the model as plain text and returned the model's guess as an observation of the footage. Real vision needs real frames extracted worker-side; until then the planner grounds visual questions in analysis rows or says it cannot see.

---

## 5. Jobs and the worker

Analysis and rendering are far too slow for a request, so they run through a Postgres-backed queue.

```
POST /api/analyze  ─┐                                   ┌─→ probe (ffprobe)
POST /api/render   ─┤                                   ├─→ beats (ffmpeg + in-repo FFT)
                    ▼                                   ├─→ scenes (ffmpeg)
             insert `job` row                           └─→ transcribe (Groq Whisper)
             (migration 006)                     ▲
                    │                            │  runAnalyzeJob
                    │      claim_job(kinds[])    │
                    └──────────────────────────► pnpm worker ──→ runRenderJob
                                                     │            compile IR → renderMedia
                       heartbeat / reap_stale_jobs   │            → MP4 → `exports` bucket
                                                     ▼
                                          mark succeeded / failed
```

`worker/index.ts` is a plain long-lived Node loop: claim → dispatch → record the outcome. No platform primitives, which is the point — it runs identically on a laptop, a VPS, a container or a Fly/Railway box, so a stranger who clones this repo can run the whole pipeline.

What it replaced never worked: Vercel Workflow DevKit directives that were never compiled (`start()` threw on every request) plus `@vercel/sandbox` microVMs that `apt-get`-installed Python onto an Amazon Linux image. No transcript, beats or scenes row could ever have existed.

**Operational guarantees, each present because its absence was a real defect:**

| Guarantee | Why it exists |
| --- | --- |
| Reaper at boot and on a timer | Whatever a crashed worker was holding is the first thing that should move. |
| Heartbeats on running jobs | Tells a 40-minute render apart from a worker that died 40 minutes ago. |
| A per-job deadline | Tells a *wedged* handler apart from a slow one. The heartbeat cannot: it beats just as diligently for a hung job, so the reaper would never fire. |
| Every terminal write fenced on the claim | A worker can only report the outcome of work it still owns. Reaped-then-reclaimed work is not overwritten with a stale verdict. |
| Outcome captured before anything is written | A database blip while recording *success* cannot be caught by the failure branch and mark a finished render as failed — the MP4 is already uploaded at that point. |
| Every failure writes a human-readable `job.error` | Nothing is swallowed. Absolute paths and signed URLs go to the log, never into the user-visible field. |
| Graceful SIGINT/SIGTERM | In-flight work is finished, or released back to the queue so another worker takes it immediately rather than waiting out the stale window. |
| One render at a time, N analyses | Chromium on a 1080p composition is the heaviest thing here; two at once is an OOM kill that strands both. Scale by running more worker processes. |

Both handlers are **idempotent** — analysis rows upsert on `(asset_id, kind)`, renders overwrite a stable `{userId}/{exportId}.mp4` — so if the outcome write itself fails, the reaper requeues and a repeat is wasteful but never wrong. That beats a lie in either direction.

Analysis branches are **isolated**: each persists as soon as it succeeds, and the job reports failure at the end naming the branches that failed. A missing `GROQ_API_KEY` costs you the transcript, not your beats and shot list — and is not reported as success either.

`claim_job` and `reap_stale_jobs` are Postgres functions (migration `006_jobs.sql`), not application logic, so claiming is atomic under concurrency. The `job` table is **read-only to a browser session**: owners can read their own job's status through RLS, and neither function is callable by a browser session. That is asserted by `tests/integration/rls.test.ts`.

---

## 6. Data and storage

Supabase is the whole backend: Postgres, Auth and object storage. There is no second datastore.

**Every session is anonymous, and there is no sign-in screen.** `middleware.ts` calls `signInAnonymously()` on the first request to `/app/*`, so `auth.uid()` exists from the first render and every policy below is unchanged from when a login wall stood in front of it. Two consequences that shape everything else here: anonymous sign-ins must be enabled on the project (`/app` answers a clean 503 if not — there is no login page to fall back to), and the session cookie is the only key to a user's rows, because no account exists to recover one with. The middleware matcher deliberately stops at `/app/*`: minting a session for `/api/*` too would create a user row per unauthenticated request and make the 401 boundary meaningless.

| Table | Holds |
| --- | --- |
| `project` | the owning unit; everything else joins back to it |
| `asset` | uploaded media + the probe measurements (duration, dimensions, fps) |
| `transcript` | one row per asset, upserted |
| `analysis` | `beats` and `scenes`, upserted on `(asset_id, kind)` |
| `edit` | one row per EDL version — the version history |
| `export` | a requested render and its output path |
| `job` | the queue (migration 006) |
| `rate_limit_bucket`, `ip_rate_limit_bucket`, `vlm_budget` | abuse limits |

**RLS is enabled on all of them**, scoped to `auth.uid()` through the project-owner join. This is verified at runtime, not asserted: `tests/integration/rls.test.ts` signs in as two real users and proves user A cannot read user B's projects, assets or edits.

Three storage buckets, created by migration `005_storage.sql`:

| Bucket | Public? | Contents |
| --- | --- | --- |
| `media` | no | user uploads |
| `exports` | no | rendered MP4s, under a `{userId}/` prefix |
| `previews` | yes | generated preview clips |

**Uploads go browser → Storage directly**, using the user's own access token, so the storage RLS policies decide what may be written; `/api/assets` then re-checks the path's owner segment before creating a row. `lib/storage/upload.ts` speaks the Storage wire protocol over XHR rather than calling the SDK, solely because the SDK is `fetch`-based and cannot report byte progress — and a progress bar that is not measuring anything is the kind of lie this codebase is built to avoid.

Downloads are signed **fresh per request** from `export.output_storage_path`, on the *caller's* session rather than the admin client, so storage RLS re-checks ownership. A signed URL is a bearer credential: the one handed to the browser lives ten minutes, not the week the stored one does.

The export **tier is derived server-side** (`lib/jobs/tier.ts`) and is deliberately not a request field. It used to be, and since the compiler only adds the watermark overlay for the free tier, anyone could `curl -d '{"tier":"pro"}'` for a watermark-free export.

---

## 7. Known gaps

Stated here so nobody has to rediscover them.

- **23 of 36 transitions do not do what their name says**, and are withheld from the AI. Clips abut end-to-end in the IR and never overlap, so v1 cannot blend or move two clips' pixels; it paints a boundary treatment over the cut. That is honest for a fade, a flash or a whip, and dishonest for a crossfade, wipe, slide, zoom or cube-rotate. Real blended transitions (`@remotion/transitions` `<TransitionSeries>`) are the follow-up that earns those keys back.
- **LUTs are CSS-filter approximations.** `public/luts/` ships no `.cube` files; a WebGL 3D-LUT sampler is the follow-up. They render, but they are not true film emulation.
- **Overlays are procedural CSS.** `public/overlays/` ships no assets, and pointing `<OffthreadVideo>` at a missing one crashes `renderMedia`, so known overlay keys render as deterministic CSS instead.
- **No audio effect engine.** The three `audio` entries have no renderer.
- **Face detection is cut.** MediaPipe was Python-only and has no JS replacement here. Nothing fabricates a face track: the resolver returns an empty one and the compiler degrades to a visible centered placement with a diagnostic.
- **Beats are detected but not consumable by look recipes.** `recipeVars` is unimplemented, so a recipe needing `{{dropMs}}` or `{{faceId}}` is withheld rather than half-applied. The AI *can* read beats and plan beat-synced cuts — that path works.
- **Speed ramps lower to a static rate.** The IR type already carries the keyframed variant.
- **`scripts/build-prompts.ts` is not wired into `prebuild` and has no drift test.** Edit a prompt `.md` without re-running it and the change silently never ships.
- **The browser editor UI is not covered by any test in the default gate.** Everything under it is. The login wall that used to make this hard to automate is gone, so `qa/` can now walk into `/app` directly — but `pnpm qa` needs a running server and is not part of `pnpm test`.
