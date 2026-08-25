# Integration tests — local Supabase

These tests require a local Supabase instance and exercise RLS end-to-end
via the real JS client. They're skipped in `vitest` by default; run them
explicitly:

```bash
# 1. Start Supabase (one-time: installs a Docker stack under supabase/.temp)
pnpm supabase start

# 2. Apply the HITE migrations against the local instance
pnpm supabase db reset

# 3. Export the local keys printed by `supabase start` (or read them from
#    `pnpm supabase status`) and run the RLS tests:
export SUPABASE_LOCAL_URL=http://127.0.0.1:54321   # the API_URL from `supabase status`
export SUPABASE_LOCAL_ANON_KEY=...       # from supabase status
export SUPABASE_LOCAL_SERVICE_KEY=...    # from supabase status
pnpm vitest run tests/integration
```

## What's covered
- `rls.test.ts` — user A cannot see user B's projects / assets / edits, and the migration-006
  `job` queue is read-only to a browser session (no client INSERT/UPDATE/DELETE, and neither
  `claim_job` nor `reap_stale_jobs` is callable by a signed-in user).
- `jobs-queue.test.ts` — `lib/jobs/queue.ts`: the `job_analyze_live_uq` dedupe (a second analyze
  request joins the live job), and the owner reading their own job's status/error under RLS.
- `worker.test.ts` — the WHOLE async backend end to end: `pnpm worker` is spawned as a real
  process against real Supabase Storage, a real ffmpeg and a real Chromium. Each case has a known
  correct answer: two 2-second clips render to a 4-second 1920×1080 MP4 that ffprobe decodes; a
  120 BPM click track analyzes to ~120 bpm; a corrupt file ends `failed` carrying ffmpeg's own
  reason; and a worker killed mid-render is reaped and the job completes on restart.
  **Set `REMOTION_BROWSER_EXECUTABLE`** to an installed Chrome: `@remotion/renderer`'s own
  download has been seen to unpack two files out of the archive on Windows and then hang with no
  error (the per-job deadline now fails such a job, so the symptom is a render that dies at its
  timeout rather than one that never ends).
  **These tests need the queue to themselves.** `claim_job` hands out the oldest queued job of a
  kind to whoever asks, so any other claimer steals their work. The four files that touch the queue
  (`worker`, `worker-db`, `jobs-queue`, `render-status`) serialize against each other through
  `queue-lock.ts` — vitest runs files in parallel, and they were quietly cross-claiming. A real
  `pnpm worker` polling the same database is outside that lock: stop it before running these.
- `worker-db.test.ts` — the worker's terminal writes are fenced on the CLAIM, not just the job id:
  a worker that was reaped mid-job cannot mark `succeeded`/`failed` a job that has been re-claimed
  under it, and the heartbeat is what tells it so. Same exclusivity requirement as above.
- `render-status.test.ts` — GET /api/render/[id] (the Export window's 1.5 s poll) always reaches an
  answer: a job the worker never got to finish reporting still ends the poll with the job row's
  reason, and the week-long signed url is not shipped on every tick.
- `project-delete.test.ts` — DELETE /api/projects/[id] removes the storage objects, not just the
  rows. Storage has no cascade, so the bytes used to outlive every deleted project.
- `storage.test.ts` — the migration-005 buckets/policies: a user writes only under their
  own `{userId}/` prefix, a second user is denied read of the first's object, there is no
  guessable public url, the DB refuses a fabricated `duration_ms`, re-registering an object does
  not overwrite the worker's probe with the browser's blanks (the payload POST /api/assets sends
  is what decides that), and the exact query `/api/plan` runs finds a usable asset.
- `rate-limits.test.ts` — consume_rate_limit RPC at the cap and after rollover.

## What's NOT covered here
- Middleware redirects (those live in a separate Playwright spec).
- AI streaming (requires live model + gateway credentials; tested via mocks
  elsewhere).
- Speech transcription (`worker.test.ts` asserts the honest failure when `GROQ_API_KEY` is
  unset, and the success path when it is set — but CI has no key, so the success path only runs
  locally).

## CI
`.github/workflows/integration.yml` spins up Supabase via the `supabase/setup`
action on PRs touching any `supabase/**` path or `lib/supabase/**`.
