/**
 * experience-bullets.js — unit tests.
 *
 * Everything is mocked: there is no Supabase client, no Storage bucket and no
 * network access. "Storage" is a Set of URLs, "the database" is an array of rows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EB = require('../experience-bullets.js');

const BUCKET = 'https://project.supabase.co/storage/v1/object/public/portfolio-assets/';
const img = (name) => `${BUCKET}images/${name}.jpg`;

/** Minimal stand-in for Supabase Storage: tracks what exists and what was deleted. */
function mockStorage(initial = []) {
  const objects = new Set(initial);
  const deleted = [];
  return {
    objects,
    deleted,
    has: (url) => objects.has(url),
    async removeUrl(url) {
      if (!objects.has(url)) return false;
      objects.delete(url);
      deleted.push(url);
      return true;
    }
  };
}

/* ========================================================================
   1. Reading: legacy bullets, bullet_items, null vs []
   ======================================================================== */

test('a row from before the migration is read from the legacy bullets strings', () => {
  const row = { organization: 'BINUS Cyber Security Community', bullets: ['Help produce Cyber Talk.', 'Second line.'] };

  const items = EB.itemsFromRow(row);

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.text), ['Help produce Cyber Talk.', 'Second line.']);
  assert.ok(items.every((i) => Array.isArray(i.photos) && i.photos.length === 0));
  assert.ok(items.every((i) => typeof i.id === 'string' && i.id.length > 0));
  assert.notEqual(items[0].id, items[1].id);
  assert.ok(EB.usesLegacyBullets(row));
});

test('converting legacy bullets does not change the row (in-memory only)', () => {
  const row = Object.freeze({ bullets: Object.freeze(['One.']), bullet_items: null });
  const items = EB.itemsFromRow(row);
  items[0].text = 'mutated';
  assert.deepEqual(row.bullets, ['One.']);
  assert.equal(row.bullet_items, null);
});

test('bullet_items wins over bullets once it is an array', () => {
  const row = {
    bullets: ['stale text'],
    bullet_items: [{ id: 'b-1', text: 'fresh text', photos: [{ url: img('a'), caption: 'Poster' }] }]
  };

  const items = EB.itemsFromRow(row);

  assert.deepEqual(items, [{ id: 'b-1', text: 'fresh text', photos: [{ url: img('a'), caption: 'Poster' }] }]);
  assert.equal(EB.usesLegacyBullets(row), false);
});

test('bullet_items = [] means intentionally empty, not "fall back to bullets"', () => {
  assert.deepEqual(EB.itemsFromRow({ bullets: ['old line'], bullet_items: [] }), []);
  // …while null does fall back
  assert.equal(EB.itemsFromRow({ bullets: ['old line'], bullet_items: null }).length, 1);
  assert.equal(EB.itemsFromRow({ bullets: ['old line'] }).length, 1);
});

test('unusable stored data is ignored instead of crashing', () => {
  assert.deepEqual(EB.itemsFromRow({ bullet_items: 'nonsense' }), []);
  assert.deepEqual(EB.itemsFromRow({ bullets: [1, null, {}] }), []);
  assert.deepEqual(EB.itemsFromRow(null), []);
  // a photo without an https URL is dropped, the bullet text survives
  const items = EB.itemsFromRow({
    bullet_items: [{ id: 'b-1', text: 'Keep me', photos: [{ url: 'javascript:alert(1)' }, { url: 'http://x.test/a.png' }, { url: img('ok') }] }]
  });
  assert.deepEqual(items[0].photos, [{ url: img('ok') }]);
});

test('reading enforces the item and photo caps', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `b-${i}`, text: `Line ${i}`, photos: [] }));
  assert.equal(EB.itemsFromRow({ bullet_items: many }, { maxItems: 8 }).length, 8);

  const photos = Array.from({ length: 9 }, (_, i) => ({ url: img(`p${i}`) }));
  const [item] = EB.itemsFromRow({ bullet_items: [{ id: 'b-1', text: 'x', photos }] }, { maxPhotos: 4 });
  assert.equal(item.photos.length, 4);
});

/* ========================================================================
   2. Reordering — the whole object moves, never an index-based photo swap
   ======================================================================== */

