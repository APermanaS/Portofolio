/* ==========================================================================
   Experience bullet points — shared core (no DOM, no build step)
   --------------------------------------------------------------------------
   One bullet point is an object:

     { id: 'b-1a2b3c4d', text: 'Help produce Cyber Talk.',
       photos: [ { url: 'https://…/images/uuid.jpg', caption: 'Optional' } ] }

   The database keeps BOTH shapes on public.experience:
     * bullets      text[]  (jsonb array of strings) — unchanged, still written
     * bullet_items jsonb   — nullable, added by
                              supabase/migrations/20261012_experience_bullet_photos.sql

   Reading rules (itemsFromRow):
     * bullet_items is an array  → use it, even when it is empty ([] = "no bullets
       on purpose"). Photos belong to their bullet OBJECT, never to an index.
     * bullet_items is null/absent → read the legacy `bullets` strings and convert
       them to items IN MEMORY ONLY. Nothing is written back automatically.

   Writing rules (serialize): on an explicit, successful save the caller writes
   bullet_items AND the matching `bullets` strings, so anything still reading the
   old column keeps working.

   Loaded as a plain <script> by index.html and admin.html (globalThis.ExperienceBullets)
   and required directly by the tests in tests/ (module.exports).
   ========================================================================== */
(function (root, factory) {
  'use strict';
  const api = factory();
  root.ExperienceBullets = api;
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Mirrors the admin form limits and the CHECK constraints in the migration. */
  const LIMITS = Object.freeze({
    items: 6, // admin form limit (the database allows up to 8)
    text: 300,
    photos: 4,
    caption: 160,
    url: 500,
    id: 64
  });

  /** Same shape as the url CHECK constraints in schema.sql / the migration. */
  const HTTPS_RE = /^https:\/\/[^\s<>"'`]+$/;
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  const isHttpsUrl = (value) =>
    typeof value === 'string' && value.length <= LIMITS.url && HTTPS_RE.test(value);

  /** Remove control / bidi-override characters and collapse whitespace (same as admin.js). */
  function sanitizeText(value) {
    return String(value ?? '')
      .normalize('NFC')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  let idCounter = 0;

  /** Stable, short, storage-safe bullet id. */
  function newId() {
    const bytes = globalThis.crypto?.getRandomValues
      ? [...globalThis.crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, '0')).join('')
      : `${Date.now().toString(16)}${(idCounter += 1).toString(16)}`;
    return `b-${bytes}`.slice(0, LIMITS.id);
  }

  /** One photo → { url, caption? }; anything without a usable https URL is dropped. */
  function normalizePhoto(value) {
    if (!value || typeof value !== 'object') return null;
    const url = typeof value.url === 'string' ? value.url.trim() : '';
    if (!isHttpsUrl(url)) return null;
    const caption = sanitizeText(value.caption).slice(0, LIMITS.caption);
    return caption ? { url, caption } : { url };
  }

  function normalizePhotos(value, maxPhotos = LIMITS.photos) {
    return (Array.isArray(value) ? value : []).map(normalizePhoto).filter(Boolean).slice(0, maxPhotos);
  }

  /**
   * A stored bullet_items array → clean items. Items are kept as objects, so an
   * item and its photos always travel together.
   */
  function normalizeItems(value, { maxItems = LIMITS.items, maxPhotos = LIMITS.photos } = {}) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const text = sanitizeText(item.text).slice(0, LIMITS.text);
        const photos = normalizePhotos(item.photos, maxPhotos);
        if (!text && !photos.length) return null;
        let id = typeof item.id === 'string' && ID_RE.test(item.id) ? item.id : newId();
        while (seen.has(id)) id = newId();
        seen.add(id);
        return { id, text, photos };
      })
      .filter(Boolean)
      .slice(0, maxItems);
  }

  /** Legacy `bullets` strings → items (in memory only; never written back on its own). */
  function legacyItems(value, { maxItems = LIMITS.items } = {}) {
    return (Array.isArray(value) ? value : [])
      .filter((text) => typeof text === 'string')
      .map((text) => sanitizeText(text).slice(0, LIMITS.text))
      .filter(Boolean)
      .slice(0, maxItems)
      .map((text) => ({ id: newId(), text, photos: [] }));
  }

  /**
   * The read path used by the public site and the admin editor.
   * An array in bullet_items wins — including [], which means "intentionally empty".
   */
  function itemsFromRow(row, options = {}) {
    if (Array.isArray(row?.bullet_items)) return normalizeItems(row.bullet_items, options);
    return legacyItems(row?.bullets, options);
  }

  /** True when the row was never migrated to the new column. */
  const usesLegacyBullets = (row) => !Array.isArray(row?.bullet_items);

  /**
   * Validate editor items before saving. Returns { ok: true, items } with clean
   * items, or { ok: false, error } with a message for the admin panel.
   */
  function validateItems(value, { maxItems = LIMITS.items, maxText = LIMITS.text, maxPhotos = LIMITS.photos, maxCaption = LIMITS.caption } = {}) {
    if (!Array.isArray(value)) return { ok: false, error: 'Bullet points could not be read. Please reload the page.' };

    const items = [];
    const seen = new Set();

    for (let i = 0; i < value.length; i += 1) {
      const raw = value[i] || {};
      const position = items.length + 1;
      const text = sanitizeText(raw.text);
      const rawPhotos = Array.isArray(raw.photos) ? raw.photos : [];

      if (!text && !rawPhotos.length) continue; // empty line with no photo → ignored
      if (!text) return { ok: false, error: `Bullet point ${position} has a photo but no text. Add the text or remove the photo.` };
      if (text.length > maxText) return { ok: false, error: `Bullet point ${position} is too long (max ${maxText} characters).` };
      if (rawPhotos.length > maxPhotos) return { ok: false, error: `Bullet point ${position} can have at most ${maxPhotos} photos.` };

      const photos = [];
      for (let p = 0; p < rawPhotos.length; p += 1) {
        const photo = rawPhotos[p] || {};
        const url = typeof photo.url === 'string' ? photo.url.trim() : '';
        if (!url) continue; // an upload slot the user left empty
        if (!isHttpsUrl(url)) {
          return { ok: false, error: `Photo ${p + 1} of bullet point ${position} has an invalid link. Please upload the image again.` };
        }
        const caption = sanitizeText(photo.caption);
        if (caption.length > maxCaption) {
          return { ok: false, error: `The caption of photo ${p + 1} in bullet point ${position} is too long (max ${maxCaption} characters).` };
        }
        photos.push(caption ? { url, caption } : { url });
      }

      let id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : newId();
      while (seen.has(id)) id = newId();
      seen.add(id);
      items.push({ id, text, photos });
    }

    if (items.length > maxItems) return { ok: false, error: `You can add at most ${maxItems} bullet points.` };
    return { ok: true, items };
  }

  /** What an explicit, successful save writes: the new column AND the legacy one. */
  function serialize(items) {
    const clean = Array.isArray(items) ? items : [];
    return {
      bullet_items: clean.map((item) => ({
        id: item.id,
        text: item.text,
        ...(item.photos?.length ? { photos: item.photos.map((p) => (p.caption ? { url: p.url, caption: p.caption } : { url: p.url })) } : { photos: [] })
      })),
      bullets: clean.map((item) => item.text)
    };
  }

  /**
   * Move one item (with its photos) up or down. Mutates and returns true when it moved.
   * Reordering never touches the photo arrays, so photos can't drift to another bullet.
   */
  function moveItem(items, index, delta) {
    if (!Array.isArray(items)) return false;
    const target = index + delta;
    if (index < 0 || index >= items.length || target < 0 || target >= items.length) return false;
    const [item] = items.splice(index, 1);
    items.splice(target, 0, item);
    return true;
  }

  /* ----------------------------------------------------------------------
     Storage references — used by the admin Files page and by deletes.
     ---------------------------------------------------------------------- */

  /** Every evidence photo URL in a bullet_items value (duplicates kept). */
  function photoUrlsOfItems(value) {
    const urls = [];
    (Array.isArray(value) ? value : []).forEach((item) => {
      (Array.isArray(item?.photos) ? item.photos : []).forEach((photo) => {
        if (typeof photo?.url === 'string' && photo.url) urls.push(photo.url);
      });
    });
    return urls;
  }

  /** Describes where each evidence photo of an experience row lives. */
  function photoRefsOfRow(row) {
    const refs = [];
    (Array.isArray(row?.bullet_items) ? row.bullet_items : []).forEach((item, itemIndex) => {
      (Array.isArray(item?.photos) ? item.photos : []).forEach((photo, photoIndex) => {
        if (typeof photo?.url !== 'string' || !photo.url) return;
        refs.push({
          url: photo.url,
          itemIndex,
          photoIndex,
          bulletId: typeof item?.id === 'string' ? item.id : null,
          bulletText: sanitizeText(item?.text)
        });
      });
    });
    return refs;
  }

  /** Every storage URL an experience row points at (logo + evidence photos). */
  function rowFileUrls(row, fields = ['logo_url']) {
    const urls = fields.map((field) => row?.[field]).filter((url) => typeof url === 'string' && url);
    return [...urls, ...photoUrlsOfItems(row?.bullet_items)];
  }

  /**
   * How many times `url` is still referenced by these rows. Used before deleting a
   * storage object that two bullets (or two entries) might share.
   */
  function countUrlRefs(rows, url, { excludeId = null, fields = ['logo_url'] } = {}) {
    if (!url) return 0;
    return (Array.isArray(rows) ? rows : []).reduce((total, row) => {
      if (excludeId != null && String(row?.id) === String(excludeId)) return total;
      return total + rowFileUrls(row, fields).filter((candidate) => candidate === url).length;
    }, 0);
  }

  /**
   * Drop every photo with this URL from a bullet_items value (Files page: "delete
   * this file" clears the fields that point at it). Bullet text is never changed.
   */
  function removePhotoUrl(value, url) {
    const items = Array.isArray(value) ? value : [];
    let removed = 0;
    const next = items.map((item) => {
      const photos = Array.isArray(item?.photos) ? item.photos : [];
      const kept = photos.filter((photo) => {
        const match = photo?.url === url;
        if (match) removed += 1;
        return !match;
      });
      return { ...item, photos: kept };
    });
    return { bullet_items: next, removed };
  }

  /* ----------------------------------------------------------------------
     Upload session — the storage side of the editor's save / cancel.
     Injected with the admin panel's own storage helpers, so it is fully
     testable with a mocked Supabase Storage.
     ---------------------------------------------------------------------- */

  /**
   * createUploadSession({ removeUrl, isReferenced, onWarning })
   *   seedOriginal(url)   mark a URL as already saved in the database
   *   trackUpload(url)    a new upload that is NOT in the database yet
   *   discardUpload(url)  the user removed a brand-new upload → delete it now
   *   commit(keptUrls)    AFTER a successful save: delete the URLs that are gone
   *   rollback()          cancel / discard: delete only the unsaved uploads
   *
   * Nothing is deleted before a save succeeds, so a replaced photo survives a
   * failed save. `isReferenced(url)` is asked first, so a storage object that is
   * still used somewhere else is kept.
   */
  function createUploadSession({ removeUrl, isReferenced = null, onWarning = null } = {}) {
    const originals = new Set();
    const pending = new Set();

    const warn = (error) => {
      if (onWarning) onWarning(error);
    };

    const tryRemove = async (url) => {
      try {
        await removeUrl(url);
        return true;
      } catch (error) {
        warn(error);
        return false;
      }
    };

    const deleteUnreferenced = async (url) => {
      if (isReferenced) {
        try {
          if (await isReferenced(url)) return false;
        } catch (error) {
          warn(error); // unknown → keep the file rather than risk deleting a used one
          return false;
        }
      }
      return tryRemove(url);
    };

    return {
      seedOriginal(url) {
        if (url) originals.add(url);
      },
      trackUpload(url) {
        if (url && !originals.has(url)) pending.add(url);
      },
      /** Only ever deletes an unsaved upload — never a stored original. */
      async discardUpload(url) {
        if (!url || originals.has(url) || !pending.has(url)) return false;
        pending.delete(url);
        return tryRemove(url);
      },
      async commit(keptUrls = []) {
        const kept = new Set(keptUrls.filter(Boolean));
        const gone = [...new Set([...originals, ...pending])].filter((url) => !kept.has(url));
        const results = await Promise.all(gone.map(deleteUnreferenced));
        originals.clear();
        pending.clear();
        kept.forEach((url) => originals.add(url));
        return { deleted: gone.filter((_, i) => results[i]), kept: [...kept] };
      },
      async rollback() {
        const unsaved = [...pending].filter((url) => !originals.has(url));
        pending.clear();
        await Promise.all(unsaved.map(tryRemove));
        return unsaved;
      },
      /** Inspection helper (tests, debugging). */
      state: () => ({ originals: [...originals], pending: [...pending] })
    };
  }

  return Object.freeze({
    LIMITS,
    isHttpsUrl,
    sanitizeText,
    newId,
    normalizePhoto,
    normalizePhotos,
    normalizeItems,
    legacyItems,
    itemsFromRow,
    usesLegacyBullets,
    validateItems,
    serialize,
    moveItem,
    photoUrlsOfItems,
    photoRefsOfRow,
    rowFileUrls,
    countUrlRefs,
    removePhotoUrl,
    createUploadSession
  });
});
