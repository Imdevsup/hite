-- Asset idempotency: blob_url must be unique.
-- Before this migration, two simultaneous uploads of the same file (retry,
-- two tabs, or webhook+client-post collision) could create duplicate asset
-- rows. The analyze workflow would then kick twice, doubling cost.

-- If any duplicates already exist, keep the earliest row and delete the rest.
-- Idempotent on re-runs because once the index lands, new duplicates can't form.
with ranked as (
  select id,
         row_number() over (partition by blob_url order by created_at asc, id asc) as rn
    from public.asset
)
delete from public.asset a
 using ranked r
 where a.id = r.id
   and r.rn > 1;

create unique index if not exists asset_blob_url_key
  on public.asset (blob_url);
