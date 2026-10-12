/**
 * project-links.js — unit tests (no DOM, no network, no Supabase).
 * Link labels / URLs below are test fixtures on example domains, not portfolio content.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sqlExternalLinksValid } from './helpers/mock-supabase.mjs';

const require = createRequire(import.meta.url);
const PL = require('../project-links.js');

const link = (n, extra = {}) => ({ id: `l-${n}`, label: `Link ${n}`, url: `https://example.com/${n}`, ...extra });

/** Every way an unsafe or non-https URL can be written. None may ever be accepted. */
const UNSAFE_URLS = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  ' javascript:alert(1)',
  'java\u0000script:alert(1)',
  'javascript://example.com/%0Aalert(1)',
  'data:text/html,<script>alert(1)</script>',
  'DATA:text/html;base64,PHNjcmlwdD4=',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'http://example.com/',
  'HTTPS://example.com/',
  'ftp://example.com/file',
  '//example.com/path',
  '/relative/path',
  'assets/docs/file.pdf',
  'example.com',
  'https://',
  'https://localhost/',
  'https://exa mple.com/',
  'https://example.com/"onmouseover="alert(1)',
  'https://example.com/<script>',
  'https://user:secret@example.com/',
  `https://example.com/${'a'.repeat(500)}`
];

/* ========================================================================
   1. Legacy projects and empty links
   ======================================================================== */

test('a project from before the migration (no external_links) has no links', () => {
  const legacy = { id: 1, title: 'Legacy', repo_url: 'https://github.com/example/repo', doc_url: null };
  assert.deepEqual(PL.linksFromRow(legacy), []);
  assert.deepEqual(PL.linksFromRow({ ...legacy, external_links: null }), []);
  assert.deepEqual(PL.linksFromRow(null), []);
  assert.deepEqual(PL.toDrafts(legacy.external_links), []);
});

test('external_links = [] means no additional links', () => {
  assert.deepEqual(PL.linksFromRow({ external_links: [] }), []);
  assert.deepEqual(PL.toDrafts([]), []);
  assert.deepEqual(PL.validateLinks([]), { ok: true, links: [], errors: [] });
  assert.deepEqual(PL.serialize([]), []);
});

test('reading never mutates the stored row', () => {
  const row = Object.freeze({ external_links: Object.freeze([Object.freeze(link(1, { description: '  Notes  ' }))]) });
  const [first] = PL.linksFromRow(row);
  first.label = 'changed';
  assert.equal(row.external_links[0].label, 'Link 1');
  assert.equal(row.external_links[0].description, '  Notes  ');
});

test('unusable stored data is ignored instead of crashing', () => {
  assert.deepEqual(PL.linksFromRow({ external_links: 'nonsense' }), []);
  assert.deepEqual(PL.linksFromRow({ external_links: {} }), []);
  assert.deepEqual(PL.linksFromRow({ external_links: [null, 1, 'x', [], { label: 5, url: 'https://example.com' }] }), []);
});

/* ========================================================================
   2. Ordering — the saved order is the display order
   ======================================================================== */

test('links keep their saved order', () => {
  const row = { external_links: [link(3), link(1), link(2)] };
  assert.deepEqual(PL.linksFromRow(row).map((l) => l.id), ['l-3', 'l-1', 'l-2']);
  assert.deepEqual(PL.toDrafts(row.external_links).map((l) => l.id), ['l-3', 'l-1', 'l-2']);
});

test('moving a link moves the whole object, and the save keeps the new order', () => {
  const drafts = [link(1, { description: 'First' }), link(2), link(3, { description: 'Third' })];

  assert.equal(PL.moveLink(drafts, 2, -1), true); // Link 3 up
  assert.equal(PL.moveLink(drafts, 0, 1), true); // Link 1 down

  assert.deepEqual(drafts.map((l) => l.id), ['l-3', 'l-1', 'l-2']);
  const result = PL.validateLinks(drafts);
  assert.equal(result.ok, true);
  assert.deepEqual(PL.serialize(result.links), [
    { id: 'l-3', label: 'Link 3', url: 'https://example.com/3', description: 'Third' },
    { id: 'l-1', label: 'Link 1', url: 'https://example.com/1', description: 'First' },
    { id: 'l-2', label: 'Link 2', url: 'https://example.com/2' }
  ]);
});