test('moving a bullet carries its photos with it', () => {
  const items = [
    { id: 'b-1', text: 'First', photos: [{ url: img('first') }] },
    { id: 'b-2', text: 'Second', photos: [] },
    { id: 'b-3', text: 'Third', photos: [{ url: img('third'), caption: 'Third photo' }] }
  ];

  assert.equal(EB.moveItem(items, 2, -1), true);

  assert.deepEqual(items.map((i) => i.id), ['b-1', 'b-3', 'b-2']);
  // the photo travelled with bullet b-3, it did not stay at position 2
  assert.deepEqual(items[1].photos, [{ url: img('third'), caption: 'Third photo' }]);
  assert.deepEqual(items[2].photos, []);
  assert.deepEqual(items[0].photos, [{ url: img('first') }]);
});

test('moving a bullet down, then saving, keeps text and photos paired', () => {
  const items = [
    { id: 'b-1', text: 'Alpha', photos: [{ url: img('alpha') }] },
    { id: 'b-2', text: 'Beta', photos: [{ url: img('beta') }] }
  ];

  EB.moveItem(items, 0, 1);
  const saved = EB.serialize(items);

  assert.deepEqual(saved.bullets, ['Beta', 'Alpha']);
  assert.deepEqual(saved.bullet_items.map((i) => [i.text, i.photos[0].url]), [
    ['Beta', img('beta')],
    ['Alpha', img('alpha')]
  ]);
});

test('out-of-range moves are refused and leave the order alone', () => {
  const items = [{ id: 'b-1', text: 'a', photos: [] }, { id: 'b-2', text: 'b', photos: [] }];
  assert.equal(EB.moveItem(items, 0, -1), false);
  assert.equal(EB.moveItem(items, 1, 1), false);
  assert.equal(EB.moveItem(items, 5, -1), false);
  assert.deepEqual(items.map((i) => i.id), ['b-1', 'b-2']);
});

/* ========================================================================
   3. Validation — existing text limits preserved, new JSON structure checked
   ======================================================================== */

test('valid items pass and come back sanitised', () => {
  const result = EB.validateItems([
    { id: 'b-1', text: '  Help  produce   Cyber Talk. ', photos: [{ url: img('a'), caption: '  Backstage  ' }] },
    { id: 'b-2', text: 'No photos here', photos: [] }
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.items, [
    { id: 'b-1', text: 'Help produce Cyber Talk.', photos: [{ url: img('a'), caption: 'Backstage' }] },
    { id: 'b-2', text: 'No photos here', photos: [] }
  ]);
});

test('empty rows are ignored, and empty upload slots do not become photos', () => {
  const result = EB.validateItems([
    { id: 'b-1', text: '   ', photos: [] },
    { id: 'b-2', text: 'Real line', photos: [{ url: '' }, { url: img('a') }] }
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].photos, [{ url: img('a') }]);
});

test('the existing 300-character bullet limit still applies', () => {
  const ok = EB.validateItems([{ id: 'b-1', text: 'x'.repeat(300), photos: [] }]);
  assert.equal(ok.ok, true);

  const tooLong = EB.validateItems([{ id: 'b-1', text: 'x'.repeat(301), photos: [] }]);
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error, /Bullet point 1 is too long/);
});

test('a photo without bullet text is rejected', () => {
  const result = EB.validateItems([{ id: 'b-1', text: '', photos: [{ url: img('a') }] }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /photo but no text/);
});

test('non-https photo links, long captions and over-long lists are rejected', () => {
  const badUrl = EB.validateItems([{ id: 'b-1', text: 'x', photos: [{ url: 'http://x.test/a.png' }] }]);
  assert.equal(badUrl.ok, false);
  assert.match(badUrl.error, /invalid link/);

  const longCaption = EB.validateItems([{ id: 'b-1', text: 'x', photos: [{ url: img('a'), caption: 'c'.repeat(161) }] }]);
  assert.equal(longCaption.ok, false);
  assert.match(longCaption.error, /caption/);

  const tooManyPhotos = EB.validateItems([
    { id: 'b-1', text: 'x', photos: Array.from({ length: 5 }, (_, i) => ({ url: img(`p${i}`) })) }
  ]);
  assert.equal(tooManyPhotos.ok, false);
  assert.match(tooManyPhotos.error, /at most 4 photos/);

  const tooManyItems = EB.validateItems(Array.from({ length: 7 }, (_, i) => ({ id: `b-${i}`, text: `Line ${i}`, photos: [] })));
  assert.equal(tooManyItems.ok, false);
  assert.match(tooManyItems.error, /at most 6 bullet points/);
});

test('missing or duplicate ids are repaired so every bullet stays identifiable', () => {
  const result = EB.validateItems([
    { text: 'No id', photos: [] },
    { id: 'b-same', text: 'One', photos: [] },
    { id: 'b-same', text: 'Two', photos: [] }
  ]);

  assert.equal(result.ok, true);
  const ids = result.items.map((i) => i.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)));
});

