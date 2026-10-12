/* ==========================================================================
   Andhika Permana Sagiyono — Portfolio
   Vanilla JS, no build step. Content comes from Supabase (read-only, public
   anon key from config.js) with data.json as the local fallback.
   --------------------------------------------------------------------------
   1. Helpers (element factory, safe URLs, text formatting)
   2. Scroll reveal
   3. Navigation (mobile menu + active link)
   4. Images & placeholders (never a broken image)
   5. Content loading (Supabase → data.json fallback)
   6. Profile (hero, about, stats, contact, CV, photo)
   7. Skills
   8. Projects + project modal
   9. Dialog plumbing (shared by all modals)
   10. Organization Experience (bullets + per-bullet evidence photos) + Education
   11. Certifications + image modal
   12. Section visibility (hide empty / switched-off sections, keep black/white alternation)
   13. Boot

   SECURITY: all database text is inserted with textContent / text nodes.
   innerHTML is only used for the trusted, hard-coded SVG icons below.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     1. Helpers
     ------------------------------------------------------------------------ */

  /** Anything containing this marker is treated as "not filled in" and hidden. */
  const MANUAL_MARKER = /\[\s*ISI\s+MANUAL\s*\]/i;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  /** True when a value has real content (non-empty and not marked [ISI MANUAL]). */
  const isFilled = (value) =>
    typeof value === 'string' ? value.trim() !== '' && !MANUAL_MARKER.test(value) : value != null;

  const clean = (value) => (isFilled(value) ? String(value).trim() : '');

  const bySortOrder = (a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0);

  const slugify = (text) =>
    String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /**
   * Only two kinds of URL are ever placed in href/src:
   *   - https:// URLs (Supabase Storage, GitHub, LinkedIn …)
   *   - repo-local paths under assets/ (data.json fallback)
   * Everything else (javascript:, data:, http:, //host …) is dropped.
   */
  function safeUrl(value) {
    if (typeof value !== 'string') return '';
    const v = value.trim();
    if (!v) return '';
    if (/^assets\/[A-Za-z0-9._\-/]+$/.test(v) && !v.includes('..')) return v;
    try {
      const url = new URL(v);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  const EMAIL_RE = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/;

  /** "https://www.linkedin.com/in/x/" → "linkedin.com/in/x" */
  function displayUrl(href) {
    try {
      const url = new URL(href);
      return (url.host.replace(/^www\./, '') + url.pathname).replace(/\/+$/, '');
    } catch {
      return href;
    }
  }

  /** Tiny element factory: h('a', { class: 'x', href: '#' }, 'text', childNode) */
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /** Text with single line breaks → text nodes separated by <br> (no HTML parsing). */
  function withBreaks(text) {
    const lines = String(text).split('\n');
    return lines.flatMap((line, i) => (i ? [h('br'), line] : [line]));
  }

  /** Split on blank lines into trimmed paragraphs. */
  const paragraphs = (text) =>
    String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  /** "Designing with *security* in mind." → text + <span class="gradient-text">security</span> + text */
  function withAccent(text) {
    return String(text)
      .split(/(\*[^*\n]+\*)/)
      .filter(Boolean)
      .map((part) =>
        /^\*[^*\n]+\*$/.test(part) ? h('span', { class: 'gradient-text' }, part.slice(1, -1)) : part
      );
  }

  /** "2024-09-01" → "September 2024" (or "2024" when months are switched off) */
  function formatMonth(value, showMonths = true) {
    const match = /^(\d{4})-(\d{2})/.exec(String(value || ''));
    if (!match) return '';
    if (!showMonths) return match[1];
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, 1));
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  /** "September 2024 – Expected 2028"; either side may be missing. */
  const periodText = (start, end) => [start, end].filter(Boolean).join(' \u2013 ');

  /** sort_order first, then the most recent start date, then id. */
  const byOrderThenStart = (a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
    String(b.start_date || '').localeCompare(String(a.start_date || '')) ||
    (Number(a.id) || 0) - (Number(b.id) || 0);

  /** "2026-09-25" → "25 September 2026" */
  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) return clean(value);
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  /** Trusted, static inline SVG icons (stroke-based, inherit currentColor). */
  const ICONS = {
    arrowRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/></svg>',
    document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5M9 12h6.5M9 15.5h6.5M9 9h3"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.75"/><path d="M21 16l-5-5-8 9"/></svg>',
    seal: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="5.5"/><path d="M9.5 9l1.75 1.75L14.75 7.5M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/></svg>',
    certificate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 9h10M7 12.5h6"/><circle cx="17" cy="17" r="2.5"/><path d="M15.5 19l-.5 3 2-1 2 1-.5-3"/></svg>'
  };

  function icon(name) {
    const tpl = document.createElement('template');
    tpl.innerHTML = ICONS[name] || '';
    return tpl.content.firstElementChild;
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  function loadError(label) {
    return h('p', { class: 'load-error' }, `${label} could not be loaded. Please refresh the page.`);
  }

  /** HEAD-check a file once; network errors (e.g. offline, CORS) keep the link visible. */
  const existenceCache = new Map();
  function resourceExists(url) {
    if (!existenceCache.has(url)) {
      existenceCache.set(
        url,
        fetch(url, { method: 'HEAD', cache: 'no-cache' }).then((r) => r.ok).catch(() => true)
      );
    }
    return existenceCache.get(url);
  }

  /** Replace children; keep them shown if the container was already revealed (no re-animation). */
  function replaceRevealing(container, nodes) {
    const wasVisible = Boolean($('.reveal.is-visible', container));
    container.replaceChildren(...nodes);
    if (wasVisible) nodes.forEach((node) => node.classList?.contains('reveal') && node.classList.add('is-visible'));
    observeReveal(container);
  }

  /**
   * Replace a container's children, but only if the visible text actually changed
   * (avoids re-animating content that the static HTML already shows correctly).
   */
  function swapChildren(container, nodes) {
    const next = nodes.filter(Boolean);
    const text = (list) => list.map((node) => node.textContent.replace(/\s+/g, '')).join('\u0000');
    if (text([...container.children]) === text(next)) return;
    const wasVisible = Boolean($('.reveal.is-visible', container));
    container.replaceChildren(...next);
    if (wasVisible) next.forEach((node) => node.classList?.contains('reveal') && node.classList.add('is-visible'));
    observeReveal(container);
  }


  /* ------------------------------------------------------------------------
     2. Scroll reveal — fade + translateY, staggered via CSS nth-child
     ------------------------------------------------------------------------ */
  let revealObserver = null;

  function observeReveal(scope = document) {
    const items = $$('.reveal:not(.is-visible)', scope);
    if (scope instanceof Element && scope.matches('.reveal:not(.is-visible)')) items.push(scope);

    if (!('IntersectionObserver' in window) || reducedMotion.matches) {
      items.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    revealObserver ??= new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );

    items.forEach((item) => revealObserver.observe(item));
  }


  /* ------------------------------------------------------------------------
     3. Navigation
     ------------------------------------------------------------------------ */
  function initNav() {
    const nav = $('.nav');
    const toggle = $('.nav__toggle');
    const menu = $('#nav-menu');
    if (!nav || !toggle || !menu) return;

    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };

    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (nav.classList.contains('is-open') && !nav.contains(event.target)) setOpen(false);
    });
    window.matchMedia('(min-width: 734px)').addEventListener('change', (e) => e.matches && setOpen(false));

    // Active link highlight: whichever section crosses the middle of the viewport
    const links = $$('.nav__link[href^="#"]');
    const sections = $$('main > section[id]');
    if (!('IntersectionObserver' in window) || !sections.length) return;

    const setActive = (id) => {
      for (const link of links) {
        const active = link.hash === `#${id}`;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    };

    const spy = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setActive(entry.target.id)),
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach((section) => spy.observe(section));
  }


  /* ------------------------------------------------------------------------
     4. Images — attach listeners BEFORE setting src so nothing is missed.
        On failure the caller swaps in a placeholder; images stay invisible
        (opacity 0) until loaded, so a broken icon is never painted.
     ------------------------------------------------------------------------ */
  function bindImage(img, onFail) {
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      onFail(img);
    };
    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    img.addEventListener('error', fail, { once: true });

    // Already settled before we got here (e.g. cached or loaded pre-script)
    if (img.complete && img.getAttribute('src')) {
      if (img.naturalWidth > 0) img.classList.add('is-loaded');
      else fail();
    }
  }

  function placeholder({ variant = '', glyph = 'image', note = '', decorative = true } = {}) {
    return h(
      'div',
      {
        class: `placeholder${variant ? ` placeholder--${variant}` : ''}`,
        'aria-hidden': decorative && !note ? 'true' : null
      },
      h('span', { class: 'placeholder__glyph', 'aria-hidden': 'true' }, icon(glyph)),
      isFilled(note) ? h('p', { class: 'placeholder__note' }, note) : null
    );
  }

  /** A non-link chip that stands in for a file that is not available yet. */
  const soonChip = (label) =>
    h('span', { class: 'link-chip link-chip--soon' }, icon('document'), label);


  /* ------------------------------------------------------------------------
     5. Content loading
        Supabase is tried first (visible rows only, anon key, no session).
        Each section falls back to data.json when Supabase is not configured,
        unreachable, slow (timeout), or the table is empty.
     ------------------------------------------------------------------------ */
  const REMOTE_TIMEOUT_MS = 6000;

  const COLUMNS = {
    profile: 'name, tagline, subtagline, about_text, stats, email, linkedin, github, photo_url, cv_url, hidden_sections',
    skills: 'id, category, name, level, icon_url, sort_order',
    projects: 'id, title, category, short_desc, detail_desc, role, tools, result, period, repo_url, image_url, doc_url, sort_order',
    experience: 'id, organization, role, location, start_date, end_date, is_current, show_months, bullets, bullet_items, logo_url, sort_order',
    education: 'id, institution, degree, field_of_study, start_date, end_date, end_label, gpa, description, logo_url, show_months, sort_order',
    certificates: 'id, title, issuer, issued_date, expiry_date, credential_url, image_url, sort_order'
  };

  /**
   * Columns from before a migration: used if the new columns don't exist yet, so the
   * site keeps showing the saved Supabase content instead of dropping to data.json.
   *   profile / certificates → 2026-10-11 (experience + education migration)
   *   experience             → 2026-10-12 (bullet_items, evidence photos)
   */
  const LEGACY_COLUMNS = {
    profile: 'name, tagline, subtagline, about_text, stats, email, linkedin, github, photo_url, cv_url',
    experience: 'id, organization, role, location, start_date, end_date, is_current, show_months, bullets, logo_url, sort_order',
    certificates: 'id, title, issuer, issued_date, image_url, sort_order'
  };

  /**
   * Tables whose (possibly empty) result is used as-is, so hiding or deleting every
   * entry in the admin hides the section. data.json is only used when the table
   * can't be read at all (not configured, unreachable, or migration not run yet).
   */
  const AUTHORITATIVE = new Set(['experience', 'education', 'certificates']);

  function supabaseConfig() {
    const cfg = window.PORTFOLIO_CONFIG || {};
    const url = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = String(cfg.supabaseAnonKey || '').trim();
    if (!/^https:\/\/[^\s/]+$/.test(url) || !key || /YOUR-/i.test(url + key)) return null;
    return { url, key };
  }

  async function fetchRemote() {
    const cfg = supabaseConfig();
    if (!cfg || typeof window.supabase?.createClient !== 'function') return {};

    const client = window.supabase.createClient(cfg.url, cfg.key, {
      // The public site never signs in: always read as an anonymous visitor.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

    const build = (table, columns) => {
      let builder = client.from(table).select(columns);
      if (table === 'profile') return builder.limit(1).abortSignal(controller.signal);
      builder = builder.eq('is_visible', true).order('sort_order', { ascending: true });
      if (table === 'experience' || table === 'education') {
        builder = builder.order('start_date', { ascending: false, nullsFirst: false });
      }
      return builder.order('id', { ascending: true }).abortSignal(controller.signal);
    };

    // Retry with the old column list when the new columns are missing (migration not run yet)
    const query = async (table) => {
      const result = await build(table, COLUMNS[table]);
      if (result.error && LEGACY_COLUMNS[table] && !controller.signal.aborted) return build(table, LEGACY_COLUMNS[table]);
      return result;
    };

    const tables = Object.keys(COLUMNS);
    try {
      const results = await Promise.allSettled(tables.map(query));
      return Object.fromEntries(
        tables.map((table, i) => {
          const result = results[i];
          const ok = result.status === 'fulfilled' && !result.value.error && Array.isArray(result.value.data);
          if (!ok) console.warn(`Supabase: ${table} unavailable, using local data.`, result.reason || result.value?.error);
          return [table, ok ? result.value.data : null];
        })
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadContent() {
    const [local, remote] = await Promise.all([
      fetchJSON('data.json').catch((error) => {
        console.warn(error);
        return null;
      }),
      fetchRemote().catch((error) => {
        console.warn(error);
        return {};
      })
    ]);

    const pick = (table) => {
      const rows = remote[table];
      if (Array.isArray(rows) && (rows.length || AUTHORITATIVE.has(table))) return { rows, source: 'remote' };
      const fallback = table === 'profile' ? (local?.profile ? [local.profile] : null) : local?.[table];
      return { rows: Array.isArray(fallback) ? fallback : null, source: 'local' };
    };

    return {
      local,
      profile: pick('profile'),
      skills: pick('skills'),
      projects: pick('projects'),
      experience: pick('experience'),
      education: pick('education'),
      certificates: pick('certificates'),
      categories: Array.isArray(local?.skill_categories) ? local.skill_categories : []
    };
  }


  /* ------------------------------------------------------------------------
     6. Profile
     ------------------------------------------------------------------------ */
  function initials(name) {
    const words = clean(name).split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || '?';
  }

  function buildStat(stat) {
    const label = clean(stat?.label);
    const value = clean(stat?.value);
    if (!label || !value) return null;
    const suffix = clean(stat?.suffix);
    return h(
      'div',
      { class: 'stat reveal' },
      h('dt', { class: 'stat__label' }, label),
      h('dd', { class: 'stat__value' }, value, suffix ? [' ', h('span', { class: 'stat__suffix' }, suffix)] : null)
    );
  }

  function buildContactRow(label, href, value, external) {
    return h(
      'a',
      {
        class: 'contact-row reveal',
        href,
        target: external ? '_blank' : null,
        rel: external ? 'noopener noreferrer' : null
      },
      h('span', { class: 'contact-row__label' }, label),
      h('span', { class: 'contact-row__value' }, value),
      contactArrow(),
      external ? h('span', { class: 'visually-hidden' }, '(opens in a new tab)') : null
    );
  }

  function contactArrow() {
    const tpl = document.createElement('template');
    tpl.innerHTML = '<svg class="contact-row__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';
    return tpl.content.firstElementChild;
  }

  /** Turn a CV button into a calm, non-interactive "coming soon" pill. */
  function cvSoon(link) {
    const soon = h(
      'span',
      { class: `${link.className} btn--soon`, 'aria-disabled': 'true', 'data-cv': '' },
      'CV coming soon'
    );
    link.replaceWith(soon);
  }

  function renderCv(rawUrl, name) {
    const links = $$('a[data-cv]');
    const url = safeUrl(rawUrl);
    if (!url) {
      links.forEach(cvSoon);
      return;
    }

    const fileName = `${clean(name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'CV'}-CV.pdf`;
    let href = url;
    const isRemote = /^https:/i.test(url);
    // Supabase Storage honours ?download=<name> to send the file as an attachment.
    if (isRemote && url.includes('/storage/v1/object/public/')) {
      href = `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(fileName)}`;
    }

    links.forEach((link) => {
      link.href = href;
      link.setAttribute('download', fileName);
      if (isRemote) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });

    resourceExists(url).then((exists) => {
      if (!exists) $$('a[data-cv]').forEach(cvSoon);
    });
  }

  function renderPhoto(rawUrl, name) {
    const figure = $('.about__photo');
    if (!figure) return;
    const box = $('.photo-placeholder', figure);
    if (box && clean(name)) box.setAttribute('aria-label', clean(name));
    const mark = $('.photo-placeholder__initials', figure);
    if (mark && clean(name)) mark.textContent = initials(name);

    $('.about__photo-img', figure)?.remove();
    const src = safeUrl(rawUrl);
    if (!src) return; // keep the placeholder; no request = no 404

    const img = h('img', {
      class: 'about__photo-img',
      alt: clean(name) ? `Portrait of ${clean(name)}` : '',
      loading: 'lazy',
      decoding: 'async',
      width: 800,
      height: 1000
    });
    bindImage(img, () => img.remove()); // failed photo → the initials placeholder stays
    img.src = src;
    figure.append(img);
  }

  function renderProfile(profile) {
    if (!profile) {
      // No data at all: keep the static HTML, but never show a dead CV link.
      renderCv('assets/CV.pdf', 'Andhika Permana Sagiyono');
      return;
    }

    const name = clean(profile.name);
    if (name) {
      $$('.nav__brand, .hero__name').forEach((node) => {
        node.textContent = name;
      });
      const footer = $('.site-footer__inner p');
      const year = $('[data-year]', footer || document);
      if (footer && year) footer.replaceChildren('\u00A9 ', year, ` ${name}`);
    }

    const tagline = $('.hero__tagline');
    if (tagline && clean(profile.tagline)) tagline.replaceChildren(...withAccent(clean(profile.tagline)));

    const sub = $('.hero__sub');
    if (sub && clean(profile.subtagline)) sub.textContent = clean(profile.subtagline);

    const about = $('.about__text');
    const paras = paragraphs(clean(profile.about_text));
    if (about && paras.length) {
      swapChildren(
        about,
        paras.map((text, i) => h('p', { class: i === 0 ? 'about__lead reveal' : 'reveal' }, ...withBreaks(text)))
      );
    }

    const stats = $('.stats');
    if (stats && Array.isArray(profile.stats)) {
      const items = profile.stats.slice(0, 8).map(buildStat).filter(Boolean);
      stats.hidden = !items.length;
      if (items.length) swapChildren(stats, items);
    }

    const contact = $('.contact__list');
    if (contact) {
      const rows = [];
      const email = clean(profile.email);
      if (EMAIL_RE.test(email)) rows.push(buildContactRow('Email', `mailto:${email}`, email, false));
      const linkedin = safeUrl(profile.linkedin);
      if (/^https:/.test(linkedin)) rows.push(buildContactRow('LinkedIn', linkedin, displayUrl(linkedin), true));
      const github = safeUrl(profile.github);
      if (/^https:/.test(github)) rows.push(buildContactRow('GitHub', github, displayUrl(github), true));
      if (rows.length) swapChildren(contact, rows);
    }

    renderPhoto(profile.photo_url, name);
    renderCv(profile.cv_url, name);
  }


  /* ------------------------------------------------------------------------
     7. Skills — one compact section: category cards side by side
        (grid on tablet/desktop, scroll-snap carousel with dots on mobile)
     ------------------------------------------------------------------------ */
  const STOPWORDS = new Set(['and', 'for', 'of', 'the', 'to', 'in', 'a', 'an', 'with', 'on']);

  /** "VS Code" → "VC", "Ghidra" → "Gh", "JADX" → "JA" */
  function monogram(name) {
    const words = String(name)
      .replace(/\(.*?\)/g, ' ')
      .split(/[\s/]+/)
      .filter((word) => /[a-z0-9]/i.test(word) && !STOPWORDS.has(word.toLowerCase()));
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    const word = words[0] || '?';
    if (word.length === 1) return word.toUpperCase();
    return word === word.toUpperCase()
      ? word.slice(0, 2)
      : word[0].toUpperCase() + word[1].toLowerCase();
  }

  /**
   * Built-in icons, matched by skill name (letters + digits only, lower case).
   * Used only when a skill has no uploaded icon_url. Glyphs are original,
   * neutral line drawings (trusted static strings, stroke = currentColor).
   */
  const SKILL_GLYPHS = {
    // Checklist — a neutral stand-in for "OWASP" (not the OWASP logo)
    checklist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5l1.75 1.75L8.5 5M3.5 12.5l1.75 1.75L8.5 11M3.5 18.5l1.75 1.75L8.5 17M11.5 7h9M11.5 13h9M11.5 19h6"/></svg>',
    // Six-segment shield — STRIDE's six threat categories
    stride: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l7.5 3v6c0 4.6-3.1 8.4-7.5 10-4.4-1.6-7.5-5.4-7.5-10v-6z"/><path d="M12 2.5v19M4.5 8.5h15M5.3 14.5h13.4"/></svg>',
    // Connected blocks — application design
    blocks: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="5.5" rx="1.5"/><rect x="2.5" y="16" width="7" height="5.5" rx="1.5"/><rect x="14.5" y="16" width="7" height="5.5" rx="1.5"/><path d="M12 8v4M6 16v-4h12v4"/></svg>'
  };

  const SKILL_ICONS = {
    owasp: { glyph: 'checklist' },
    owasptop10: { glyph: 'checklist' },
    stride: { glyph: 'stride' },
    coreapplicationdesign: { glyph: 'blocks' },
    html: { src: 'assets/icons/html5.svg' },
    html5: { src: 'assets/icons/html5.svg' },
    css: { src: 'assets/icons/css.svg' },
    css3: { src: 'assets/icons/css.svg' },
    javascript: { src: 'assets/icons/javascript.svg' },
    js: { src: 'assets/icons/javascript.svg' },
    php: { src: 'assets/icons/php.svg' },
    wireshark: { src: 'assets/icons/wireshark.svg' },
    burpsuite: { src: 'assets/icons/burpsuite.svg' },
    linux: { src: 'assets/icons/linux.svg' },
    docker: { src: 'assets/icons/docker.svg' },
    figma: { src: 'assets/icons/figma.svg' },
    git: { src: 'assets/icons/git.svg' },
    github: { src: 'assets/icons/github.svg' },
    mysql: { src: 'assets/icons/mysql.svg' }
  };

  const skillKey = (name) => clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '');

  function glyph(name) {
    const tpl = document.createElement('template');
    tpl.innerHTML = SKILL_GLYPHS[name] || '';
    return tpl.content.firstElementChild;
  }

  /**
   * Accent palette for category cards. Categories listed in data.json
   * (skill_categories[].accent) keep their colour; any other category gets
   * the first colour not used yet (cycling once all are taken).
   */
  const ACCENTS = ['blue', 'orange', 'green', 'purple', 'pink'];

  function assignAccents(names, metaFor) {
    const result = new Map();
    const used = new Set();
    names.forEach((name) => {
      const accent = metaFor(name)?.accent;
      if (ACCENTS.includes(accent)) {
        result.set(name, accent);
        used.add(accent);
      }
    });
    let cursor = 0;
    names.forEach((name) => {
      if (result.has(name)) return;
      const free = ACCENTS.find((accent) => !used.has(accent));
      const accent = free || ACCENTS[cursor++ % ACCENTS.length];
      used.add(accent);
      result.set(name, accent);
    });
    return result;
  }

  function buildSkillTile(skill) {
    const iconBox = h('span', { class: 'skill-tile__icon', 'aria-hidden': 'true' });
    const builtIn = SKILL_ICONS[skillKey(skill.name)] || {};
    const useFallback = () => {
      const node = builtIn.glyph ? glyph(builtIn.glyph) : null;
      iconBox.replaceChildren(node || h('span', { class: 'skill-tile__monogram' }, monogram(skill.name)));
    };
    const useImage = (src, uploaded, onFail) => {
      const img = h('img', {
        alt: '',
        width: 22,
        height: 22,
        loading: 'lazy',
        decoding: 'async',
        class: uploaded ? 'is-uploaded' : null
      });
      bindImage(img, onFail);
      img.src = src;
      iconBox.replaceChildren(img);
    };

    // Priority: uploaded icon_url → built-in icon file / glyph → monogram.
    const uploaded = safeUrl(skill.icon_url);
    const bundled = safeUrl(builtIn.src);
    const tryBundled = () => (bundled ? useImage(bundled, false, useFallback) : useFallback());
    if (uploaded) useImage(uploaded, !uploaded.startsWith('assets/icons/'), tryBundled);
    else tryBundled();

    const level = clean(skill.level);
    return h(
      'li',
      { class: 'skill-tile' },
      iconBox,
      h(
        'span',
        { class: 'skill-tile__text' },
        h('span', { class: 'skill-tile__name' }, clean(skill.name)),
        level ? h('span', { class: 'skill-tile__level' }, level) : null
      )
    );
  }

  function buildSkillCard(name, meta, accent, skills, index) {
    const key = isFilled(meta?.key) ? meta.key : slugify(name) || `category-${index + 1}`;
    const headingId = `skills-cat-${index + 1}-${key}`;
    return h(
      'article',
      { class: 'skill-card', 'data-category': key, 'data-accent': accent, 'aria-labelledby': headingId },
      h('div', { class: 'ornament', 'aria-hidden': 'true' }),
      h('h3', { class: 'skill-card__title', id: headingId }, name),
      h('ul', { class: 'skill-card__grid', role: 'list' }, skills.map(buildSkillTile))
    );
  }

  /** Mobile carousel dots: shown by CSS below 734px only, when there are 2+ cards. */
  function buildSkillDots(track, cards, names) {
    if (cards.length < 2) return null;
    const dots = cards.map((card, i) =>
      h('button', {
        class: 'skills__dot',
        type: 'button',
        'aria-label': `Show ${names[i]}`,
        'aria-current': i === 0 ? 'true' : null,
        onclick: () => {
          track.scrollTo({
            left: card.offsetLeft - cards[0].offsetLeft,
            behavior: reducedMotion.matches ? 'auto' : 'smooth'
          });
        }
      })
    );

    let frame = 0;
    const sync = () => {
      frame = 0;
      const x = track.scrollLeft;
      let active = 0;
      let best = Infinity;
      cards.forEach((card, i) => {
        const distance = Math.abs(card.offsetLeft - cards[0].offsetLeft - x);
        if (distance < best) {
          best = distance;
          active = i;
        }
      });
      dots.forEach((dot, i) => {
        if (i === active) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
    };
    track.addEventListener('scroll', () => {
      frame ||= requestAnimationFrame(sync);
    }, { passive: true });

    return h('div', { class: 'skills__dots', role: 'group', 'aria-label': 'Skill categories' }, dots);
  }

  function renderSkills({ rows }, categories) {
    const root = $('#skills-root');
    if (!root) return;
    if (!rows) {
      root.replaceChildren(loadError('Skills'));
      return;
    }

    // Drop hidden / empty / [ISI MANUAL] skills, then group by category
    // (case-insensitive, first spelling wins, first-seen order)
    const groups = new Map();
    for (const skill of rows) {
      if (skill?.is_visible === false) continue;
      if (!isFilled(skill?.name) || !isFilled(skill?.category)) continue;
      const id = skill.category.trim().toLowerCase();
      if (!groups.has(id)) groups.set(id, { name: skill.category.trim(), skills: [] });
      groups.get(id).skills.push(skill);
    }

    const metaFor = (name) =>
      categories.find((c) => typeof c?.name === 'string' && c.name.trim().toLowerCase() === name.toLowerCase());
    const seen = [...groups.keys()];
    const orderOf = (id) => {
      const meta = metaFor(id);
      return meta ? Number(meta.sort_order) || 0 : 1000 + seen.indexOf(id);
    };

    // Categories without visible skills never get a card
    const ordered = seen
      .filter((id) => groups.get(id).skills.length)
      .sort((a, b) => orderOf(a) - orderOf(b))
      .map((id) => groups.get(id));

    const names = ordered.map((g) => g.name);
    const accents = assignAccents(names, metaFor);
    const cards = ordered.map((group, i) =>
      buildSkillCard(group.name, metaFor(group.name), accents.get(group.name), group.skills.sort(bySortOrder), i)
    );

    if (!cards.length) {
      root.replaceChildren();
      return;
    }

    const track = h('div', { class: 'skills__track', 'data-count': String(Math.min(cards.length, 5)) }, cards);
    root.replaceChildren(...[track, buildSkillDots(track, cards, names)].filter(Boolean));
  }


  /* ------------------------------------------------------------------------
     8. Projects
     ------------------------------------------------------------------------ */

  /** DB rows use 'code' | 'document'; the markup/CSS use 'code' | 'documents'. */
  function normalizeProject(row) {
    const category = row.category === 'document' ? 'documents' : 'code';
    return {
      ...row,
      title: clean(row.title),
      category,
      category_label: category === 'documents' ? 'Document' : 'Code'
    };
  }

  const glyphFor = (project) => (project.category === 'documents' ? 'document' : 'code');

  /** Cover image or an elegant placeholder; swaps to placeholder if the image fails. */
  function buildCardMedia(project) {
    const media = h('div', { class: 'project-card__media' });
    const fallback = () => media.replaceChildren(placeholder({ variant: project.category, glyph: glyphFor(project) }));
    const src = safeUrl(project.image_url);

    if (src) {
      const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
      bindImage(img, fallback);
      img.src = src;
      media.append(img);
    } else {
      fallback();
    }
    return media;
  }

  function buildProjectCard(project, onOpen) {
    const meta = [project.category_label, project.period].filter(isFilled).join(' · ');
    const openBtn = h(
      'button',
      { class: 'project-card__open', type: 'button', 'aria-haspopup': 'dialog' },
      project.title
    );
    openBtn.addEventListener('click', () => onOpen(project, openBtn));

    const cta = h('span', { class: 'project-card__cta', 'aria-hidden': 'true' }, 'View details', icon('arrowRight'));

    return h(
      'article',
      { class: 'project-card', 'data-category': project.category },
      buildCardMedia(project),
      h(
        'div',
        { class: 'project-card__body' },
        isFilled(meta) ? h('p', { class: 'project-card__meta' }, meta) : null,
        h('h3', { class: 'project-card__title' }, openBtn),
        isFilled(project.short_desc) ? h('p', { class: 'project-card__summary' }, clean(project.short_desc)) : null,
        cta
      )
    );
  }

  /** Image in the modal; missing or broken → placeholder card. */
  function buildModalMedia(project) {
    const wrap = h('div', { class: 'modal__media' });
    const soon = () => placeholder({ variant: project.category, glyph: 'image', note: 'Image coming soon' });
    const src = safeUrl(project.image_url);

    if (!src) {
      wrap.append(soon());
      return wrap;
    }

    const figure = h('figure', { class: 'gallery__item' });
    const img = h('img', { alt: project.title, loading: 'lazy', decoding: 'async' });
    bindImage(img, () => figure.replaceWith(soon()));
    img.src = src;
    figure.append(img);
    wrap.append(figure);
    return wrap;
  }

  function buildFlow(text) {
    const steps = text.replace(/\.\s*$/, '').split(/\s*→\s*/).filter(Boolean);
    return h(
      'ol',
      { class: 'flow', role: 'list', 'aria-label': text },
      steps.map((step) => h('li', {}, h('span', { class: 'flow__step' }, step)))
    );
  }

  /** Paragraphs → <p>; a paragraph with "→" becomes flow chips. */
  function blockBody(text) {
    return paragraphs(text).map((para) =>
      para.includes('→') && !para.includes('\n') ? buildFlow(para) : h('p', {}, ...withBreaks(para))
    );
  }

  const block = (label, text) =>
    clean(text) ? h('section', { class: 'modal__block' }, h('h3', {}, label), blockBody(clean(text))) : null;

  /**
   * detail_desc format (see ADMIN-GUIDE.md):
   *   first paragraph(s)      → "Detailed description"
   *   "Heading:\ntext …"      → its own titled block (added after Result / impact)
   */
  function parseDetail(text) {
    const intro = [];
    const extra = [];
    for (const para of paragraphs(text)) {
      const [first, ...rest] = para.split('\n');
      if (rest.length && /:\s*$/.test(first) && first.length <= 60) {
        extra.push({ label: first.replace(/:\s*$/, '').trim(), text: rest.join('\n').trim() });
      } else if (extra.length) {
        extra[extra.length - 1].text += `\n\n${para}`;
      } else {
        intro.push(para);
      }
    }
    return { intro: intro.join('\n\n'), extra };
  }

  function buildLinkChip(label, href) {
    return h(
      'a',
      { class: 'link-chip', href, target: '_blank', rel: 'noopener noreferrer' },
      label,
      icon('external'),
      h('span', { class: 'visually-hidden' }, ' (opens in a new tab)')
    );
  }

  function buildDocumentBlock(project) {
    const label = project.category === 'documents' ? 'Document' : 'Supporting document';
    const href = safeUrl(project.doc_url);
    const item = h('li', {}, href ? buildLinkChip('View document (PDF)', href) : soonChip('Document coming soon'));

    // A missing/removed file never becomes a dead link
    if (href) {
      resourceExists(href).then((exists) => {
        if (!exists) item.replaceChildren(soonChip('Document coming soon'));
      });
    }

    return h(
      'section',
      { class: 'modal__block' },
      h('h3', {}, label),
      h('ul', { class: 'link-list', role: 'list' }, item)
    );
  }

  function buildRepoBlock(project) {
    const href = safeUrl(project.repo_url);
    if (!/^https:/.test(href)) return null;
    return h(
      'section',
      { class: 'modal__block' },
      h('h3', {}, 'Repository'),
      h('ul', { class: 'link-list', role: 'list' }, h('li', {}, buildLinkChip(displayUrl(href), href)))
    );
  }

  function buildProjectDetail(project) {
    const chips = [project.category_label, project.period].filter(isFilled).map(clean);
    const detail = parseDetail(clean(project.detail_desc));

    const blocks = [
      block('Detailed description', detail.intro),
      block('My role', project.role),
      block('Tools and methods', project.tools),
      block('Result / impact', project.result),
      ...detail.extra.map((b) => block(b.label, b.text)),
      buildDocumentBlock(project),
      buildRepoBlock(project)
    ];

    return [
      h(
        'header',
        { class: 'modal__header' },
        chips.length ? h('ul', { class: 'chips', role: 'list' }, chips.map((c) => h('li', { class: 'chip' }, c))) : null,
        h('h2', { class: 'modal__title', id: 'project-modal-title' }, project.title),
        isFilled(project.short_desc) ? h('p', { class: 'modal__lead' }, clean(project.short_desc)) : null
      ),
      buildModalMedia(project),
      h('div', { class: 'modal__body' }, blocks)
    ];
  }

  function renderProjects({ rows }) {
    const root = $('#projects-root');
    const modal = $('#project-modal');
    const buttons = $$('.segmented__btn[data-filter]');
    if (!root) return;
    if (!rows) {
      root.replaceChildren(loadError('Projects'));
      return;
    }

    const projects = rows.filter((p) => isFilled(p?.title)).map(normalizeProject).sort(bySortOrder);

    const openProject = (project, opener) => {
      const panel = $('.modal__panel', modal);
      panel.replaceChildren(...buildProjectDetail(project));
      panel.scrollTop = 0;
      openDialog(modal, opener);
    };

    const cards = projects.map((project) => ({ project, card: buildProjectCard(project, openProject) }));
    root.replaceChildren(...cards.map(({ card }) => card));

    // Hide a filter button if it has nothing to show
    buttons.forEach((btn) => {
      btn.hidden = !projects.some((p) => p.category === btn.dataset.filter);
    });

    const applyFilter = (filter) => {
      buttons.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter)));
      cards.forEach(({ project, card }) => {
        card.hidden = project.category !== filter;
      });
    };

    buttons.forEach((btn) => btn.addEventListener('click', () => applyFilter(btn.dataset.filter)));

    const initial = buttons.find((b) => !b.hidden && b.getAttribute('aria-pressed') === 'true') || buttons.find((b) => !b.hidden);
    if (initial) applyFilter(initial.dataset.filter);
  }


  /* ------------------------------------------------------------------------
     9. Dialog plumbing — native <dialog> gives focus trapping and Esc-to-close.
     ------------------------------------------------------------------------ */
  const openers = new WeakMap();

  function openDialog(dialog, opener) {
    if (!dialog) return;
    openers.set(dialog, opener || document.activeElement);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.documentElement.classList.add('has-modal');
    $('[data-close]', dialog)?.focus();
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
  }

  function setupDialog(dialog) {
    if (!dialog) return;
    // Click on the backdrop (or empty panel area of the image viewer) closes
    dialog.addEventListener('click', (event) => {
      const target = event.target;
      if (target === dialog || target.classList.contains('modal__figure') || target.classList.contains('modal__image-slot')) {
        closeDialog(dialog);
      }
    });
    $$('[data-close]', dialog).forEach((btn) => btn.addEventListener('click', () => closeDialog(dialog)));
    // Fallback Esc for browsers without native modal support
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && typeof dialog.showModal !== 'function') closeDialog(dialog);
    });
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('has-modal');
      const opener = openers.get(dialog);
      if (opener && document.contains(opener)) opener.focus();
    });
  }


  /* ------------------------------------------------------------------------
     10. Organization Experience + Education
     ------------------------------------------------------------------------ */

  /** Uploaded logo, or a monogram tile when there is none or it fails to load. */
  function buildLogo(rawUrl, name) {
    const tile = h('span', { class: 'logo-tile', 'aria-hidden': 'true' });
    const mark = () => {
      tile.classList.remove('logo-tile--image');
      tile.replaceChildren(h('span', { class: 'logo-tile__mark' }, monogram(name)));
    };
    const src = safeUrl(rawUrl);
    if (!src) {
      mark();
      return tile;
    }
    const img = h('img', { alt: '', width: 56, height: 56, loading: 'lazy', decoding: 'async' });
    tile.classList.add('logo-tile--image');
    tile.append(img);
    bindImage(img, mark);
    img.src = src;
    return tile;
  }

  /** bullets is a jsonb array of strings; anything else is ignored. */
  const bulletList = (value) =>
    (Array.isArray(value) ? value : []).filter((item) => typeof item === 'string' && isFilled(item)).map(clean).slice(0, 8);

  /**
   * Bullet points of one entry as objects: { id, text, photos: [{ url, caption }] }.
   * bullet_items wins when it is an array (an empty array means "no bullets on
   * purpose"); a row that predates that column falls back to the `bullets` strings.
   * experience-bullets.js does the conversion; without it, text-only bullets still show.
   */
  function experienceBullets(entry) {
    const core = window.ExperienceBullets;
    if (core) return core.itemsFromRow(entry, { maxItems: 8 });
    return bulletList(entry?.bullets).map((text) => ({ id: null, text, photos: [] }));
  }

  /** Open one evidence photo in the shared image modal (Esc / close button / backdrop). */
  function openImageModal(modal, { src, alt, caption }, opener) {
    const slot = $('.modal__image-slot', modal);
    const full = h('img', { alt, decoding: 'async' });
    bindImage(full, () => slot.replaceChildren(placeholder({ variant: 'dark', glyph: 'image' })));
    full.src = src;
    slot.replaceChildren(full);
    $('.modal__caption', modal).textContent = caption;
    openDialog(modal, opener);
  }

  /**
   * Compact evidence thumbnails for ONE bullet point. Returns null when the bullet
   * has no usable photo, so a bullet without evidence stays completely clean.
   * A thumbnail that fails to load removes itself (never a broken or empty box).
   */
  function buildBulletEvidence(photos, { text, organization }, modal) {
    if (!modal || !Array.isArray(photos) || !photos.length) return null;

    const list = h('ul', { class: 'xp-evidence', role: 'list' });
    const usable = photos.filter((photo) => safeUrl(photo?.url));

    usable.forEach((photo, index) => {
      const src = safeUrl(photo.url);
      const caption = clean(photo.caption);
      const position = usable.length > 1 ? ` ${index + 1} of ${usable.length}` : '';
      // Alt text describes the evidence; with a caption the caption carries the meaning.
      const alt = caption || [`Evidence${position} for: ${text}`, organization].filter(Boolean).join(' — ');
      const button = h('button', {
        class: 'xp-evidence__btn',
        type: 'button',
        'aria-haspopup': 'dialog',
        'aria-label': `View evidence photo${position} larger: ${caption || text}`
      });
      const img = h('img', { class: 'xp-evidence__img', alt: caption ? '' : alt, width: 320, height: 240, loading: 'lazy', decoding: 'async' });
      const item = h(
        'li',
        { class: 'xp-evidence__item' },
        h(
          'figure',
          { class: 'xp-evidence__figure' },
          button,
          caption ? h('figcaption', { class: 'xp-evidence__caption' }, caption) : null
        )
      );

      button.append(img, h('span', { class: 'xp-evidence__zoom', 'aria-hidden': 'true' }, icon('expand')));
      button.addEventListener('click', () =>
        openImageModal(modal, { src, alt, caption: [caption || text, organization].filter(Boolean).join(' — ') }, button)
      );

      // In the list before the image starts loading, so a failing photo can remove itself.
      list.append(item);
      bindImage(img, () => {
        item.remove();
        if (!list.children.length) list.remove();
      });
      img.src = src;
    });

    return list.children.length ? list : null;
  }

  function buildBullet(item, context, modal) {
    const evidence = buildBulletEvidence(item.photos, { text: item.text, organization: context.organization }, modal);
    return h(
      'li',
      { class: `xp-bullet${evidence ? ' has-evidence' : ''}` },
      h('span', { class: 'xp-bullet__text' }, item.text),
      evidence
    );
  }

  function buildExperienceItem(entry, modal) {
    const organization = clean(entry.organization);
    const role = clean(entry.role);
    const location = clean(entry.location);
    const showMonths = entry.show_months !== false;
    const current = entry.is_current === true;
    const start = formatMonth(entry.start_date, showMonths);
    const end = current ? 'Present' : formatMonth(entry.end_date, showMonths);
    const period = periodText(start, end);
    const bullets = experienceBullets(entry).filter((item) => isFilled(item.text));

    const chips = [
      period ? h('span', { class: `xp-chip${current ? ' xp-chip--now' : ''}` }, period) : null,
      location ? h('span', { class: 'xp-chip' }, location) : null
    ].filter(Boolean);

    return h(
      'li',
      { class: `xp-item reveal${current ? ' is-current' : ''}` },
      h('span', { class: 'xp-item__dot', 'aria-hidden': 'true' }),
      h(
        'article',
        { class: 'xp-card' },
        h(
          'header',
          { class: 'xp-card__head' },
          buildLogo(entry.logo_url, organization),
          h(
            'div',
            { class: 'xp-card__titles' },
            h('h3', { class: 'xp-card__org' }, organization),
            role ? h('p', { class: 'xp-card__role' }, role) : null
          )
        ),
        chips.length ? h('p', { class: 'xp-card__meta' }, chips) : null,
        bullets.length
          ? h('ul', { class: 'xp-card__bullets', role: 'list' }, bullets.map((item) => buildBullet(item, { organization }, modal)))
          : null
      )
    );
  }

  /** Returns the number of entries shown (0 → the section is hidden). */
  function renderExperience({ rows }) {
    const root = $('#experience-root');
    if (!root) return 0;
    const modal = $('#image-modal');
    const entries = (rows || [])
      .filter((row) => row?.is_visible !== false && isFilled(row?.organization))
      .sort(byOrderThenStart);
    replaceRevealing(root, entries.map((entry) => buildExperienceItem(entry, modal)));
    return entries.length;
  }

  function buildEducationCard(entry) {
    const institution = clean(entry.institution);
    const showMonths = entry.show_months !== false;
    const start = formatMonth(entry.start_date, showMonths);
    const end = clean(entry.end_label) || formatMonth(entry.end_date, showMonths);
    const period = periodText(start, end);
    const degree = clean(entry.degree);
    const field = clean(entry.field_of_study);
    const gpa = clean(entry.gpa);
    const description = clean(entry.description);

    // .reveal sits on a wrapper so it never fights the card's hover transform
    const card = h(
      'article',
      { class: 'edu-card' },
      h(
        'div',
        { class: 'edu-card__top' },
        buildLogo(entry.logo_url, institution),
        period ? h('p', { class: 'edu-card__period' }, period) : null
      ),
      h('h3', { class: 'edu-card__institution' }, institution),
      degree ? h('p', { class: 'edu-card__degree' }, degree) : null,
      field ? h('p', { class: 'edu-card__field' }, field) : null,
      gpa ? h('dl', { class: 'edu-card__facts' }, h('div', {}, h('dt', {}, 'GPA'), h('dd', {}, gpa))) : null,
      description ? h('p', { class: 'edu-card__desc' }, ...withBreaks(description)) : null
    );
    return h('div', { class: 'edu-item reveal' }, card);
  }

  function renderEducation({ rows }) {
    const root = $('#education-root');
    if (!root) return 0;
    const entries = (rows || [])
      .filter((row) => row?.is_visible !== false && isFilled(row?.institution))
      .sort(byOrderThenStart);
    replaceRevealing(root, entries.map(buildEducationCard));
    return entries.length;
  }


  /* ------------------------------------------------------------------------
     11. Certifications + image modal
     ------------------------------------------------------------------------ */
  function certPlaceholder() {
    return h(
      'div',
      { class: 'cert-card__media cert-card__media--empty' },
      placeholder({ variant: 'auto', glyph: 'certificate', note: 'Image coming soon' })
    );
  }

  const todayIso = () => new Date().toISOString().slice(0, 10);

  function buildCertCard(cert, modal) {
    const title = clean(cert.title);
    const issuer = clean(cert.issuer);
    const issued = formatDate(cert.issued_date);
    const expiry = formatDate(cert.expiry_date);
    const expired = Boolean(expiry) && String(cert.expiry_date).slice(0, 10) < todayIso();
    const src = safeUrl(cert.image_url);
    const credential = safeUrl(cert.credential_url);
    const alt = [title, issuer && `certificate issued by ${issuer}`, issued && `on ${issued}`].filter(Boolean).join(' ');

    let media;
    if (src) {
      media = h('button', {
        class: 'cert-card__media',
        type: 'button',
        'aria-haspopup': 'dialog',
        'aria-label': `View ${title} certificate full size`
      });
      const img = h('img', { alt, width: 880, height: 623, loading: 'lazy', decoding: 'async' });
      bindImage(img, () => media.replaceWith(certPlaceholder()));
      img.src = src;
      media.append(img, h('span', { class: 'cert-card__hint', 'aria-hidden': 'true' }, icon('expand'), 'View full size'));

      media.addEventListener('click', () => {
        const slot = $('.modal__image-slot', modal);
        const full = h('img', { alt, decoding: 'async' });
        bindImage(full, () => slot.replaceChildren(placeholder({ variant: 'dark', glyph: 'certificate' })));
        full.src = src;
        slot.replaceChildren(full);
        $('.modal__caption', modal).textContent = [title, issuer].filter(Boolean).join(' — ');
        openDialog(modal, media);
      });
    } else {
      media = certPlaceholder();
    }

    const meta = [
      issued ? h('div', {}, h('dt', {}, 'Issued'), h('dd', {}, issued)) : null,
      expiry ? h('div', {}, h('dt', {}, expired ? 'Expired' : 'Expires'), h('dd', {}, expiry)) : null
    ].filter(Boolean);

    // Only https links become a "Show credential" button
    const link = /^https:/.test(credential)
      ? h(
          'a',
          { class: 'cert-card__link', href: credential, target: '_blank', rel: 'noopener noreferrer' },
          'Show credential',
          icon('external'),
          h('span', { class: 'visually-hidden' }, ' (opens in a new tab)')
        )
      : null;

    const card = h(
      'article',
      { class: 'cert-card' },
      media,
      h(
        'div',
        { class: 'cert-card__body' },
        h('span', { class: 'cert-card__seal', 'aria-hidden': 'true' }, icon('seal')),
        h('h3', { class: 'cert-card__title' }, title),
        issuer ? h('p', { class: 'cert-card__issuer' }, issuer) : null,
        meta.length ? h('dl', { class: 'cert-card__meta' }, meta) : null,
        link
      )
    );
    return h('div', { class: 'cert-item reveal' }, card);
  }

  function renderCertificates({ rows }) {
    const root = $('#cert-root');
    const modal = $('#image-modal');
    if (!root || !modal) return 0;
    const certs = (rows || []).filter((c) => c?.is_visible !== false && isFilled(c?.title)).sort(bySortOrder);
    root.dataset.count = String(Math.min(certs.length, 3));
    replaceRevealing(root, certs.map((cert) => buildCertCard(cert, modal)));
    return certs.length;
  }


  /* ------------------------------------------------------------------------
     12. Section visibility
         A section is hidden (with its nav link) when it is switched off in
         Admin → Sections (profile.hidden_sections) or has no visible entries.
         Sections marked data-theme="auto" are then re-striped so the page
         keeps alternating black / white.
     ------------------------------------------------------------------------ */
  const SECTION_KEYS = ['skills', 'experience', 'projects', 'education', 'certifications'];

  function applySectionVisibility(hiddenKeys) {
    for (const key of SECTION_KEYS) {
      const hidden = hiddenKeys.has(key);
      const section = $(`main > section[data-section="${key}"]`);
      if (section) section.hidden = hidden;
      $$(`[data-nav="${key}"]`).forEach((item) => {
        item.hidden = hidden;
      });
    }

    const visible = $$('main > section[id]').filter((section) => !section.hidden);
    visible.forEach((section, index) => {
      if (section.dataset.theme !== 'auto') return;
      const dark = index % 2 === 0; // hero (index 0) is black
      const light = section.id === 'contact' ? 'section--white' : 'section--light';
      section.classList.remove('section--dark', 'section--light', 'section--white');
      section.classList.add(dark ? 'section--dark' : light);
    });
  }


  /* ------------------------------------------------------------------------
     13. Boot
     ------------------------------------------------------------------------ */
  function initYear() {
    const year = String(new Date().getFullYear());
    $$('[data-year]').forEach((node) => {
      node.textContent = year;
    });
  }

  async function initContent() {
    let content;
    try {
      content = await loadContent();
    } catch (error) {
      console.warn(error);
      const none = { rows: null };
      content = { profile: none, skills: none, projects: none, experience: none, education: none, certificates: none, categories: [] };
    }

    // Each renderer is isolated: one failing section never blanks the others.
    const run = (label, fn) => {
      try {
        return fn();
      } catch (error) {
        console.error(`${label} failed to render`, error);
        return undefined;
      }
    };

    const profile = content.profile.rows?.[0];
    run('Profile', () => renderProfile(profile));
    run('Skills', () => renderSkills(content.skills, content.categories));
    run('Projects', () => renderProjects(content.projects));
    const counts = {
      experience: run('Experience', () => renderExperience(content.experience)),
      education: run('Education', () => renderEducation(content.education)),
      certifications: run('Certifications', () => renderCertificates(content.certificates))
    };

    const hidden = new Set(
      (Array.isArray(profile?.hidden_sections) ? profile.hidden_sections : []).filter((key) => SECTION_KEYS.includes(key))
    );
    // Empty sections disappear; a renderer that crashed (undefined) keeps its static content.
    Object.entries(counts).forEach(([key, count]) => count === 0 && hidden.add(key));
    run('Sections', () => applySectionVisibility(hidden));
  }

  function init() {
    initNav();
    initYear();
    setupDialog($('#project-modal'));
    setupDialog($('#image-modal'));
    observeReveal();
    initContent();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
