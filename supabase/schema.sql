-- ============================================================================
-- Portfolio — Supabase schema (tables, RLS, grants, storage)
-- ----------------------------------------------------------------------------
-- HOW TO USE
--   1. Find & Replace every  ADMIN_UUID_HERE  with your admin user's UUID
--      (Authentication → Users → your user → "User UID").
--   2. Paste the whole file into Supabase → SQL Editor → Run.
--
-- The script runs in one transaction and is safe to re-run: tables are only
-- created if missing, policies are dropped and recreated.
--
-- Security model
--   * Row Level Security is enabled on EVERY table. RLS policies are the real
--     gatekeeper: anyone may read visible rows; only the admin UUID may write.
--   * This project has "Automatically expose new tables" DISABLED, so the API
--     roles (anon, authenticated) cannot reach new tables until we GRANT
--     privileges explicitly. Grants make a table reachable; policies decide
--     which rows each role may actually see or change.
--   * anon (= visitors using the public anon key) gets SELECT only, never
--     INSERT/UPDATE/DELETE.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Guard: stop immediately if the admin UUID placeholder was not replaced.
--    (The comparison string is split in two so Find & Replace does not touch it.)
-- ---------------------------------------------------------------------------
do $guard$
begin
  if 'ADMIN_UUID_HERE' = 'ADMIN' || '_UUID_HERE' then
    raise exception 'schema.sql: replace the admin UUID placeholder with your real admin user UUID before running.';
  end if;
  perform 'ADMIN_UUID_HERE'::uuid;  -- fails loudly if the value is not a valid UUID
end
$guard$;


-- ---------------------------------------------------------------------------
-- 1. Tables
--    CHECK constraints are a server-side backstop for the admin form limits:
--    length caps, https-only URLs, simple e-mail shape, known categories.
-- ---------------------------------------------------------------------------

-- Single-row table: id is pinned to 1, so a second row can never be created.
create table if not exists public.profile (
  id          smallint primary key default 1 check (id = 1),
  name        text not null check (char_length(name) between 1 and 120),
  tagline     text check (char_length(tagline) <= 160),
  subtagline  text check (char_length(subtagline) <= 300),
  about_text  text check (char_length(about_text) <= 4000),
  stats       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(stats) = 'array' and jsonb_array_length(stats) <= 8),
  email       text check (email is null or (char_length(email) <= 254
                          and email ~ '^[^[:space:]@<>"]+@[^[:space:]@<>"]+\.[^[:space:]@<>"]+$')),
  linkedin    text check (linkedin is null or (char_length(linkedin) <= 300 and linkedin ~ '^https://[^[:space:]<>"''`]+$')),
  github      text check (github   is null or (char_length(github)   <= 300 and github   ~ '^https://[^[:space:]<>"''`]+$')),
  photo_url   text check (photo_url is null or (char_length(photo_url) <= 500 and photo_url ~ '^https://[^[:space:]<>"''`]+$')),
  cv_url      text check (cv_url    is null or (char_length(cv_url)    <= 500 and cv_url    ~ '^https://[^[:space:]<>"''`]+$'))
);

create table if not exists public.skills (
  id          bigint generated always as identity primary key,
  category    text not null check (char_length(category) between 1 and 60),
  name        text not null check (char_length(name) between 1 and 120),
  level       text check (char_length(level) <= 40),
  icon_url    text check (icon_url is null or (char_length(icon_url) <= 500 and icon_url ~ '^https://[^[:space:]<>"''`]+$')),
  sort_order  integer not null default 0 check (sort_order between 0 and 100000),
  is_visible  boolean not null default true
);

create table if not exists public.projects (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) between 1 and 150),
  category    text not null check (category in ('code', 'document')),
  short_desc  text check (char_length(short_desc) <= 300),
  detail_desc text check (char_length(detail_desc) <= 6000),
  role        text check (char_length(role) <= 1500),
  tools       text check (char_length(tools) <= 1500),
  result      text check (char_length(result) <= 2000),
  period      text check (char_length(period) <= 60),
  repo_url    text check (repo_url  is null or (char_length(repo_url)  <= 300 and repo_url  ~ '^https://[^[:space:]<>"''`]+$')),
  image_url   text check (image_url is null or (char_length(image_url) <= 500 and image_url ~ '^https://[^[:space:]<>"''`]+$')),
  doc_url     text check (doc_url   is null or (char_length(doc_url)   <= 500 and doc_url   ~ '^https://[^[:space:]<>"''`]+$')),
  sort_order  integer not null default 0 check (sort_order between 0 and 100000),
  is_visible  boolean not null default true
);