/* ========================================================================
   4. What a successful save writes
   ======================================================================== */

test('a save writes bullet_items AND the matching legacy bullets strings', () => {
  const { items } = EB.validateItems([
    { id: 'b-1', text: 'First line', photos: [{ url: img('a'), caption: 'Caption' }] },
    { id: 'b-2', text: 'Second line', photos: [] }
  ]);

  const saved = EB.serialize(items);

  assert.deepEqual(saved.bullets, ['First line', 'Second line']);
  assert.deepEqual(saved.bullet_items, [
    { id: 'b-1', text: 'First line', photos: [{ url: img('a'), caption: 'Caption' }] },
    { id: 'b-2', text: 'Second line', photos: [] }
  ]);
});

test('the saved JSON matches the shape the migration CHECK allows', () => {
  const { items } = EB.validateItems([
    { id: 'b-1', text: 'Line', photos: [{ url: img('a'), caption: 'Cap' }, { url: img('b') }] }
  ]);
  const { bullet_items: saved } = EB.serialize(items);

  assert.ok(Array.isArray(saved) && saved.length <= 8);
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) <= 20000);
  for (const item of saved) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'photos', 'text']);
    assert.match(item.id, /^[A-Za-z0-9_-]{1,64}$/);
    assert.ok(item.text.length >= 1 && item.text.length <= 300);
    assert.ok(Array.isArray(item.photos) && item.photos.length <= 4);
    for (const photo of item.photos) {
      assert.ok(Object.keys(photo).every((key) => key === 'url' || key === 'caption'));
      assert.match(photo.url, /^https:\/\/[^\s<>"'`]+$/);
      assert.ok(photo.url.length <= 500);
      if ('caption' in photo) {
        assert.equal(typeof photo.caption, 'string');
        assert.ok(photo.caption.length <= 160);
      }
    }
  }
});

test('a captionless photo is stored without a caption key', () => {
  const { bullet_items: saved } = EB.serialize([{ id: 'b-1', text: 'x', photos: [{ url: img('a'), caption: '' }] }]);
  assert.deepEqual(saved[0].photos, [{ url: img('a') }]);
});

/* ========================================================================
   5. Storage references (admin Files page, deletes)
   ======================================================================== */

const ROWS = [
  {
    id: 1,
    organization: 'BINUS Cyber Security Community',
    logo_url: img('logo-1'),
    bullet_items: [
      { id: 'b-1', text: 'Produced Cyber Talk', photos: [{ url: img('talk-1'), caption: 'Stage' }, { url: img('talk-2') }] },
      { id: 'b-2', text: 'Ran the publication desk', photos: [{ url: img('desk') }] }
    ]
  },
  // A row that still uses the legacy column: no bullet_items, so no photo references.
  { id: 2, organization: 'Legacy Org', logo_url: null, bullets: ['Only text'], bullet_items: null },
  // A shared photo: the same storage object referenced from another entry.
  { id: 3, organization: 'Shared Org', logo_url: null, bullet_items: [{ id: 'b-9', text: 'Shared', photos: [{ url: img('desk') }] }] }
];

test('every evidence photo is found, with the bullet it belongs to', () => {
  const refs = EB.photoRefsOfRow(ROWS[0]);

  assert.deepEqual(refs.map((r) => [r.itemIndex, r.photoIndex, r.bulletId, r.url]), [
    [0, 0, 'b-1', img('talk-1')],
    [0, 1, 'b-1', img('talk-2')],
    [1, 0, 'b-2', img('desk')]
  ]);
  assert.equal(refs[0].bulletText, 'Produced Cyber Talk');
  assert.deepEqual(EB.photoRefsOfRow(ROWS[1]), []);
});

