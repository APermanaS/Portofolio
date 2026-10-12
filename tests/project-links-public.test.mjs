/**
 * Public site (script.js) — the project's "Additional links", run for real in node:vm
 * with a tiny DOM and a mocked Supabase client. No browser, no network, no real
 * Supabase project: every row below is an in-memory fixture on example domains.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDom, browserGlobals, waitFor, settle } from './helpers/mini-dom.mjs';
import { createMockSupabase } from './helpers/mock-supabase.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => readFileSync(join(repo, name), 'utf8');
const localData = JSON.parse(source('data.json'));

const BUCKET = 'https://project.supabase.co/storage/v1/object/public/portfolio-assets/';

/** Saved Supabase rows as they look BEFORE the migration (no external_links column). */
const SAVED_PROJECTS = [
  {
    id: 1,
    title: 'Saved project from Supabase',
    category: 'code',
    short_desc: 'Remote short description.',
    detail_desc: 'Remote detail.',
    role: null,
    tools: null,
    result: null,
    period: '2026',
    repo_url: 'https://github.com/example/repo',
    image_url: null,
    doc_url: `${BUCKET}docs/report.pdf`,
    sort_order: 1,
    is_visible: true
  },
  {
    id: 2,
    title: 'Second saved project',
    category: 'document',
    short_desc: null,
    detail_desc: null,
    role: null,
    tools: null,
    result: null,
    period: null,
    repo_url: null,
    image_url: null,
    doc_url: null,
    sort_order: 2,
    is_visible: true
  }
];

