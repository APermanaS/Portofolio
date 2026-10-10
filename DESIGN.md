Design Rules

Style: Apple-like minimalism, black \& white base, color only as accent

Font: Inter. Sections alternate black / white

Accent gradient: #0a84ff, #bf5af2, #ff375f, #ff9f0a

Skills: one sub-section per category, each with its own accent color,

ornament (.ornament layer) and icon tile grid. Data comes from the Supabase

"skills" table; category keys/headlines and the offline fallback live in data.json



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
