"use client";
import { useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { useMediaUpload } from "@/components/editor/mediaUpload";
import { usePlanner } from "@/components/editor/planner";
import { Composer } from "@/components/editor/Composer";
import { AFFORDANCE, EXAMPLE_SLOTS } from "@/components/editor/affordances";
import { loadSampleTake, sampleTakeAvailable } from "@/components/editor/sampleTake";
import { EXAMPLE_PROMPTS } from "@/lib/landing/prompts";
import { MEDIA_FILE_ACCEPT } from "@/lib/storage/media";

/**
 * THE FIRST SCREEN, BEFORE THERE IS FOOTAGE — §13, "First screen — empty, 7 focusables".
 *
 *   1. Kite → home        4. The prompt input, 640px
 *   2. Settings           5-7. Three example prompts
 *   3. Choose a file      (the whole viewport is also a drop target)
 *
 * The kite and Settings are in `Chrome`; the other five are here. Centred: "Drop a video" in
 * Fraunces italic 700 at 44px, `--t-2` — §13 names the face, the weight, the size and the rung.
 *
 * THE EXAMPLES MUST RUN. §13 adopts the jury's sharpest constructive note whole: "the old empty state
 * offered an input that could not act and three links that could not run — a dead field and three
 * dead links as the product's first screen." The fix it specifies is that each example "loads the
 * bundled sample take and runs".
 *
 * AND THE TAKE IS NOT SHIPPED YET (§11's asset ledger; `sampleTake.ts` carries the whole argument).
 * So the honest version of that promise is what happens here: pressing an example HOLDS the sentence
 * and asks for the one missing thing, and `EditorFrame` sends it by itself the moment a timeline
 * exists. Nothing is dead — the press starts the flow, it just needs a video to finish it — and the
 * copy says which of the two it is doing rather than implying a sample that is not in the build.
 *
 * THE PROMPTS THEMSELVES are `EXAMPLE_PROMPTS`, the one allowlist on the property, whose test runs
 * every entry through the real flat mapper and the real reducer and requires a command that actually
 * changes the EDL. That is why none of them mention beats: beat detection is not wired, and the worst
 * thing this screen can do is hand a first-time user a sentence that reports success and changes
 * nothing.
 */
export function EmptyState({
  projectId,
  initialPrompt,
}: {
  readonly projectId: string;
  readonly initialPrompt?: string;
}) {
  const assets = useEditor((s) => s.assets);
  const uploadingName = useMediaUpload((s) => s.uploadingName);
  const progress = useMediaUpload((s) => s.progress);
  const uploadError = useMediaUpload((s) => s.error);
  const dragActive = useMediaUpload((s) => s.dragActive);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  function pickFile() {
    fileRef.current?.click();
  }

  async function runExample(text: string) {
    // Hold it first, so the sentence survives whichever branch happens next.
    usePlanner.setState({ held: text, heldReason: "needs-footage" });
    if (sampleTakeAvailable()) {
      const result = await loadSampleTake(projectId);
      if (result.ok) return; // EditorFrame releases the held sentence when the timeline appears
      if (result.reason === "failed") {
        setNote(`HITE couldn't load its sample video (${result.detail}). Pick a video of your own and this runs on it.`);
      }
    }
    // The "we kept your sentence" half is the composer's to say — it says it on both screens, and
    // saying it twice on this one would read as two different things having happened.
    pickFile();
  }

  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-[var(--space-6)] px-[var(--gutter)] pb-[var(--space-8)]">
      <h1
        className="italic-serif text-center"
        style={{ fontSize: "44px", lineHeight: 1.05, color: "var(--t-2)" }}
      >
        {dragActive ? "Let go" : "Drop a video"}
      </h1>

      <div className="flex flex-col items-center gap-[var(--space-2)]">
        <button
          data-affordance={AFFORDANCE.chooseFile}
          type="button"
          onClick={pickFile}
          className="inline-flex h-[var(--tap)] items-center rounded-[var(--r-sm)] px-[var(--space-5)] text-[15px] font-medium"
          style={{ background: "var(--color-accent-cta)", color: "var(--color-on-accent)", boxShadow: "var(--shadow-cta)" }}
        >
          Choose a file
        </button>
        <p className="text-[13px] text-[var(--t-3)]">or drop one anywhere on this page</p>
      </div>

      <Composer
        projectId={projectId}
        initialPrompt={initialPrompt}
        onNeedsFootage={pickFile}
        placeholder="what do you want changed?"
      />

      {/* §13 items 5-7. */}
      <ul className="flex flex-wrap items-center justify-center gap-[var(--space-2)]">
        {EXAMPLE_PROMPTS.slice(0, EXAMPLE_SLOTS.length).map((example, i) => (
          <li key={example.text}>
            <button
              data-affordance={EXAMPLE_SLOTS[i]}
              type="button"
              onClick={() => void runExample(example.text)}
              className="inline-flex h-[var(--tap)] items-center rounded-[var(--r-pill)] px-[var(--space-4)] text-[13px] text-[var(--t-2)]"
              style={{ background: "var(--s-1)", boxShadow: "inset 0 0 0 1px var(--line-3)" }}
            >
              {example.text}
            </button>
          </li>
        ))}
      </ul>

      {/* Real bytes, real filenames, real failures. `useMediaUpload` never synthesises progress, and a
          file whose length the browser could not read says so — an asset with no length cannot be cut,
          and inventing one is how the old code produced a timeline of a video nobody had measured. */}
      <div className="flex min-h-[var(--space-6)] flex-col items-center gap-[var(--space-2)]">
        <p className="sr-only" role="status" aria-live="polite">
          {uploadError
            ? `Some files were not added: ${uploadError}`
            : uploadingName
              ? `Adding ${uploadingName}, ${Math.round(progress * 100)} percent`
              : assets.length > 0
                ? `${assets.length} file${assets.length === 1 ? "" : "s"} added.`
                : ""}
        </p>

        {uploadingName && (
          <div className="flex w-[280px] flex-col gap-[var(--space-2)]">
            <div className="flex items-baseline justify-between gap-[var(--space-3)] text-[12px]">
              <span className="truncate text-[var(--t-2)]">{uploadingName}</span>
              <span className="tabular-nums text-[var(--t-3)]">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-[3px] w-full overflow-hidden rounded-[var(--r-pill)]" style={{ background: "var(--s-2)" }}>
              <div className="h-full" style={{ width: `${progress * 100}%`, background: "var(--color-accent)" }} />
            </div>
          </div>
        )}

        {note && !uploadingName && (
          <p className="max-w-[46ch] text-center text-[13px] leading-relaxed text-[var(--t-3)]">{note}</p>
        )}

        {uploadError && (
          <p role="alert" className="max-w-[52ch] text-center text-[13px] leading-relaxed" style={{ color: "var(--color-hit)" }}>
            {uploadError}
          </p>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={MEDIA_FILE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          // COPY the FileList before clearing the input. `e.target.files` is LIVE: resetting `value`
          // empties it in place, and the upload queues its work on a promise chain — so it read an
          // already-emptied list and uploaded nothing, silently, because a batch of zero files is a
          // legitimate no-op.
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length > 0) void useMediaUpload.getState().uploadFiles(projectId, picked);
        }}
      />
    </main>
  );
}
