Design Rules

Style: Apple-like minimalism, black \& white base, color only as accent

Font: Inter. Sections alternate black / white

Accent gradient: #0a84ff, #bf5af2, #ff375f, #ff9f0a

Skills: ONE compact section (two-tone headline), categories side by side as

rounded cards, each with its own accent color, ornament (.ornament layer) and a

compact icon tile grid. Data comes from the Supabase "skills" table; category

keys/accents and the offline fallback live in data.json



Section backgrounds: the Hero keeps its meteor canvas. Every other section carries one decorative
layer `<div class="section-gradient" aria-hidden="true">` (absolute, inset 0, z-index 0,
pointer-events none; section = position relative, overflow hidden; content above at z-index 1).
- Black sections (.section--dark) → DARK "Bloom Field" (21st.dev): #000 base, Charcoal #343432,
  Midnight #121211, Ink #000. Motion speed 0.77, amt 1.00, dir 1.
- White sections (.section--light / .section--white) → LIGHT "Pipo" (21st.dev): Paper #FAF9EF
  (backdrop #FAF8EE), Apricot #E6B093, Sky blue #A3CEFF, static grain (overlay). Speed 0.86, amt 0.72, dir 1.
- The gradient follows the section's theme class, so re-striping and new sections get the right one
  automatically; data-gradient="none" opts a section out. Gradients are soft atmosphere, never busy.
- Motion (section-gradients.js, CONFIG at the top): blob offset = (sin(ph·0.55 + p) − sin(p))·14·amt·U
  for x and (sin(ph·0.43 + p2) − sin(p2))·14·amt·U for y, U = 0.25 (% of width/height); p, p2 static.
  Zero at ph = 0 (no snap), no animated hash, no rounding, grain never animated. One shared rAF loop,
  ~30 fps (20 fps < 734px), only sections in view, paused when the tab is hidden. The static CSS in
  style.css §18 is the no-JS and prefers-reduced-motion frame (ph = 0).

Text tokens (per surface, style.css §1). Every surface sets its own text colour; never rely on the
section colour inheriting into a card of the opposite tone. Minimum 4.5:1 body / 3:1 large text,
measured against the WORST-CASE pixel behind the text.
- --text-on-dark #f5f5f7 / --text-on-dark-muted #a1a1a6 — opaque dark surfaces (#000, #111113, #1d1d1f)
- --text-on-light #1d1d1f / --text-on-light-muted #636366 — opaque light surfaces (#fff, #f5f5f7, #e8e8ed)
- --text-on-dark-gradient(-muted) = #f5f5f7 / #a1a1a6 — directly on Bloom Field (worst pixel #343432: 11.5 / 4.85:1)
- --text-on-light-gradient(-muted) = #1d1d1f / #3a3a3c — directly on Pipo (worst pixel #de9872 = apricot
  centre + darkest grain: 7.1 / 4.8:1). If a grey fails, darken the text, never weaken the gradient.
- Section helpers: --sec-muted = muted text on the section's cards; --sec-bg-muted = muted text on the
  section background. Cards and controls on a gradient get an opaque surface (e.g. the segmented track).
- Accent gradient text on Bloom Field is only allowed as large text (≥ 24px, or ≥ 18.66px bold): its
  darkest colour #6170f9 is 3.1:1 on #343432.

Never invent content. Hide anything marked \[ISI MANUAL]

One change per prompt. Do not touch unrelated sections.

Keep decorations lightweight (CSS/SVG only) and respect prefers-reduced-motion

