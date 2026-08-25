# HITE — notes for AI coding agents

This is the repo root (`package.json` is here). Run every `pnpm` command from this directory.

**Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.** They are the source of truth for setup, the layering, and the rules below. This file is the short version plus the traps that are not obvious from reading the code.

## Operating mode

Correct, production-quality work over the fastest plausible-looking answer.

- **Read the existing code before changing it.** Match its naming, layout, error handling and idioms over your own preferences. Reuse before you build — search for an existing owner, utility, type or component and extend it.
- **Ground claims in fact, not memory.** Your recollection of an API is a hypothesis until you check the source. Do not invent signatures or behaviour.
- **Plan first for anything non-trivial** — multi-file changes, shared logic, or anything with a design choice.
- **Strong typing throughout.** No `any` without a stated reason. Handle errors explicitly: no silent catches, no swallowed failures. No dead code or stray TODOs unless flagged in your summary.
- **Never say done for something you have not run.** Reading code is not verification. If you could not run it, say so and list exactly what is unverified.
- **Smallest correct change.** Don't gold-plate or refactor unrelated code without asking.

## Gates

```bash
pnpm typecheck        # tsc --noEmit
pnpm exec vitest run   # unit suites
pnpm lint              # eslint . — flat config; includes the determinism guard
```

Run the first two before claiming done, always. If your change touches the database, storage, the job queue or the worker, also run `pnpm exec vitest run tests/integration` against a local Supabase stack — unit tests mock exactly the thing that breaks there.

## The spine — do not break the layering

`EditCommand[]` (`lib/edl/commands.ts`) → `reduceBatch` (`lib/edl/reducer.ts`) → `Edl.2` (`lib/edl/schema.ts`) → `edlToRenderIR` (`lib/render/compile.ts`) → `HiteRoot` (`lib/remotion/HiteRoot.tsx`).

- The AI and the manual UI emit the **same** command union through the **same** reducer. There is no second mutation path, and that is why they share one undo stack.
- The editor store (`lib/editor/store.ts`) mutates the EDL ONLY via `dispatch(EditCommand[])` / `applyAiEdl`.
- `HiteRoot` is the **only** compositor — the browser `<Player>` preview and the worker's `renderMedia` export run the same tree over the same IR. Never add a second render path. ffmpeg is decode/encode/probe/analysis only, never compositing.
- Time is integer **ticks** at 30000/sec (`lib/edl/time.ts`); DB analysis is in ms (×30). `ticksToFrame` is called only in the compiler.
- **A new edit command means four coordinated changes:** a variant in `commands.ts`, a case in `reducer.ts`, render support, and the flat mapper (`lib/ai/edit-batch-flat.ts`).

## Non-negotiables specific to this codebase

1. **Determinism.** `lib/edl/**`, `lib/render/**`, `lib/remotion/**` are lint-enforced pure — no `Math.random`, `Date.now`, `crypto.randomUUID`, bare `new Date()`, `setInterval`. IR hashing and segment caching assume identical input produces identical pixels; breaking it corrupts the cache silently. Use `lib/edl/ids.ts`, or pass timestamps in from the boundary.

2. **No fabricated data.** Never emit a number, result or success message that nothing measured. Missing analysis is reported as missing (the resolver returns an *empty* face track; the compiler degrades visibly and records a diagnostic rather than resolving a variable to 0). Failures keep their own error text.

3. **The renderable gate.** The manifest advertises 76 entries; **46 render**. Two numbers exist and they are not interchangeable — verified live: `isRenderableEntry` passes **46 of 76** (the renderer truth: audio 0/3, procedural 0/2, looks 5/7, transitions 13/36, everything else full), while `RENDERABLE_ENTRY_COUNT` is **39**, because the landing catalog scopes itself to seven categories and excludes `overlays` and `text` — those render, they are simply not catalog rows. Quote 46 for "what the model may emit"; quote the derived constant for "what the catalog shows". The reducer accepts any key and `ClipFx` silently skips one it cannot draw, so an ungated key lets the model report success over an unchanged video. Everything model-facing filters through `lib/ai/tools/renderableEntry.ts` (`partitionRenderableEntries` + `withheldNote`). Never bypass it, and never widen `RENDERABLE_TRANSITION_STEMS` without implementing the blend it names.

4. **Gemini-safe schemas.** Gemini's function-calling rejects `z.union` / `z.tuple` / `z.record` / mixed-type unions. Model-facing schemas use only `z.string/number/boolean/enum/optional`, flat and shallow. Hence `FlatEditBatch` + `flatBatchToEditBatch()`.

5. **Never `readFileSync` at runtime.** Prompts are bundled into `lib/ai/prompts/prompts.generated.ts` and the registry manifest is a **module import** (`lib/registry/catalog.ts`). A serverless function has no repo on disk — a runtime file read 500s in production.

