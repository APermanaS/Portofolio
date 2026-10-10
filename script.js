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
   10. Certificates + image modal
   11. Boot

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
    profile: 'name, tagline, subtagline, about_text, stats, email, linkedin, github, photo_url, cv_url',
    skills: 'id, category, name, level, icon_url, sort_order',
    projects: 'id, title, category, short_desc, detail_desc, role, tools, result, period, repo_url, image_url, doc_url, sort_order',
    certificates: 'id, title, issuer, issued_date, image_url, sort_order'
  };

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

    const query = (table) => {
      let builder = client.from(table).select(COLUMNS[table]);
      builder = table === 'profile'
        ? builder.limit(1)
        : builder.eq('is_visible', true).order('sort_order', { ascending: true }).order('id', { ascending: true });
      return builder.abortSignal(controller.signal);
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
      if (Array.isArray(rows) && rows.length) return { rows, source: 'remote' };
      const fallback = table === 'profile' ? (local?.profile ? [local.profile] : null) : local?.[table];
      return { rows: Array.isArray(fallback) ? fallback : null, source: 'local' };
    };

    return {
      local,
      profile: pick('profile'),
      skills: pick('skills'),
      projects: pick('projects'),
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
     7. Skills
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

  function buildSkillTile(skill, bundledIcon) {
    const iconBox = h('span', { class: 'skill-tile__icon', 'aria-hidden': 'true' });
    const useMonogram = () => {
      iconBox.replaceChildren(h('span', { class: 'skill-tile__monogram' }, monogram(skill.name)));
    };

    // Uploaded icon (png/webp) first, then the bundled monochrome SVG, then a monogram.
    const src = safeUrl(skill.icon_url) || safeUrl(bundledIcon);

    if (src) {
      const img = h('img', {
        alt: '',
        width: 28,
        height: 28,
        loading: 'lazy',
        decoding: 'async',
        class: src.startsWith('assets/icons/') ? null : 'is-uploaded'
      });
      bindImage(img, useMonogram);
      img.src = src;
      iconBox.append(img);
    } else {
      useMonogram();
    }

    return h(
      'li',
      { class: 'reveal' },
      h(
        'div',
        { class: 'skill-tile' },
        iconBox,
        h('span', { class: 'skill-tile__name' }, clean(skill.name)),
        clean(skill.level) ? h('span', { class: 'skill-tile__level' }, clean(skill.level)) : null
      )
    );
  }

  function buildSkillCategory(name, meta, skills, iconFor) {
    const key = isFilled(meta?.key) ? meta.key : slugify(name);
    const headingId = `skills-${key}`;
    const headline = meta?.headline || {};
    const lead = isFilled(headline.lead) ? headline.lead : name;

    return h(
      'section',
      { class: 'skill-cat', 'data-category': key, 'aria-labelledby': headingId },
      h('div', { class: 'ornament', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'container' },
        h('p', { class: 'skill-cat__label reveal' }, name),
        h(
          'h3',
          { class: 'skill-cat__headline reveal', id: headingId },
          h('span', { class: 'skill-cat__lead' }, lead),
          isFilled(headline.accent) ? [' ', h('em', { class: 'skill-cat__accent' }, headline.accent)] : null,
          isFilled(headline.rest) ? [' ', h('span', { class: 'skill-cat__rest' }, headline.rest)] : null
        ),
        h('ul', { class: 'skill-grid', role: 'list' }, skills.map((skill) => buildSkillTile(skill, iconFor(skill))))
      )
    );
  }

  function renderSkills({ rows }, categories, local) {
    const root = $('#skills-root');
    if (!root) return;
    if (!rows) {
      root.replaceChildren(h('div', { class: 'container' }, loadError('Skills')));
      return;
    }

    // Bundled SVG icons (repo files) keep working for skills without an uploaded icon.
    const bundled = new Map(
      (local?.skills || [])
        .filter((s) => isFilled(s?.name) && safeUrl(s.icon_url).startsWith('assets/icons/'))
        .map((s) => [s.name.trim().toLowerCase(), s.icon_url])
    );
    const iconFor = (skill) => bundled.get(clean(skill.name).toLowerCase()) || '';

    // Drop empty / [ISI MANUAL] skills, then group by category (first-seen order)
    const groups = new Map();
    for (const skill of rows) {
      if (!isFilled(skill?.name) || !isFilled(skill?.category)) continue;
      const category = skill.category.trim();
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(skill);
    }

    const metaFor = (name) => categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    const seen = [...groups.keys()];
    const orderOf = (name) => {
      const meta = metaFor(name);
      return meta ? Number(meta.sort_order) || 0 : 1000 + seen.indexOf(name);
    };

    // Categories with no remaining entries never get rendered
    const fragment = document.createDocumentFragment();
    seen
      .sort((a, b) => orderOf(a) - orderOf(b))
      .forEach((name) => {
        const skills = groups.get(name).sort(bySortOrder);
        if (skills.length) fragment.append(buildSkillCategory(name, metaFor(name), skills, iconFor));
      });

    root.replaceChildren(fragment);
    observeReveal(root);
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
     10. Certificates + image modal
     ------------------------------------------------------------------------ */
  function certPlaceholder() {
    return h(
      'div',
      { class: 'cert-card__media cert-card__media--empty' },
      placeholder({ variant: 'dark', glyph: 'certificate', note: 'Image coming soon' })
    );
  }

  function buildCertCard(cert, modal) {
    const title = clean(cert.title);
    const issuer = clean(cert.issuer);
    const issued = formatDate(cert.issued_date);
    const src = safeUrl(cert.image_url);
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
      issuer ? h('div', {}, h('dt', {}, 'Issuer'), h('dd', {}, issuer)) : null,
      issued ? h('div', {}, h('dt', {}, 'Issued'), h('dd', {}, issued)) : null
    ].filter(Boolean);

    return h(
      'article',
      { class: 'cert-card' },
      media,
      h(
        'div',
        { class: 'cert-card__body' },
        h('h4', { class: 'cert-card__title' }, title),
        meta.length ? h('dl', { class: 'cert-card__meta' }, meta) : null
      )
    );
  }

  function renderCertificates({ rows }) {
    const root = $('#cert-root');
    const modal = $('#image-modal');
    if (!root || !modal) return;
    if (!rows) {
      root.replaceChildren(loadError('Certificates'));
      return;
    }

    const certs = rows.filter((c) => isFilled(c?.title)).sort(bySortOrder);
    const heading = $('[data-cert-heading]');
    if (heading) heading.textContent = certs.length > 1 ? 'Certificates' : 'Certificate';
    root.replaceChildren(...certs.map((cert) => buildCertCard(cert, modal)));
  }


  /* ------------------------------------------------------------------------
     11. Boot
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
      content = { profile: { rows: null }, skills: { rows: null }, projects: { rows: null }, certificates: { rows: null }, categories: [] };
    }

    // Each renderer is isolated: one failing section never blanks the others.
    const run = (label, fn) => {
      try {
        fn();
      } catch (error) {
        console.error(`${label} failed to render`, error);
      }
    };

    run('Profile', () => renderProfile(content.profile.rows?.[0]));
    run('Skills', () => renderSkills(content.skills, content.categories, content.local));
    run('Projects', () => renderProjects(content.projects));
    run('Certificates', () => renderCertificates(content.certificates));
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
