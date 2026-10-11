-- ============================================================================
-- Portfolio — seed data (run AFTER schema.sql, in Supabase → SQL Editor)
-- ----------------------------------------------------------------------------
-- Content comes from portfolio-content.md / projects.json / skills.json.
-- All file URL fields are left NULL — upload files later in the admin panel.
--
-- Safe to re-run: each table is only seeded while it is still empty, so it will
-- never duplicate rows or overwrite edits you made in the admin panel.
-- Text uses $$ … $$ quoting so apostrophes need no escaping.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- profile (single row, id = 1)
-- In the tagline, *word* marks the word shown with the animated gradient.
-- about_text: paragraphs separated by a blank line; the first is the lead.
-- ---------------------------------------------------------------------------
insert into public.profile
  (id, name, tagline, subtagline, about_text, stats, email, linkedin, github, photo_url, cv_url)
values (
  1,
  $$Andhika Permana Sagiyono$$,
  $$Understanding systems. Designing with *security* in mind.$$,
  $$Cyber Security student at BINUS University, open to Cyber Security and Software Engineering internships.$$,
  $$I'm Andhika Permana Sagiyono, a Cyber Security student at BINUS University with an interest in software engineering. I study how systems are designed and how identity, sessions, and application flows affect security.

My academic team projects cover e-commerce threat modeling and a pet transportation web application prototype. My contributions include cash-on-delivery threat analysis, conclusions and recommendations, CRC cards, application flow design, and use case diagrams.

Outside coursework, I help produce Cyber Talk as a Media and Publication Activist at BINUS Cyber Security Community. I'm seeking a Cyber Security or Software Engineering internship to build practical skills with a team.$$,
  $$[
    {"label": "GPA", "value": "3.44", "suffix": "/ 4.00"},
    {"label": "Academic team projects", "value": "2"},
    {"label": "Certification", "value": "1"},
    {"label": "University study started", "value": "2024"}
  ]$$::jsonb,
  $$andhikapermanasagiyono@gmail.com$$,
  $$https://www.linkedin.com/in/andhikapermanasagiyono$$,
  $$https://github.com/APermanaS$$,
  null,
  null
)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- skills
-- ---------------------------------------------------------------------------
-- Levels are NULL (set them in the admin panel); icon_url is NULL — the site
-- shows built-in icons matched by name until an icon is uploaded.
-- Existing databases: run supabase/migrations/20261011120000_skills_update.sql.
insert into public.skills (category, name, level, icon_url, sort_order, is_visible)
select v.category, v.name, null, null, v.sort_order, true
from (values
  ($$Security$$,        $$OWASP$$,                   1),
  ($$Security$$,        $$STRIDE$$,                  2),
  ($$Security$$,        $$Wireshark$$,               3),
  ($$Security$$,        $$Burp Suite$$,              4),

  ($$Web Development$$, $$HTML$$,                    1),
  ($$Web Development$$, $$CSS$$,                     2),
  ($$Web Development$$, $$JavaScript$$,              3),
  ($$Web Development$$, $$PHP$$,                     4),
  ($$Web Development$$, $$Core Application Design$$, 5)
) as v(category, name, sort_order)
where not exists (select 1 from public.skills);


-- ---------------------------------------------------------------------------
-- projects
-- detail_desc: the first paragraph is the "Detailed description". A paragraph
-- whose first line ends with ":" becomes its own titled block in the modal;
-- text containing "→" is shown as flow chips.
-- ---------------------------------------------------------------------------
insert into public.projects
  (title, category, short_desc, detail_desc, role, tools, result, period,
   repo_url, image_url, doc_url, sort_order, is_visible)
select v.title, v.category, v.short_desc, v.detail_desc, v.role, v.tools, v.result, v.period,
       v.repo_url, null, null, v.sort_order, true
from (values
  (
    $$Pet Butler — Pet Transportation Web Application$$,
    $$code$$,
    $$An academic team prototype for pet transport bookings, pet profiles, and medical records.$$,
    $$Our five-member team developed a pet transportation web application prototype with Customer, Admin, and Driver roles. The documented design covers accounts, pet profiles, service booking, delivery status, order history, and payment. I developed CRC cards, designed the core application flow, and contributed to use case diagrams and supporting models. The application code and Flask, SQLAlchemy, MySQL, and Docker Compose stack are the team's work.

Context:
Academic group project; five-member team

Core booking flow:
Login → Pet profile → Booking → Checkout → Order history.$$,
    $$CRC-card development, core application flow design, and contributions to use case diagrams and supporting models.$$,
    $$CRC cards, use case diagrams, and GitHub workflow. Team application stack: Flask, SQLAlchemy, MySQL, and Docker Compose.$$,
    $$My contributions produced CRC cards and a defined booking flow for the academic prototype, alongside use case and model contributions. My learning focus was CRC modeling, application flow, and GitHub collaboration.$$,
    $$March–June 2026$$,
    $$https://github.com/cosmicus0/petButtler$$,
    1
  ),
  (
    $$Software Security Threat Modeling Report — E-commerce$$,
    $$document$$,
    $$An academic group report assessing five e-commerce features through DFD-based STRIDE analysis, with OWASP references.$$,
    $$Our team assessed payment, search, promotions, login and registration, and cash on delivery, considering trade-offs between proposed mitigations. I handled the cash-on-delivery analysis and wrote Chapter 6, covering conclusions and recommendations. My analysis connected fake accounts, shared-device sessions, and weak logging to identity verification, session controls, and transaction audit logs. On 3 June 2026, the team also demonstrated SQL injection and authentication bypass using Burp Suite in an OWASP Juice Shop training lab.

Context:
Academic group project

Scope:
The mitigations were analytical recommendations. The Juice Shop exercise was a training lab, not a live platform assessment.$$,
    $$Cash-on-delivery threat analysis and the conclusions and recommendations chapter.$$,
    $$Data flow diagrams, STRIDE, and OWASP references. Team training lab: OWASP Juice Shop and Burp Suite.$$,
    $$The report documents COD recommendations for OTP verification, device fingerprinting, auto-logout, primary-device confirmation, and IP, time, and device audit logs with OTP confirmation. My takeaway was that transaction traceability depends on identity, session controls, and logs.$$,
    $$2025–2026$$,
    null,
    2
  )
) as v(title, category, short_desc, detail_desc, role, tools, result, period, repo_url, sort_order)
where not exists (select 1 from public.projects);


-- ---------------------------------------------------------------------------
-- certificates
-- ---------------------------------------------------------------------------
insert into public.certificates (title, issuer, issued_date, image_url, sort_order, is_visible)
select $$ISO/IEC 27001:2022 Information Security Associate$$, $$SkillFront$$, date '2026-09-25', null, 1, true
where not exists (select 1 from public.certificates);

commit;
