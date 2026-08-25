# HITE

**Vibe coding for video editing.** Describe an edit in plain language and a real timeline cuts it.

[Website](https://www.tryhite.xyz) · [Docs](https://www.tryhite.xyz/docs) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md)

![A film cut in HITE: nine shots cut to the beat, graded, with transitions, an overlay and a title, then rendered by HITE itself](docs/media/hite-demo.gif)

There is no black box between the prompt and the result. The model emits typed edit commands, those
commands reduce into a versioned edit decision list, and that list compiles into the scene graph that
renders. You can undo any of it, or ignore the prompt entirely and drag the clips yourself.

The film in the middle of that clip is HITE's own export, the mp4 its worker rendered and uploaded to
its `exports` bucket, watermark included. The title cards around it, and the editor footage in the
[full 53-second version](public/demo/hite-demo.mp4), were assembled afterwards in ffmpeg.

That timeline, read out of the database rather than remembered: **21 clips** over 25.00s cut to a
120 BPM grid, **20 transitions** across 7 kinds, **`look-a24`**, **53 effect applications** across 8
keys, two overlays, and a `text-lower-third-basic` title. The footage is the synthetic sample this
repo ships (`pnpm sample:take`).

## HITE is self-hosted

There is no hosted editor. You clone this repo, point it at your own Supabase, bring your own model
key, and run it. Your footage never leaves your machine and nobody pays for your renders but you.

<https://www.tryhite.xyz> runs this code as a landing page. It has no Supabase project behind it, so
`/app` there answers a `503` naming the variables it wants. That is the correct behaviour for a
deployment meant only to serve the landing, and it is why the site's buttons say *Source* rather than
*Open the editor*.

## Status

- **The async backend runs end to end.** Queue, analyze, render, MP4. Covered by an integration test
  that spawns the real worker, drives real ffmpeg and a real headless Chromium, uploads to real
  object storage, and ffprobes the result. Four tests, all passing against a local stack.
- **The catalog over-promises.** The registry advertises 76 effects, looks and transitions; **46**
  actually change the picture. The gap is measured and gated, so the model is never offered the other
  30 (`lib/ai/tools/renderableEntry.ts`).
- **The browser UI has no automated coverage in the default gate.** Everything under it does. The
  Playwright suite in `qa/` walks into `/app`, but `pnpm test` does not run it, so assume the
  timeline UI has edges the tests do not see.
- **Every provider ships `untested`.** Eight are wired (Google, OpenAI, Anthropic, Groq, xAI,
  DeepSeek, OpenRouter, self-hosted OpenAI-compatible). The badges come from
  `public/providers/verified.json`, which only `scripts/verify-provider.ts` writes.

## Quickstart

Verified on Windows 11 with Node 24.16.0, pnpm 10.18.0 and Docker Desktop 4.67.0.

You need **Node 20+**, **pnpm**, **Docker** (for the local Supabase), and an **AI provider key**,
which you paste into the app's settings panel rather than into `.env`. Gemini's free tier is enough
to try it: <https://aistudio.google.com/apikey>.

```bash
git clone https://github.com/Imdevsup/hite.git && cd hite
pnpm install
```

The Supabase CLI will not work straight after install. Its postinstall is blocked by
`pnpm.onlyBuiltDependencies`, so `node_modules/supabase/` has no `bin/`. Fix it from inside its own
package directory, because the script reads `package.json` relative to the working directory and
dies on the repo root's:

```bash
cd node_modules/supabase && node scripts/postinstall.js && cd ../..
```

Then bring up the database and the app:

```bash
pnpm supabase start        # applies supabase/migrations/*.sql automatically
cp .env.example .env.local # fill in the three SUPABASE_* values from `pnpm supabase status`
pnpm dev                   # http://localhost:3000
pnpm worker                # SECOND TERMINAL, see below
```

> This project's Supabase ports are not the defaults: API `54421`, DB `54422`, Studio `54423`,
> Mailpit `54424`. Anything you read elsewhere saying `54321` is wrong for this repo.

**`pnpm worker` is a second process and the app is broken without it.** It drains the Postgres job
queue, which is every analyze and every export. Without it running, uploads and the editor work fine
and every job sits queued forever.

Open <http://localhost:3000/app>. The settings sheet opens on first visit and asks for your provider
key. Nothing is stored server-side and no account is created: `middleware.ts` mints an anonymous
Supabase session, so **anonymous sign-ins must be enabled** on the project. That is already set for
local in `supabase/config.toml`; on a hosted project it is Authentication, then Sign In / Providers,
then Anonymous. With it off, `/app` answers a `503` saying exactly that.

## How it works

One spine, and nothing bypasses it:

```
EditCommand[]  ->  reduceBatch  ->  Edl.2  ->  edlToRenderIR  ->  HiteRoot
lib/edl/commands   lib/edl/reducer  lib/edl/schema  lib/render/compile  lib/remotion
```

- **The model and your hands go through the same door.** The planner and the manual UI emit the same
  command union through the same reducer, which is why they share one undo stack.
- **`HiteRoot` is the only compositor.** The browser `<Player>` and the worker's `renderMedia` run
  the same tree over the same IR, so the preview is the export. ffmpeg does decode, encode, probe and
  analysis, never compositing.
- **Time is integer ticks at 30000/sec.** `ticksToFrame` is called only by the compiler.
- **Nothing is fabricated.** Missing analysis is reported as missing. A look step that cannot resolve
  is dropped with a diagnostic rather than guessed at.

The AI layer is bring-your-own-key. There is no deployer key pool and nothing falls back to one, so a
request with no key is a `402` pointing at settings. The key arrives per request in a header and is
never stored. `lib/ai/providers/registry.ts` imports no provider SDK, which is what keeps the browser
bundle at zero; `factory.ts` is the only module that does.

Analysis and render go through a Postgres job queue (`claim_job`, `reap_stale_jobs`) drained by
`worker/index.ts`. It reaps jobs abandoned by a dead worker, heartbeats the ones it holds, enforces a
per-job deadline, and fences every terminal write on its claim.

The long version is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and on
[the docs site](https://www.tryhite.xyz/docs): the command union, the reducer's invariants, the tool
router, and what the renderer cannot draw yet.

## Tests

```bash
pnpm typecheck      # tsc --noEmit
pnpm exec vitest run
pnpm lint
```

With no environment configured that is **111 files / 1577 tests passing**, plus 8 files / 65 tests
skipped. The skipped ones are the integration suites, which need a database.

To run those, start the local stack and export `SUPABASE_LOCAL_URL`, `SUPABASE_LOCAL_ANON_KEY` and
`SUPABASE_LOCAL_SERVICE_KEY` from `pnpm supabase status`. On Windows also point
`REMOTION_BROWSER_EXECUTABLE` at an installed Chrome, or the render tests hang for four minutes
before failing for the wrong reason.

They are not mocks. They run the real worker against real Postgres and real object storage, and they
prove row-level security at runtime rather than asserting it.

## Deploying

You do not need this section to use HITE. Running it on your own machine is the supported path.

The Next.js app deploys to any Node host. The worker does not: it is a long-lived process that
renders video, so it needs a container or a VM with the same repo, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, ffmpeg (vendored) and a Chromium. Deploy the app without it and every
analyze and export job queues forever.

A deployment with no Supabase configured is a landing page. `middleware.ts` answers `/app/*` with a
clean `503` naming the variables it wants.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the gates and the conventions. The short version:
match the surrounding code, ground claims in the source rather than in memory, and never report a
number the code does not actually produce.

Issues and pull requests are welcome. If you are looking for somewhere to start, the effects catalog
is the obvious one: 30 of the 76 registry entries have no renderer, and each one is a self-contained
piece of work with a clear test.

## License

HITE's own source is [MIT](LICENSE).

It bundles ffmpeg binaries via `ffmpeg-static`, which are GPL/LGPL, and GSAP, under its own licence.
If you ship HITE commercially those terms are yours to satisfy. The third-party notice in
[LICENSE](LICENSE) names them.