6. **~16-tool ceiling.** `lib/ai/tools/router.ts` exposes only the tiers a request hits. A new tool is one file in `lib/ai/tools/generated/` exporting `spec: ToolSpec`, added to `generated/index.ts`. To make a prompt reach it, widen that tier's **keywords** — do not enlarge the default fallback set, which is sized to land just under the ceiling.

7. **Honesty in user-facing copy.** No fabricated metrics, testimonials, logos, user counts or real-creator clip claims. Banned phrases on the landing: "to the pixel", "in seconds", "in minutes", render-length caps, any Pro price or Buy button. "beta" at most twice.

## Traps

- **The landing is a scroll-driven Three.js piece, rebuilt from scratch on 2026-08-21.** It lives in
  `components/landing3d/` (vanilla three r185 + gsap ScrollTrigger + lenis + `postprocessing`/`n8ao`;
  NOT react-three-fiber — the design is one object, one state texture, one master timeline, and a
  reconciler on that hot path buys nothing). Rules that keep it honest and working:
  (1) `choreography/script.ts` is the single source of truth for the chat, the twelve tool calls and
  the staged demo project; `script.test.ts` pins every tool name to a real planner tool the router
  exposes for `DEMO_PROMPT`, every command to a real `EditCommand`, every key to a renderable registry
  entry, and every number to `deriveDemoStats()`. Change the demo there, nowhere else.
  (2) GSAP tweens numbers on `SceneState` (`choreography/master.ts`); `Scene.tsx` writes the renderer
  from it each frame. Nothing animates by side effect, so scroll is reversible by construction — no
  `once`, no `onComplete`, `tl.set()` only (it rewinds).
  (3) The page is server-rendered copy; the island is `dynamic(..., { ssr: false })` from the client
  wrapper `Landing3D.tsx`, which picks `scroll` / `mobile` (<900px) / `stills` (reduced motion: the
  same scene rendered once per act) / `none` (no WebGL2). `app/page.test.tsx` and
  `lib/seo/honesty.test.ts` SSR-render `/` in node — `next/font/google` is stubbed for vitest in
  `vitest.config.ts`.
  (4) `objects/paths.ts` carries the loop TWICE, TS and GLSL, line for line; `paths.test.ts` measures
  the shape (a full loop: turns > 1 with along-track `advance` so it never intersects in 3D,
  clearance > 2× width, ends at ENTRY/EXIT) and pins the GLSL literals. The join tangents are
  SECANTS over the loop's first/last 2% — the analytic derivative is degenerate there.
  (5) Strict Mode mounts the island twice on the same canvas: `Stage.dispose()` must never
  `forceContextLoss()`. GLSL reserved words (`half`) and backticks inside the template-literal
  shaders both break the build silently until runtime — `?debug` shows compile errors in the console.
  (6) **No float textures, no vertex-stage texture reads, no curl math when flat.** The owner's GPU
  truncated the flat timeline at one slot while the software renderer showed it fine; three things
  were removed in response and must stay removed: the per-vertex path position is the CPU-baked
  `aTEff` attribute (never a texture fetch in the vertex shader), the state texture is 8-bit RGBA
  with 16-bit packed clip bounds (never `FloatType`), and the vertex shader evaluates the curl
  only while `morph < 0.999` (a NaN from the curl's exit segment times zero is still NaN on real
  hardware). The `?debug` box prints the GPU renderer string for the next such report.
  **The flat timeline's span is LAYOUT:** its ends come from the plane's own uv coordinate, never
  from per-slot data, and the ripple's influence fades to zero at both ends. `pFlat` takes a
  normalised 0..1 position. `.scratch/probe-edge.mjs` measures it: it projects the last vertex to
  NDC and finds the rightmost lit pixel — the answer must be `gapRight 0` (or the scrollbar's
  width) at every scroll position, and `?debug` prints the same thing as `span L..R ok|SHORT`.
  **The ripple is 129 uniform floats** (`uPrefix`, resampled per frame), NOT a per-vertex attribute
  and NOT a texture: an Intel Iris Xe truncated the bar at a clip boundary with both of those while
  the geometry provably spanned the frame, and neither could be reproduced on any renderer here.
  Dynamically indexed uniform arrays in a vertex shader are the oldest, most portable path in GL.
  **Size the renderer from the canvas's own `getBoundingClientRect()`,** never `window.innerWidth`:
  a scrollbar or a browser zoom otherwise poisons the camera aspect and every fit downstream.
  **NEVER `pow()` a value that can be negative, and never square with `pow(x, 2.0)`.** GLSL leaves
  pow() undefined for a negative base, and `NaN * 0` is still NaN, so one such term propagates into
  the vertex position and DELETES geometry. This cost days: `pow(sin(PI * u), 1.25)` in the roll
  term, where `u` clamps to exactly 1 past the curl's last segment and `sin(PI)` is a tiny negative
  epsilon on real hardware but +0 on the software renderer used for testing here, silently removed
  the whole timeline past t = SEG_A + SEG_B = 0.72 on an Intel Iris Xe. Clamp with `max(x, 0.0)`
  before pow(), square by multiplication, and remember the symptom: geometry vanishing at a constant
  `t` that no data path explains, while the CPU-side probe says everything is fine.
  (7) Below the piece the renderer idles (`Stage.idle`) — the sections' reveal observers need the
  main thread. The reveals are IntersectionObserver-driven (`app/_landing/Reveal.tsx`);
  `animation-timeline: view()` reported zero progress in headless Chromium and was dropped.
  (8) The old `scripts/check-bundle.mjs` baseline predates this page and is not a gate for it.