create table if not exists public.certificates (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) between 1 and 200),
  issuer      text check (char_length(issuer) <= 120),
  issued_date date,
  image_url   text check (image_url is null or (char_length(image_url) <= 500 and image_url ~ '^https://[^[:space:]<>"''`]+$')),
  sort_order  integer not null default 0 check (sort_order between 0 and 100000),
  is_visible  boolean not null default true
);

create index if not exists skills_order_idx       on public.skills (category, sort_order);
create index if not exists projects_order_idx     on public.projects (sort_order);
create index if not exists certificates_order_idx on public.certificates (sort_order);


-- ---------------------------------------------------------------------------
-- 2. Row Level Security — enabled on every table (deny-by-default).
-- ---------------------------------------------------------------------------
alter table public.profile      enable row level security;
alter table public.skills       enable row level security;
alter table public.projects     enable row level security;
alter table public.certificates enable row level security;


-- ---------------------------------------------------------------------------
-- 3. Policies
--    Public read : visible rows only (profile has no is_visible → whole row).
--    Admin read  : the admin also sees hidden rows (needed by the admin panel).
--    Admin write : INSERT / UPDATE / DELETE only when auth.uid() is the admin.
--    (select auth.uid()) is the form Supabase recommends: evaluated once per query.
-- ---------------------------------------------------------------------------

-- profile
drop policy if exists "profile: public read"  on public.profile;
drop policy if exists "profile: admin insert" on public.profile;
drop policy if exists "profile: admin update" on public.profile;
drop policy if exists "profile: admin delete" on public.profile;

create policy "profile: public read"  on public.profile for select to anon, authenticated
  using (true);
create policy "profile: admin insert" on public.profile for insert to authenticated
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "profile: admin update" on public.profile for update to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid)
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "profile: admin delete" on public.profile for delete to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);

-- skills
drop policy if exists "skills: public read visible" on public.skills;
drop policy if exists "skills: admin read all"      on public.skills;
drop policy if exists "skills: admin insert"        on public.skills;
drop policy if exists "skills: admin update"        on public.skills;
drop policy if exists "skills: admin delete"        on public.skills;

create policy "skills: public read visible" on public.skills for select to anon, authenticated
  using (is_visible = true);
create policy "skills: admin read all"      on public.skills for select to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "skills: admin insert"        on public.skills for insert to authenticated
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "skills: admin update"        on public.skills for update to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid)
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "skills: admin delete"        on public.skills for delete to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);

-- projects
drop policy if exists "projects: public read visible" on public.projects;
drop policy if exists "projects: admin read all"      on public.projects;
drop policy if exists "projects: admin insert"        on public.projects;
drop policy if exists "projects: admin update"        on public.projects;
drop policy if exists "projects: admin delete"        on public.projects;

create policy "projects: public read visible" on public.projects for select to anon, authenticated
  using (is_visible = true);
create policy "projects: admin read all"      on public.projects for select to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "projects: admin insert"        on public.projects for insert to authenticated
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "projects: admin update"        on public.projects for update to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid)
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "projects: admin delete"        on public.projects for delete to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);

-- certificates
drop policy if exists "certificates: public read visible" on public.certificates;
drop policy if exists "certificates: admin read all"      on public.certificates;
drop policy if exists "certificates: admin insert"        on public.certificates;
drop policy if exists "certificates: admin update"        on public.certificates;
drop policy if exists "certificates: admin delete"        on public.certificates;

create policy "certificates: public read visible" on public.certificates for select to anon, authenticated
  using (is_visible = true);
