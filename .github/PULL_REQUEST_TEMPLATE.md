## What changed, and why

<!-- The problem first, then the change. If it fixes an issue, link it. -->

## Gates

<!-- Tick what you actually ran. An honest gap is better than a wrong tick. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm exec vitest run`
- [ ] `pnpm exec vitest run tests/integration` against a local Supabase stack
      *(required if this touches the database, storage, the job queue or the worker: unit tests mock
      exactly the thing that breaks there)*

**Not verified:** <!-- What you could not run, and why. Say "nothing" if there is nothing. -->

## House rules

- [ ] A bug fix ships with the regression test that catches it, in the same commit.
- [ ] The layering still runs one way: `EditCommand[]` to `reduceBatch` to `Edl.2` to
      `edlToRenderIR` to `HiteRoot`. No second mutation path, no second compositor.
- [ ] If this adds a new kind of edit, all four changes landed together: a variant in
      `lib/edl/commands.ts`, a case in `lib/edl/reducer.ts`, render support, and the flat AI mapper
      in `lib/ai/edit-batch-flat.ts`.
- [ ] No fabricated data in anything user-facing. No metric, result or success message that nothing
      measured; no invented numbers, testimonials or logos in copy. An unrenderable registry key is
      withheld with a reason, never silently dropped.

<!-- New effect, AI tool, provider or prompt? CONTRIBUTING.md has the checklist for each. -->
