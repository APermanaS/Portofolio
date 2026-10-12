-- ============================================================================
-- Experience, Education & Certifications (2026-10-11)
-- ----------------------------------------------------------------------------
-- HOW TO USE
--   1. Run supabase/schema.sql (and seed.sql) first — this file builds on them.
--   2. Find & Replace every  ADMIN_UUID_HERE  with your admin user's UUID
--      (Authentication → Users → your user → "User UID").
--   3. Paste the whole file into Supabase → SQL Editor → Run.
--      Expected result: "Success. No rows returned."
--
-- What it does
--   * New tables  public.experience  and  public.education
--     (RLS enabled, explicit grants, policies like schema.sql).
--   * public.certificates gets  expiry_date  and  credential_url.
--   * public.profile gets  hidden_sections  (Admin → Sections switches) and
--     cv_file_name / cv_uploaded_at (shown next to the CV upload).
--   * Seeds the new tables ONLY while they are empty (content from
--     portfolio-content.md), and the ISO/IEC 27001 certificate only if the
--     certificates table is empty.
--   * Storage: the existing "portfolio-assets" bucket and its policies are
--     reused unchanged (logos and certificate images go to images/).
--
-- Safe to run again: one transaction, CREATE TABLE / ADD COLUMN IF NOT EXISTS,
-- policies are dropped and recreated, seeds never duplicate rows or overwrite
-- edits made in the admin panel.
--
-- Security model (same as schema.sql)
--   * "Automatically expose new tables" is DISABLED in this project, so the
--     API roles get explicit GRANTs below. Grants make a table reachable;
--     RLS policies decide which rows each role may read or change.
--   * anon (visitors) gets SELECT only and only sees rows with is_visible = true.
--   * Only the admin UUID may INSERT / UPDATE / DELETE (and read hidden rows,
--     which the admin panel needs to list them).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Guard: stop immediately if the admin UUID placeholder was not replaced.
--    (The comparison string is split in two so Find & Replace does not touch it.)
-- ---------------------------------------------------------------------------
do $guard$
begin
  if 'ADMIN_UUID_HERE' = 'ADMIN' || '_UUID_HERE' then
    raise exception '20261011130000_experience_education.sql: replace the admin UUID placeholder with your real admin user UUID before running.';
  end if;
  perform 'ADMIN_UUID_HERE'::uuid;  -- fails loudly if the value is not a valid UUID
end
$guard$;


-- ---------------------------------------------------------------------------
-- 1. New tables
--    CHECK constraints mirror the admin form limits (server-side backstop).
--    Dates are stored as the 1st of the month; show_months = false shows
--    years only (e.g. "2021 – 2024").
-- ---------------------------------------------------------------------------
create table if not exists public.experience (
  id           bigint generated always as identity primary key,
  organization text not null check (char_length(organization) between 1 and 150),
  role         text check (char_length(role) <= 150),
  location     text check (char_length(location) <= 120),
  start_date   date,
  end_date     date,
  is_current   boolean not null default false,
  show_months  boolean not null default true,
  -- Plain bullet text. Still written on every save. The richer bullet_items
  -- column (bullet text + optional evidence photos) is added afterwards by
  -- supabase/migrations/20261012_experience_bullet_photos.sql — run that file too.
  bullets      jsonb not null default '[]'::jsonb
               check (case when jsonb_typeof(bullets) = 'array'
                           then jsonb_array_length(bullets) <= 8 and octet_length(bullets::text) <= 4000
                           else false end),
  logo_url     text check (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~ '^https://[^[:space:]<>"''`]+$')),
  sort_order   integer not null default 0 check (sort_order between 0 and 100000),
  is_visible   boolean not null default true,
  constraint experience_dates_order check (start_date is null or end_date is null or end_date >= start_date),
  constraint experience_current_no_end check (not is_current or end_date is null)
);

create table if not exists public.education (
  id             bigint generated always as identity primary key,
  institution    text not null check (char_length(institution) between 1 and 150),
  degree         text check (char_length(degree) <= 150),
  field_of_study text check (char_length(field_of_study) <= 150),
  start_date     date,
  end_date       date,
  end_label      text check (char_length(end_label) <= 60),
  gpa            text check (char_length(gpa) <= 30),
  description    text check (char_length(description) <= 1000),
  logo_url       text check (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~ '^https://[^[:space:]<>"''`]+$')),
  show_months    boolean not null default true,
  sort_order     integer not null default 0 check (sort_order between 0 and 100000),
  is_visible     boolean not null default true,
  constraint education_dates_order check (start_date is null or end_date is null or end_date >= start_date)
);

create index if not exists experience_order_idx on public.experience (sort_order, start_date desc);
create index if not exists education_order_idx  on public.education  (sort_order, start_date desc);


-- ---------------------------------------------------------------------------
-- 2. New columns on existing tables
-- ---------------------------------------------------------------------------
alter table public.certificates
  add column if not exists expiry_date date;
alter table public.certificates
  add column if not exists credential_url text
  check (credential_url is null or (char_length(credential_url) <= 500 and credential_url ~ '^https://[^[:space:]<>"''`]+$'));

