/**
 * Admin panel (admin.js) — the Project "Additional links" editor, run for real in
 * node:vm with a tiny DOM and a mocked Supabase client (Auth, Database, Storage).
 * No browser, no network, nothing is written to a real Supabase project.
 * Labels / URLs are test fixtures on example domains, not portfolio content.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDom, browserGlobals, waitFor, settle } from './helpers/mini-dom.mjs';
import { createMockSupabase, sqlExternalLinksValid } from './helpers/mock-supabase.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => readFileSync(join(repo, name), 'utf8');

const SUPABASE_URL = 'https://project.supabase.co';
const BUCKET = `${SUPABASE_URL}/storage/v1/object/public/portfolio-assets/`;
const REPO_URL = 'https://github.com/example/repo';
const DOC_URL = `${BUCKET}docs/report.pdf`;

const savedProject = (extra = {}) => ({
  id: 1,
  title: 'Saved project',
  category: 'code',
  short_desc: 'Short.',
  detail_desc: 'Detail.',
  role: null,
  tools: null,
  result: null,
  period: '2026',
  repo_url: REPO_URL,
  image_url: null,
  doc_url: DOC_URL,
  sort_order: 1,
  is_visible: true,
  ...extra
});

/** The admin.html elements admin.js looks up (same ids; checked against admin.html below). */
function adminShell(el) {
  return [
    el('div', { id: 'boot-view' }),
    el('main', { id: 'config-view', hidden: true }, el('p', { id: 'config-message' })),
    el('main', { id: 'login-view', hidden: true },
      el('form', { id: 'login-form' },
        el('p', { id: 'login-notice', hidden: true }),
        el('input', { id: 'login-email' }),
        el('input', { id: 'login-password' }),
        el('p', { id: 'login-error', hidden: true }),
        el('button', { id: 'login-submit', type: 'submit' }, 'Sign in'))),
    el('div', { id: 'app-view', hidden: true },
      el('aside', {}, el('ul', { id: 'sidebar-list' }), el('p', { id: 'user-email' }), el('button', { id: 'logout-btn' })),
      el('main', { id: 'main' },
        el('h1', { id: 'view-title' }), el('p', { id: 'view-sub' }), el('div', { id: 'view-actions' }), el('div', { id: 'view-root' }))),
    el('dialog', { id: 'editor' },
      el('form', { id: 'editor-form' },
        el('header', {}, el('h2', { id: 'editor-title' }), el('button', { class: 'icon-btn', type: 'button', 'data-action': 'close' })),
        el('div', { id: 'editor-body' }),
        el('footer', {},
          el('span', { id: 'editor-status' }),
          el('button', { class: 'btn', type: 'button', 'data-action': 'close' }, 'Cancel'),
          el('button', { class: 'btn', type: 'submit', id: 'editor-save' }, 'Save')))),
    el('dialog', { id: 'confirm' },
      el('h2', { id: 'confirm-title' }), el('div', { id: 'confirm-message' }), el('div', { id: 'confirm-extra' }),
      el('button', { id: 'confirm-cancel' }), el('button', { id: 'confirm-ok' })),
    el('div', { id: 'toasts' })
  ];
}

