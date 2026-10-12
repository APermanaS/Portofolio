-- ============================================================================
-- Experience bullet points: optional evidence photos (2026-10-12)
-- ----------------------------------------------------------------------------
-- HOW TO USE
--   1. Run supabase/schema.sql and
--      supabase/migrations/20261011130000_experience_education.sql first —
--      this file only adds to the existing public.experience table.
--   2. Paste the whole file into Supabase → SQL Editor → Run.
--      Expected result: "Success. No rows returned."
--   There is NOTHING to find & replace in this file: it adds no policies and
--   needs no admin UUID.
--
-- What it does
--   * Adds the nullable column  public.experience.bullet_items  (jsonb).
--     Each element is one bullet point:
--
--       { "id": "b-1a2b3c4d",
--         "text": "Help produce Cyber Talk.",
--         "photos": [ { "url": "https://…/images/uuid.jpg",
--                       "caption": "optional" } ] }
--
--     The photos belong to the bullet OBJECT, so reordering a bullet in the
--     admin panel moves its photos with it.
--   * Adds a CHECK constraint (via the immutable helper function
--     public.experience_bullet_items_valid) that mirrors the admin form limits.
--
-- What it does NOT do
--   * It does not touch the existing  bullets  column: that stays the source of
--     truth for every row that has not been edited since. The admin panel keeps
--     writing BOTH columns on save, so anything reading only `bullets` still works.
--   * It does not seed, convert or overwrite a single existing row.
--     bullet_items stays NULL until you press Save on that entry in the admin
--     panel. NULL means "read the legacy bullets", an empty array [] means
--     "this entry has no bullet points on purpose".
--   * It changes no RLS policy, no grant and no storage rule. Evidence photos
--     reuse the existing "portfolio-assets" bucket (images/ folder, no SVG), so
--     the policies from schema.sql already cover them. The column is covered by
--     the table-level grants from 20261011130000_experience_education.sql.
--
-- Safe to run again: one transaction, ADD COLUMN IF NOT EXISTS, the helper
-- function is CREATE OR REPLACE and the constraint is dropped before it is added.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The column (nullable on purpose — see above)
-- ---------------------------------------------------------------------------
alter table public.experience
  add column if not exists bullet_items jsonb;

comment on column public.experience.bullet_items is
  'Bullet points with optional evidence photos: [{ id, text, photos:[{ url, caption }] }]. '
  'NULL = fall back to the legacy "bullets" string array; [] = intentionally no bullet points. '
  'Written together with "bullets" by the admin panel on save.';


-- ---------------------------------------------------------------------------
-- 2. Structure validation
--    A CHECK constraint cannot contain a sub-select, so the shape is validated
--    by this immutable helper. Limits mirror LIMITS.experience in admin.js and
--    the existing "bullets" constraint (max 8 items, 300 characters per line).
-- ---------------------------------------------------------------------------
create or replace function public.experience_bullet_items_valid(items jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  -- Written as nested CASE expressions on purpose: PostgreSQL does not promise that
  -- AND / OR short-circuit, so the type of a value is always settled BEFORE a function
  -- that would raise on the wrong type (jsonb_object_keys, jsonb_array_length) is used.
  -- Every predicate is coalesce()d, so a missing key means "invalid", never NULL.
  select jsonb_typeof(items) = 'array'
     and jsonb_array_length(items) <= 8
     and octet_length(items::text) <= 20000
     and not exists (
       select 1
       from jsonb_array_elements(items) as item
       where not coalesce(
         case
           when jsonb_typeof(item) <> 'object' then false
           else
             -- the bullet itself: { id, text, photos? } and nothing else
                 (select count(*) from jsonb_object_keys(item) as key_name
                   where key_name not in ('id', 'text', 'photos')) = 0
             and coalesce(jsonb_typeof(item -> 'id'), '') = 'string'
             and char_length(item ->> 'id') between 1 and 64
             and (item ->> 'id') ~ '^[A-Za-z0-9_-]+$'
             and coalesce(jsonb_typeof(item -> 'text'), '') = 'string'
             and char_length(item ->> 'text') between 1 and 300
             -- photos: the key may be absent; when present it must be an array of <= 4
             and case
                   when item -> 'photos' is null then true
                   when jsonb_typeof(item -> 'photos') <> 'array' then false
                   else jsonb_array_length(item -> 'photos') <= 4
                    and not exists (
                      select 1
                      from jsonb_array_elements(item -> 'photos') as photo
                      where not coalesce(
                        case
                          when jsonb_typeof(photo) <> 'object' then false
                          else
                            -- each photo: { url, caption? }, https only,
                            -- same caps as the other url / text columns
                                (select count(*) from jsonb_object_keys(photo) as key_name
                                  where key_name not in ('url', 'caption')) = 0
                            and coalesce(jsonb_typeof(photo -> 'url'), '') = 'string'
                            and char_length(photo ->> 'url') <= 500
                            and (photo ->> 'url') ~ '^https://[^[:space:]<>"''`]+$'
                            and coalesce(jsonb_typeof(photo -> 'caption'), 'string') = 'string'
                            and char_length(coalesce(photo ->> 'caption', '')) <= 160
                        end, false)
                    )
                 end
         end, false)
     );
$fn$;

comment on function public.experience_bullet_items_valid(jsonb) is
  'Server-side backstop for public.experience.bullet_items (see the CHECK constraint '
  'experience_bullet_items_shape). Mirrors the admin form limits.';

-- Idempotent: drop first, so re-running the file always leaves exactly one constraint.
alter table public.experience
  drop constraint if exists experience_bullet_items_shape;

alter table public.experience
  add constraint experience_bullet_items_shape
  check (bullet_items is null or public.experience_bullet_items_valid(bullet_items));

commit;

-- Check (optional):
-- select id, organization, bullets, bullet_items from public.experience order by sort_order;
--
-- Expected after this file has run and BEFORE you edit anything in the admin panel:
--   bullets      → unchanged
--   bullet_items → NULL on every row
--
-- Rejected by the constraint (try it if you like — it must fail):
-- update public.experience set bullet_items = '[{"text":"no id"}]'::jsonb where id = 1;
-- update public.experience set bullet_items = '[{"id":"b-1","text":"x","photos":[{"url":"http://x.test/a.png"}]}]'::jsonb where id = 1;