create policy "certificates: admin read all"      on public.certificates for select to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "certificates: admin insert"        on public.certificates for insert to authenticated
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "certificates: admin update"        on public.certificates for update to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid)
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "certificates: admin delete"        on public.certificates for delete to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);


-- ---------------------------------------------------------------------------
-- 4. Grants (required because "Automatically expose new tables" is disabled)
--    Grants only make the tables reachable through the Data API.
--    RLS policies above still decide which rows can be read or changed.
-- ---------------------------------------------------------------------------

-- Start from a clean slate so no unexpected privilege lingers from earlier runs.
revoke all on table public.profile, public.skills, public.projects, public.certificates
  from anon, authenticated;

-- Lets the API roles resolve objects inside the public schema at all.
-- Without USAGE, every request fails with "permission denied for schema public".
grant usage on schema public to anon, authenticated;

-- Read access for visitors (anon) and the logged-in admin (authenticated).
-- Which rows are returned is limited by the "public read visible" / "admin read all" policies.
grant select on table public.profile, public.skills, public.projects, public.certificates
  to anon, authenticated;

-- Write access for logged-in users ONLY. anon never receives INSERT/UPDATE/DELETE.
-- Even for authenticated users, the policies only allow the admin UUID to write.
grant insert, update, delete on table public.profile, public.skills, public.projects, public.certificates
  to authenticated;

-- skills / projects / certificates use identity ids backed by these sequences.
-- USAGE lets an authenticated INSERT draw the next id. anon gets nothing here.
-- (profile uses a fixed id = 1 and has no sequence.)
grant usage on sequence public.skills_id_seq       to authenticated;
grant usage on sequence public.projects_id_seq     to authenticated;
grant usage on sequence public.certificates_id_seq to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Storage bucket "portfolio-assets"
--    * public = true      → files are readable via their public URL (no listing).
--    * file_size_limit    → hard server-side cap of 10 MB (the PDF limit).
--                           The 5 MB image limit is enforced by the admin panel;
--                           a bucket can only hold one size limit.
--    * allowed_mime_types → jpeg, png, webp, pdf only. SVG is NOT allowed
--                           (an SVG can carry scripts → stored XSS).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portfolio-assets',
  'portfolio-assets',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies (RLS on storage.objects is managed and already enabled by Supabase).
--   * No public SELECT policy: public URLs work for a public bucket without one,
--     and omitting it stops anonymous visitors from LISTING the bucket.
--   * Admin may list (Files page), upload, replace and delete.
--   * Uploads must go to images/ (jpg, jpeg, png, webp) or docs/ (pdf).
drop policy if exists "portfolio-assets: admin read"   on storage.objects;
drop policy if exists "portfolio-assets: admin insert" on storage.objects;
drop policy if exists "portfolio-assets: admin update" on storage.objects;
drop policy if exists "portfolio-assets: admin delete" on storage.objects;

create policy "portfolio-assets: admin read" on storage.objects for select to authenticated
  using (
    bucket_id = 'portfolio-assets'
    and (select auth.uid()) = 'ADMIN_UUID_HERE'::uuid
  );

create policy "portfolio-assets: admin insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'portfolio-assets'
    and (select auth.uid()) = 'ADMIN_UUID_HERE'::uuid
    and (
      ((storage.foldername(name))[1] = 'images' and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp'))
      or
      ((storage.foldername(name))[1] = 'docs' and lower(storage.extension(name)) = 'pdf')
    )
  );

create policy "portfolio-assets: admin update" on storage.objects for update to authenticated
  using (
    bucket_id = 'portfolio-assets'
    and (select auth.uid()) = 'ADMIN_UUID_HERE'::uuid
  )
  with check (
    bucket_id = 'portfolio-assets'
    and (select auth.uid()) = 'ADMIN_UUID_HERE'::uuid
    and (
      ((storage.foldername(name))[1] = 'images' and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp'))
      or
      ((storage.foldername(name))[1] = 'docs' and lower(storage.extension(name)) = 'pdf')
    )
  );

create policy "portfolio-assets: admin delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'portfolio-assets'
    and (select auth.uid()) = 'ADMIN_UUID_HERE'::uuid
  );

commit;