async function bootAdmin({ projects = [savedProject()], missingColumns = {}, onWrite = null, storageFiles = {}, hash = '#projects' } = {}) {
  const dom = createDom();
  const { document } = dom;
  document.body.append(...adminShell(dom.el));

  const mock = createMockSupabase({
    tables: { profile: [], skills: [], projects, certificates: [], experience: [], education: [] },
    missingColumns,
    onWrite,
    storageFiles
  });
  const logged = [];
  const sink = { ...console, warn: (...a) => logged.push(a.map(String).join(' ')), error: (...a) => logged.push(a.map(String).join(' ')) };
  const fetch = async (url) =>
    url === 'data.json'
      ? { ok: true, status: 200, json: async () => JSON.parse(source('data.json')) }
      : { ok: false, status: 404, json: async () => ({}) };

  const context = vm.createContext(
    browserGlobals(dom, {
      fetch,
      supabase: mock.supabase,
      config: { supabaseUrl: SUPABASE_URL, supabaseAnonKey: 'public-anon-key-for-tests' },
      hash,
      console: sink
    })
  );
  context.window = context;
  context.self = context;
  context.top = context;

  for (const file of ['experience-bullets.js', 'project-links.js', 'admin.js']) {
    vm.runInContext(source(file), context, { filename: file });
  }
  await waitFor(() => !document.querySelector('#app-view').hidden && document.querySelector('#view-root .list-view, #view-root .tiles, #view-root .list-card'), {
    label: 'admin view'
  });
  return { dom, document, mock, logged };
}

/* ---------------- small UI helpers ---------------- */

const buttonByText = (scope, text) => scope.querySelectorAll('button').find((b) => b.textContent.trim() === text);

async function openEditor(document, rowId = 1) {
  document.querySelector(`[data-row-id="${rowId}"] [data-act="edit"]`).click();
  assert.ok(document.querySelector('#editor').open, 'the editor opens');
  return document.querySelector('#editor-body');
}

function linksUi(body) {
  const editor = body.querySelector('.links-editor');
  const items = () =>
    editor.querySelectorAll('.links-editor__item').map((item) => ({
      item,
      title: item.querySelector('.links-editor__title').textContent,
      label: item.querySelector('.links-editor__part--label input'),
      url: item.querySelector('.links-editor__part--url input'),
      description: item.querySelector('.links-editor__part--description input'),
      error: (key) => item.querySelector(`.links-editor__part--${key} .field__error`),
      button: (act) => item.querySelector(`[data-act="${act}"]`)
    }));
  return { editor, items, add: () => buttonByText(editor, 'Add link').click() };
}

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function fill(entry, { label = '', url = '', description = '' }) {
  type(entry.label, label);
  type(entry.url, url);
  type(entry.description, description);
}

const submit = (document) => document.querySelector('#editor-form').dispatchEvent(new Event('submit', { cancelable: true }));
const updates = (mock) => mock.calls.filter((c) => c.table === 'projects' && c.op === 'update');
const toasts = (document, kind) => document.querySelectorAll(`#toasts .toast--${kind} .toast__text`).map((p) => p.textContent);

/* ------------------------------------------------------------------------ */

test('the test shell uses the same element ids as admin.html', () => {
  const html = source('admin.html');
  const ids = ['boot-view', 'config-view', 'config-message', 'login-view', 'login-form', 'login-notice', 'login-email', 'login-password',
    'login-error', 'login-submit', 'app-view', 'sidebar-list', 'user-email', 'logout-btn', 'main', 'view-title', 'view-sub',
    'view-actions', 'view-root', 'editor', 'editor-form', 'editor-title', 'editor-body', 'editor-status', 'editor-save', 'confirm',
    'confirm-title', 'confirm-message', 'confirm-extra', 'confirm-cancel', 'confirm-ok', 'toasts'];
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `admin.html has #${id}`);
});

