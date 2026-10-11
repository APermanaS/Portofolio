-- ============================================================================
-- Skills update (2026-10-11) — DATA ONLY, no schema changes.
-- Run once in Supabase → SQL Editor (or `supabase db push`). Touches only
-- public.skills; profile / projects / certificates are not touched.
--
--   Security:        OWASP, STRIDE, Wireshark, Burp Suite
--   Web Development: HTML, CSS, JavaScript, PHP, Core Application Design
--
-- Idempotent: running it again gives the same result and never duplicates
-- rows. Skills are matched by name (case-insensitive, trimmed):
--   • existing row  → moved to its category, level = NULL, order set, visible
--   • missing row   → inserted (level NULL, icon_url NULL, visible)
--   • duplicates of a listed name → the oldest row is kept visible, the others hidden
--   • the old seeded skills not in the list → hidden (is_visible = false), NOT deleted
-- icon_url is never changed, so an uploaded icon keeps priority.
-- Skills you added yourself in the admin panel are left alone.
--
-- NOTE: re-running it resets level, category, order and visibility of the
-- nine listed skills (e.g. levels you set later in the admin panel).
-- ============================================================================

begin;

-- 1 + 2. Update the listed skills that exist, insert the ones that are missing
with target(category, name, sort_order) as (
  values
    ($$Security$$,        $$OWASP$$,                   1),
    ($$Security$$,        $$STRIDE$$,                  2),
    ($$Security$$,        $$Wireshark$$,               3),
    ($$Security$$,        $$Burp Suite$$,              4),
    ($$Web Development$$, $$HTML$$,                    1),
    ($$Web Development$$, $$CSS$$,                     2),
    ($$Web Development$$, $$JavaScript$$,              3),
    ($$Web Development$$, $$PHP$$,                     4),
    ($$Web Development$$, $$Core Application Design$$, 5)
),
ranked as (
  select s.id,
         t.category,
         t.sort_order,
         row_number() over (partition by lower(btrim(s.name)) order by s.id) as rn
  from public.skills s
  join target t on lower(btrim(s.name)) = lower(t.name)
),
updated as (
  update public.skills s
     set category   = r.category,
         level      = null,
         sort_order = r.sort_order,
         is_visible = (r.rn = 1)
    from ranked r
   where s.id = r.id
  returning s.id
)
insert into public.skills (category, name, level, icon_url, sort_order, is_visible)
select t.category, t.name, null, null, t.sort_order, true
from target t
where not exists (
  select 1 from public.skills s where lower(btrim(s.name)) = lower(t.name)
);

-- 3. Hide (do not delete) the previously seeded skills that are not in the list
update public.skills
   set is_visible = false
 where is_visible
   and lower(btrim(name)) in (
     lower($$Threat modeling for cash-on-delivery transactions$$),
     lower($$DFD-based STRIDE analysis$$),
     lower($$Mitigation recommendations covering identity, session controls, and audit logging$$),
     lower($$OWASP Top 10$$),
     lower($$CRC-card development$$),
     lower($$Core application flow design$$),
     lower($$Contributions to use case diagrams and supporting models$$),
     lower($$Linux$$),
     lower($$Nmap$$),
     lower($$PCAP analysis$$),
     lower($$SQL$$),
     lower($$GitHub workflow$$),
     lower($$VS Code$$),
     lower($$Docker$$),
     lower($$Figma$$),
     lower($$JADX$$),
     lower($$Apktool$$),
     lower($$Ghidra$$)
   );

commit;

-- Check (optional):
-- select category, name, level, sort_order, is_visible from public.skills
-- order by is_visible desc, category, sort_order, id;