test('rowFileUrls returns the logo and all evidence photos of an entry', () => {
  assert.deepEqual(EB.rowFileUrls(ROWS[0], ['logo_url']), [img('logo-1'), img('talk-1'), img('talk-2'), img('desk')]);
  assert.deepEqual(EB.rowFileUrls(ROWS[1], ['logo_url']), []);
});

test('a referenced evidence photo is never reported as unused', () => {
  // Mirrors the Files page: storage listing + the reference scan over the table rows.
  const storage = [img('logo-1'), img('talk-1'), img('talk-2'), img('desk'), img('orphan')];
  const usage = new Map();
  for (const row of ROWS) {
    for (const url of EB.rowFileUrls(row, ['logo_url'])) {
      if (!usage.has(url)) usage.set(url, []);
      usage.get(url).push(row.id);
    }
  }

  const unused = storage.filter((url) => !usage.has(url));

  assert.deepEqual(unused, [img('orphan')]);
  for (const url of [img('talk-1'), img('talk-2'), img('desk')]) {
    assert.ok(usage.has(url), `${url} must count as used`);
  }
  assert.deepEqual(usage.get(img('desk')), [1, 3]); // shared by two entries
});

test('countUrlRefs sees shared objects and can exclude the row being edited', () => {
  assert.equal(EB.countUrlRefs(ROWS, img('desk')), 2);
  assert.equal(EB.countUrlRefs(ROWS, img('desk'), { excludeId: 1 }), 1);
  assert.equal(EB.countUrlRefs(ROWS, img('talk-1'), { excludeId: 1 }), 0);
  assert.equal(EB.countUrlRefs(ROWS, img('logo-1')), 1);
  assert.equal(EB.countUrlRefs(ROWS, img('orphan')), 0);
  assert.equal(EB.countUrlRefs(ROWS, null), 0);
});

test('clearing one file reference rewrites bullet_items without touching the text', () => {
  const { bullet_items: next, removed } = EB.removePhotoUrl(ROWS[0].bullet_items, img('talk-1'));

  assert.equal(removed, 1);
  assert.deepEqual(next.map((i) => i.text), ['Produced Cyber Talk', 'Ran the publication desk']);
  assert.deepEqual(next[0].photos, [{ url: img('talk-2') }]);
  assert.deepEqual(next[1].photos, [{ url: img('desk') }]);
  // the original value is untouched
  assert.equal(ROWS[0].bullet_items[0].photos.length, 2);

  assert.deepEqual(EB.removePhotoUrl(null, img('talk-1')), { bullet_items: [], removed: 0 });
  assert.equal(EB.removePhotoUrl(ROWS[0].bullet_items, img('orphan')).removed, 0);
});

/* ========================================================================
   6. Upload session — Save, failed Save and Cancel against mocked Storage
   ======================================================================== */

test('Cancel deletes only the new uploads and keeps every saved photo', async () => {
  const storage = mockStorage([img('saved')]);
  const session = EB.createUploadSession({ removeUrl: storage.removeUrl });

  session.seedOriginal(img('saved'));
  storage.objects.add(img('fresh'));
  session.trackUpload(img('fresh'));

  const removed = await session.rollback();

  assert.deepEqual(removed, [img('fresh')]);
  assert.deepEqual(storage.deleted, [img('fresh')]);
  assert.ok(storage.has(img('saved')), 'the photo that was already saved must survive Cancel');
});

test('a failed Save deletes nothing, so the original photo is still there to retry with', async () => {
  const storage = mockStorage([img('original')]);
  const session = EB.createUploadSession({ removeUrl: storage.removeUrl });

  session.seedOriginal(img('original'));
  storage.objects.add(img('replacement'));
  session.trackUpload(img('replacement'));

  // The save threw: neither commit() nor rollback() runs.
  assert.deepEqual(storage.deleted, []);
  assert.ok(storage.has(img('original')));
  assert.ok(storage.has(img('replacement')));
  assert.deepEqual(session.state(), { originals: [img('original')], pending: [img('replacement')] });

  // Pressing Save again succeeds: now the replaced original goes.
  await session.commit([img('replacement')]);
  assert.deepEqual(storage.deleted, [img('original')]);
  assert.ok(storage.has(img('replacement')));
});