test('add, edit, reorder and remove links; Save writes them in order and keeps repo_url / doc_url', async () => {
  const { document, mock } = await bootAdmin({ projects: [savedProject({ external_links: [] })] });
  const body = await openEditor(document);
  const ui = linksUi(body);

  // Existing controls are all still there
  for (const label of ['Repository URL', 'Project image', 'Project document', 'Additional links']) {
    assert.ok(body.querySelectorAll('.field__label').some((l) => l.textContent.startsWith(label)), `${label} field is shown`);
  }
  assert.equal(body.querySelectorAll('input').find((i) => i.value === REPO_URL)?.value, REPO_URL);
  assert.equal(ui.editor.querySelector('.links-editor__empty').hidden, false, 'empty state says there are no links yet');

  ui.add();
  ui.add();
  ui.add();
  let items = ui.items();
  assert.deepEqual(items.map((i) => i.title), ['Link 1', 'Link 2', 'Link 3']);
  assert.equal(ui.editor.querySelector('.links-editor__empty').hidden, true);
  fill(items[0], { label: 'Alpha', url: 'https://example.com/a' });
  fill(items[1], { label: 'Beta', url: 'https://example.com/b', description: 'Beta description' });
  fill(items[2], { label: 'Gamma', url: 'https://example.com/c' });

  // Reorder: Gamma up one, then remove Alpha
  items[2].button('up').click();
  items = ui.items();
  assert.deepEqual(items.map((i) => i.label.value), ['Alpha', 'Gamma', 'Beta']);
  assert.deepEqual(items.map((i) => i.title), ['Link 1', 'Link 2', 'Link 3'], 'numbers follow the new order');
  assert.equal(items[1].button('up').getAttribute('aria-label'), 'Move link 2 up');
  assert.equal(document.activeElement, items[1].button('up'), 'focus stays on the moved link');
  assert.equal(items[0].button('up').disabled, true);
  assert.equal(items[2].button('down').disabled, true);

  items[0].button('remove').click();
  // An extra card left completely empty is ignored on save
  ui.add();
  assert.deepEqual(ui.items().map((i) => i.label.value), ['Gamma', 'Beta', '']);

  submit(document);
  await waitFor(() => !document.querySelector('#editor').open, { label: 'editor closes after save' });

  const [call] = updates(mock);
  assert.ok(call, 'one update was sent');
  const sent = call.values.external_links;
  assert.deepEqual(sent.map(({ label, url, description }) => ({ label, url, description })), [
    { label: 'Gamma', url: 'https://example.com/c', description: undefined },
    { label: 'Beta', url: 'https://example.com/b', description: 'Beta description' }
  ]);
  assert.ok(!('description' in sent[0]), 'no empty description key');
  assert.ok(sent.every((l) => /^l-[0-9a-f]+$/.test(l.id)) && new Set(sent.map((l) => l.id)).size === 2, 'stable unique ids');
  assert.equal(sqlExternalLinksValid(sent), true, 'matches the database CHECK');
  assert.equal(call.values.repo_url, REPO_URL, 'repository link unchanged');
  assert.equal(call.values.doc_url, DOC_URL, 'supporting document unchanged');
  assert.deepEqual(toasts(document, 'success'), ['Changes saved.']);
  assert.ok(!mock.calls.some((c) => c.table === 'storage'), 'no storage file was deleted');

  // Re-open: same links, same order, same ids
  const again = linksUi(await openEditor(document));
  assert.deepEqual(again.items().map((i) => [i.item.dataset.linkId, i.label.value, i.url.value, i.description.value]), [
    [sent[0].id, 'Gamma', 'https://example.com/c', ''],
    [sent[1].id, 'Beta', 'https://example.com/b', 'Beta description']
  ]);
});

