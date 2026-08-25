import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Exclusive use of the shared `public.job` table, for the test files that claim from it.
 *
 * `claim_job` takes the OLDEST queued job of a kind — it has no notion of whose it is, which is the
 * whole point of a work queue. Two test files claiming at once therefore steal each other's jobs,
 * and vitest runs files in parallel by default: `worker-db.test.ts` marking a job succeeded while
 * `worker.test.ts` was waiting for its own render is exactly what that looks like, and it presents
 * as a baffling "the job succeeded but the export row never moved". The same happens if a real
 * `pnpm worker` is polling the same database while the suite runs.
 *
 * A directory is the lock because `mkdir` is atomic on every platform this runs on: the create
 * either wins or raises EEXIST, with no read-then-write gap to lose.
 */

const LOCK_DIR = join(tmpdir(), "hite-job-queue.lock");
/** A lock older than this belonged to a run that was killed; it is not a live holder. */
const STALE_LOCK_MS = 10 * 60_000;
const RETRY_MS = 250;

export type ReleaseQueue = () => Promise<void>;

export async function acquireQueueLock(timeoutMs = 300_000): Promise<ReleaseQueue> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(LOCK_DIR);
      return async () => {
        await rm(LOCK_DIR, { recursive: true, force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (await isStale()) {
        await rm(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `another test file has held the job queue for over ${Math.round(timeoutMs / 1000)}s ` +
            `(${LOCK_DIR}) — is a 'pnpm worker' or a stale run still going?`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

async function isStale(): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(LOCK_DIR);
    return Date.now() - mtimeMs > STALE_LOCK_MS;
  } catch {
    // It disappeared between the EEXIST and this check — the next mkdir will win.
    return false;
  }
}