test('out-of-range moves are refused and leave the order alone', () => {
  const drafts = [link(1), link(2)];
  assert.equal(PL.moveLink(drafts, 0, -1), false);
  assert.equal(PL.moveLink(drafts, 1, 1), false);
  assert.equal(PL.moveLink(drafts, 7, -1), false);
  assert.equal(PL.moveLink(null, 0, 1), false);
  assert.deepEqual(drafts.map((l) => l.id), ['l-1', 'l-2']);
});

test('the public read path keeps at most 8 links, counted after unsafe ones are dropped', () => {
  const stored = [{ id: 'l-bad', label: 'Bad', url: 'javascript:alert(1)' }, ...Array.from({ length: 10 }, (_, i) => link(i + 1))];
  const links = PL.linksFromRow({ external_links: stored });
  assert.equal(links.length, PL.LIMITS.items);
  assert.equal(links[0].id, 'l-1');
});

/* ========================================================================
   3. Validation (admin Save)
   ======================================================================== */

test('valid links pass and come back sanitised; an empty description is not stored', () => {
  const result = PL.validateLinks([
    { id: 'l-1', label: '  Live\u200B   demo ', url: ' https://example.com/demo ', description: '' },
    { id: 'l-2', label: 'Slides', url: 'https://example.com/slides', description: '  Short   note \u202E ' }
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.links, [
    { id: 'l-1', label: 'Live demo', url: 'https://example.com/demo' },
    { id: 'l-2', label: 'Slides', url: 'https://example.com/slides', description: 'Short note' }
  ]);
});

test('a completely empty card is ignored', () => {
  const result = PL.validateLinks([{ id: 'l-1', label: '  ', url: '', description: '' }, link(2)]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.links.map((l) => l.id), ['l-2']);
});

test('a label is required, and so is a URL', () => {
  const result = PL.validateLinks([
    { id: 'l-1', label: '', url: 'https://example.com/a', description: '' },
    { id: 'l-2', label: 'No URL', url: '   ', description: '' },
    { id: 'l-3', label: '', url: '', description: 'Only a description' }
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => [e.index, e.field]), [[0, 'label'], [1, 'url'], [2, 'label'], [2, 'url']]);
  assert.match(result.error, /^Link 1: Please add a label/);
  assert.match(result.error, /3 more problems/);
});

test('the error index is the card position, so the editor can mark the exact input', () => {
  const result = PL.validateLinks([link(1), { id: 'l-2', label: '', url: '', description: '' }, { id: 'l-3', label: 'x', url: 'http://example.com' }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [{ index: 2, field: 'url', message: 'Only https:// links are allowed here, not \u201chttp:\u201d.' }]);
  assert.match(result.error, /^Link 3: /);
});

test('length limits: label 60, URL 500, description 160', () => {
  const at = PL.validateLinks([{ id: 'l-1', label: 'L'.repeat(60), url: `https://example.com/${'a'.repeat(480)}`, description: 'd'.repeat(160) }]);
  assert.equal(at.ok, true, 'values at the limit are allowed');
  assert.equal(at.links[0].url.length, 500);

  const over = PL.validateLinks([{ id: 'l-1', label: 'L'.repeat(61), url: `https://example.com/${'a'.repeat(481)}`, description: 'd'.repeat(161) }]);
  assert.equal(over.ok, false);
  assert.deepEqual(over.errors.map((e) => e.field), ['label', 'url', 'description']);
  assert.match(over.errors[0].message, /under 60 characters \(now 61\)/);
  assert.match(over.errors[1].message, /under 500 characters \(now 501\)/);
  assert.match(over.errors[2].message, /under 160 characters \(now 161\)/);
});

test('at most 8 links', () => {
  const eight = PL.validateLinks(Array.from({ length: 8 }, (_, i) => link(i + 1)));
  assert.equal(eight.ok, true);
  const nine = PL.validateLinks(Array.from({ length: 9 }, (_, i) => link(i + 1)));
  assert.equal(nine.ok, false);
  assert.equal(nine.error, 'You can add at most 8 links.');
});

test('missing or duplicate ids are repaired so every link keeps a stable, unique id', () => {
  const result = PL.validateLinks([
    { label: 'No id', url: 'https://example.com/1' },
    { id: 'l-same', label: 'One', url: 'https://example.com/2' },
    { id: 'l-same', label: 'Two', url: 'https://example.com/3' },
    { id: 'not valid!', label: 'Three', url: 'https://example.com/4' }
  ]);
  assert.equal(result.ok, true);
  const ids = result.links.map((l) => l.id);
  assert.equal(new Set(ids).size, 4);
  assert.equal(ids[1], 'l-same', 'a valid id is kept as it is');
  assert.ok(ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)));
});

