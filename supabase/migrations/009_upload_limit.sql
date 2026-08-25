-- The media bucket's size cap, brought down to what Storage will actually accept.
--
-- Migration 005 created the bucket with a 2 GiB `file_size_limit` mirroring
-- lib/storage/media.ts. Both numbers were fiction: the PROJECT-level limit
-- (`[storage] file_size_limit` in supabase/config.toml, and 50 MiB on Supabase's free
-- tier) applies to every upload and wins whenever it is lower, so anything past 50 MiB
-- failed mid-transfer with a raw storage error after the picker had accepted it.
--
-- 005 is left as it was rather than edited: it has already been applied to real
-- databases, and a migration that changes after the fact is one that only fixes the next
-- clone. `MAX_UPLOAD_BYTES` and this value are asserted equal by
-- tests/integration/storage.test.ts, so the TS copy and the SQL copy still cannot drift.
--
-- Raising it again is a two-step change and both steps are required: raise the project's
-- global storage limit first, then this.
update storage.buckets
set file_size_limit = 52428800 -- 50 MiB
where id = 'media';