test('a successful Save deletes replaced and removed photos, and keeps the rest', async () => {
  const storage = mockStorage([img('keep'), img('replaced'), img('removed')]);
  const session = EB.createUploadSession({ removeUrl: storage.removeUrl });

  [img('keep'), img('replaced'), img('removed')].forEach(session.seedOriginal);
  storage.objects.add(img('new'));
  session.trackUpload(img('new'));

  const result = await session.commit([img('keep'), img('new')]);

  assert.deepEqual(result.deleted.sort(), [img('removed'), img('replaced')].sort());
  assert.ok(storage.has(img('keep')));
  assert.ok(storage.has(img('new')));
  assert.equal(storage.has(img('replaced')), false);
  assert.equal(storage.has(img('removed')), false);
  // After the save the kept photos count as saved originals.
  assert.deepEqual(session.state(), { originals: [img('keep'), img('new')], pending: [] });
});

test('an upload left over from a removed bullet is cleaned up by the save', async () => {
  const storage = mockStorage([]);
  const session = EB.createUploadSession({ removeUrl: storage.removeUrl });

  storage.objects.add(img('orphan'));
  session.trackUpload(img('orphan')); // uploaded, then its bullet was deleted

  await session.commit([]); // save with no photos left

  assert.deepEqual(storage.deleted, [img('orphan')]);
});

test('a storage object another entry still references is kept, not deleted', async () => {
  const storage = mockStorage([img('shared'), img('lonely')]);
  const asked = [];
  const session = EB.createUploadSession({
    removeUrl: storage.removeUrl,
    isReferenced: async (url) => {
      asked.push(url);
      return EB.countUrlRefs(ROWS, url) > 0;
    }
  });

  session.seedOriginal(img('shared'));
  session.seedOriginal(img('lonely'));

  // img('desk') is the shared one in ROWS; reuse it here as the shared original.
  const sharedSession = EB.createUploadSession({
    removeUrl: storage.removeUrl,
    isReferenced: async (url) => EB.countUrlRefs(ROWS, url) > 0
  });
  storage.objects.add(img('desk'));
  sharedSession.seedOriginal(img('desk'));
  await sharedSession.commit([]);
  assert.ok(storage.has(img('desk')), 'a photo used by another entry must not be deleted');

  await session.commit([]);
  assert.deepEqual(asked.sort(), [img('lonely'), img('shared')].sort());
  assert.equal(storage.has(img('lonely')), false);
  assert.equal(storage.has(img('shared')), false);
});

test('an unknown reference answer keeps the file rather than risking a used one', async () => {
  const storage = mockStorage([img('unsure')]);
  const warnings = [];
  const session = EB.createUploadSession({
    removeUrl: storage.removeUrl,
    isReferenced: async () => {
      throw new Error('table unreachable');
    },
    onWarning: (error) => warnings.push(error.message)
  });

  session.seedOriginal(img('unsure'));
  await session.commit([]);

  assert.ok(storage.has(img('unsure')));
  assert.deepEqual(warnings, ['table unreachable']);
});

test('discardUpload never deletes a photo that is already saved', async () => {
  const storage = mockStorage([img('saved'), img('fresh')]);
  const session = EB.createUploadSession({ removeUrl: storage.removeUrl });

  session.seedOriginal(img('saved'));
  session.trackUpload(img('fresh'));

  assert.equal(await session.discardUpload(img('saved')), false);
  assert.ok(storage.has(img('saved')));

  assert.equal(await session.discardUpload(img('fresh')), true);
  assert.equal(storage.has(img('fresh')), false);
  // A second attempt is a harmless no-op.
  assert.equal(await session.discardUpload(img('fresh')), false);
});

test('a storage failure during cleanup is reported, not thrown', async () => {
  const warnings = [];
  const session = EB.createUploadSession({
    removeUrl: async () => {
      throw new Error('storage offline');
    },
    onWarning: (error) => warnings.push(error.message)
  });

  session.seedOriginal(img('a'));
  await assert.doesNotReject(session.commit([]));
  assert.deepEqual(warnings, ['storage offline']);
});