test('validation does not modify the drafts (the editor keeps them on a failed Save)', () => {
  const drafts = [{ id: 'l-1', label: '  Draft  ', url: 'javascript:alert(1)', description: ' keep me ' }];
  const copy = structuredClone(drafts);
  PL.validateLinks(drafts);
  assert.deepEqual(drafts, copy);
});

test('a non-array value is refused', () => {
  assert.equal(PL.validateLinks(null).ok, false);
  assert.equal(PL.validateLinks({}).ok, false);
});

/* ========================================================================
   4. Unsafe URLs
   ======================================================================== */

test('unsafe and non-https URLs are refused by validation', () => {
  for (const url of UNSAFE_URLS) {
    const result = PL.validateLinks([{ id: 'l-1', label: 'Label', url }]);
    assert.equal(result.ok, false, `must be refused: ${JSON.stringify(url)}`);
    assert.equal(result.errors[0].field, 'url');
  }
});

test('the error names the actual problem, so it is clear why a link was refused', () => {
  const message = (url) => PL.validateLinks([{ id: 'l-1', label: 'x', url }]).errors[0].message;
  assert.match(message('javascript:alert(1)'), /not \u201cjavascript:\u201d/);
  assert.match(message('DATA:text/html,x'), /not \u201cdata:\u201d/);
  assert.match(message('http://example.com'), /not \u201chttp:\u201d/);
  assert.match(message('mailto:someone@example.com'), /not \u201cmailto:\u201d/);
  // host:port is not a scheme
  assert.equal(message('example.com:8080/x'), 'Please enter a full link that starts with https://');
  assert.equal(message('localhost:3000'), 'Please enter a full link that starts with https://');
  assert.equal(message('example.com'), 'Please enter a full link that starts with https://');
  assert.match(message('https://exa mple.com/'), /can\u2019t contain spaces/);
  assert.match(message('https://user:secret@example.com/'), /remove the user name or password/);
});

test('unsafe and non-https URLs are never returned by the public read path', () => {
  const stored = UNSAFE_URLS.map((url, i) => ({ id: `l-${i}`, label: `Bad ${i}`, url }));
  stored.push(link(99));
  const links = PL.linksFromRow({ external_links: stored });
  assert.deepEqual(links.map((l) => l.id), ['l-99']);
});

test('isHttpsUrl accepts ordinary https links', () => {
  for (const url of ['https://example.com', 'https://www.example.com/path?q=1#part', 'https://sub.example.co.uk/a-b_c/%20x']) {
    assert.equal(PL.isHttpsUrl(url), true, url);
  }
});

test('the editor still shows a stored link the public site would hide (nothing is lost silently)', () => {
  const drafts = PL.toDrafts([{ id: 'l-1', label: 'Old', url: 'http://example.com/old' }]);
  assert.deepEqual(drafts, [{ id: 'l-1', label: 'Old', url: 'http://example.com/old', description: '' }]);
  assert.equal(PL.validateLinks(drafts).ok, false, 'and Save asks for a fix instead of dropping it');
});