test('validation: label and https URL are required, errors sit under the exact input, nothing is sent', async () => {
  const { document, mock } = await bootAdmin();
  const body = await openEditor(document);
  const ui = linksUi(body);

  ui.add();
  ui.add();
  ui.add();
  const items = ui.items();
  fill(items[0], { label: 'Valid', url: 'https://example.com/ok', description: 'Draft description' });
  fill(items[1], { label: '', url: 'javascript:alert(1)' });
  fill(items[2], { label: 'Data', url: 'data:text/html,<b>x</b>' });

  submit(document);
  await settle();

  assert.equal(updates(mock).length, 0, 'nothing is sent while a link is invalid');
  assert.ok(document.querySelector('#editor').open, 'the editor stays open');
  assert.deepEqual(toasts(document, 'error'), ['Please fix the highlighted fields.']);

  // Link 1 is fine and is not marked
  for (const key of ['label', 'url', 'description']) {
    assert.equal(items[0][key].getAttribute('aria-invalid'), 'false', `link 1 ${key} not marked`);
    assert.equal(items[0].error(key).hidden, true);
  }
  // Link 2: missing label AND unsafe URL, each under its own input
  assert.equal(items[1].label.getAttribute('aria-invalid'), 'true');
  assert.match(items[1].error('label').textContent, /Please add a label/);
  assert.equal(items[1].error('label').hidden, false);
  assert.equal(items[1].label.getAttribute('aria-describedby'), items[1].error('label').getAttribute('id'));
  assert.match(items[1].error('url').textContent, /not \u201cjavascript:\u201d/);
  assert.equal(items[1].error('description').hidden, true);
  // Link 3: unsafe URL only
  assert.match(items[2].error('url').textContent, /not \u201cdata:\u201d/);
  assert.ok(items[2].item.querySelector('.links-editor__part--url').classList.contains('has-error'));
  assert.ok(!items[2].item.querySelector('.links-editor__part--label').classList.contains('has-error'));
  assert.equal(document.activeElement, items[1].label, 'focus goes to the first problem (link 2 label)');

  const summary = body.querySelectorAll('.field').find((f) => f.querySelector('.links-editor')).querySelector('.field__meta .field__error');
  assert.match(summary.textContent, /^Link 2: Please add a label.*\(2 more problems highlighted below\)$/);

  // Draft values are exactly as typed
  assert.deepEqual(items.map((i) => [i.label.value, i.url.value, i.description.value]), [
    ['Valid', 'https://example.com/ok', 'Draft description'],
    ['', 'javascript:alert(1)', ''],
    ['Data', 'data:text/html,<b>x</b>', '']
  ]);

  // Typing clears that input's error; fixing everything lets Save through
  type(items[1].label, 'Fixed');
  assert.equal(items[1].error('label').hidden, true);
  assert.equal(items[1].label.getAttribute('aria-invalid'), 'false');
  type(items[1].url, 'https://example.com/fixed');
  items[2].button('remove').click();
  submit(document);
  await waitFor(() => !document.querySelector('#editor').open, { label: 'editor closes' });
  assert.deepEqual(updates(mock)[0].values.external_links.map((l) => [l.label, l.description]), [
    ['Valid', 'Draft description'],
    ['Fixed', undefined]
  ]);
});