- **The landing does NOT host the editor, and the primary CTA has already been reversed twice.** The
  decision on record: **www.tryhite.xyz serves the landing page only; the editor runs on the visitor's
  own machine after they clone the repo.** Both previous sessions got this wrong in opposite
  directions, each citing a true fact — "`app/app/page.tsx` is a route in this build" (true of the
  REPO) versus "the editor is not hosted" (true of the DEPLOYMENT) — and each shipped a false claim in
  the other context. Do not re-argue it from either fact. `lib/site/primaryCta.ts` resolves it at build
  time (`next.config.ts` derives `local` vs `hosted-landing` from `VERCEL`, which Vercel always sets),
  and the header, hero, closing band, footer, prompt-rail chips and rail caption all read that one
  value. A hard-coded `href="/app"` on a landing surface is a regression; `hero-scene.test.ts` and
  `PromptRailFaq.test.tsx` fail if one reappears.
- **There is no login page, and `/login` + `/verify` are deleted routes.** `middleware.ts` mints an anonymous Supabase session on the first `/app/*` request, so RLS still has an `auth.uid()` and no visitor is ever asked for an email. Two things follow: **anonymous sign-ins must be enabled on the target project** or `/app` answers a clean 503 (`enable_anonymous_sign_ins` in `supabase/config.toml` locally; Dashboard → Authentication → Sign In / Providers → Anonymous when hosted), and **no user-facing copy may promise durability** — the session cookie is the only key to a project and no account exists to recover one with. The landing's microline has one owner, `CTA_MICROLINE` in `components/site/SiteChrome.tsx`; the caveat itself lives in §6.7's "Do I need an account?" FAQ, which is also the JSON-LD `FAQPage`.
- **Export works, and it is SLOW on a software rasterizer.** Verified end to end 2026-08-24: 40s of
  1080p from the bundled take took 1169s (~19.5 min) and produced a decodable, watermarked
  1920x1080 MP4 in the private `exports` bucket. Two things to know before you diagnose a "stuck"
  export. (a) **Remotion's compositor can panic on a single frame** —
  `rust/select_right_thread.rs:142`, `called Option::unwrap() on a None value`, extracting one source
  timestamp; ffmpeg seeks and decodes that same timestamp fine, and a retry rendered the whole clip.
  It surfaces as progress freezing at one decile while Chrome keeps burning CPU. The per-job deadline
  plus `max_attempts` is what saves it. (b) **Slow is not wedged.** Check the Chrome
  `--type=gpu-process` CPU delta over 20s before concluding anything, and check for orphaned
  `worker/index.ts` processes from earlier sessions — one four days old once claimed a render and
  logged to a file that no longer existed, so the queue showed `running` with a live heartbeat while
  every visible worker sat idle.
- **`pnpm worker` is a second process.** Without it, uploads and the editor work but every analyze/export job sits queued forever.
- **The `supabase` CLI is not installed by `pnpm install`** — its postinstall is blocked by `pnpm.onlyBuiltDependencies`. See the [README quickstart, step 2](README.md#2-get-a-working-supabase-cli--read-this-it-will-bite-you).
- **The local stack uses non-default ports** (API 54421, DB 54422, Studio 54423, Mailpit 54424). Anything saying 54321 is wrong for this repo.
- **A build with `NEXT_DIST_DIR` / `HITE_VERIFY_DIST` set** appends `include` entries to `tsconfig.json` and rewrites `next-env.d.ts`. Check `git status` afterwards and revert that churn.
- **`scripts/build-prompts.ts` is not wired into `prebuild` and has no drift test.** After editing `lib/ai/prompts/*.md`, run `pnpm tsx scripts/build-prompts.ts` and commit the result, or your prompt change silently never ships.
- **Transcription is not Gemini** — `lib/ai/transcribe.ts` is Groq Whisper (ASR, not an LLM call).
- **`sandbox/` and `lib/workflow/` are empty leftovers** from the removed Vercel Workflow DevKit / `@vercel/sandbox` architecture. Nothing imports them.