/* ========================================================================
   5. Rendering data: text stays text
   ======================================================================== */

test('markup in a label or description is kept as plain text (rendered with textContent)', () => {
  const [first] = PL.linksFromRow({
    external_links: [{ id: 'l-1', label: '<img src=x onerror=alert(1)>', url: 'https://example.com', description: '<b>bold</b>' }]
  });
  assert.equal(first.label, '<img src=x onerror=alert(1)>');
  assert.equal(first.description, '<b>bold</b>');
});

/* ========================================================================
   6. What a save writes matches the database CHECK constraint
   ======================================================================== */

test('the saved JSON has exactly the shape the migration CHECK allows', () => {
  const { links } = PL.validateLinks([
    link(1, { description: 'With description' }),
    { label: 'Generated id', url: 'https://example.com/x' },
    { id: 'l-3', label: 'L'.repeat(60), url: `https://example.com/${'a'.repeat(480)}`, description: 'd'.repeat(160) }
  ]);
  const saved = PL.serialize(links);

  assert.equal(sqlExternalLinksValid(saved), true);
  for (const item of saved) {
    assert.ok(Object.keys(item).every((key) => ['id', 'label', 'url', 'description'].includes(key)));
    assert.ok(!('description' in item) || item.description.length > 0, 'no empty description key');
  }
  assert.equal(sqlExternalLinksValid(Array.from({ length: 8 }, (_, i) => link(i + 1))), true);
});

test('the CHECK mirror refuses what the database must refuse', () => {
  const bad = [
    null,
    {},
    [link(1), link(1)], // duplicate id
    [{ label: 'x', url: 'https://example.com' }], // no id
    [{ ...link(1), extra: true }],
    [{ ...link(1), url: 'javascript:alert(1)' }],
    [{ ...link(1), url: 'http://example.com' }],
    [{ ...link(1), label: '   ' }],
    [{ ...link(1), description: null }],
    Array.from({ length: 9 }, (_, i) => link(i + 1))
  ];
  bad.forEach((value) => assert.equal(sqlExternalLinksValid(value), false, JSON.stringify(value)?.slice(0, 80)));
});

/* ========================================================================
   7. Storage references (admin Files page)
   ======================================================================== */

test('linkRefs lists every link URL with its position and label', () => {
  const refs = PL.linkRefs([link(1), { id: 'l-2', label: ' Two ', url: 'https://example.com/2' }, null, { id: 'l-x' }]);
  assert.deepEqual(refs, [
    { url: 'https://example.com/1', index: 0, label: 'Link 1' },
    { url: 'https://example.com/2', index: 1, label: 'Two' }
  ]);
  assert.deepEqual(PL.linkRefs(undefined), []);
});

test('removeUrl drops only the links with that URL and keeps the rest in order', () => {
  const value = [link(1), { ...link(2), url: 'https://example.com/1' }, link(3)];
  const { external_links: next, removed } = PL.removeUrl(value, 'https://example.com/1');
  assert.equal(removed, 2);
  assert.deepEqual(next.map((l) => l.id), ['l-3']);
  assert.equal(value.length, 3, 'the original value is untouched');
  assert.deepEqual(PL.removeUrl(null, 'https://example.com/1'), { external_links: [], removed: 0 });
});

test('removeUrl also takes a matcher, so ?query / #fragment variants of a file go with it', () => {
  const value = [
    link(1, { url: 'https://example.com/docs/x.pdf' }),
    link(2, { url: 'https://example.com/docs/x.pdf#page=2' }),
    link(3, { url: 'https://example.com/docs/y.pdf' })
  ];
  const samePath = (url) => url.split(/[?#]/)[0] === 'https://example.com/docs/x.pdf';
  const { external_links: next, removed } = PL.removeUrl(value, samePath);
  assert.equal(removed, 2);
  assert.deepEqual(next.map((l) => l.id), ['l-3']);
});
