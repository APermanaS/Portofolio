/* ==========================================================================
   Andhika Permana Sagiyono — Portfolio
   Vanilla JS, no dependencies, no build step.
   --------------------------------------------------------------------------
   1. Helpers
   2. Scroll reveal
   3. Navigation (mobile menu + active link)
   4. Images (fallback to placeholders, never a broken image)
   5. Skills (skills.json)
   6. Projects (projects.json) + project modal
   7. Dialog plumbing (shared by all modals)
   8. Certificate + image modal
   9. About photo, footer year
   10. Boot
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

  const bySortOrder = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);

  const slugify = (text) =>
    String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

  /** Trusted, static inline SVG icons (stroke-based, inherit currentColor). */
  const ICONS = {
    arrowRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>',
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


  /* ------------------------------------------------------------------------
     5. Skills
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

  function buildSkillTile(skill) {
    const iconBox = h('span', { class: 'skill-tile__icon', 'aria-hidden': 'true' });
    const useMonogram = () => {
      iconBox.replaceChildren(h('span', { class: 'skill-tile__monogram' }, monogram(skill.name)));
    };

    if (isFilled(skill.icon)) {
      const file = skill.icon.trim().replace(/\.svg$/i, '');
      const img = h('img', { alt: '', width: 28, height: 28, loading: 'lazy', decoding: 'async' });
      bindImage(img, useMonogram);
      img.src = `assets/icons/${encodeURIComponent(file)}.svg`;
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
        h('span', { class: 'skill-tile__name' }, skill.name.trim()),
        isFilled(skill.level) ? h('span', { class: 'skill-tile__level' }, skill.level.trim()) : null
      )
    );
  }

  function buildSkillCategory(name, meta, skills) {
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
        h('ul', { class: 'skill-grid', role: 'list' }, skills.map(buildSkillTile))
      )
    );
  }

  async function initSkills() {
    const root = $('#skills-root');
    if (!root) return;

    let data;
    try {
      data = await fetchJSON('skills.json');
    } catch (error) {
      console.warn(error);
      root.replaceChildren(h('div', { class: 'container' }, loadError('Skills')));
      return;
    }

    const categories = Array.isArray(data.categories) ? data.categories : [];
    const rawSkills = Array.isArray(data) ? data : Array.isArray(data.skills) ? data.skills : [];

    // Drop empty / [ISI MANUAL] skills, then group by category
    const groups = new Map();
    for (const skill of rawSkills) {
      if (!isFilled(skill?.name) || !isFilled(skill?.category)) continue;
      const category = skill.category.trim();
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(skill);
    }

    const metaFor = (name) => categories.find((c) => c.name === name);
    const orderOf = (name) => {
      const meta = metaFor(name);
      return meta ? Number(meta.sort_order) || 0 : Number.MAX_SAFE_INTEGER;
    };

    // Categories with no remaining entries never get rendered
    const fragment = document.createDocumentFragment();
    [...groups.keys()]
      .sort((a, b) => orderOf(a) - orderOf(b))
      .forEach((name) => {
        const skills = groups.get(name).sort(bySortOrder);
        if (skills.length) fragment.append(buildSkillCategory(name, metaFor(name), skills));
      });

    root.replaceChildren(fragment);
    observeReveal(root);
  }


  /* ------------------------------------------------------------------------
     6. Projects
     ------------------------------------------------------------------------ */
  const glyphFor = (project) => (project.category === 'documents' ? 'document' : 'code');

  const filledImages = (project) =>
    (Array.isArray(project.images) ? project.images : []).filter((img) => isFilled(img?.src));

  /** Cover image or an elegant placeholder; swaps to placeholder if the image fails. */
  function buildCardMedia(project) {
    const media = h('div', { class: 'project-card__media' });
    const fallback = () => media.replaceChildren(placeholder({ variant: project.category, glyph: glyphFor(project) }));
    const [cover] = filledImages(project);

    if (cover) {
      const img = h('img', {
        alt: isFilled(cover.alt) ? cover.alt : '',
        loading: 'lazy',
        decoding: 'async',
        width: cover.width || null,
        height: cover.height || null
      });
      bindImage(img, fallback);
      img.src = cover.src;
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
        isFilled(project.summary) ? h('p', { class: 'project-card__summary' }, project.summary) : null,
        isFilled(project.context) ? h('p', { class: 'project-card__context' }, project.context) : null,
        cta
      )
    );
  }

  /** Images in the modal; deferred/missing → placeholder card with the note from the content. */
  function buildModalMedia(project) {
    const wrap = h('div', { class: 'modal__media' });
    const images = filledImages(project);
    const note = isFilled(project.image_note) ? project.image_note : '';

    if (!images.length) {
      wrap.append(placeholder({ variant: project.category, glyph: glyphFor(project), note }));
      return wrap;
    }

    for (const image of images) {
      const figure = h('figure', { class: 'gallery__item' });
      const img = h('img', {
        alt: isFilled(image.alt) ? image.alt : project.title,
        loading: 'lazy',
        decoding: 'async',
        width: image.width || null,
        height: image.height || null
      });
      bindImage(img, () => figure.replaceWith(placeholder({ variant: project.category, glyph: 'image' })));
      img.src = image.src;
      figure.append(img);
      if (isFilled(image.caption)) figure.append(h('figcaption', {}, image.caption));
      wrap.append(figure);
    }
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

  const isLocalHref = (href) => !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#');

  function buildLinkGroup(group) {
    const links = (group.links || []).filter((link) => isFilled(link?.label) && isFilled(link?.href));
    if (!links.length || !isFilled(group.label)) return null;

    const items = links.map((link) => {
      const local = isLocalHref(link.href);
      return h(
        'li',
        // Local files are verified before being shown, so a missing PDF never becomes a dead link
        { 'data-verify': local ? link.href : null, hidden: local },
        h(
          'a',
          { class: 'link-chip', href: link.href, target: '_blank', rel: 'noopener noreferrer' },
          link.label,
          icon('external'),
          h('span', { class: 'visually-hidden' }, ' (opens in a new tab)')
        )
      );
    });

    const allLocal = items.every((item) => item.hasAttribute('data-verify'));
    return h(
      'section',
      { class: 'modal__block', 'data-link-group': true, hidden: allLocal },
      h('h3', {}, group.label),
      h('ul', { class: 'link-list', role: 'list' }, items)
    );
  }

  function buildProjectDetail(project) {
    const chips = [project.category_label, project.period, project.context].filter(isFilled);

    const blocks = (project.details || [])
      .filter((d) => isFilled(d?.label) && isFilled(d?.text))
      .map((d) =>
        h(
          'section',
          { class: 'modal__block' },
          h('h3', {}, d.label),
          d.type === 'flow' ? buildFlow(d.text) : h('p', {}, d.text)
        )
      );

    const linkGroups = (project.link_groups || []).map(buildLinkGroup).filter(Boolean);

    return [
      h(
        'header',
        { class: 'modal__header' },
        chips.length ? h('ul', { class: 'chips', role: 'list' }, chips.map((c) => h('li', { class: 'chip' }, c))) : null,
        h('h2', { class: 'modal__title', id: 'project-modal-title' }, project.title),
        isFilled(project.summary) ? h('p', { class: 'modal__lead' }, project.summary) : null
      ),
      buildModalMedia(project),
      h('div', { class: 'modal__body' }, blocks, linkGroups)
    ];
  }

  /** HEAD-check local documents once; network errors (e.g. offline) keep the link visible. */
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

  async function verifyLocalLinks(scope) {
    await Promise.all(
      $$('[data-link-group]', scope).map(async (group) => {
        await Promise.all(
          $$('[data-verify]', group).map(async (item) => {
            if (await resourceExists(item.dataset.verify)) item.hidden = false;
            else item.remove();
          })
        );
        if (!$('li', group)) group.remove();
        else group.hidden = !$('li:not([hidden])', group);
      })
    );
  }

  async function initProjects() {
    const root = $('#projects-root');
    const modal = $('#project-modal');
    const buttons = $$('.segmented__btn[data-filter]');
    if (!root) return;

    let projects;
    try {
      projects = await fetchJSON('projects.json');
    } catch (error) {
      console.warn(error);
      root.replaceChildren(loadError('Projects'));
      return;
    }

    projects = (Array.isArray(projects) ? projects : []).filter((p) => isFilled(p?.title));

    const openProject = (project, opener) => {
      const panel = $('.modal__panel', modal);
      panel.replaceChildren(...buildProjectDetail(project));
      panel.scrollTop = 0;
      openDialog(modal, opener);
      verifyLocalLinks(panel);
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
     7. Dialog plumbing — native <dialog> gives focus trapping and Esc-to-close.
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
     8. Certificate + image modal
     ------------------------------------------------------------------------ */
  function initCertificate() {
    const trigger = $('#cert-trigger');
    const modal = $('#image-modal');
    if (!trigger || !modal) return;

    const thumb = $('img', trigger);
    const title = $('.cert-card__title')?.textContent.trim() || '';
    const issuer = $('.cert-card__meta dd')?.textContent.trim() || '';

    if (thumb) {
      bindImage(thumb, () => {
        trigger.disabled = true;
        trigger.removeAttribute('aria-haspopup');
        trigger.replaceChildren(placeholder({ variant: 'dark', glyph: 'certificate' }));
      });
    }

    trigger.addEventListener('click', () => {
      const slot = $('.modal__image-slot', modal);
      const img = h('img', { alt: thumb?.alt || title, decoding: 'async' });
      bindImage(img, () => slot.replaceChildren(placeholder({ variant: 'dark', glyph: 'certificate' })));
      img.src = trigger.dataset.full || thumb?.currentSrc || thumb?.src;
      slot.replaceChildren(img);
      $('.modal__caption', modal).textContent = [title, issuer].filter(Boolean).join(' — ');
      openDialog(modal, trigger);
    });
  }


  /* ------------------------------------------------------------------------
     9. About photo, footer year
     ------------------------------------------------------------------------ */
  function initPhoto() {
    const figure = $('[data-photo-src]');
    const src = figure?.dataset.photoSrc?.trim();
    if (!figure || !src) return; // keep the placeholder; no request = no 404

    const img = h('img', {
      class: 'about__photo-img',
      alt: figure.dataset.photoAlt || '',
      loading: 'lazy',
      decoding: 'async',
      width: 800,
      height: 1000
    });
    bindImage(img, () => img.remove());
    img.src = src;
    figure.append(img);
  }

  function initYear() {
    const year = String(new Date().getFullYear());
    $$('[data-year]').forEach((node) => {
      node.textContent = year;
    });
  }


  /* ------------------------------------------------------------------------
     10. Boot
     ------------------------------------------------------------------------ */
  function init() {
    initNav();
    initYear();
    initPhoto();
    setupDialog($('#project-modal'));
    setupDialog($('#image-modal'));
    initCertificate();
    observeReveal();
    initSkills();
    initProjects();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