-- Sections hidden with Admin → Sections (a section not listed is shown).
alter table public.profile
  add column if not exists hidden_sections text[] not null default '{}'::text[]
  check (hidden_sections <@ array['skills', 'experience', 'projects', 'education', 'certifications']::text[]);
-- Original name + upload time of the current CV (the stored file has a random name).
alter table public.profile
  add column if not exists cv_file_name text check (char_length(cv_file_name) <= 255);
alter table public.profile
  add column if not exists cv_uploaded_at timestamptz;


-- ---------------------------------------------------------------------------
-- 3. Row Level Security — enabled on every new table (deny-by-default).
-- ---------------------------------------------------------------------------
alter table public.experience enable row level security;
alter table public.education  enable row level security;


-- ---------------------------------------------------------------------------
-- 4. Policies
--    Public read : visible rows only.
--    Admin read  : the admin also sees hidden rows (needed by the admin panel).
--    Admin write : INSERT / UPDATE / DELETE only when auth.uid() is the admin.
-- ---------------------------------------------------------------------------

-- experience
drop policy if exists "experience: public read visible" on public.experience;
drop policy if exists "experience: admin read all"      on public.experience;
drop policy if exists "experience: admin insert"        on public.experience;
drop policy if exists "experience: admin update"        on public.experience;
drop policy if exists "experience: admin delete"        on public.experience;

create policy "experience: public read visible" on public.experience for select to anon, authenticated
  using (is_visible = true);
create policy "experience: admin read all"      on public.experience for select to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "experience: admin insert"        on public.experience for insert to authenticated
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "experience: admin update"        on public.experience for update to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid)
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "experience: admin delete"        on public.experience for delete to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);

-- education
drop policy if exists "education: public read visible" on public.education;
drop policy if exists "education: admin read all"      on public.education;
drop policy if exists "education: admin insert"        on public.education;
drop policy if exists "education: admin update"        on public.education;
drop policy if exists "education: admin delete"        on public.education;

create policy "education: public read visible" on public.education for select to anon, authenticated
  using (is_visible = true);
create policy "education: admin read all"      on public.education for select to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "education: admin insert"        on public.education for insert to authenticated
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "education: admin update"        on public.education for update to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid)
  with check ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);
create policy "education: admin delete"        on public.education for delete to authenticated
  using ((select auth.uid()) = 'ADMIN_UUID_HERE'::uuid);


-- ---------------------------------------------------------------------------
-- 5. Grants (required because "Automatically expose new tables" is disabled)
--    The new columns on profile / certificates are covered by the existing
--    table-level grants from schema.sql.
-- ---------------------------------------------------------------------------
revoke all on table public.experience, public.education from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Read: visitors and the admin (rows limited by the policies above).
grant select on table public.experience, public.education to anon, authenticated;

-- Write: logged-in users ONLY (anon never). Policies allow only the admin UUID.
grant insert, update, delete on table public.experience, public.education to authenticated;

-- Identity ids: USAGE lets an authenticated INSERT draw the next id. anon gets nothing.
grant usage on sequence public.experience_id_seq to authenticated;
grant usage on sequence public.education_id_seq  to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Seed — only while each table is still empty (content from portfolio-content.md)
--    Dates/location for the experience entry are intentionally NULL:
--    fill them in with Admin → Experience.
-- ---------------------------------------------------------------------------
insert into public.experience
  (organization, role, location, start_date, end_date, is_current, show_months, bullets, logo_url, sort_order, is_visible)
select $$BINUS Cyber Security Community$$, $$Media and Publication Activist$$, null::text, null::date, null::date, false, true,
       jsonb_build_array($$Help produce Cyber Talk.$$::text), null::text, 1, true
where not exists (select 1 from public.experience);

insert into public.education
  (institution, degree, field_of_study, start_date, end_date, end_label, gpa, description, logo_url, show_months, sort_order, is_visible)
select v.institution, v.degree, v.field_of_study, v.start_date, v.end_date, v.end_label, v.gpa, v.description,
       null, v.show_months, v.sort_order, true
from (values
  ($$BINUS University$$, $$Bachelor's Degree in Computer Science$$, $$Cyber Security$$,
   date '2024-09-01', null::date, $$Expected 2028$$, $$3.44 / 4.00$$,
   $$Relevant coursework: Software Engineering; Software Security; and Penetration Testing$$,
   true, 1),
  -- Years only (2021–2024): stored as 1 January, shown without months.
  ($$SMAIT Auliya$$, null, null,
   date '2021-01-01', date '2024-01-01', null, null, null,
   false, 2)
) as v(institution, degree, field_of_study, start_date, end_date, end_label, gpa, description, show_months, sort_order)
where not exists (select 1 from public.education);

-- The existing certificate stays as it is; it is only inserted on an empty table.
insert into public.certificates (title, issuer, issued_date, image_url, sort_order, is_visible)
select $$ISO/IEC 27001:2022 Information Security Associate$$, $$SkillFront$$, date '2026-09-25', null, 1, true
where not exists (select 1 from public.certificates);

commit;

-- Check (optional):
-- select organization, role, start_date, end_date, is_current, bullets, is_visible from public.experience order by sort_order;
-- select institution, degree, start_date, end_date, end_label, gpa, is_visible from public.education order by sort_order;
-- select title, issuer, issued_date, expiry_date, credential_url from public.certificates order by sort_order;