function boot({ projects, missingColumns = {} }) {
  const dom = createDom();
  const { document, el } = dom;
  document.body.append(
    el('main', {}, el('section', { id: 'projects', 'data-section': 'projects' }, el('div', { id: 'projects-root' }))),
    el('dialog', { id: 'project-modal', class: 'modal modal--project' },
      el('button', { class: 'modal__close', type: 'button', 'data-close': true }),
      el('div', { class: 'modal__panel' })),
    el('dialog', { id: 'image-modal', class: 'modal modal--image' },
      el('button', { class: 'modal__close', type: 'button', 'data-close': true }),
      el('figure', { class: 'modal__panel modal__figure' }, el('div', { class: 'modal__image-slot' }), el('figcaption', { class: 'modal__caption' })))
  );

  const mock = createMockSupabase({
    tables: { profile: [], skills: [], projects, experience: [], education: [], certificates: [] },
    missingColumns
  });

  const warnings = [];
  const sink = { ...console, warn: (...args) => warnings.push(args.map(String).join(' ')), error: (...args) => warnings.push(args.map(String).join(' ')) };
  const fetch = async (url, options = {}) => {
    if (options.method === 'HEAD') return { ok: true, status: 200 };
    if (url === 'data.json') return { ok: true, status: 200, json: async () => structuredClone(localData) };
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const context = vm.createContext(
    browserGlobals(dom, {
      fetch,
      supabase: mock.supabase,
      config: { supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'public-anon-key-for-tests' },
      console: sink
    })
  );
  context.window = context;
  context.self = context;
  context.top = context;

  for (const file of ['experience-bullets.js', 'project-links.js', 'script.js']) {
    vm.runInContext(source(file), context, { filename: file });
  }
  return { dom, document, mock, warnings, context };
}

const cards = (document) => document.querySelectorAll('#projects-root .project-card');
const titleOf = (card) => card.querySelector('.project-card__open').textContent;

async function openProject(document, title) {
  const card = await waitFor(() => cards(document).find((c) => titleOf(c) === title), { label: `card "${title}"` });
  card.querySelector('.project-card__open').click();
  const panel = document.querySelector('#project-modal .modal__panel');
  assert.ok(document.querySelector('#project-modal').open, 'the project modal opens');
  return panel;
}

const blockByHeading = (panel, heading) =>
  panel.querySelectorAll('.modal__block').find((block) => block.querySelector('h3')?.textContent === heading) || null;

/* ------------------------------------------------------------------------ */

test('migration not run yet: the legacy query is retried and saved Supabase projects still show', async () => {
  const { document, mock } = boot({ projects: SAVED_PROJECTS, missingColumns: { projects: ['external_links'] } });

  await waitFor(() => cards(document).length === 2, { label: 'two project cards' });

  const projectSelects = mock.calls.filter((c) => c.table === 'projects' && c.op === 'select');
  assert.equal(projectSelects.length, 2, 'one failed query with the new column, then one retry');
  assert.ok(projectSelects[0].columns.includes('external_links'));
  assert.ok(!projectSelects[1].columns.includes('external_links'), 'the retry does not ask for the new column');
  assert.ok(projectSelects[1].columns.includes('repo_url') && projectSelects[1].columns.includes('doc_url'));

  // Saved Supabase content, not the data.json fallback
  const titles = cards(document).map(titleOf);
  assert.deepEqual(titles, ['Saved project from Supabase', 'Second saved project']);
  for (const fallback of localData.projects) assert.ok(!titles.includes(fallback.title), 'data.json did not replace saved content');

  // Repository and supporting document are unchanged, and no additional-links area appears
  const panel = await openProject(document, 'Saved project from Supabase');
  const repo = blockByHeading(panel, 'Repository');
  assert.equal(repo.querySelector('a').getAttribute('href'), 'https://github.com/example/repo');
  const docBlock = blockByHeading(panel, 'Supporting document');
  assert.equal(docBlock.querySelector('a').getAttribute('href'), `${BUCKET}docs/report.pdf`);
  assert.equal(blockByHeading(panel, 'Additional links'), null);
});

test('additional links render in the saved order with the chosen labels and descriptions', async () => {
  const projects = structuredClone(SAVED_PROJECTS);
  projects[0].external_links = [
    { id: 'l-b', label: 'Second label', url: 'https://example.com/b' },
    { id: 'l-a', label: 'First label', url: 'https://example.org/a?x=1', description: 'A short description.' },
    { id: 'l-c', label: 'Third label', url: 'https://example.net/c', description: '' }
  ];
  projects[1].external_links = [];
  const { document, mock } = boot({ projects });

  const panel = await openProject(document, 'Saved project from Supabase');
  assert.equal(mock.calls.filter((c) => c.table === 'projects').length, 1, 'no retry needed once the column exists');

  const block = blockByHeading(panel, 'Additional links');
  assert.ok(block, 'the Additional links area is shown');
  const items = block.querySelectorAll('li.link-item');
  const anchors = items.map((li) => li.querySelector('a'));

  assert.deepEqual(anchors.map((a) => a.childNodes[0].textContent), ['Second label', 'First label', 'Third label']);
  assert.deepEqual(anchors.map((a) => a.getAttribute('href')), ['https://example.com/b', 'https://example.org/a?x=1', 'https://example.net/c']);

  for (const a of anchors) {
    assert.equal(a.getAttribute('target'), '_blank');
    assert.deepEqual(a.getAttribute('rel').split(' ').sort(), ['noopener', 'noreferrer']);
    assert.match(a.textContent, /\(opens in a new tab\)/, 'screen readers hear that it opens a new tab');
    assert.ok(a.classList.contains('link-chip'), 'same chip style as the other project links');
  }

  // Description: only where one was saved, tied to its link for assistive tech
  const desc = items[1].querySelector('.link-item__desc');
  assert.equal(desc.textContent, 'A short description.');
  assert.equal(anchors[1].getAttribute('aria-describedby'), desc.getAttribute('id'));
  assert.equal(items[0].querySelector('.link-item__desc'), null);
  assert.equal(items[2].querySelector('.link-item__desc'), null);
  assert.equal(anchors[0].getAttribute('aria-describedby'), null);

  // Existing links are still there, before the new area
  const headings = panel.querySelectorAll('.modal__block h3').map((h3) => h3.textContent);
  assert.ok(headings.indexOf('Supporting document') < headings.indexOf('Repository'));
  assert.ok(headings.indexOf('Repository') < headings.indexOf('Additional links'));
});

test('a project with no additional links shows no extra area', async () => {
  const projects = structuredClone(SAVED_PROJECTS);
  projects[0].external_links = [{ id: 'l-1', label: 'Only on the first', url: 'https://example.com/1' }];
  projects[1].external_links = [];
  const { document } = boot({ projects });

  const panel = await openProject(document, 'Second saved project');
  assert.equal(blockByHeading(panel, 'Additional links'), null);
  assert.equal(panel.querySelectorAll('.link-list--stacked').length, 0);
  assert.ok(blockByHeading(panel, 'Document'), 'the document block still renders (placeholder)');
});

test('unsafe URL schemes never reach an href; labels and descriptions stay plain text', async () => {
  const projects = structuredClone(SAVED_PROJECTS);
  projects[0].external_links = [
    { id: 'l-1', label: 'Script', url: 'javascript:alert(1)' },
    { id: 'l-2', label: 'Data', url: 'data:text/html,<script>alert(1)</script>' },
    { id: 'l-3', label: 'Plain http', url: 'http://example.com/' },
    { id: 'l-4', label: 'Protocol relative', url: '//example.com/' },
    { id: 'l-5', label: 'Repo-local path', url: 'assets/docs/x.pdf' },
    { id: 'l-6', label: '[ISI MANUAL]', url: 'https://example.com/manual' },
    { id: 'l-7', label: '<img src=x onerror=alert(1)>', url: 'https://example.com/ok', description: '<b>not bold</b>' }
  ];
  const { document, dom } = boot({ projects });

  const panel = await openProject(document, 'Saved project from Supabase');
  const block = blockByHeading(panel, 'Additional links');
  const anchors = block.querySelectorAll('a');

  assert.equal(anchors.length, 1, 'only the safe https link is rendered');
  assert.equal(anchors[0].getAttribute('href'), 'https://example.com/ok');
  assert.equal(anchors[0].childNodes[0].textContent, '<img src=x onerror=alert(1)>', 'the label is a text node');
  assert.equal(block.querySelectorAll('img, b').length, 0, 'no element was created from database text');
  assert.equal(block.querySelector('.link-item__desc').textContent, '<b>not bold</b>');

  const hrefs = panel.querySelectorAll('a').map((a) => a.getAttribute('href'));
  assert.ok(hrefs.every((href) => /^https:\/\//.test(href)), `every href is https: ${hrefs.join(', ')}`);

  // innerHTML only ever received the hard-coded SVG icons
  assert.ok(dom.innerHTMLWrites.length > 0);
  assert.ok(dom.innerHTMLWrites.every((html) => html.startsWith('<svg')), 'innerHTML only gets trusted static SVG');
});

test('a project whose only links are unsafe shows no extra area at all', async () => {
  const projects = structuredClone(SAVED_PROJECTS);
  projects[0].external_links = [{ id: 'l-1', label: 'Script', url: 'javascript:alert(1)' }];
  const { document } = boot({ projects });

  const panel = await openProject(document, 'Saved project from Supabase');
  assert.equal(blockByHeading(panel, 'Additional links'), null);
});

test('an empty projects table still falls back to data.json (unchanged), with no additional links', async () => {
  const { document, mock } = boot({ projects: [] }); // empty table → data.json (unchanged behaviour)

  await waitFor(() => cards(document).length === localData.projects.length, { label: 'fallback cards' });
  assert.ok(mock.calls.some((c) => c.table === 'projects'));
  for (const project of localData.projects) {
    assert.deepEqual(project.external_links, [], 'data.json has no invented links');
    const panel = await openProject(document, project.title);
    assert.equal(blockByHeading(panel, 'Additional links'), null);
    document.querySelector('#project-modal').close();
    await settle(2);
  }
});
