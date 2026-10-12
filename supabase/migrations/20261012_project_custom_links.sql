-- ============================================================================
-- Projects: additional custom links (2026-10-12)
-- ----------------------------------------------------------------------------
-- HOW TO USE
--   1. Run supabase/schema.sql first (it creates public.projects).
--   2. Paste the whole file into Supabase → SQL Editor → Run.
--      Expected result: "Success. No rows returned."
--   There is NOTHING to find & replace in this file: it adds no policies and
--   needs no admin UUID.
--
-- What it does
--   * Adds the column  public.projects.external_links  (jsonb, NOT NULL,
--     default '[]'). Each element is one link, shown in this order under
--     "Additional links" in the project details:
--
--       { "id": "l-1a2b3c4d5e",
--         "label": "the text visitors click",
--         "url": "https://…",
--         "description": "optional, short" }
--
--   * Adds a CHECK constraint (via the immutable helper function
--     public.project_external_links_valid) that mirrors the admin form limits:
--     at most 8 links, unique ids, label 1–60 characters, https:// URL up to
--     500 characters, optional description up to 160 characters, no other keys.
--
-- What it does NOT do
--   * It does not touch repo_url or doc_url: the repository and supporting
--     document links stay exactly as they are, in their own columns.
--   * It does not seed, convert, update or rewrite a single existing row.
--     Existing projects simply read as external_links = [] (no additional
--     links). PostgreSQL 11+ stores a constant default without rewriting the
--     table, so the saved values of every row are left alone.
--   * It changes no RLS policy, no grant and no storage rule. The new column is
--     covered by the existing table-level grants from schema.sql, and the
--     existing "projects:" policies keep deciding who may read or write rows.
--
-- Safe to run again: one transaction, ADD COLUMN IF NOT EXISTS, the helper
-- function is CREATE OR REPLACE and the constraint is dropped before it is added.
-- (schema.sql contains the same function and column for new installations, so
-- running this file after a fresh schema.sql is a harmless no-op.)
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Structure validation
--    A CHECK constraint cannot contain a sub-select, so the shape is validated
--    by this immutable helper. Limits mirror LIMITS in project-links.js.
--    Keep this function identical to the copy in supabase/schema.sql
--    (tests/static-checks.test.mjs compares them).
-- ---------------------------------------------------------------------------
create or replace function public.project_external_links_valid(links jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  -- Nested CASE expressions on purpose: PostgreSQL does not promise that AND / OR
  -- short-circuit, so the type of a value is always settled BEFORE a function that
  -- would raise on the wrong type (jsonb_array_length, jsonb_array_elements,
  -- jsonb_object_keys) is used. Every predicate is coalesce()d, so a missing key
  -- means "invalid", never NULL (a NULL CHECK result would count as a pass).
  select case
    when links is null or jsonb_typeof(links) <> 'array' then false
    else
          jsonb_array_length(links) <= 8
      and octet_length(links::text) <= 32000
      -- every link has its own id
      and (select count(distinct link ->> 'id') from jsonb_array_elements(links) as link)
          = jsonb_array_length(links)
      and not exists (
        select 1
        from jsonb_array_elements(links) as link
        where not coalesce(
          case
            when jsonb_typeof(link) <> 'object' then false
            else
              -- { id, label, url, description? } and nothing else
                  (select count(*) from jsonb_object_keys(link) as key_name
                    where key_name not in ('id', 'label', 'url', 'description')) = 0
              and coalesce(jsonb_typeof(link -> 'id'), '') = 'string'
              and char_length(link ->> 'id') between 1 and 64
              and (link ->> 'id') ~ '^[A-Za-z0-9_-]+$'
              and coalesce(jsonb_typeof(link -> 'label'), '') = 'string'
              and char_length(link ->> 'label') between 1 and 60
              and (link ->> 'label') ~ '[^[:space:]]'
              -- https only (javascript:, data:, http: … are refused), same caps as the other url columns
              and coalesce(jsonb_typeof(link -> 'url'), '') = 'string'
              and char_length(link ->> 'url') <= 500
              and (link ->> 'url') ~ '^https://[^[:space:]<>"''`]+$'
              and coalesce(jsonb_typeof(link -> 'description'), 'string') = 'string'
              and char_length(coalesce(link ->> 'description', '')) <= 160
          end, false)
      )
  end;
$fn$;

comment on function public.project_external_links_valid(jsonb) is
  'Server-side backstop for public.projects.external_links (see the CHECK constraint '
  'projects_external_links_shape). Mirrors the admin form limits in project-links.js.';


-- ---------------------------------------------------------------------------
-- 2. The column (additive; existing rows read as [])
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists external_links jsonb not null default '[]'::jsonb;

comment on column public.projects.external_links is
  'Additional project links, in display order: [{ id, label, url, description? }]. '
  'https:// only. [] = no additional links. repo_url and doc_url are separate columns.';

-- Idempotent: drop first, so re-running the file always leaves exactly one constraint.
alter table public.projects
  drop constraint if exists projects_external_links_shape;

alter table public.projects
  add constraint projects_external_links_shape
  check (public.project_external_links_valid(external_links));

commit;

-- Check (optional):
-- select id, title, repo_url, doc_url, external_links from public.projects order by sort_order;
--
-- Expected after this file has run and BEFORE you edit anything in the admin panel:
--   repo_url, doc_url → unchanged
--   external_links    → [] on every row
--
-- Rejected by the constraint (try it if you like — each one must fail):
-- update public.projects set external_links = '[{"label":"No id","url":"https://example.com"}]'::jsonb where id = 1;
-- update public.projects set external_links = '[{"id":"l-1","label":"x","url":"javascript:alert(1)"}]'::jsonb where id = 1;
-- update public.projects set external_links = '[{"id":"l-1","label":"x","url":"http://example.com"}]'::jsonb where id = 1;