test('a failed Save keeps every draft value in the form, and Save again works', async () => {
  let failNext = true;
  const { document, mock } = await bootAdmin({
    onWrite: () => {
      if (!failNext) return null;
      failNext = false;
      return { message: 'Failed to fetch' };
    }
  });
  const ui = linksUi(await openEditor(document));
  ui.add();
  ui.add();
  fill(ui.items()[0], { label: 'Kept label', url: 'https://example.com/kept', description: 'Kept description' });
  fill(ui.items()[1], { label: 'Second', url: 'https://example.org/2' });
  ui.items()[1].button('up').click();

  submit(document);
  await waitFor(() => toasts(document, 'error').length, { label: 'error toast' });
  await settle();

  assert.match(toasts(document, 'error')[0], /Can't reach Supabase/);
  assert.ok(document.querySelector('#editor').open, 'the editor stays open');
  assert.equal(document.querySelector('#editor-save').disabled, false, 'Save can be pressed again');
  assert.deepEqual(ui.items().map((i) => [i.label.value, i.url.value, i.description.value]), [
    ['Second', 'https://example.org/2', ''],
    ['Kept label', 'https://example.com/kept', 'Kept description']
  ]);
  assert.equal(mock.db.projects[0].external_links, undefined, 'nothing reached the database');

  submit(document);
  await waitFor(() => !document.querySelector('#editor').open, { label: 'second save succeeds' });
  assert.deepEqual(mock.db.projects[0].external_links.map((l) => l.label), ['Second', 'Kept label']);
  assert.equal(mock.db.projects[0].repo_url, REPO_URL);
  assert.equal(mock.db.projects[0].doc_url, DOC_URL);
});

test('a new project saves its links with the insert', async () => {
  const { document, mock } = await bootAdmin({ projects: [] });
  buttonByText(document.querySelector('#view-actions'), 'Add project').click();
  const body = document.querySelector('#editor-body');
  type(body.querySelector('input'), 'Brand-new project'); // Title is the first input
  const ui = linksUi(body);
  ui.add();
  fill(ui.items()[0], { label: 'Only link', url: 'https://example.com/new' });

  submit(document);
  await waitFor(() => !document.querySelector('#editor').open, { label: 'insert done' });
  const insert = mock.calls.find((c) => c.table === 'projects' && c.op === 'insert');
  assert.deepEqual(insert.values.external_links.map((l) => [l.label, l.url]), [['Only link', 'https://example.com/new']]);
});

test('migration not run: no links field, a clear notice, and Save never sends external_links', async () => {
  const { document, mock } = await bootAdmin({
    projects: [savedProject()], // no external_links key at all (pre-migration row)
    missingColumns: { projects: ['external_links'] }
  });

  const notice = document.querySelector('#view-root .notice');
  assert.match(notice.textContent, /20261012_project_custom_links\.sql/);

  const body = await openEditor(document);
  assert.equal(body.querySelector('.links-editor'), null, 'the links editor is left out');
  assert.equal(body.querySelectorAll('input').find((i) => i.value === REPO_URL)?.value, REPO_URL, 'repository field still there');

  type(body.querySelector('input'), 'Saved project (edited)');
  submit(document);
  await waitFor(() => !document.querySelector('#editor').open, { label: 'save without links' });

  const [call] = updates(mock);
  assert.ok(!('external_links' in call.values), 'the missing column is never written');
  assert.equal(call.values.repo_url, REPO_URL);
  assert.equal(call.values.doc_url, DOC_URL);
  assert.equal(mock.db.projects[0].title, 'Saved project (edited)');
});

test('Files page: a bucket file used by an additional link is "used", never cleaned up as unused', async () => {
  const { document } = await bootAdmin({
    hash: '#files',
    storageFiles: { docs: ['report.pdf', 'linked.pdf', 'orphan.pdf'] },
    projects: [savedProject({ external_links: [{ id: 'l-1', label: 'Linked file', url: `${BUCKET}docs/linked.pdf` }] })]
  });

  const tiles = await waitFor(() => {
    const list = document.querySelectorAll('.tile');
    return list.length === 3 ? list : null;
  }, { label: 'file tiles' });
  const usage = Object.fromEntries(tiles.map((t) => [t.querySelector('.tile__name').textContent, t.querySelector('.tile__usage').textContent]));

  assert.equal(usage['linked.pdf'], 'Used by: Project \u201cSaved project\u201d link \u201cLinked file\u201d');
  assert.equal(usage['report.pdf'], 'Used by: Project \u201cSaved project\u201d document');
  assert.equal(usage['orphan.pdf'], 'Not used');
  assert.equal(buttonByText(document.querySelector('#view-actions'), 'Delete 1 unused file')?.disabled, false);
});

/* ---------------- storage files that an additional link points at ---------------- */

async function confirmDialog(document) {
  await waitFor(() => document.querySelector('#confirm').open, { label: 'confirm dialog' });
  const message = document.querySelector('#confirm-message').textContent;
  document.querySelector('#confirm-ok').click();
  return message;
}

const storageRemoves = (mock) => mock.calls.filter((c) => c.table === 'storage' && c.op === 'remove').flatMap((c) => c.values);
const fieldByLabel = (body, label) => body.querySelectorAll('.field').find((f) => f.querySelector('.field__label')?.textContent.startsWith(label));

test('removing a project document keeps the file when an additional link still points at it', async () => {
  const { document, mock } = await bootAdmin({
    projects: [
      savedProject({ external_links: [] }),
      savedProject({ id: 2, title: 'Other project', doc_url: null, sort_order: 2, external_links: [{ id: 'l-1', label: 'Report page 2', url: `${DOC_URL}#page=2` }] })
    ]
  });
  const body = await openEditor(document, 1);
  buttonByText(fieldByLabel(body, 'Project document'), 'Remove').click();
  await confirmDialog(document);
  await settle();
  submit(document);
  await waitFor(() => !document.querySelector('#editor').open, { label: 'saved' });
  await waitFor(() => toasts(document, 'info').length, { label: 'info toast' });

  assert.equal(updates(mock)[0].values.doc_url, null, 'the field itself is cleared as asked');
  assert.deepEqual(storageRemoves(mock), [], 'the file is kept for the link');
  assert.match(toasts(document, 'info')[0], /still used by an additional link/);
});

test('removing a project document still deletes the file when nothing else points at it', async () => {
  const { document, mock } = await bootAdmin({ projects: [savedProject({ external_links: [] })] });
  const body = await openEditor(document, 1);
  buttonByText(fieldByLabel(body, 'Project document'), 'Remove').click();
  await confirmDialog(document);
  await settle();
  submit(document);
  await waitFor(() => storageRemoves(mock).length, { label: 'storage delete' });
  assert.deepEqual(storageRemoves(mock), ['docs/report.pdf'], 'unchanged behaviour for unreferenced files');
});

test('deleting a project with its files keeps a file that another project links to', async () => {
  const { document, mock } = await bootAdmin({
    projects: [
      savedProject({ external_links: [] }),
      savedProject({ id: 2, title: 'Other project', doc_url: null, sort_order: 2, external_links: [{ id: 'l-1', label: 'Report', url: DOC_URL }] })
    ]
  });
  document.querySelector('[data-row-id="1"] [data-act="delete"]').click();
  await waitFor(() => document.querySelector('#confirm-check'), { label: 'delete files checkbox' });
  assert.equal(document.querySelector('#confirm-check').checked, true);
  await confirmDialog(document);
  await waitFor(() => toasts(document, 'info').length, { label: 'kept toast' });

  assert.ok(mock.calls.some((c) => c.table === 'projects' && c.op === 'delete'));
  assert.deepEqual(storageRemoves(mock), []);
  assert.match(toasts(document, 'info')[0], /1 file kept/);
});

test('Files page: deleting a linked file removes every link to it (incl. #page variants) and nothing else', async () => {
  const { document, mock } = await bootAdmin({
    hash: '#files',
    storageFiles: { docs: ['linked.pdf'] },
    projects: [
      savedProject({
        doc_url: null,
        external_links: [
          { id: 'l-1', label: 'Linked file', url: `${BUCKET}docs/linked.pdf` },
          { id: 'l-2', label: 'Page two', url: `${BUCKET}docs/linked.pdf#page=2` },
          { id: 'l-3', label: 'Elsewhere', url: 'https://example.com/elsewhere' }
        ]
      })
    ]
  });
  const tile = await waitFor(() => document.querySelector('.tile'), { label: 'tile' });
  buttonByText(tile, 'Delete').click();
  const message = await confirmDialog(document);
  assert.match(message, /additional links will be removed/);
  assert.doesNotMatch(message, /placeholder/, 'no promise of a placeholder for links');

  await waitFor(() => storageRemoves(mock).length, { label: 'file deleted' });
  assert.deepEqual(storageRemoves(mock), ['docs/linked.pdf']);
  const linkUpdates = updates(mock).filter((c) => 'external_links' in c.values);
  assert.equal(linkUpdates.length, 1, 'one rewrite of the project');
  assert.deepEqual(linkUpdates[0].values.external_links.map((l) => l.id), ['l-3']);
  assert.equal(mock.db.projects[0].repo_url, REPO_URL);
});
