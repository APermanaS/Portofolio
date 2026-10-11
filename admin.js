/* ==========================================================================
   Portfolio Admin — Supabase Auth + Database + Storage
   Vanilla JS, no build step.
   --------------------------------------------------------------------------
   1. Constants & config
   2. Helpers (DOM, text sanitising, formatting, icons)
   3. Toasts & confirm dialog
   4. Errors (friendly messages, expired sessions)
   5. Data layer (tables)
   6. Storage (upload with progress, delete, list)
   7. Upload field (drag & drop, preview, progress, validation)
   8. Form builder (fields, validation, dirty tracking)
   9. Editor side panel
   10. Views: Profile, Sections, Skills, Experience, Projects, Education,
       Certificates, Files
   11. Navigation, auth, boot

   SECURITY
   * Uses only the public anon key from config.js. Every write is authorised
     by Row Level Security in Supabase (admin UUID), not by this file.
   * All text from the database or the user is rendered with textContent /
     text nodes. innerHTML is used only for the hard-coded SVG icons below.
   * Inputs are trimmed, stripped of control/bidi characters and length-capped
     (mirrors the CHECK constraints in supabase/schema.sql).
   * Uploads: type checked by extension, MIME and file signature; SVG refused;
     random file names; size limits 5 MB (images) / 10 MB (PDF).
   ========================================================================== */
