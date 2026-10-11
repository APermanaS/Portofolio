Design Rules

Style: Apple-like minimalism, black \& white base, color only as accent

Font: Inter. Sections alternate black / white

Accent gradient: #0a84ff, #bf5af2, #ff375f, #ff9f0a

Skills: ONE compact section (two-tone headline), categories side by side as

rounded cards, each with its own accent color, ornament (.ornament layer) and a

compact icon tile grid. Data comes from the Supabase "skills" table; category

keys/accents and the offline fallback live in data.json



Never invent content. Hide anything marked \[ISI MANUAL]

One change per prompt. Do not touch unrelated sections.

Keep decorations lightweight (CSS/SVG only) and respect prefers-reduced-motion

Content is managed in admin.html (Supabase). Render database text with textContent only.

Missing files show a placeholder ("Document coming soon", image placeholder), never a broken layout.

Change Log

(isi tiap revisi: tanggal, section, perubahan)

- 2026-10-10 · Data / Admin · Added Supabase admin mode. supabase/schema.sql (tables, RLS on every table,
  explicit grants, "portfolio-assets" storage bucket without SVG) and supabase/seed.sql (current content).
  script.js now loads profile, skills, projects and certificates from Supabase (supabase-js 2.116.0 via CDN,
  config.js = URL + public anon key), with data.json as the fallback. File placeholders: "CV coming soon",
  "Document coming soon", "Image coming soon". New admin.html / admin.js / admin.css (login, Profile, Skills,
  Projects, Certificates, Files, uploads with preview and progress). Certificates are rendered from data
  (#cert-root). Visual design unchanged; small additions in style.css §16b for the "coming soon" states.
  projects.json and skills.json are no longer read by the site (data.json replaces them).
- 2026-10-11 · Hero · Replaced the horizon glow (.hero__glow) with an animated meteor shower on pure black:
  new hero-meteors.js (single 2D canvas .hero__meteors, aria-hidden, CONFIG object at the top for colours,
  counts, angle, speeds). Diagonal streaks at ~37° in #0a84ff / #64d2ff / #bf5af2 with bright heads, depth
  parallax, tiny twinkling stars. Pauses when the tab is hidden or hero is offscreen; DPR capped at 2;
  prefers-reduced-motion draws one static frame. Readability: .hero__vignette radial overlay, streaks dimmed
  behind the text, soft shadow on .hero__sub. Static CSS gradient on .hero when canvas/JS is unavailable.
  Exception to "CSS/SVG only" decorations: canvas explicitly requested for this effect. Headline unchanged.
- 2026-10-11 · Skills · Replaced the tall full-width sub-section per category with ONE compact section:
  two-tone headline ("Skills, *in practice.* Understanding systems, one layer at a time."), then category
  cards side by side (≥1024px: 2–3 per row by count; 734–1023px: 2 columns; <734px: scroll-snap carousel
  with a peek of the next card and dot indicators). Each 24px-radius card keeps its accent colour (data.json
  skill_categories[].accent; new categories get the next free colour automatically), its .ornament (sized
  for the card; generic rings for new categories) and holds compact tiles (icon + name + level only when set).
  Empty or fully hidden categories get no card. Hover: accent border + glow. Icons: uploaded icon_url first,
  then built-in by skill name (existing assets/icons SVGs; new original line glyphs for OWASP = checklist,
  STRIDE = six-segment shield, Core Application Design = connected blocks), then a monogram.
  Data: Security = OWASP, STRIDE, Wireshark, Burp Suite; Web Development = HTML, CSS, JavaScript, PHP,
  Core Application Design; all level NULL, icon_url NULL, visible. data.json and seed.sql updated; existing
  databases use supabase/migrations/20261011120000_skills_update.sql (idempotent, data only, hides the old
  seeded skills instead of deleting them). Admin Skills page: category stays free text with de-duplicated
  suggestions, matched case-insensitively (a new name = a new card); updated hints.
