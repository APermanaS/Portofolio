/* ==========================================================================
   Project links — shared core (no DOM, no build step)
   --------------------------------------------------------------------------
   The "Additional links" of one project, stored in public.projects.external_links
   (jsonb, NOT NULL, default []; added by
   supabase/migrations/20261012_project_custom_links.sql):

     [ { "id": "l-1a2b3c4d5e", "label": "…", "url": "https://…",
         "description": "optional" } ]

   * The array order is the display order (the admin arrows reorder the objects).
   * Only https:// links are accepted and rendered: javascript:, data:, http:,
     protocol-relative and relative URLs are refused.
   * repo_url and doc_url are separate columns and are never touched here.
   * A row from before the migration (no external_links key) simply has no links.

   Loaded as a plain <script> by index.html and admin.html (globalThis.ProjectLinks)
   and required directly by the tests in tests/ (module.exports).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  const api = factory();
  root.ProjectLinks = api;
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Mirrors the CHECK constraint in the migration (public.project_external_links_valid). */
  const LIMITS = Object.freeze({
    items: 8,
    label: 60,
    url: 500,
    description: 160,
    id: 64
  });

  /** Same shape as the url CHECK constraints in schema.sql (and HTTPS_RE in admin.js). */
  const HTTPS_RE = /^https:\/\/[^\s<>"'`]+$/;
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  /** "javascript:", "data:", "http:" … — but not "example.com:8080" or "localhost:3000" (host:port). */
  const SCHEME_RE = /^([a-z][a-z0-9+-]*):(?!\d)/i;

  /** https://user:password@host — refused, because the link is published on the site. */
  function hasCredentials(value) {
    try {
      const url = new URL(value);
      return Boolean(url.username || url.password);
    } catch {
      return false;
    }
  }

  /** Remove control / bidi-override characters and collapse whitespace (same as admin.js). */
  function sanitizeText(value) {
    return String(value ?? '')
      .normalize('NFC')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * A full https:// link with a real host name (same rule as isHttpsUrl in admin.js),
   * without user:password@ in it, because the link is published on the site.
   */
  function isHttpsUrl(value) {
    if (typeof value !== 'string' || value.length > LIMITS.url || !HTTPS_RE.test(value)) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  let idCounter = 0;

  /** Stable, short link id (never derived from the position). */
  function newId() {
    const hex = globalThis.crypto?.getRandomValues
      ? [...globalThis.crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('')
      : `${Date.now().toString(16)}${(idCounter += 1).toString(16)}`;
    return `l-${hex}`.slice(0, LIMITS.id);
  }

  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  /** Gives every link a valid id that is unique within the list. */
  function uniqueId(candidate, seen) {
    let id = typeof candidate === 'string' && ID_RE.test(candidate) ? candidate : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    return id;
  }

  /* ----------------------------------------------------------------------
     Public read path (strict): only links that are safe to show.
     ---------------------------------------------------------------------- */

  /** One stored link → { id, label, url, description? }, or null when it must not be shown. */
  function normalizeLink(value) {
    if (!isObject(value) || typeof value.label !== 'string' || typeof value.url !== 'string') return null;
    const label = sanitizeText(value.label).slice(0, LIMITS.label);
    const url = value.url.trim();
    if (!label || !isHttpsUrl(url)) return null;
    const description = typeof value.description === 'string' ? sanitizeText(value.description).slice(0, LIMITS.description) : '';
    return { id: value.id, label, url, ...(description ? { description } : {}) };
  }

  /** A stored external_links value → safe links in their saved order (max LIMITS.items). */
  function normalizeLinks(value, { maxItems = LIMITS.items } = {}) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .map(normalizeLink)
      .filter(Boolean)
      .slice(0, maxItems)
      .map((link) => ({ ...link, id: uniqueId(link.id, seen) }));
  }

  /** Used by the public site. A row without external_links (legacy) → []. */
  const linksFromRow = (row, options) => normalizeLinks(row?.external_links, options);

  /* ----------------------------------------------------------------------
     Admin editor
     ---------------------------------------------------------------------- */

  /**
   * Stored links → editor drafts { id, label, url, description }. Lenient on purpose:
   * an entry the public site would hide is still shown in the editor (and flagged on
   * Save) instead of silently disappearing and being lost on the next save.
   */
  function toDrafts(value) {
    const seen = new Set();
    const text = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
    return (Array.isArray(value) ? value : [])
      .filter(isObject)
      .map((item) => ({
        id: uniqueId(item.id, seen),
        label: text(item.label),
        url: text(item.url),
        description: text(item.description)
      }));
  }

  /**
   * Validate editor drafts before saving.
   *   { ok: true, links }                 clean links, ready for serialize()
   *   { ok: false, error, errors }        error = one summary line for the field,
   *                                       errors = [{ index, field, message }] so the
   *                                       editor can mark the exact input
   * index is the position in the given array (= "Link N" in the editor, N = index + 1).
   * A card left completely empty is ignored. Nothing in `value` is modified.
   */
  function validateLinks(value, {
    maxItems = LIMITS.items,
    maxLabel = LIMITS.label,
    maxUrl = LIMITS.url,
    maxDescription = LIMITS.description
  } = {}) {
    if (!Array.isArray(value)) {
      return { ok: false, error: 'The links could not be read. Please reload the page.', errors: [] };
    }

    const links = [];
    const errors = [];
    const seen = new Set();

    value.forEach((raw, index) => {
      const draft = isObject(raw) ? raw : {};
      const label = sanitizeText(draft.label);
      const url = sanitizeText(draft.url);
      const description = sanitizeText(draft.description);
      if (!label && !url && !description) return; // an empty card → ignored

      const before = errors.length;
      const fail = (field, message) => errors.push({ index, field, message });

      if (!label) fail('label', 'Please add a label (the text visitors click).');
      else if (label.length > maxLabel) fail('label', `Please keep the label under ${maxLabel} characters (now ${label.length}).`);

      const scheme = SCHEME_RE.exec(url)?.[1];
      if (!url) fail('url', 'Please add the link address.');
      else if (url.length > maxUrl) fail('url', `Please keep the link under ${maxUrl} characters (now ${url.length}).`);
      else if (scheme && scheme.toLowerCase() !== 'https') fail('url', `Only https:// links are allowed here, not \u201c${scheme.toLowerCase()}:\u201d.`);
      else if (/\s/.test(url)) fail('url', 'A link can\u2019t contain spaces. Please check the address.');
      else if (hasCredentials(url)) fail('url', 'Please remove the user name or password from the link.');
      else if (!isHttpsUrl(url)) fail('url', 'Please enter a full link that starts with https://');

      if (description.length > maxDescription) {
        fail('description', `Please keep the description under ${maxDescription} characters (now ${description.length}).`);
      }

      if (errors.length > before) return;
      const id = uniqueId(draft.id, seen);
      links.push(description ? { id, label, url, description } : { id, label, url });
    });

    if (errors.length) {
      const [first] = errors;
      const more = errors.length - 1;
      const tail = more ? ` (${more} more ${more === 1 ? 'problem' : 'problems'} highlighted below)` : '';
      return { ok: false, error: `Link ${first.index + 1}: ${first.message}${tail}`, errors };
    }
    if (links.length > maxItems) return { ok: false, error: `You can add at most ${maxItems} links.`, errors: [] };
    return { ok: true, links, errors: [] };
  }

  /** What a save writes to external_links: no empty description key, nothing else. */
  function serialize(links) {
    return (Array.isArray(links) ? links : []).map((link) =>
      link.description
        ? { id: link.id, label: link.label, url: link.url, description: link.description }
        : { id: link.id, label: link.label, url: link.url }
    );
  }

  /** Move one link (the whole object) up or down. Mutates and returns true when it moved. */
  function moveLink(items, index, delta) {
    if (!Array.isArray(items)) return false;
    const target = index + delta;
    if (index < 0 || index >= items.length || target < 0 || target >= items.length) return false;
    const [item] = items.splice(index, 1);
    items.splice(target, 0, item);
    return true;
  }

  /* ----------------------------------------------------------------------
     Storage references — an additional link may point at a file in the
     "portfolio-assets" bucket (e.g. pasted from Files → Copy link). The admin
     Files page counts those as "used", so the cleanup never deletes them.
     ---------------------------------------------------------------------- */

  /** Every link URL with its position and label (duplicates kept). */
  function linkRefs(value) {
    return (Array.isArray(value) ? value : []).flatMap((link, index) =>
      isObject(link) && typeof link.url === 'string' && link.url
        ? [{ url: link.url, index, label: sanitizeText(link.label) }]
        : []
    );
  }

  /**
   * Drop the links that point at a deleted file (Files page: "delete this file").
   * `match` is the exact URL, or a function (url) → boolean, e.g. "same storage path",
   * so ".../x.pdf#page=2" goes together with ".../x.pdf". Other links stay as they are.
   */
  function removeUrl(value, match) {
    const links = Array.isArray(value) ? value : [];
    const hit = typeof match === 'function' ? match : (url) => url === match;
    const kept = links.filter((link) => !(isObject(link) && typeof link.url === 'string' && hit(link.url)));
    return { external_links: kept, removed: links.length - kept.length };
  }

  return Object.freeze({
    LIMITS,
    sanitizeText,
    isHttpsUrl,
    newId,
    normalizeLink,
    normalizeLinks,
    linksFromRow,
    toDrafts,
    validateLinks,
    serialize,
    moveLink,
    linkRefs,
    removeUrl
  });
});