Content is managed in admin.html (Supabase). Render database text with textContent only.
Image URLs from the database are validated (safeUrl: https:// or a repo-local assets/ path) before
they reach a src attribute.

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
- 2026-10-11 · Experience / Education / Certifications · Page order is now Hero, About, Skills, Organization
  Experience, Projects, Education, Certifications, Contact (navbar likewise, with the existing active highlight).
  The old combined "Education & Certificates" section (#certificate) became two sections: #education and
  #certifications. Backgrounds alternate black / white, so Projects now sits on black (white cards unchanged,
  darker segmented track). Sections marked data-theme="auto" use the --sec-* tokens (style.css §3) and are
  re-striped by script.js when a section is hidden, so the alternation always holds (Contact can also go black).
  Experience: thin vertical timeline line with dots (blue ring when "Present"), one card per entry with a logo
  tile (uploaded logo on white, else gradient monogram), role, period/location chips, bullets with gradient dots.
  Education: two-column cards with a gradient hairline on top, period (end_label such as "Expected 2028"
  overrides the end date), degree, field, GPA, description. Certifications: badge cards (gradient-ring seal over
  the image edge) in a grid (1 card = 560px wide, 2 = side by side, then auto-fill); the image opens in the
  existing image modal, missing image = "Image coming soon" placeholder, optional expiry and "Show credential".
  A section and its nav link are hidden when it has no visible entries or is switched off in Admin → Sections
  (profile.hidden_sections). For experience / education / certificates an empty Supabase result is final; data.json
  is only the fallback when the table can't be read. Dates are month precision; show_months = false shows years
  only (needed for "2021 – 2024"). Data: supabase/migrations/20261011130000_experience_education.sql (new tables with
  RLS, grants and policies; new columns on certificates and profile; seeds only empty tables). Admin: new pages
  Sections, Experience (bullet editor, "I'm currently here" disables End), Education; Certificates gets
  expiry / credential URL; the CV upload shows the original file name and upload date. Tablet nav spacing is
  tighter (734–1067px) to fit the extra links.
- 2026-10-11 · Projects (fix) / All sections · Invisible project card title fixed at the source: .project-card
  is a white surface but set no text colour, so the title (h3 > button, both inheriting) took --text-on-dark
  from .section--dark after Projects moved to black (#f5f5f7 on #fff = 1.09:1). The card now sets
  color: var(--text-on-light). Added per-surface text tokens (--text-on-*-gradient, --sec-bg-muted) and ran a
  static WCAG audit; changed pairs: muted light grey #6e6e73 → #636366 (failed on #e8e8ed segmented track 4.15
  and tinted placeholder 4.25), muted dark grey #86868b → #a1a1a6 (failed on dark placeholders 3.85 and skill
  tiles 4.29), About text / stats / Contact labels on the light gradient → #3a3a3c, Skills rest/closing and
  Contact-on-dark labels on the dark gradient → #a1a1a6, the dark segmented track is now opaque #1d1d1f, and the
  gradient words in the Skills closing line are bold (large text). Animated section gradients: Bloom Field on
  black sections, Pipo on white sections (style.css §18, new section-gradients.js, static .section-gradient
  layers in index.html). Hero, footer, admin and data unchanged.
- 2026-10-12 · Organization Experience · Each Experience BULLET POINT can now carry its own optional
  evidence photos (not just one logo per organization). A bullet is an object
  { id, text, photos: [{ url, caption }] }, so reordering moves the complete bullet with its photos —
  photos are never tied to an array position. New shared core experience-bullets.js (plain script,
  loaded by index.html and admin.html, also required by tests/): legacy ↔ new conversion, validation,
  reordering, storage-reference scanning and the upload session that decides what may be deleted.
  Data: supabase/migrations/20261012_experience_bullet_photos.sql adds the nullable jsonb column
  experience.bullet_items plus a CHECK (via the immutable helper experience_bullet_items_valid:
  max 8 bullets, 300 chars each, max 4 photos, https-only urls, captions ≤ 160). Additive and
  idempotent; it seeds, converts and overwrites nothing, and touches no policy, grant or storage rule.
  bullet_items NULL = read the legacy bullets strings, [] = intentionally empty; an explicit successful
  Save writes bullet_items AND the matching bullets strings. The public query asks for bullet_items and
  retries with the old column list when it is missing, so saved Supabase content keeps showing.
  Public: compact thumbnails (112×84, 132×99 ≥734px) under their own bullet, gradient-dot bullets,
  timeline and card style unchanged; a bullet without photos renders nothing extra. A thumbnail opens
  the existing #image-modal (close button, Esc, focus returns to the thumbnail, alt text from the
  caption or "Evidence for: <bullet> — <organization>"); captions show under the thumbnail. A photo
  that fails to load removes its own thumbnail instead of leaving an empty box. prefers-reduced-motion
  drops the hover lift and keeps the zoom badge visible. Admin: the Experience bullet editor is now one
  card per bullet with its own photo area (add / preview / replace / remove, caption field, up to 4),
  reusing FILE_KINDS.image + validateFile (extension, MIME, file-signature, no SVG, 5 MB) and
  uploadFile; Save is blocked while an upload runs, a failed Save deletes nothing (the original survives
  for a retry), Cancel deletes only the unsaved uploads, and a storage object another entry still
  references is kept. Files page scans bullet_items[].photos[] ("Experience … bullet 2 photo 1"), so
  evidence photos are never listed as unused, and clearing such a reference rewrites bullet_items
  without touching the text. Admin → Experience explains the migration if the column is missing and
  stays usable as a text-only editor until then. Other sections, auth, RLS, config.js and CNAME
  unchanged. Tests: node --test "tests/*.test.mjs" (mocked Supabase/Storage, no dependencies).