(() => {
  'use strict';

  // Refuse to run inside a frame (clickjacking protection; Pages can't send headers).
  if (window.top !== window.self) {
    document.documentElement.textContent = '';
    return;
  }

  /* ------------------------------------------------------------------------
     1. Constants & config
     ------------------------------------------------------------------------ */
  const BUCKET = 'portfolio-assets';
  const MB = 1024 * 1024;
  const AUTH_STORAGE_KEY = 'portfolio-admin-auth';

  const FILE_KINDS = {
    image: {
      folder: 'images',
      types: { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] },
      max: 5 * MB,
      label: 'JPG, PNG or WebP image',
      hint: 'JPG, PNG or WebP · max 5 MB'
    },
    icon: {
      folder: 'images',
      types: { 'image/png': ['png'], 'image/webp': ['webp'] },
      max: 5 * MB,
      label: 'PNG or WebP image',
      hint: 'PNG or WebP, ideally square with a transparent background · max 5 MB'
    },
    pdf: {
      folder: 'docs',
      types: { 'application/pdf': ['pdf'] },
      max: 10 * MB,
      label: 'PDF document',
      hint: 'PDF · max 10 MB'
    }
  };

  /** Mirrors the CHECK constraints in supabase/schema.sql. */
  const LIMITS = {
    profile: { name: 120, tagline: 160, subtagline: 300, about_text: 4000, email: 254, linkedin: 300, github: 300 },
    stats: { rows: 8, label: 40, value: 20, suffix: 20 },
    skills: { category: 60, name: 120, level: 40 },
    projects: { title: 150, short_desc: 300, detail_desc: 6000, role: 1500, tools: 1500, result: 2000, period: 60, repo_url: 300 },
    certificates: { title: 200, issuer: 120, credential_url: 500 },
    experience: { organization: 150, role: 150, location: 120, bullets: 6, bullet: 300 },
    education: { institution: 150, degree: 150, field_of_study: 150, end_label: 60, gpa: 30, description: 1000 },
    cvFileName: 255
  };

  /** File of the 2026-10-11 migration (shown in "missing column / table" messages). */
  const MIGRATION_FILE = 'supabase/migrations/20261011130000_experience_education.sql';

  function readConfig() {
    const cfg = window.PORTFOLIO_CONFIG || {};
    const url = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = String(cfg.supabaseAnonKey || '').trim();
    if (!/^https:\/\/[^\s/]+$/.test(url) || !key || /YOUR-/i.test(url + key)) return null;
    return { url, key };
  }

  const config = readConfig();
  let sb = null; // Supabase client


  /* ------------------------------------------------------------------------
     2. Helpers
     ------------------------------------------------------------------------ */
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  let uid = 0;
  const nextId = (prefix) => `${prefix}-${++uid}`;

  /** Tiny element factory: h('a', { class: 'x', href: '#' }, 'text', childNode) */
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = Boolean(value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /** Trusted, static inline SVG icons. */
  const ICONS = {
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>',
    certificate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 9h10M7 12.5h6"/><circle cx="17" cy="17" r="2.5"/><path d="M15.5 19l-.5 3 2-1 2 1-.5-3"/></svg>',
    files: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M4 7v14h11"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.75"/><path d="M21 16l-5-5-8 9"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5M9 12h6.5M9 15.5h6.5M9 9h3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12.5h18"/></svg>',
    graduation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c1.5 1.3 3.4 2 5.5 2s4-.7 5.5-2V11M21.5 9v5"/></svg>',
    layout: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M3.5 14.5h17"/></svg>'
  };

  function icon(name) {
    const tpl = document.createElement('template');
    tpl.innerHTML = ICONS[name] || '';
    return tpl.content.firstElementChild;
  }

  /** Remove control and bidi-override characters, normalise whitespace. */
  function sanitizeText(value, multiline = false) {
    let text = String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n');
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '');
    if (multiline) {
      text = text.replace(/\t/g, ' ').replace(/[ \u00A0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    } else {
      text = text.replace(/\s+/g, ' ');
    }
    return text.trim();
  }

  const EMAIL_RE = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/;
  const HTTPS_RE = /^https:\/\/[^\s<>"'`]+$/;

  function isHttpsUrl(value) {
    if (!HTTPS_RE.test(value)) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && Boolean(url.hostname.includes('.'));
    } catch {
      return false;
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) return '';
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  /** "2024-09-01" → "Sep 2024" (or "2024" when months are switched off) */
  function formatMonth(value, showMonths = true) {
    const match = /^(\d{4})-(\d{2})/.exec(String(value || ''));
    if (!match) return '';
    if (!showMonths) return match[1];
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, 1));
    return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  const periodText = (start, end) => [start, end].filter(Boolean).join(' \u2013 ');

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const bySortOrder = (a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0);

  /** Same order as the public site: sort_order, then newest start date, then id. */
  const byOrderThenStart = (a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
    String(b.start_date || '').localeCompare(String(a.start_date || '')) ||
    (Number(a.id) || 0) - (Number(b.id) || 0);

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const fileNameOf = (url) => {
    try {
      return decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    } catch {
      return '';
    }
  };

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.label ??= button.textContent;
      button.disabled = true;
      button.classList.add('is-busy');
      if (label) button.textContent = label;
    } else {
      button.disabled = false;
      button.classList.remove('is-busy');
      if (button.dataset.label) button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
  }


  /* ------------------------------------------------------------------------
     3. Toasts & confirm dialog
     ------------------------------------------------------------------------ */
  function toast(message, type = 'success') {
    const root = $('#toasts');
    const item = h(
      'div',
      { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' },
      h('span', { class: 'toast__icon', 'aria-hidden': 'true' }, icon(type === 'error' ? 'alert' : 'check')),
      h('p', { class: 'toast__text' }, message),
      h('button', { class: 'toast__close', type: 'button', 'aria-label': 'Dismiss', onclick: () => dismiss() }, icon('close'))
    );
    const dismiss = () => {
      item.classList.add('is-leaving');
      setTimeout(() => item.remove(), 250);
    };
    root.append(item);
    setTimeout(dismiss, type === 'error' ? 8000 : 4000);
  }

  /**
   * Promise-based confirm dialog. Resolves { ok, checked }.
   * message may be a string or an array of strings (paragraphs).
   */
  function ask({ title, message, okLabel = 'Delete', cancelLabel = 'Cancel', danger = true, checkbox = null }) {
    const dialog = $('#confirm');
    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    const extra = $('#confirm-extra');

    $('#confirm-title').textContent = title;
    $('#confirm-message').replaceChildren(...[].concat(message || []).map((text) => h('p', {}, text)));
    ok.textContent = okLabel;
    ok.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
    cancel.textContent = cancelLabel;

    let box = null;
    if (checkbox) {
      box = h('input', { type: 'checkbox', id: 'confirm-check', checked: checkbox.checked !== false });
      extra.replaceChildren(h('label', { class: 'check', for: 'confirm-check' }, box, h('span', {}, checkbox.label)));
    } else {
      extra.replaceChildren();
    }

    return new Promise((resolve) => {
      const finish = (result) => {
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onEsc);
        if (dialog.open) dialog.close();
        resolve({ ok: result, checked: Boolean(box?.checked) });
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onEsc = (event) => {
        event.preventDefault();
        finish(false);
      };
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onEsc);
      dialog.showModal();
      (danger ? cancel : ok).focus();
    });
  }


  /* ------------------------------------------------------------------------
     4. Errors
     ------------------------------------------------------------------------ */
  class SessionError extends Error {}

  const PERMISSION_MESSAGE =
    "You don't have permission to make this change. Make sure ADMIN_UUID_HERE in schema.sql was replaced with your user ID.";

  function friendlyDbError(error, status) {
    const message = String(error?.message || '');
    const code = String(error?.code || '');
    if (status === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt|token is expired|invalid claim/i.test(message)) {
      return new SessionError('Your session has expired. Please sign in again.');
    }
    if (code === '42501' || /row-level security|permission denied/i.test(message)) return new Error(PERMISSION_MESSAGE);
    if (code === '23514') return new Error('The database rejected a value (too long or wrong format). Please check the fields.');
    if (code === '23502') return new Error('A required field is missing.');
    if (code === '42P01' || code === 'PGRST205') {
      const missing = new Error(`A database table is missing. Run supabase/schema.sql and ${MIGRATION_FILE} (see SETUP.md), then reload.`);
      missing.missingTable = true;
      return missing;
    }
    if (code === '42703' || code === 'PGRST204') {
      return new Error(`The database is missing new columns. Run ${MIGRATION_FILE} in the Supabase SQL Editor (see SETUP.md), then reload.`);
    }
    if (/failed to fetch|network|load failed/i.test(message)) {
      return new Error("Can't reach Supabase. Check your internet connection and try again.");
    }
    return new Error(message ? `Something went wrong: ${message}` : 'Something went wrong. Please try again.');
  }

  function friendlyStorageError(status, message) {
    const text = String(message || '');
    if (status === 401 || /jwt|exp claim|invalid.*token|unauthori[sz]ed.*token/i.test(text)) {
      return new SessionError('Your session has expired. Please sign in again.');
    }
    if (status === 413 || /too large|exceeded the maximum/i.test(text)) return new Error('This file is too large for the storage bucket.');
    if (status === 415 || /mime type|invalid_mime/i.test(text)) return new Error('This file type is not allowed by the storage bucket.');
    if (status === 403 || /row-level security|unauthori[sz]ed|permission/i.test(text)) return new Error(PERMISSION_MESSAGE);
    if (status === 409 || /already exists|duplicate/i.test(text)) return new Error('A file with this name already exists. Please try again.');
    if (status === 0) return new Error('Upload failed — check your internet connection and try again.');
    return new Error(text ? `Storage error: ${text}` : 'Storage error. Please try again.');
  }

  /** Central error handler for every user action. */
  function handleError(error) {
    if (error instanceof SessionError) {
      sessionExpired();
      return;
    }
    console.error(error);
    toast(error?.message || 'Something went wrong. Please try again.', 'error');
  }


  /* ------------------------------------------------------------------------
     5. Data layer
     ------------------------------------------------------------------------ */
  async function run(builder) {
    let result;
    try {
      result = await builder;
    } catch (error) {
      throw friendlyDbError(error);
    }
    if (result.error) throw friendlyDbError(result.error, result.status);
    return result.data;
  }

  const api = {
    list: (table) => run(sb.from(table).select('*').order('sort_order', { ascending: true }).order('id', { ascending: true })),
    async insert(table, values) {
      return run(sb.from(table).insert(values).select().single());
    },
    async update(table, id, values) {
      const rows = await run(sb.from(table).update(values).eq('id', id).select());
      // RLS hides rows you may not change: 0 rows updated = not allowed (or deleted meanwhile).
      if (!rows?.length) throw new Error(PERMISSION_MESSAGE);
      return rows[0];
    },
    async remove(table, id) {
      const rows = await run(sb.from(table).delete().eq('id', id).select('id'));
      if (!rows?.length) throw new Error(PERMISSION_MESSAGE);
    },
    profile: () => run(sb.from('profile').select('*').eq('id', 1).maybeSingle()),
    saveProfile: (values) => run(sb.from('profile').upsert({ id: 1, ...values }).select().single())
  };

  let localDataPromise = null;
  /** data.json (same origin) — used for skill category order and a fallback profile. */
  function localData() {
    localDataPromise ??= fetch('data.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    return localDataPromise;
  }


  /* ------------------------------------------------------------------------
     6. Storage
     ------------------------------------------------------------------------ */
  const storagePrefix = () => `${config.url}/storage/v1/object/public/${BUCKET}/`;

  const publicUrl = (path) => storagePrefix() + path.split('/').map(encodeURIComponent).join('/');

  /** Storage path for URLs that point into our bucket; null for anything else. */
  function pathFromUrl(url) {
    if (typeof url !== 'string' || !url.startsWith(storagePrefix())) return null;
    const rest = url.slice(storagePrefix().length).split(/[?#]/)[0];
    try {
      const path = decodeURIComponent(rest);
      return /^(images|docs)\/[A-Za-z0-9._-]+$/.test(path) ? path : null;
    } catch {
      return null;
    }
  }

  async function accessToken() {
    const { data, error } = await sb.auth.getSession(); // refreshes the token if needed
    if (error || !data.session) throw new SessionError('Your session has expired. Please sign in again.');
    return data.session.access_token;
  }

  /** Upload with real progress (XHR), never overwriting an existing file. */
  async function uploadFile(file, path, contentType, onProgress) {
    const token = await accessToken();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${config.url}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', config.key);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', 'max-age=31536000'); // names are random → safe to cache long
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1);
          resolve(publicUrl(path));
          return;
        }
        let message = '';
        let status = xhr.status;
        try {
          const body = JSON.parse(xhr.responseText);
          message = body.message || body.error || '';
          status = Number(body.statusCode) || status;
        } catch {
          message = xhr.statusText;
        }
        reject(friendlyStorageError(status, message));
      });
      xhr.addEventListener('error', () => reject(friendlyStorageError(0)));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
      xhr.send(file);
    });
  }

  async function removeStoragePath(path) {
    const { data, error } = await sb.storage.from(BUCKET).remove([path]);
    if (error) throw friendlyStorageError(error.status || error.statusCode, error.message);
    return Array.isArray(data) && data.length > 0;
  }

  /** Delete a file by its public URL (ignored for URLs outside our bucket). */
  async function removeStorageUrl(url) {
    const path = pathFromUrl(url);
    if (!path) return false;
    return removeStoragePath(path);
  }

  async function listFolder(folder) {
    const { data, error } = await sb.storage.from(BUCKET).list(folder, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' }
    });
    if (error) throw friendlyStorageError(error.status || error.statusCode, error.message);
    return (data || [])
      .filter((item) => item.id && !item.name.startsWith('.'))
      .map((item) => ({
        path: `${folder}/${item.name}`,
        name: item.name,
        size: Number(item.metadata?.size),
        type: item.metadata?.mimetype || '',
        created: item.created_at
      }));
  }

  /** Detect the real type from the first bytes (a renamed file can't sneak through). */
  async function sniffType(file) {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a) return 'image/png';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(0, 5) === '%PDF-') return 'application/pdf';
    return '';
  }

  const TYPE_NAMES = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'application/pdf': 'PDF' };

  async function validateFile(file, kindKey) {
    const kind = FILE_KINDS[kindKey];
    const fail = (error) => ({ ok: false, error });
    const ext = (file.name.includes('.') ? file.name.split('.').pop() : '').toLowerCase();

    if (ext === 'svg' || /svg/i.test(file.type)) {
      return fail("SVG files can't be uploaded because they can contain hidden code. Please export it as PNG or WebP and try again.");
    }
    if (!file.size) return fail('This file is empty. Please choose another file.');

    const allowedExts = Object.values(kind.types).flat();
    if (!allowedExts.includes(ext)) {
      return fail(`This file type isn't supported here. Please choose a ${kind.label}.`);
    }
    if (file.size > kind.max) {
      return fail(`This file is ${formatBytes(file.size)}, but the maximum is ${formatBytes(kind.max)}. Please make it smaller and try again.`);
    }

    const detected = await sniffType(file);
    if (!detected || !kind.types[detected]) {
      return fail(`This doesn't look like a real ${kind.label}. The file may be damaged or renamed.`);
    }
    if (!kind.types[detected].includes(ext)) {
      return fail(`The file name ends in .${ext}, but it is actually a ${TYPE_NAMES[detected]} file. Please rename it to .${kind.types[detected][0]} and try again.`);
    }
    return { ok: true, type: detected, ext };
  }

  /** Random, safe storage path: images/<uuid>.png */
  function randomPath(kindKey, ext) {
    const id = crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${FILE_KINDS[kindKey].folder}/${id}.${ext}`;
  }


  /* ------------------------------------------------------------------------
     7. Upload field
        - Upload starts right after a valid file is chosen (with progress).
        - The new URL is only written to the database when the form is saved.
        - Replaced/removed files are deleted from storage after a successful
          save (the user confirms this up front); unsaved uploads are cleaned
          up when the form is discarded.
     ------------------------------------------------------------------------ */
  function createUploadField(field, value, values = {}) {
    const kindKey = field.kind;
    const kind = FILE_KINDS[kindKey];
    const isPdf = kindKey === 'pdf';
    const id = nextId('upload');

    const state = {
      original: value || null,
      current: value || null,
      sessionUploads: new Set(),
      busy: false,
      preview: null, // { objectUrl, name, size } for a freshly chosen file
      // Optional original file name + upload time of the saved file (field.infoFields, e.g. the CV)
      savedName: field.infoFields ? values[field.infoFields.name] || null : null,
      savedAt: field.infoFields ? values[field.infoFields.date] || null : null,
      lastUpload: null // { name, at } of the most recent successful upload in this form
    };

    const accept = [...Object.keys(kind.types), ...Object.values(kind.types).flat().map((e) => `.${e}`)].join(',');
    const input = h('input', { type: 'file', id, accept, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
    const body = h('div', { class: 'upload__body' });
    const root = h(
      'div',
      { class: `upload${isPdf ? ' upload--pdf' : ''}` },
      body,
      input
    );

    const showError = (message) => {
      error.textContent = message;
      error.hidden = !message;
    };

    const pick = () => {
      if (!state.busy) input.click();
    };

    function renderEmpty() {
      body.replaceChildren(
        h(
          'button',
          { type: 'button', class: 'drop', onclick: pick, 'aria-describedby': `${id}-hint` },
          h('span', { class: 'drop__icon', 'aria-hidden': 'true' }, icon('upload')),
          h('span', { class: 'drop__title' }, 'Drag & drop a file here, or ', h('span', { class: 'drop__link' }, 'choose a file')),
          h('span', { class: 'drop__hint', id: `${id}-hint` }, kind.hint)
        )
      );
    }

    function renderProgress(name, size) {
      const bar = h('span', { class: 'progress__bar' });
      const pct = h('span', { class: 'progress__pct' }, '0%');
      const meter = h('div', {
        class: 'progress',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
        'aria-label': `Uploading ${name}`
      }, bar);
      body.replaceChildren(
        h(
          'div',
          { class: 'file-card is-uploading' },
          thumb(),
          h('div', { class: 'file-card__info' },
            h('p', { class: 'file-card__name' }, name),
            h('p', { class: 'file-card__meta' }, `Uploading… ${formatBytes(size)}`),
            h('div', { class: 'progress__row' }, meter, pct)
          )
        )
      );
      return (ratio) => {
        const value = Math.round(ratio * 100);
        bar.style.width = `${value}%`;
        pct.textContent = `${value}%`;
        meter.setAttribute('aria-valuenow', String(value));
      };
    }

    function thumb() {
      const src = state.preview?.objectUrl || state.current;
      if (!isPdf && src) {
        const img = h('img', { alt: '', class: 'file-card__img', decoding: 'async' });
        img.addEventListener('error', () => img.replaceWith(h('span', { class: 'file-card__glyph' }, icon('image'))), { once: true });
        img.src = src;
        return h('div', { class: `file-card__thumb${kindKey === 'icon' ? ' file-card__thumb--icon' : ''}` }, img);
      }
      return h('div', { class: 'file-card__thumb' }, h('span', { class: 'file-card__glyph' }, icon(isPdf ? 'pdf' : 'image')));
    }

    function renderFile() {
      const saved = state.current === state.original;
      const name = state.preview?.name || (saved && state.savedName) || fileNameOf(state.current) || 'Uploaded file';
      const when = saved && state.savedAt ? formatDateTime(state.savedAt) : '';
      const meta = state.preview
        ? `${formatBytes(state.preview.size)} · Uploaded — save to apply`
        : [isPdf ? 'PDF document' : 'Current image', when && `uploaded ${when}`].filter(Boolean).join(' · ');
      body.replaceChildren(
        h(
          'div',
          { class: 'file-card' },
          thumb(),
          h(
            'div',
            { class: 'file-card__info' },
            h('p', { class: 'file-card__name', title: name }, name),
            h('p', { class: 'file-card__meta' }, meta),
            h(
              'div',
              { class: 'file-card__actions' },
              h('a', { class: 'text-btn', href: state.current, target: '_blank', rel: 'noopener noreferrer' }, 'Open', icon('external')),
              h('button', { class: 'text-btn', type: 'button', onclick: replace }, 'Replace'),
              h('button', { class: 'text-btn text-btn--danger', type: 'button', onclick: remove }, 'Remove')
            )
          )
        )
      );
    }

    function render() {
      if (state.current) renderFile();
      else renderEmpty();
    }

    async function replace() {
      if (state.current === state.original && pathFromUrl(state.original)) {
        const answer = await ask({
          title: 'Replace this file?',
          message: 'You will choose a new file next. The current file will be permanently deleted from storage when you save.',
          okLabel: 'Choose new file',
          danger: false
        });
        if (!answer.ok) return;
      }
      pick();
    }

    async function remove() {
      const ours = Boolean(pathFromUrl(state.current));
      const answer = await ask({
        title: 'Remove this file?',
        message: ours
          ? state.current === state.original
            ? 'The file will be permanently deleted from storage when you save. The site will show a placeholder instead.'
            : 'This new upload will be deleted from storage now.'
          : 'The link to this file will be removed when you save.',
        okLabel: 'Remove'
      });
      if (!answer.ok) return;
      await dropSessionUpload(state.current);
      state.current = null;
      clearPreview();
      render();
      root.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function clearPreview() {
      if (state.preview?.objectUrl) URL.revokeObjectURL(state.preview.objectUrl);
      state.preview = null;
    }

    /** Delete a not-yet-saved upload (never the saved original). */
    async function dropSessionUpload(url) {
      if (!url || url === state.original || !state.sessionUploads.has(url)) return;
      state.sessionUploads.delete(url);
      try {
        await removeStorageUrl(url);
      } catch (err) {
        console.warn('Could not delete unsaved upload', err);
      }
    }

    async function handleFile(file) {
      showError('');
      if (!file || state.busy) return;
      const check = await validateFile(file, kindKey);
      if (!check.ok) {
        showError(check.error);
        return;
      }

      state.busy = true;
      root.classList.add('is-busy');
      const previous = state.current;
      clearPreview();
      state.preview = { objectUrl: isPdf ? null : URL.createObjectURL(file), name: file.name, size: file.size };
      const setProgress = renderProgress(file.name, file.size);
      root.dispatchEvent(new Event('change', { bubbles: true }));

      try {
        const url = await uploadFile(file, randomPath(kindKey, check.ext), check.type, setProgress);
        state.sessionUploads.add(url);
        state.current = url;
        state.lastUpload = { url, name: sanitizeText(file.name).slice(0, LIMITS.cvFileName) || null, at: new Date().toISOString() };
        await dropSessionUpload(previous); // an earlier unsaved upload is no longer needed
        toast(`${isPdf ? 'Document' : 'Image'} uploaded. Remember to save.`);
      } catch (err) {
        clearPreview();
        state.current = previous;
        if (err instanceof SessionError) {
          handleError(err);
          return;
        }
        showError(err.message);
      } finally {
        state.busy = false;
        root.classList.remove('is-busy');
        if (root.isConnected) render();
        root.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    input.addEventListener('change', () => {
      const [file] = input.files;
      input.value = '';
      handleFile(file);
    });

    // Drag & drop anywhere on the field
    let depth = 0;
    root.addEventListener('dragenter', (event) => {
      event.preventDefault();
      depth += 1;
      root.classList.add('is-dragover');
    });
    root.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy';
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) root.classList.remove('is-dragover');
    });
    root.addEventListener('drop', async (event) => {
      event.preventDefault();
      depth = 0;
      root.classList.remove('is-dragover');
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      if (files.length > 1) toast('Only one file can be used here — the first one was taken.', 'info');
      if (state.current === state.original && pathFromUrl(state.original)) {
        const answer = await ask({
          title: 'Replace this file?',
          message: 'The current file will be permanently deleted from storage when you save.',
          okLabel: 'Replace',
          danger: false
        });
        if (!answer.ok) return;
      }
      handleFile(files[0]);
    });

    render();

    return {
      element: h('div', { class: 'upload-wrap' }, root, error),
      focusTarget: () => $('button', body),
      raw: () => state.current,
      read: () => ({ value: state.current }),
      isBusy: () => state.busy,
      showError,
      /** { name, at } for the file that is about to be saved (null when removed / unchanged). */
      uploadInfo: () => (state.current && state.lastUpload?.url === state.current ? state.lastUpload : null),
      /** After a successful save: delete the file that was replaced or removed. */
      async commit() {
        const old = state.original;
        if (old !== state.current) {
          const info = state.lastUpload?.url === state.current ? state.lastUpload : null;
          state.savedName = info?.name || null;
          state.savedAt = info?.at || null;
        }
        state.original = state.current;
        state.sessionUploads.clear();
        clearPreview();
        if (old && old !== state.current && pathFromUrl(old)) {
          try {
            await removeStorageUrl(old);
          } catch (err) {
            console.warn(err);
            toast('Saved, but the old file could not be deleted. You can remove it on the Files page.', 'error');
          }
        }
        if (root.isConnected) render();
      },
      /** Discarding the form: delete uploads that were never saved. */
      async rollback() {
        const pending = [...state.sessionUploads].filter((url) => url !== state.original);
        state.sessionUploads.clear();
        state.current = state.original;
        clearPreview();
        await Promise.allSettled(pending.map(removeStorageUrl));
      }
    };
  }


  /* ------------------------------------------------------------------------
     8. Form builder
        field: { name, label, type, max, required, hint, rows, options, kind, list, full,
                 disables (checkbox: name of the field it disables while ticked),
                 infoFields (upload: { name, date } columns with the original file name / time),
                 maxItems / itemMax (bullets) }
        types: text | textarea | email | url | date | month | select | switch | checkbox |
               upload | stats | bullets | heading
     ------------------------------------------------------------------------ */

  /** Bullet points: one line each; add, remove and reorder. Value = array of strings. */
  function createBulletsField(field, value) {
    const maxItems = field.maxItems || 6;
    const itemMax = field.itemMax || 300;
    const list = h('ol', { class: 'bullets-editor__list', role: 'list' });
    const addBtn = h('button', { type: 'button', class: 'btn btn--secondary btn--small' }, icon('plus'), 'Add bullet point');
    const changed = () => list.dispatchEvent(new Event('input', { bubbles: true }));

    const rowsOf = () => $$('.bullets-editor__row', list);

    const refresh = () => {
      const rows = rowsOf();
      rows.forEach((row, i) => {
        $('[data-act="up"]', row).disabled = i === 0;
        $('[data-act="down"]', row).disabled = i === rows.length - 1;
        $('input', row).setAttribute('aria-label', `Bullet point ${i + 1}`);
      });
      addBtn.disabled = rows.length >= maxItems;
    };

    const addRow = (text = '') => {
      const input = h('input', { class: 'input', type: 'text', value: text, maxlength: String(itemMax), placeholder: 'e.g. Help produce Cyber Talk.' });
      const row = h('li', { class: 'bullets-editor__row' });
      const move = (delta, act) => {
        const sibling = delta < 0 ? row.previousElementSibling : row.nextElementSibling;
        if (!sibling) return;
        if (delta < 0) sibling.before(row);
        else sibling.after(row);
        refresh();
        changed();
        const btn = $(`[data-act="${act}"]`, row);
        (btn.disabled ? input : btn).focus();
      };
      row.append(
        h('span', { class: 'bullets-editor__dot', 'aria-hidden': 'true' }),
        input,
        h('button', { type: 'button', class: 'icon-btn', 'data-act': 'up', 'aria-label': 'Move bullet point up', title: 'Move up', onclick: () => move(-1, 'up') }, icon('up')),
        h('button', { type: 'button', class: 'icon-btn', 'data-act': 'down', 'aria-label': 'Move bullet point down', title: 'Move down', onclick: () => move(1, 'down') }, icon('down')),
        h('button', {
          type: 'button',
          class: 'icon-btn icon-btn--danger',
          'aria-label': 'Remove bullet point',
          title: 'Remove',
          onclick: () => {
            const next = row.nextElementSibling || row.previousElementSibling;
            row.remove();
            if (!rowsOf().length) addRow();
            refresh();
            changed();
            ($('input', next || list) || addBtn).focus();
          }
        }, icon('trash'))
      );
      list.append(row);
      refresh();
      return row;
    };

    addBtn.addEventListener('click', () => {
      $('input', addRow())?.focus();
      changed();
    });

    const initial = (Array.isArray(value) ? value : []).filter((v) => typeof v === 'string').slice(0, maxItems);
    (initial.length ? initial : ['']).forEach((text) => addRow(text));

    const collect = () => rowsOf().map((row) => sanitizeText($('input', row).value));

    return {
      element: h('div', { class: 'bullets-editor' }, list, addBtn),
      focusTarget: () => $('input', list) || addBtn,
      raw: collect,
      read() {
        const items = collect().filter(Boolean);
        const tooLong = items.findIndex((text) => text.length > itemMax);
        if (tooLong !== -1) return { error: `Bullet point ${tooLong + 1} is too long (max ${itemMax} characters).` };
        if (items.length > maxItems) return { error: `You can add at most ${maxItems} bullet points.` };
        return { value: items };
      }
    };
  }

  function createStatsField(field, value) {
    const L = LIMITS.stats;
    const list = h('div', { class: 'stats-editor__list' });
    const addBtn = h('button', { type: 'button', class: 'btn btn--secondary btn--small' }, icon('plus'), 'Add stat');

    const updateAdd = () => {
      addBtn.disabled = list.children.length >= L.rows;
    };

    const addRow = (stat = {}) => {
      const mk = (key, placeholder, max, cls) =>
        h('input', {
          class: `input ${cls}`,
          type: 'text',
          value: stat[key] || '',
          maxlength: String(max),
          placeholder,
          'aria-label': placeholder,
          dataset: { key }
        });
      const row = h(
        'div',
        { class: 'stats-editor__row' },
        mk('label', 'Label (e.g. GPA)', L.label, 'stats-editor__label'),
        mk('value', 'Value (e.g. 3.44)', L.value, 'stats-editor__value'),
        mk('suffix', 'Suffix (optional)', L.suffix, 'stats-editor__suffix'),
        h('button', {
          type: 'button',
          class: 'icon-btn icon-btn--danger',
          'aria-label': 'Remove stat',
          onclick: () => {
            row.remove();
            updateAdd();
            list.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, icon('trash'))
      );
      list.append(row);
      updateAdd();
      return row;
    };

    addBtn.addEventListener('click', () => {
      $('input', addRow())?.focus();
      list.dispatchEvent(new Event('input', { bubbles: true }));
    });

    (Array.isArray(value) ? value : []).slice(0, L.rows).forEach(addRow);

    const collect = () =>
      $$('.stats-editor__row', list).map((row) =>
        Object.fromEntries($$('input', row).map((inp) => [inp.dataset.key, sanitizeText(inp.value)]))
      );

    return {
      element: h('div', { class: 'stats-editor' }, list, addBtn),
      focusTarget: () => $('input', list) || addBtn,
      raw: collect,
      read() {
        const stats = [];
        for (const s of collect()) {
          if (!s.label && !s.value && !s.suffix) continue;
          if (!s.label || !s.value) return { error: 'Each stat needs both a label and a value.' };
          if (s.label.length > L.label || s.value.length > L.value || s.suffix.length > L.suffix) {
            return { error: `Keep labels under ${L.label} and values/suffixes under ${L.value} characters.` };
          }
          stats.push(s.suffix ? s : { label: s.label, value: s.value });
        }
        if (stats.length > L.rows) return { error: `You can show at most ${L.rows} stats.` };
        return { value: stats };
      }
    };
  }

  function createControl(field, value, values = {}) {
    const id = nextId('f');
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const error = h('p', { class: 'field__error', id: errorId, role: 'alert', hidden: true });
    let control;
    let input = null;
    let counter = null;

    const textual = ['text', 'textarea', 'email', 'url'].includes(field.type);

    if (field.type === 'upload') {
      control = createUploadField(field, value, values);
    } else if (field.type === 'stats') {
      control = createStatsField(field, value);
    } else if (field.type === 'bullets') {
      control = createBulletsField(field, value);
    } else {
      if (field.type === 'textarea') {
        input = h('textarea', { class: 'input input--area', id, rows: String(field.rows || 4) });
        input.value = value ?? '';
      } else if (field.type === 'select') {
        input = h('select', { class: 'input input--select', id },
          field.options.map((opt) => h('option', { value: opt.value }, opt.label)));
        input.value = value ?? field.options[0].value;
      } else if (field.type === 'switch') {
        input = h('input', { type: 'checkbox', class: 'switch__input', id, role: 'switch', checked: value !== false });
      } else if (field.type === 'checkbox') {
        input = h('input', { type: 'checkbox', id, checked: field.defaultChecked ? value !== false : value === true });
      } else if (field.type === 'month') {
        // Native month picker; browsers without one show a text box that accepts YYYY-MM
        input = h('input', {
          class: 'input',
          id,
          type: 'month',
          value: /^\d{4}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 7) : '',
          placeholder: 'YYYY-MM',
          autocomplete: 'off'
        });
      } else {
        input = h('input', {
          class: 'input',
          id,
          type: field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : field.type === 'date' ? 'date' : 'text',
          value: value ?? '',
          inputmode: field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : null,
          autocomplete: 'off',
          spellcheck: field.type === 'url' || field.type === 'email' ? 'false' : null,
          list: field.list || null,
          placeholder: field.placeholder || null
        });
      }
      if (field.max) input.maxLength = field.max;
      if (field.required) input.required = true;
      input.setAttribute('aria-describedby', [field.hint ? hintId : '', errorId].filter(Boolean).join(' '));

      if (textual && field.max) {
        counter = h('span', { class: 'field__count', 'aria-hidden': 'true' });
        const update = () => {
          const length = input.value.length;
          counter.textContent = `${length} / ${field.max}`;
          counter.classList.toggle('is-near', length > field.max * 0.9);
        };
        input.addEventListener('input', update);
        update();
      }

      const isCheck = field.type === 'switch' || field.type === 'checkbox';
      control = {
        focusTarget: () => input,
        raw: () => (isCheck ? input.checked : input.value),
        /** Used by a "disables" checkbox, e.g. "I'm currently here" → end date. */
        setDisabled(disabled) {
          input.disabled = disabled;
          wrapper.classList.toggle('is-disabled', disabled);
          if (disabled) showError('');
        },
        read() {
          if (isCheck) return { value: input.checked };
          if (input.disabled) return { value: null };
          if (field.type === 'month') {
            const text = sanitizeText(input.value);
            if (!text) return field.required ? { error: `Please fill in “${field.label}”.` } : { value: null };
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return { error: 'Please choose a month and year (e.g. 2024-09).' };
            return { value: `${text}-01` };
          }
          if (field.type === 'select') {
            const ok = field.options.some((opt) => opt.value === input.value);
            return ok ? { value: input.value } : { error: 'Please choose an option.' };
          }
          const text = sanitizeText(input.value, field.type === 'textarea');
          if (field.required && !text) return { error: `Please fill in “${field.label}”.` };
          if (field.max && text.length > field.max) {
            return { error: `Please keep this under ${field.max} characters (now ${text.length}).` };
          }
          if (text && field.type === 'email' && !EMAIL_RE.test(text)) {
            return { error: 'Please enter a valid email address, like name@example.com.' };
          }
          if (text && field.type === 'url' && !isHttpsUrl(text)) {
            return { error: 'Please enter a full link that starts with https://' };
          }
          if (text && field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            return { error: 'Please choose a valid date.' };
          }
          return { value: text || null };
        }
      };
    }

    const showError = (message) => {
      if (control.showError && field.type === 'upload') control.showError(message);
      error.textContent = message || '';
      error.hidden = !message || field.type === 'upload';
      input?.setAttribute('aria-invalid', message ? 'true' : 'false');
      wrapper.classList.toggle('has-error', Boolean(message));
    };

    const label = field.type === 'switch' || field.type === 'checkbox'
      ? null
      : h('label', { class: 'field__label', for: input ? id : null },
          field.label,
          field.required ? h('span', { class: 'field__req' }, 'Required') : null);

    const main = field.type === 'switch'
      ? h('label', { class: 'switch', for: id }, input, h('span', { class: 'switch__track', 'aria-hidden': 'true' }), h('span', { class: 'switch__label' }, field.label))
      : field.type === 'checkbox'
        ? h('label', { class: 'check', for: id }, input, h('span', {}, field.label))
        : input || control.element;

    const wrapper = h(
      'div',
      { class: `field${field.full ? ' field--full' : ''}` },
      label,
      main,
      field.hint ? h('p', { class: 'field__hint', id: hintId }, field.hint) : null,
      h('div', { class: 'field__meta' }, error, counter)
    );

    // Clear the error as soon as the user edits the field
    wrapper.addEventListener('input', () => wrapper.classList.contains('has-error') && showError(''));

    return { ...control, name: field.name, field, input, element: wrapper, showError };
  }

  function createForm(fields, values = {}) {
    const controls = [];
    const element = h('div', { class: 'form-grid' });

    for (const field of fields) {
      if (field.type === 'heading') {
        element.append(h('h3', { class: 'form-grid__heading' }, field.label));
        continue;
      }
      const control = createControl(field, values[field.name], values);
      controls.push(control);
      element.append(control.element);
    }

    // "Disables" checkboxes (e.g. "I'm currently here" greys out the end date)
    for (const control of controls) {
      const target = control.field.disables && controls.find((c) => c.name === control.field.disables);
      if (!target?.setDisabled || !control.input) continue;
      const sync = () => target.setDisabled(control.input.checked);
      control.input.addEventListener('change', sync);
      sync();
    }

    const snapshot = () => JSON.stringify(controls.map((c) => c.raw()));
    let initial = snapshot();

    return {
      element,
      control: (name) => controls.find((c) => c.name === name),
      isDirty: () => snapshot() !== initial,
      isBusy: () => controls.some((c) => c.isBusy?.()),
      collect() {
        const out = {};
        let firstInvalid = null;
        for (const control of controls) {
          const result = control.read();
          if (result.error) {
            control.showError(result.error);
            firstInvalid ??= control;
          } else {
            control.showError('');
            out[control.name] = result.value;
          }
        }
        return { ok: !firstInvalid, values: out, firstInvalid };
      },
      markSaved() {
        initial = snapshot();
      },
      async commitUploads() {
        await Promise.all(controls.filter((c) => c.commit).map((c) => c.commit()));
        initial = snapshot();
      },
      async rollbackUploads() {
        await Promise.all(controls.filter((c) => c.rollback).map((c) => c.rollback()));
      }
    };
  }


  /* ------------------------------------------------------------------------
     9. Editor side panel
     ------------------------------------------------------------------------ */
  const editor = {
    form: null,
    onSave: null,

    init() {
      const dialog = $('#editor');
      $$('[data-action="close"]', dialog).forEach((btn) => btn.addEventListener('click', () => editor.requestClose()));
      $('.icon-btn[data-action="close"]', dialog).append(icon('close'));
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault(); // Esc → same guard as Cancel
        editor.requestClose();
      });
      $('#editor-form').addEventListener('submit', (event) => {
        event.preventDefault();
        editor.save();
      });
    },

    open({ title, fields, values = {}, onSave }) {
      const dialog = $('#editor');
      editor.form = createForm(fields, values);
      editor.onSave = onSave;
      $('#editor-title').textContent = title;
      $('#editor-status').textContent = '';
      $('#editor-body').replaceChildren(editor.form.element);
      $('#editor-body').scrollTop = 0;
      dialog.showModal();
      $('input:not([type="file"]), textarea, select', editor.form.element)?.focus();
    },

    isOpen: () => $('#editor').open,

    async requestClose() {
      const { form } = editor;
      if (!form) return true;
      if (form.isBusy()) {
        toast('Please wait until the upload has finished.', 'info');
        return false;
      }
      if (form.isDirty()) {
        const answer = await ask({
          title: 'Discard changes?',
          message: 'You have unsaved changes. If you close now they will be lost, and files uploaded in this form will be deleted.',
          okLabel: 'Discard',
          cancelLabel: 'Keep editing'
        });
        if (!answer.ok) return false;
        await form.rollbackUploads();
      }
      editor.close();
      return true;
    },

    close() {
      const dialog = $('#editor');
      if (dialog.open) dialog.close();
      editor.form = null;
      editor.onSave = null;
      $('#editor-body').replaceChildren();
    },

    async save() {
      const { form } = editor;
      if (!form) return;
      if (form.isBusy()) {
        toast('Please wait until the upload has finished.', 'info');
        return;
      }
      const result = form.collect();
      if (!result.ok) {
        result.firstInvalid.focusTarget?.()?.focus();
        toast('Please fix the highlighted fields.', 'error');
        return;
      }
      const button = $('#editor-save');
      setBusy(button, true, 'Saving…');
      try {
        await editor.onSave(result.values);
        form.markSaved();
        await form.commitUploads();
        editor.close();
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(button, false);
      }
    }
  };


  /* ------------------------------------------------------------------------
     10. Views
     ------------------------------------------------------------------------ */
  const root = () => $('#view-root');

  function setHeader(title, sub, actions = []) {
    $('#view-title').textContent = title;
    $('#view-sub').textContent = sub;
    $('#view-actions').replaceChildren(...actions);
  }

  function loadingState() {
    root().replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, 'Loading…')));
  }

  function errorState(error, retry) {
    if (error instanceof SessionError) {
      sessionExpired();
      return;
    }
    root().replaceChildren(
      h('div', { class: 'state state--error' },
        h('span', { class: 'state__icon', 'aria-hidden': 'true' }, icon('alert')),
        h('p', {}, error.message || 'Something went wrong.'),
        h('button', { class: 'btn btn--secondary', type: 'button', onclick: retry }, 'Try again'))
    );
  }

  // ---- Profile (inline form with sticky save bar) ----
  let profileForm = null;

  const PROFILE_FIELDS = [
    { type: 'heading', label: 'Hero' },
    { name: 'name', label: 'Full name', type: 'text', max: LIMITS.profile.name, required: true },
    { name: 'tagline', label: 'Tagline', type: 'text', max: LIMITS.profile.tagline, full: true,
      hint: 'Wrap one word in *asterisks* to show it with the animated gradient, e.g. Designing with *security* in mind.' },
    { name: 'subtagline', label: 'Subtagline', type: 'textarea', rows: 2, max: LIMITS.profile.subtagline, full: true },
    { type: 'heading', label: 'About' },
    { name: 'about_text', label: 'About text', type: 'textarea', rows: 9, max: LIMITS.profile.about_text, full: true,
      hint: 'Separate paragraphs with an empty line. The first paragraph is shown larger.' },
    { name: 'stats', label: 'Stats row', type: 'stats', full: true, hint: `Up to ${LIMITS.stats.rows} numbers shown under the About text.` },
    { type: 'heading', label: 'Contact' },
    { name: 'email', label: 'Email', type: 'email', max: LIMITS.profile.email, placeholder: 'name@example.com' },
    { name: 'linkedin', label: 'LinkedIn URL', type: 'url', max: LIMITS.profile.linkedin, placeholder: 'https://www.linkedin.com/in/…' },
    { name: 'github', label: 'GitHub URL', type: 'url', max: LIMITS.profile.github, placeholder: 'https://github.com/…' },
    { type: 'heading', label: 'Files' },
    { name: 'photo_url', label: 'Profile photo', type: 'upload', kind: 'image', hint: 'Portrait, ideally 4:5 (e.g. 800 × 1000 px).' },
    { name: 'cv_url', label: 'CV', type: 'upload', kind: 'pdf', infoFields: { name: 'cv_file_name', date: 'cv_uploaded_at' },
      hint: 'Used by both “Download CV” buttons. Replace uploads the new PDF and points the site to it when you save; the old file is then deleted.' }
  ];

  async function renderProfileView() {
    setHeader('Profile', 'Name, introduction, stats, contact links, photo and CV.');
    loadingState();
    let row;
    try {
      row = await api.profile();
    } catch (error) {
      errorState(error, renderProfileView);
      return;
    }

    const notice = row
      ? null
      : h('p', { class: 'notice' }, 'No profile saved yet — the form is pre-filled from data.json. Save to create it.');
    if (!row) {
      const local = await localData();
      row = { ...(local?.profile || {}), photo_url: null, cv_url: null };
      if (Array.isArray(row.stats) === false) row.stats = [];
    }

    // cv_file_name / cv_uploaded_at exist once the 2026-10-11 migration has run
    const hasCvInfo = Boolean(row) && 'cv_file_name' in row;
    let savedCvUrl = row.cv_url || null;

    profileForm = createForm(PROFILE_FIELDS, row);
    const saveBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Save changes');
    const discardBtn = h('button', { class: 'btn btn--secondary', type: 'button' }, 'Discard');
    const status = h('span', { class: 'savebar__status' }, 'All changes saved');
    const bar = h('div', { class: 'savebar' }, status, h('div', { class: 'savebar__actions' }, discardBtn, saveBtn));

    const refresh = () => {
      const dirty = profileForm.isDirty();
      bar.classList.toggle('is-dirty', dirty);
      status.textContent = profileForm.isBusy() ? 'Uploading…' : dirty ? 'Unsaved changes' : 'All changes saved';
      discardBtn.disabled = !dirty;
    };

    const formEl = h('form', { class: 'card card--form', novalidate: true }, profileForm.element, bar);
    formEl.addEventListener('input', refresh);
    formEl.addEventListener('change', refresh);

    discardBtn.addEventListener('click', async () => {
      const answer = await ask({
        title: 'Discard changes?',
        message: 'Your unsaved edits will be lost, and files uploaded since the last save will be deleted.',
        okLabel: 'Discard'
      });
      if (!answer.ok) return;
      await profileForm.rollbackUploads();
      profileForm = null;
      renderProfileView();
    });

    formEl.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (profileForm.isBusy()) {
        toast('Please wait until the upload has finished.', 'info');
        return;
      }
      const result = profileForm.collect();
      if (!result.ok) {
        result.firstInvalid.focusTarget?.()?.focus();
        toast('Please fix the highlighted fields.', 'error');
        return;
      }
      const values = { ...result.values };
      if (hasCvInfo && values.cv_url !== savedCvUrl) {
        const info = profileForm.control('cv_url')?.uploadInfo?.();
        values.cv_file_name = values.cv_url ? info?.name || null : null;
        values.cv_uploaded_at = values.cv_url ? info?.at || new Date().toISOString() : null;
      }
      setBusy(saveBtn, true, 'Saving…');
      try {
        await api.saveProfile(values);
        savedCvUrl = values.cv_url || null;
        profileForm.markSaved();
        await profileForm.commitUploads();
        notice?.remove();
        toast('Profile saved.');
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(saveBtn, false);
        refresh();
      }
    });

    root().replaceChildren(...[notice, formEl].filter(Boolean));
    refresh();
  }

  // ---- Sections (show / hide whole sections; stored in profile.hidden_sections) ----
  const SECTIONS = [
    { key: 'skills', label: 'Skills', table: 'skills', icon: 'sparkles', auto: false },
    { key: 'experience', label: 'Organization Experience', table: 'experience', icon: 'briefcase', auto: true },
    { key: 'projects', label: 'Projects', table: 'projects', icon: 'folder', auto: false },
    { key: 'education', label: 'Education', table: 'education', icon: 'graduation', auto: true },
    { key: 'certifications', label: 'Certifications', table: 'certificates', icon: 'certificate', auto: true }
  ];

  async function renderSectionsView() {
    setHeader('Sections', 'Show or hide whole sections of the public site. Hero, About and Contact are always shown. Backgrounds keep alternating black and white automatically.');
    loadingState();

    let profile;
    let counts;
    try {
      [profile, counts] = await Promise.all([
        api.profile(),
        Promise.allSettled(SECTIONS.map((section) => api.list(section.table)))
      ]);
    } catch (error) {
      errorState(error, renderSectionsView);
      return;
    }

    const ready = Boolean(profile) && Array.isArray(profile.hidden_sections);
    const notice = !profile
      ? h('p', { class: 'notice' }, 'Save the Profile page once first — section settings are stored with your profile.')
      : !ready
        ? h('p', { class: 'notice' }, `Run ${MIGRATION_FILE} in the Supabase SQL Editor (see SETUP.md) to use these switches, then reload.`)
        : null;
    let hidden = new Set(ready ? profile.hidden_sections : []);
    let busy = false;

    const visibleCount = (i) => {
      const result = counts[i];
      if (result.status !== 'fulfilled') return null;
      return result.value.filter((row) => row.is_visible !== false).length;
    };

    const buildRow = (section, i) => {
      const shown = !hidden.has(section.key);
      const count = visibleCount(i);
      const empty = count === 0;
      const sub = count === null
        ? 'Entries could not be loaded.'
        : section.auto && empty
          ? 'No visible entries — hidden on the site automatically until you add one.'
          : `${count} visible ${count === 1 ? 'entry' : 'entries'}`;
      const input = h('input', {
        type: 'checkbox',
        class: 'switch__input',
        role: 'switch',
        checked: shown,
        disabled: !ready,
        'aria-label': `Show the ${section.label} section on the site`
      });
      input.addEventListener('change', async () => {
        if (busy) {
          input.checked = !input.checked;
          return;
        }
        busy = true;
        const next = new Set(hidden);
        if (input.checked) next.delete(section.key);
        else next.add(section.key);
        try {
          const saved = await api.update('profile', 1, { hidden_sections: SECTIONS.map((s) => s.key).filter((key) => next.has(key)) });
          hidden = new Set(saved.hidden_sections || []);
          toast(input.checked ? `${section.label} is now shown on the site.` : `${section.label} is now hidden from the site.`);
          draw();
          $(`[data-section-key="${section.key}"] .switch__input`, list)?.focus();
        } catch (error) {
          input.checked = !input.checked;
          handleError(error);
        } finally {
          busy = false;
        }
      });

      return h(
        'li',
        { class: `row${shown ? '' : ' is-hidden'}`, 'data-section-key': section.key },
        h('div', { class: 'row__thumb', 'aria-hidden': 'true' }, icon(section.icon)),
        h(
          'div',
          { class: 'row__main' },
          h('p', { class: 'row__title' }, section.label, shown ? null : h('span', { class: 'badge' }, 'Hidden')),
          h('p', { class: 'row__sub' }, sub)
        ),
        h(
          'div',
          { class: 'row__actions' },
          h('label', { class: 'switch switch--compact' }, input, h('span', { class: 'switch__track', 'aria-hidden': 'true' }), h('span', { class: 'switch__label' }, shown ? 'Shown' : 'Hidden'))
        )
      );
    };

    const list = h('ul', { class: 'list', role: 'list' });
    const draw = () => list.replaceChildren(...SECTIONS.map(buildRow));
    draw();

    root().replaceChildren(
      ...[
        notice,
        h('div', { class: 'list-view' }, h('section', { class: 'card list-card' }, h('h2', { class: 'list-card__title' }, 'Public sections'), list))
      ].filter(Boolean)
    );
  }

  // ---- Generic list view (Skills, Experience, Projects, Education, Certificates) ----
  const groupKey = (value) => String(value ?? '').trim().toLowerCase();

  const LIST_CONFIG = {
    skills: {
      title: 'Skills',
      sub: 'Grouped by category — each category is one card on the site. Order within a category with the arrows. Categories with no visible skills are not shown.',
      noun: 'skill',
      fileFields: ['icon_url'],
      group: (row) => row.category,
      titleOf: (row) => row.name,
      subOf: (row) => [row.category, row.level].filter(Boolean).join(' · '),
      thumbOf: (row) => ({ src: row.icon_url, glyph: 'sparkles', icon: true }),
      fields: () => [
        { name: 'category', label: 'Category', type: 'text', max: LIMITS.skills.category, required: true, list: 'skill-categories',
          hint: 'Free text. Pick a suggested category to add the skill to that card, or type a new name: it appears on the site as a new card with the next free accent colour.' },
        { name: 'name', label: 'Skill name', type: 'text', max: LIMITS.skills.name, required: true },
        { name: 'level', label: 'Level', type: 'text', max: LIMITS.skills.level, placeholder: 'e.g. Beginner (optional)',
          hint: 'Optional. Leave empty to show no level label.' },
        { name: 'icon_url', label: 'Icon', type: 'upload', kind: 'icon', full: true,
          hint: 'Optional, and always used first. Without an upload the tile shows the built-in icon matched by skill name (e.g. HTML, CSS, JavaScript, PHP, Wireshark, Burp Suite, OWASP, STRIDE, Core Application Design) or initials. Use a light or coloured icon — tiles are dark.' },
        { name: 'is_visible', label: 'Visible on the site', type: 'switch', full: true }
      ],
      // Suggestions: categories already in use first, then the built-in ones (case-insensitive, no duplicates)
      categoryNames: (rows, local) => {
        const seen = new Map();
        [...rows.map((r) => r.category), ...(local?.skill_categories || []).map((c) => c?.name)].forEach((name) => {
          const text = typeof name === 'string' ? name.trim() : '';
          if (text && !seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
        });
        return [...seen.values()];
      },
      datalist: (rows, local) =>
        h('datalist', { id: 'skill-categories' }, LIST_CONFIG.skills.categoryNames(rows, local).map((name) => h('option', { value: name })))
    },
    projects: {
      title: 'Projects',
      sub: 'Cards in the Projects section. The first “Code” project is shown first.',
      noun: 'project',
      fileFields: ['image_url', 'doc_url'],
      titleOf: (row) => row.title,
      subOf: (row) => [row.category === 'document' ? 'Document' : 'Code', row.period].filter(Boolean).join(' · '),
      thumbOf: (row) => ({ src: row.image_url, glyph: row.category === 'document' ? 'pdf' : 'folder' }),
      fields: () => [
        { name: 'title', label: 'Title', type: 'text', max: LIMITS.projects.title, required: true, full: true },
        { name: 'category', label: 'Type', type: 'select', options: [{ value: 'code', label: 'Code' }, { value: 'document', label: 'Document' }] },
        { name: 'period', label: 'Period', type: 'text', max: LIMITS.projects.period, placeholder: 'e.g. March–June 2026' },
        { name: 'short_desc', label: 'Short description', type: 'textarea', rows: 2, max: LIMITS.projects.short_desc, full: true,
          hint: 'One sentence shown on the card.' },
        { name: 'detail_desc', label: 'Detailed description', type: 'textarea', rows: 8, max: LIMITS.projects.detail_desc, full: true,
          hint: 'Separate paragraphs with an empty line. To add an extra titled block, start a paragraph with a short heading ending in a colon on its own line (e.g. “Scope:”). A line with arrows (A → B → C) is shown as flow chips.' },
        { name: 'role', label: 'My role', type: 'textarea', rows: 3, max: LIMITS.projects.role, full: true },
        { name: 'tools', label: 'Tools and methods', type: 'textarea', rows: 3, max: LIMITS.projects.tools, full: true },
        { name: 'result', label: 'Result / impact', type: 'textarea', rows: 3, max: LIMITS.projects.result, full: true },
        { name: 'repo_url', label: 'Repository URL', type: 'url', max: LIMITS.projects.repo_url, full: true, placeholder: 'https://github.com/…' },
        { name: 'image_url', label: 'Project image', type: 'upload', kind: 'image', hint: 'Cover image, ideally 16:10.' },
        { name: 'doc_url', label: 'Project document', type: 'upload', kind: 'pdf', hint: 'Shown as “View document (PDF)”.' },
        { name: 'is_visible', label: 'Visible on the site', type: 'switch', full: true }
      ]
    },
    experience: {
      title: 'Experience',
      sub: 'Organization Experience timeline on the site. Order with the arrows (entries with the same position are shown newest first). The section is hidden when no entry is visible.',
      noun: 'experience',
      nounPlural: 'experience entries',
      emptyText: 'No experience entries yet. The Organization Experience section stays hidden until you add a visible one.',
      emptyIcon: 'briefcase',
      fileFields: ['logo_url'],
      sort: byOrderThenStart,
      defaults: { is_current: false, show_months: true, bullets: [] },
      titleOf: (row) => row.organization,
      subOf: (row) => [
        row.role,
        periodText(formatMonth(row.start_date, row.show_months !== false), row.is_current ? 'Present' : formatMonth(row.end_date, row.show_months !== false))
      ].filter(Boolean).join(' · '),
      thumbOf: (row) => ({ src: row.logo_url, glyph: 'briefcase' }),
      fields: () => [
        { name: 'organization', label: 'Organization', type: 'text', max: LIMITS.experience.organization, required: true, full: true,
          placeholder: 'e.g. BINUS Cyber Security Community' },
        { name: 'role', label: 'Role', type: 'text', max: LIMITS.experience.role, placeholder: 'e.g. Media and Publication Activist' },
        { name: 'location', label: 'Location', type: 'text', max: LIMITS.experience.location, placeholder: 'Optional, e.g. Jakarta' },
        { type: 'heading', label: 'Period' },
        { name: 'start_date', label: 'Start', type: 'month', hint: 'Month and year. Leave empty if you don\u2019t want to show a period.' },
        { name: 'end_date', label: 'End', type: 'month', hint: 'Disabled while \u201cI\u2019m currently here\u201d is ticked.' },
        { name: 'is_current', label: 'I\u2019m currently here (shows \u201cPresent\u201d)', type: 'checkbox', disables: 'end_date' },
        { name: 'show_months', label: 'Show months (untick to show years only)', type: 'checkbox', defaultChecked: true },
        { type: 'heading', label: 'Details' },
        { name: 'bullets', label: 'Bullet points', type: 'bullets', full: true,
          maxItems: LIMITS.experience.bullets, itemMax: LIMITS.experience.bullet,
          hint: `2\u20134 short lines work best (max ${LIMITS.experience.bullets}). Use the arrows to reorder. Empty lines are ignored.` },
        { name: 'logo_url', label: 'Logo', type: 'upload', kind: 'image', full: true,
          hint: 'Optional. A square logo looks best (shown on a white tile). Without a logo the card shows the organization\u2019s initials.' },
        { name: 'is_visible', label: 'Visible on the site', type: 'switch', full: true }
      ],
      prepare(data) {
        if (data.is_current) data.end_date = null;
        if (data.start_date && data.end_date && data.end_date < data.start_date) {
          throw new Error('The end date is before the start date. Please check the period.');
        }
        return data;
      }
    },
    education: {
      title: 'Education',
      sub: 'Cards in the Education section. Order with the arrows (entries with the same position are shown newest first). The section is hidden when no entry is visible.',
      noun: 'education entry',
      nounPlural: 'education entries',
      emptyText: 'No education entries yet. The Education section stays hidden until you add a visible one.',
      emptyIcon: 'graduation',
      fileFields: ['logo_url'],
      sort: byOrderThenStart,
      defaults: { show_months: true },
      titleOf: (row) => row.institution,
      subOf: (row) => [
        row.degree,
        periodText(formatMonth(row.start_date, row.show_months !== false), row.end_label || formatMonth(row.end_date, row.show_months !== false))
      ].filter(Boolean).join(' · '),
      thumbOf: (row) => ({ src: row.logo_url, glyph: 'graduation' }),
      fields: () => [
        { name: 'institution', label: 'Institution', type: 'text', max: LIMITS.education.institution, required: true, full: true,
          placeholder: 'e.g. BINUS University' },
        { name: 'degree', label: 'Degree', type: 'text', max: LIMITS.education.degree, placeholder: 'Optional, e.g. Bachelor\u2019s Degree in Computer Science' },
        { name: 'field_of_study', label: 'Field of study', type: 'text', max: LIMITS.education.field_of_study, placeholder: 'Optional, e.g. Cyber Security' },
        { type: 'heading', label: 'Period' },
        { name: 'start_date', label: 'Start', type: 'month', hint: 'Month and year.' },
        { name: 'end_date', label: 'End', type: 'month', hint: 'Leave empty if you use the label below.' },
        { name: 'end_label', label: 'End label', type: 'text', max: LIMITS.education.end_label, placeholder: 'e.g. Expected 2028',
          hint: 'Optional. Shown instead of the end date.' },
        { name: 'show_months', label: 'Show months (untick to show years only, e.g. 2021 \u2013 2024)', type: 'checkbox', defaultChecked: true },
        { type: 'heading', label: 'Details' },
        { name: 'gpa', label: 'GPA', type: 'text', max: LIMITS.education.gpa, placeholder: 'Optional, e.g. 3.44 / 4.00' },
        { name: 'description', label: 'Short description', type: 'textarea', rows: 3, max: LIMITS.education.description, full: true,
          hint: 'Optional, e.g. relevant coursework.' },
        { name: 'logo_url', label: 'Logo', type: 'upload', kind: 'image', full: true,
          hint: 'Optional. A square logo looks best (shown on a white tile). Without a logo the card shows the institution\u2019s initials.' },
        { name: 'is_visible', label: 'Visible on the site', type: 'switch', full: true }
      ],
      prepare(data) {
        if (data.start_date && data.end_date && data.end_date < data.start_date) {
          throw new Error('The end date is before the start date. Please check the period.');
        }
        return data;
      }
    },
    certificates: {
      title: 'Certificates',
      sub: 'Badge cards in the Certifications section. Visitors can open the image full size. The section is hidden when no certificate is visible.',
      noun: 'certificate',
      emptyText: 'No certificates yet. The Certifications section stays hidden until you add a visible one.',
      emptyIcon: 'certificate',
      fileFields: ['image_url'],
      titleOf: (row) => row.title,
      subOf: (row) => [row.issuer, formatDate(row.issued_date), row.expiry_date ? `expires ${formatDate(row.expiry_date)}` : '']
        .filter(Boolean).join(' · '),
      thumbOf: (row) => ({ src: row.image_url, glyph: 'certificate' }),
      fields: () => [
        { name: 'title', label: 'Title', type: 'text', max: LIMITS.certificates.title, required: true, full: true },
        { name: 'issuer', label: 'Issuer', type: 'text', max: LIMITS.certificates.issuer },
        { name: 'issued_date', label: 'Issued on', type: 'date' },
        { name: 'expiry_date', label: 'Expires on', type: 'date', hint: 'Optional. Leave empty if it doesn\u2019t expire.' },
        { name: 'credential_url', label: 'Credential URL', type: 'url', max: LIMITS.certificates.credential_url, full: true,
          placeholder: 'https://…', hint: 'Optional. Shown as a \u201cShow credential\u201d button.' },
        { name: 'image_url', label: 'Certificate image', type: 'upload', kind: 'image', full: true,
          hint: 'A clear scan or export of the certificate (landscape works best). Without an image the card shows a placeholder.' },
        { name: 'is_visible', label: 'Visible on the site', type: 'switch', full: true }
      ],
      prepare(data) {
        if (data.issued_date && data.expiry_date && data.expiry_date < data.issued_date) {
          throw new Error('The expiry date is before the issue date. Please check the dates.');
        }
        return data;
      }
    }
  };

  function rowThumb({ src, glyph, icon: isIcon }) {
    const box = h('div', { class: `row__thumb${isIcon ? ' row__thumb--icon' : ''}`, 'aria-hidden': 'true' });
    const fallback = () => box.replaceChildren(icon(glyph));
    if (src && pathFromUrl(src)) {
      const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', fallback, { once: true });
      img.src = src;
      box.append(img);
    } else {
      fallback();
    }
    return box;
  }

  async function renderListView(table) {
    const cfg = LIST_CONFIG[table];
    const addBtn = h('button', { class: 'btn btn--primary', type: 'button' }, icon('plus'), `Add ${cfg.noun}`);
    setHeader(cfg.title, cfg.sub, [addBtn]);
    loadingState();

    let rows;
    let local;
    try {
      [rows, local] = await Promise.all([api.list(table), localData()]);
    } catch (error) {
      errorState(error, () => renderListView(table));
      return;
    }
    const sortRows = cfg.sort || bySortOrder;
    rows.sort(sortRows);

    const container = h('div', { class: 'list-view' });
    let busy = false;

    // Group rows (skills by category, ordered like the public site)
    const groupsOf = () => {
      if (!cfg.group) return [{ name: null, rows: rows.slice().sort(sortRows) }];
      const order = (local?.skill_categories || []).map((c) => groupKey(c?.name));
      // Same rule as the public site: categories match case-insensitively, first spelling wins
      const map = new Map();
      rows.forEach((row) => {
        const key = groupKey(cfg.group(row));
        if (!map.has(key)) map.set(key, { name: String(cfg.group(row) ?? '').trim(), rows: [] });
        map.get(key).rows.push(row);
      });
      const rank = (key) => {
        const i = order.indexOf(key);
        return i === -1 ? 1000 : i;
      };
      return [...map.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1].name.localeCompare(b[1].name))
        .map(([, group]) => ({ name: group.name, rows: group.rows.sort(bySortOrder) }));
    };

    const nextOrder = (groupName) => {
      const peers = cfg.group ? rows.filter((r) => groupKey(cfg.group(r)) === groupKey(groupName)) : rows;
      return peers.reduce((max, r) => Math.max(max, Number(r.sort_order) || 0), 0) + 1;
    };

    // "security " → "Security" when that category already exists, so it joins the same card
    const canonicalCategory = (value) => {
      if (!cfg.categoryNames) return value;
      const match = cfg.categoryNames(rows, local).find((name) => groupKey(name) === groupKey(value));
      return match || value;
    };

    const guard = async (fn) => {
      if (busy) return;
      busy = true;
      container.classList.add('is-busy');
      try {
        await fn();
      } catch (error) {
        handleError(error);
      } finally {
        busy = false;
        container.classList.remove('is-busy');
      }
    };

    const move = (list, index, delta, focusSelector) =>
      guard(async () => {
        const target = index + delta;
        if (target < 0 || target >= list.length) return;
        const reordered = list.slice();
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        const changes = reordered
          .map((row, i) => ({ row, order: i + 1 }))
          .filter(({ row, order }) => Number(row.sort_order) !== order);
        await Promise.all(changes.map(({ row, order }) => api.update(table, row.id, { sort_order: order })));
        changes.forEach(({ row, order }) => {
          row.sort_order = order;
        });
        const movedId = list[index].id;
        draw();
        // Keep keyboard focus on the item that moved
        const moved = $(`[data-row-id="${movedId}"] ${focusSelector}`, container);
        (moved && !moved.disabled ? moved : $(`[data-row-id="${movedId}"] [data-act="edit"]`, container))?.focus();
      });

    const toggleVisible = (row, input) => {
      if (busy) {
        input.checked = !input.checked;
        return;
      }
      return guard(async () => {
        const next = input.checked;
        try {
          const saved = await api.update(table, row.id, { is_visible: next });
          Object.assign(row, saved);
          toast(next ? `“${cfg.titleOf(row)}” is now visible on the site.` : `“${cfg.titleOf(row)}” is now hidden from the site.`);
          draw();
          $(`[data-row-id="${row.id}"] .switch__input`, container)?.focus();
        } catch (error) {
          input.checked = !next;
          throw error;
        }
      });
    };

    const remove = async (row) => {
      const files = cfg.fileFields.map((f) => row[f]).filter((url) => pathFromUrl(url));
      const answer = await ask({
        title: `Delete “${cfg.titleOf(row)}”?`,
        message: `This ${cfg.noun} will be removed from the site. This can't be undone.`,
        okLabel: 'Delete',
        checkbox: files.length
          ? { label: `Also delete its ${plural(files.length, 'uploaded file')} from storage`, checked: true }
          : null
      });
      if (!answer.ok) return;
      await guard(async () => {
        await api.remove(table, row.id);
        rows = rows.filter((r) => r.id !== row.id);
        if (answer.checked) {
          const results = await Promise.allSettled(files.map(removeStorageUrl));
          if (results.some((r) => r.status === 'rejected')) {
            toast('Deleted, but some files could not be removed. Check the Files page.', 'error');
          }
        }
        toast(`“${cfg.titleOf(row)}” deleted.`);
        draw();
      });
    };

    const openEditor = (row = null) => {
      const isNew = !row;
      const firstGroup = groupsOf()[0]?.name;
      const values = row
        ? { ...row }
        : { is_visible: true, category: table === 'projects' ? 'code' : firstGroup || '', ...(cfg.defaults || {}) };
      editor.open({
        title: isNew ? `Add ${cfg.noun}` : `Edit ${cfg.noun}`,
        fields: cfg.fields(),
        values,
        onSave: async (data) => {
          if (cfg.prepare) data = cfg.prepare(data);
          if (cfg.categoryNames && typeof data.category === 'string') data.category = canonicalCategory(data.category);
          if (isNew) {
            data.sort_order = nextOrder(cfg.group ? data.category : null);
            const created = await api.insert(table, data);
            rows.push(created);
            toast(`“${cfg.titleOf(created)}” added.`);
          } else {
            if (cfg.group && groupKey(data.category) !== groupKey(row.category)) data.sort_order = nextOrder(data.category);
            const saved = await api.update(table, row.id, data);
            Object.assign(row, saved);
            toast('Changes saved.');
          }
          draw();
        }
      });
    };

    function buildRow(row, list, index) {
      const title = cfg.titleOf(row) || 'Untitled';
      const visible = row.is_visible !== false;
      const switchInput = h('input', {
        type: 'checkbox',
        class: 'switch__input',
        role: 'switch',
        checked: visible,
        'aria-label': `Show “${title}” on the site`
      });
      switchInput.addEventListener('change', () => toggleVisible(row, switchInput));

      const btn = (act, iconName, label, onClick, disabled = false, extraClass = '') =>
        h('button', { type: 'button', class: `icon-btn ${extraClass}`, 'data-act': act, 'aria-label': `${label}: ${title}`, title: label, disabled, onclick: onClick }, icon(iconName));

      return h(
        'li',
        { class: `row${visible ? '' : ' is-hidden'}`, 'data-row-id': String(row.id) },
        rowThumb(cfg.thumbOf(row)),
        h(
          'div',
          { class: 'row__main' },
          h('p', { class: 'row__title' }, title, visible ? null : h('span', { class: 'badge' }, 'Hidden')),
          cfg.subOf(row) ? h('p', { class: 'row__sub' }, cfg.subOf(row)) : null
        ),
        h(
          'div',
          { class: 'row__actions' },
          h('label', { class: 'switch switch--compact' }, switchInput, h('span', { class: 'switch__track', 'aria-hidden': 'true' }), h('span', { class: 'switch__label' }, visible ? 'Visible' : 'Hidden')),
          btn('up', 'up', 'Move up', () => move(list, index, -1, '[data-act="up"]'), index === 0),
          btn('down', 'down', 'Move down', () => move(list, index, 1, '[data-act="down"]'), index === list.length - 1),
          btn('edit', 'edit', 'Edit', () => openEditor(row)),
          btn('delete', 'trash', 'Delete', () => remove(row), false, 'icon-btn--danger')
        )
      );
    }

    function draw() {
      const groups = groupsOf();
      if (!rows.length) {
        container.replaceChildren(
          h('div', { class: 'state' },
            h('span', { class: 'state__icon', 'aria-hidden': 'true' }, icon(cfg.emptyIcon || 'sparkles')),
            h('p', {}, cfg.emptyText || `No ${cfg.nounPlural || `${cfg.noun}s`} yet. The public site shows the built-in content from data.json until you add some.`),
            h('button', { class: 'btn btn--primary', type: 'button', onclick: () => openEditor() }, icon('plus'), `Add ${cfg.noun}`)),
          cfg.datalist ? cfg.datalist(rows, local) : null
        );
        return;
      }
      container.replaceChildren(
        ...groups.map((group) =>
          h(
            'section',
            { class: 'card list-card' },
            group.name ? h('h2', { class: 'list-card__title' }, group.name, h('span', { class: 'list-card__count' }, plural(group.rows.length, cfg.noun))) : null,
            h('ul', { class: 'list', role: 'list' }, group.rows.map((row, i) => buildRow(row, group.rows, i)))
          )
        ),
        cfg.datalist ? cfg.datalist(rows, local) : null
      );
    }

    addBtn.addEventListener('click', () => openEditor());
    draw();
    root().replaceChildren(container);
  }

  // ---- Files ----
  async function renderFilesView() {
    setHeader('Files', 'Everything stored in the “portfolio-assets” bucket. Upload files from the Profile, Skills, Experience, Projects, Education and Certificates pages.');
    loadingState();

    // Experience / Education may not exist yet (migration not run): treat them as empty.
    // Any other error stops the page, so a used file is never reported as "unused".
    const optionalList = (table) => api.list(table).catch((error) => (error?.missingTable ? [] : Promise.reject(error)));

    let images;
    let docs;
    let profile;
    let skills;
    let projects;
    let certificates;
    let experience;
    let education;
    try {
      [images, docs, profile, skills, projects, certificates, experience, education] = await Promise.all([
        listFolder('images'),
        listFolder('docs'),
        api.profile(),
        api.list('skills'),
        api.list('projects'),
        api.list('certificates'),
        optionalList('experience'),
        optionalList('education')
      ]);
    } catch (error) {
      errorState(error, renderFilesView);
      return;
    }

    // Which rows point at which file?
    const usage = new Map();
    const note = (url, ref) => {
      const path = pathFromUrl(url);
      if (!path) return;
      if (!usage.has(path)) usage.set(path, []);
      usage.get(path).push(ref);
    };
    if (profile) {
      note(profile.photo_url, { table: 'profile', id: 1, field: 'photo_url', label: 'Profile photo' });
      note(profile.cv_url, { table: 'profile', id: 1, field: 'cv_url', label: 'CV' });
    }
    skills.forEach((r) => note(r.icon_url, { table: 'skills', id: r.id, field: 'icon_url', label: `Skill “${r.name}” icon` }));
    projects.forEach((r) => {
      note(r.image_url, { table: 'projects', id: r.id, field: 'image_url', label: `Project “${r.title}” image` });
      note(r.doc_url, { table: 'projects', id: r.id, field: 'doc_url', label: `Project “${r.title}” document` });
    });
    certificates.forEach((r) => note(r.image_url, { table: 'certificates', id: r.id, field: 'image_url', label: `Certificate “${r.title}” image` }));
    experience.forEach((r) => note(r.logo_url, { table: 'experience', id: r.id, field: 'logo_url', label: `Experience “${r.organization}” logo` }));
    education.forEach((r) => note(r.logo_url, { table: 'education', id: r.id, field: 'logo_url', label: `Education “${r.institution}” logo` }));

    const clearRefs = async (refs) => {
      for (const ref of refs) {
        await api.update(ref.table, ref.id, { [ref.field]: null });
      }
    };

    const deleteFile = async (file) => {
      const refs = usage.get(file.path) || [];
      const answer = await ask({
        title: 'Delete this file?',
        message: refs.length
          ? [`It is used by: ${refs.map((r) => r.label).join(', ')}.`, 'Those fields will be cleared and the site will show a placeholder instead. This can\u2019t be undone.']
          : 'The file will be permanently deleted from storage. This can\u2019t be undone.',
        okLabel: 'Delete file'
      });
      if (!answer.ok) return;
      try {
        await clearRefs(refs);
        await removeStoragePath(file.path);
        toast('File deleted.');
        renderFilesView();
      } catch (error) {
        handleError(error);
      }
    };

    const unused = [...images, ...docs].filter((f) => !usage.has(f.path));
    const cleanupBtn = h('button', { class: 'btn btn--secondary', type: 'button', disabled: !unused.length },
      unused.length ? `Delete ${plural(unused.length, 'unused file')}` : 'No unused files');
    cleanupBtn.addEventListener('click', async () => {
      const answer = await ask({
        title: `Delete ${plural(unused.length, 'unused file')}?`,
        message: 'These files are not used anywhere on the site. They will be permanently deleted from storage.',
        okLabel: 'Delete all'
      });
      if (!answer.ok) return;
      setBusy(cleanupBtn, true, 'Deleting…');
      const results = await Promise.allSettled(unused.map((f) => removeStoragePath(f.path)));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) handleError(failed[0].reason);
      else toast(`${plural(unused.length, 'file')} deleted.`);
      renderFilesView();
    });
    setHeader('Files', 'Everything stored in the “portfolio-assets” bucket. Upload files from the Profile, Skills, Experience, Projects, Education and Certificates pages.', [cleanupBtn]);

    const fileCard = (file) => {
      const url = publicUrl(file.path);
      const refs = usage.get(file.path) || [];
      const isImage = file.path.startsWith('images/');
      const preview = h('div', { class: 'tile__preview', 'aria-hidden': 'true' });
      if (isImage) {
        const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', () => preview.replaceChildren(icon('image')), { once: true });
        img.src = url;
        preview.append(img);
      } else {
        preview.append(icon('pdf'));
      }
      return h(
        'li',
        { class: 'tile' },
        preview,
        h(
          'div',
          { class: 'tile__body' },
          h('p', { class: 'tile__name', title: file.name }, file.name),
          h('p', { class: 'tile__meta' }, [formatBytes(file.size), file.created ? new Date(file.created).toLocaleDateString('en-GB') : ''].filter(Boolean).join(' · ')),
          h('p', { class: `tile__usage${refs.length ? '' : ' is-unused'}` }, refs.length ? `Used by: ${refs.map((r) => r.label).join(', ')}` : 'Not used'),
          h(
            'div',
            { class: 'tile__actions' },
            h('a', { class: 'text-btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open', icon('external')),
            h('button', {
              class: 'text-btn',
              type: 'button',
              onclick: async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast('Link copied.');
                } catch {
                  toast("Couldn't copy the link. Use Open and copy it from the address bar.", 'error');
                }
              }
            }, 'Copy link'),
            h('button', { class: 'text-btn text-btn--danger', type: 'button', onclick: () => deleteFile(file) }, 'Delete')
          )
        )
      );
    };

    const section = (title, list, empty) =>
      h(
        'section',
        { class: 'card list-card' },
        h('h2', { class: 'list-card__title' }, title, h('span', { class: 'list-card__count' }, plural(list.length, 'file'))),
        list.length ? h('ul', { class: 'tiles', role: 'list' }, list.map(fileCard)) : h('p', { class: 'list-card__empty' }, empty)
      );

    root().replaceChildren(
      h('div', { class: 'list-view' },
        section('Images', images, 'No images uploaded yet.'),
        section('Documents', docs, 'No documents uploaded yet.'))
    );
  }


  /* ------------------------------------------------------------------------
     11. Navigation, auth, boot
     ------------------------------------------------------------------------ */
  const VIEWS = {
    profile: { label: 'Profile', icon: 'user', render: renderProfileView },
    sections: { label: 'Sections', icon: 'layout', render: renderSectionsView },
    skills: { label: 'Skills', icon: 'sparkles', render: () => renderListView('skills') },
    experience: { label: 'Experience', icon: 'briefcase', render: () => renderListView('experience') },
    projects: { label: 'Projects', icon: 'folder', render: () => renderListView('projects') },
    education: { label: 'Education', icon: 'graduation', render: () => renderListView('education') },
    certificates: { label: 'Certificates', icon: 'certificate', render: () => renderListView('certificates') },
    files: { label: 'Files', icon: 'files', render: renderFilesView }
  };

  let currentView = null;

  const hasUnsaved = () => Boolean((profileForm && currentView === 'profile' && profileForm.isDirty()) || (editor.form && editor.form.isDirty()));

  /** Ask before leaving a view with unsaved changes; cleans up unsaved uploads. */
  async function confirmLeave() {
    if (currentView === 'profile' && profileForm) {
      if (profileForm.isBusy()) {
        toast('Please wait until the upload has finished.', 'info');
        return false;
      }
      if (profileForm.isDirty()) {
        const answer = await ask({
          title: 'Leave without saving?',
          message: 'You have unsaved changes on the Profile page. They will be lost, and files uploaded since the last save will be deleted.',
          okLabel: 'Leave',
          cancelLabel: 'Stay'
        });
        if (!answer.ok) return false;
        await profileForm.rollbackUploads();
      }
    }
    return true;
  }

  async function navigate(view, { force = false } = {}) {
    if (!VIEWS[view]) view = 'profile';
    if (!force && view === currentView) return;
    if (!force && !(await confirmLeave())) {
      history.replaceState(null, '', `#${currentView}`);
      return;
    }
    profileForm = null;
    currentView = view;
    history.replaceState(null, '', `#${view}`);
    $$('.sidebar__link').forEach((link) => {
      if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = `${VIEWS[view].label} — Admin`;
    await VIEWS[view].render();
    $('#main').focus({ preventScroll: true });
  }

  function buildSidebar() {
    $('#sidebar-list').replaceChildren(
      ...Object.entries(VIEWS).map(([key, view]) =>
        h('li', {},
          h('button', { class: 'sidebar__link', type: 'button', 'data-view': key, onclick: () => navigate(key) },
            h('span', { class: 'sidebar__icon', 'aria-hidden': 'true' }, icon(view.icon)),
            h('span', {}, view.label)))
      )
    );
  }

  function show(viewId) {
    ['boot-view', 'config-view', 'login-view', 'app-view'].forEach((id) => {
      $(`#${id}`).hidden = id !== viewId;
    });
  }

  function showLogin(notice = '') {
    editor.close();
    if ($('#confirm').open) $('#confirm').close();
    profileForm = null;
    currentView = null;
    root().replaceChildren();
    $('#user-email').textContent = '';
    const box = $('#login-notice');
    box.textContent = notice;
    box.hidden = !notice;
    $('#login-error').hidden = true;
    $('#login-password').value = '';
    show('login-view');
    $('#login-email').focus();
  }

  async function showApp(user) {
    $('#user-email').textContent = user.email || '';
    show('app-view');
    const fromHash = location.hash.slice(1);
    await navigate(VIEWS[fromHash] ? fromHash : 'profile', { force: true });
  }

  let signingOut = false;
  let expiredShown = false;

  /** Session ended without the user asking (expired / revoked / signed out elsewhere). */
  async function sessionExpired() {
    if (signingOut || expiredShown || $('#app-view').hidden) return;
    expiredShown = true;
    try {
      await sb.auth.signOut({ scope: 'local' });
    } catch {
      /* already gone */
    }
    showLogin('Your session has expired. Please sign in again. Unsaved changes could not be kept.');
    expiredShown = false;
  }

  async function logout() {
    if (hasUnsaved()) {
      const answer = await ask({
        title: 'Log out with unsaved changes?',
        message: 'Your unsaved changes will be lost.',
        okLabel: 'Log out',
        cancelLabel: 'Stay'
      });
      if (!answer.ok) return;
      await profileForm?.rollbackUploads();
      await editor.form?.rollbackUploads();
    }
    signingOut = true;
    try {
      await sb.auth.signOut();
    } catch {
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    }
    signingOut = false;
    showLogin('You have been logged out.');
  }

  function initLogin() {
    const form = $('#login-form');
    const error = $('#login-error');
    const submit = $('#login-submit');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      $('#login-notice').hidden = true;

      const email = sanitizeText($('#login-email').value).toLowerCase();
      const password = $('#login-password').value;
      if (!EMAIL_RE.test(email) || email.length > 254) {
        error.textContent = 'Please enter a valid email address.';
        error.hidden = false;
        $('#login-email').focus();
        return;
      }
      if (!password || password.length > 128) {
        error.textContent = 'Please enter your password.';
        error.hidden = false;
        $('#login-password').focus();
        return;
      }

      setBusy(submit, true, 'Signing in…');
      try {
        const { data, error: authError } = await sb.auth.signInWithPassword({ email, password });
        if (authError) {
          const status = authError.status;
          let message = 'Sign-in failed. Please try again.';
          if (status === 400 || /invalid login credentials/i.test(authError.message)) message = 'Email or password is incorrect.';
          else if (status === 429) message = 'Too many attempts. Please wait a minute and try again.';
          else if (/email not confirmed/i.test(authError.message)) message = 'This email address has not been confirmed yet.';
          else if (/fetch|network/i.test(authError.message)) message = "Can't reach Supabase. Check your internet connection.";
          error.textContent = message;
          error.hidden = false;
          $('#login-password').value = '';
          $('#login-password').focus();
          return;
        }
        $('#login-password').value = '';
        await showApp(data.user);
        toast('Signed in.');
      } catch (err) {
        error.textContent = "Can't reach Supabase. Check your internet connection.";
        error.hidden = false;
        console.error(err);
      } finally {
        setBusy(submit, false);
      }
    });
  }

  async function boot() {
    if (!config) {
      show('config-view');
      return;
    }
    if (typeof window.supabase?.createClient !== 'function') {
      $('#config-message').textContent =
        "The Supabase library couldn't be loaded. Check your internet connection or disable content blockers for this page, then reload.";
      show('config-view');
      return;
    }

    sb = window.supabase.createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: AUTH_STORAGE_KEY,
        storage: window.sessionStorage // session ends when the browser is closed
      }
    });

    buildSidebar();
    editor.init();
    initLogin();
    $('#logout-btn').addEventListener('click', logout);

    // Refresh failed / signed out in another tab → treat as expired.
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && !$('#app-view').hidden) {
        setTimeout(sessionExpired, 0); // never call Supabase inside this callback
      }
    });

    window.addEventListener('hashchange', () => {
      const view = location.hash.slice(1);
      if (!$('#app-view').hidden && VIEWS[view] && view !== currentView && !editor.isOpen()) navigate(view);
    });

    window.addEventListener('beforeunload', (event) => {
      if (hasUnsaved()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    const { data } = await sb.auth.getSession();
    if (!data.session) {
      showLogin();
      return;
    }
    // Verify the stored session with the server (it may have expired or been revoked).
    const { data: userData, error } = await sb.auth.getUser();
    if (error && /fetch|network/i.test(error.message || '')) {
      showLogin("Can't reach Supabase right now. Check your internet connection and reload.");
      return;
    }
    if (error || !userData?.user) {
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      showLogin('Your session has expired. Please sign in again.');
      return;
    }
    await showApp(userData.user);
  }

  const start = () => boot().catch((error) => {
    console.error(error);
    $('#config-message').textContent = 'The admin panel could not start. Please reload the page.';
    show('config-view');
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