- 2026-10-12 · Projects · Each project can carry up to 8 custom "Additional links" managed in the admin
  panel: a label of your choice (the text visitors click), an https:// URL and an optional short description.
  Data: supabase/migrations/20261012_project_custom_links.sql adds projects.external_links (jsonb, NOT NULL,
  default [] — existing rows read as [], nothing is seeded, converted or rewritten) plus a CHECK via the
  immutable helper project_external_links_valid (max 8 links, unique stable ids, label 1–60, https:// URL
  ≤ 500, description ≤ 160, no other keys). Additive and idempotent; no policy, grant or storage rule touched.
  schema.sql defines the same function and column for new installations (a test keeps both copies identical).
  repo_url and doc_url stay separate and unchanged. New shared core project-links.js (plain script, loaded by
  index.html and admin.html, also required by tests/): strict public read path, editor drafts, validation,
  ordering and the saved shape. Public: the project modal gets an "Additional links" block after Repository —
  the existing .link-chip pills, one per row, the chosen label as the link text and the description underneath
  (linked with aria-describedby); target=_blank, rel="noopener noreferrer", "(opens in a new tab)" for screen
  readers; database text via text nodes only; only https:// hrefs (javascript:, data:, http:, relative and
  protocol-relative URLs are dropped, and safeUrl checks again); no block when a project has no safe link;
  long labels wrap inside the pill. The public query asks for external_links and retries the old column list
  when it is missing, so saved Supabase projects keep showing instead of data.json. Admin → Projects: an
  "Additional links" editor under the document upload (Add link, edit, ↑/↓ reorder, remove; label and https URL
  required, description optional), problems shown under the exact input, nothing rewritten while typing, so a
  failed Save keeps every draft value; without the column the field is left out and a notice names the migration.
  Files page counts bucket files used by an additional link as used (deleting such a file removes every link
  to it, ?query / #fragment variants included); replacing / removing a project image or document, or deleting a
  project with its files, keeps a file an additional link still points at (opt-in isReferenced on the upload
  field, used by Projects only).
  Experience, Skills, other sections, auth, RLS, config.js and CNAME unchanged. Tests: node --test
  tests/*.test.mjs — core unit tests plus script.js and admin.js run in node:vm against a mocked Supabase.
- 2026-10-14 · Organization Experience (visual revision) · Each bullet and its evidence photos now read as ONE
  cohesive block instead of a text line with a loose strip of thumbnails underneath. Public only — script.js,
  style.css and the one section tag in index.html; no data, admin, Supabase, migration, auth, config.js or CNAME
  change, and the stored bullet shape { id, text, photos: [{ url, caption }] } is untouched.
  Marker fix: .xp-card__bullets li and li::before were DESCENDANT selectors, so they also matched the nested
  evidence <li>s and painted a second blue gradient dot (plus a 20px indent) next to every thumbnail. Both are
  now scoped with the child combinator (.xp-card__bullets > li), so the marker belongs to the text bullets only;
  the static no-JS fallback bullet is a plain <li> and keeps its dot.
  Placement is switchable on the Experience <section> via data-photo-layout, "side" being the default:
    side   → from 768px up the bullet becomes a two-column grid, grid-template-columns: minmax(0, 1fr) auto with
             align-items: start, so the text sits left and its photos right with their tops aligned. The photo
             column uses compact 104×78 thumbnails, wraps at two per row and is capped at
             max-width: calc(var(--xp-thumb-w) * 2 + var(--space-1)), so the validated maximum of 4 photos can
             never overflow the card.
    below  → photos always stay under their own bullet text at every width.
  Under 768px both variants are identical: the photos sit directly beneath their own bullet text, flush with the
  text edge (inherited from the parent li's 20px indent), as one nowrap row that scrolls sideways
  (overflow-x: auto, overscroll-behavior-x: contain) only when it does not fit. Thumbnail size is driven by
  --xp-thumb-w / --xp-thumb-h (112×84, 132×99 ≥734px, 104×78 in the side layout).
  script.js normalises the attribute (unknown, empty or missing → "side"; case-insensitive), and the CSS treats
  "anything that is not below" as side, so the pre-JS fallback markup is laid out correctly too. To switch,
  edit data-photo-layout on <section id="experience"> in index.html (or set it at runtime:
  document.querySelector('#experience').dataset.photoLayout = 'below').
  Captions: the narrow paragraph under each thumbnail is replaced by a one-line overlay inside the button
  (absolute bottom bar, white-space: nowrap + text-overflow: ellipsis, gradient scrim) that fades in on hover
  AND on keyboard focus-visible. It is aria-hidden because the button's aria-label already carries the caption,
  and it is only created for a non-empty caption, so an empty caption adds no element and no empty space. The
  full, untruncated caption still goes to the #image-modal figcaption. The zoom badge moved to the top-right so
  it cannot collide with the caption bar; prefers-reduced-motion keeps the badge visible and drops the overlay's
  slide-up while still revealing it. The old <figure>/<figcaption> wrapper per thumbnail is gone (li > button).
  Unchanged: the shared gallery modal and its keyboard controls (Esc, close button, focus returns to the
  thumbnail), lazy loading with the is-loaded fade, a failing photo removing only its own thumbnail, the
  photo-to-bullet association, alt-text rules, and a bullet without photos rendering nothing extra.
  Tests: node --test tests/*.test.mjs (93 pass, unchanged) plus an isolated node:vm run of the revision
  (markers, overlay, modal caption, layout switch, scroll fallback, load-failure path).
