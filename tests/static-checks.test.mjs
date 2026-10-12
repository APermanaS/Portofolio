/**
 * Static checks for the browser files and the migration. No DOM, no network:
 * the files are read from disk and only inspected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(repo, name), 'utf8');

const SCRIPTS = ['experience-bullets.js', 'project-links.js', 'script.js', 'admin.js', 'hero-meteors.js', 'section-gradients.js', 'config.js'];

test('every browser script parses', () => {
  for (const file of SCRIPTS) {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ['--check', join(repo, file)], { stdio: 'pipe' }),
      `${file} must be syntactically valid`
    );
  }
});

test('data.json is valid JSON and its experience entries still work', () => {
  const data = JSON.parse(read('data.json'));
  assert.ok(Array.isArray(data.experience) && data.experience.length > 0);
  for (const entry of data.experience) {
    assert.ok(Array.isArray(entry.bullets), 'the legacy bullets array stays in data.json');
    assert.ok('bullet_items' in entry, 'offline fallback entries declare bullet_items');
  }
});

test('the public query asks for bullet_items and falls back without it', () => {
  const script = read('script.js');
  const columns = /const COLUMNS = \{([\s\S]*?)\n  \};/.exec(script)?.[1] || '';
  const legacy = /const LEGACY_COLUMNS = \{([\s\S]*?)\n  \};/.exec(script)?.[1] || '';

  const experience = /experience: '([^']+)'/.exec(columns)?.[1];
  const legacyExperience = /experience: '([^']+)'/.exec(legacy)?.[1];

  assert.ok(experience?.includes('bullet_items'), 'COLUMNS.experience must select bullet_items');
  assert.ok(legacyExperience, 'LEGACY_COLUMNS.experience must exist so a pre-migration database still loads');
  assert.ok(!legacyExperience.includes('bullet_items'), 'the retry must not ask for the new column');
  assert.ok(legacyExperience.includes('bullets'), 'the retry still reads the legacy bullets column');
});

test('experience rows stay authoritative and user text is rendered with text nodes', () => {
  const script = read('script.js');
  assert.match(script, /AUTHORITATIVE = new Set\(\['experience'/);
  // innerHTML may only ever receive a hard-coded SVG, never database text.
  const assignments = [...script.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(assignments.length > 0);
  for (const value of assignments) {
    assert.ok(
      /^ICONS\[name\]/.test(value) || /^SKILL_GLYPHS\[name\]/.test(value) || /^'<svg/.test(value),
      `innerHTML must only receive a trusted static SVG, got: ${value}`
    );
  }
  // Photo URLs go through safeUrl before they reach an src attribute.
  assert.match(script, /const src = safeUrl\(photo\.url\)/);
});

test('both pages load the shared bullet core before their own script', () => {
  for (const [page, main] of [['index.html', 'script.js'], ['admin.html', 'admin.js']]) {
    const html = read(page);
    const core = html.indexOf('experience-bullets.js');
    assert.ok(core !== -1, `${page} must load experience-bullets.js`);
    assert.ok(core < html.indexOf(`src="${main}"`), `${page} must load the core before ${main}`);
  }
});

test('the old string-only bullets editor is gone from the admin panel', () => {
  const admin = read('admin.js');
  assert.ok(!admin.includes('createBulletsField'), 'no dead bullets editor left behind');
  assert.match(admin, /createBulletItemsField/);
  assert.match(admin, /name: 'bullet_items', label: 'Bullet points', type: 'bulletItems'/);
  // Evidence photos reuse the existing image validation and upload helpers.
  assert.match(admin, /await validateFile\(file, kindKey\)/);
  assert.match(admin, /uploadFile\(file, randomPath\(kindKey, check\.ext\), check\.type, setProgress\)/);
});

test('the Files page tracks nested evidence photo references', () => {
  const admin = read('admin.js');
  assert.match(admin, /EB\.photoRefsOfRow\(r\)/);
  assert.match(admin, /field: 'bullet_items'/);
  assert.match(admin, /EB\.removePhotoUrl\(fresh\?\.bullet_items, ref\.url\)/);
  assert.match(admin, /stillReferenced/);
});

test('the migration is additive and idempotent, and seeds nothing', () => {
  const sql = read('supabase/migrations/20261012_experience_bullet_photos.sql');
  const statements = sql.replace(/--[^\n]*/g, '');

  assert.match(statements, /add column if not exists bullet_items jsonb/i);
  assert.match(statements, /drop constraint if exists experience_bullet_items_shape/i);
  assert.match(statements, /create or replace function public\.experience_bullet_items_valid/i);
  assert.match(statements, /^\s*begin;/i);
  assert.match(statements, /commit;/i);

  // Nothing destructive, nothing seeded, no placeholder to replace.
  for (const forbidden of [/drop column/i, /drop table/i, /delete from/i, /truncate/i, /insert into/i, /alter column/i]) {
    assert.ok(!forbidden.test(statements), `the migration must not contain ${forbidden}`);
  }
  assert.ok(!/update\s+public\.experience\s+set/i.test(statements), 'existing rows are never mass-converted');
  assert.ok(!/ADMIN_UUID_HERE/.test(statements), 'this migration needs no admin UUID');
  assert.ok(!/policy/i.test(statements), 'RLS policies are left untouched');
  assert.ok(!/storage\./i.test(statements), 'storage rules are left untouched');
});

test('the migration limits match the shared core limits', () => {
  const sql = read('supabase/migrations/20261012_experience_bullet_photos.sql');
  const EB = createRequire(import.meta.url)('../experience-bullets.js');
  const core = EB.LIMITS;

  assert.match(sql, /jsonb_array_length\(items\) <= 8/);
  assert.match(sql, new RegExp(`char_length\\(item ->> 'text'\\) between 1 and ${core.text}`));
  assert.match(sql, new RegExp(`char_length\\(item ->> 'id'\\) between 1 and ${core.id}`));
  assert.match(sql, new RegExp(`jsonb_array_length\\(item -> 'photos'\\) <= ${core.photos}`));
  assert.match(sql, new RegExp(`char_length\\(photo ->> 'url'\\) <= ${core.url}`));
  assert.match(sql, new RegExp(`char_length\\(coalesce\\(photo ->> 'caption', ''\\)\\) <= ${core.caption}`));
  // The https shape must match the core's isHttpsUrl check.
  assert.match(sql, /\(photo ->> 'url'\) ~ '\^https:\/\//);
  assert.equal(EB.isHttpsUrl('http://x.test/a.png'), false);
  assert.equal(EB.isHttpsUrl('https://x.test/a.png'), true);
});

/* ========================================================================
   Project additional links (projects.external_links)
   ======================================================================== */

const LINKS_MIGRATION = 'supabase/migrations/20261012_project_custom_links.sql';
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, '');

test('data.json projects declare empty additional links and keep repo_url / doc_url', () => {
  const data = JSON.parse(read('data.json'));
  assert.ok(Array.isArray(data.projects) && data.projects.length > 0);
  for (const project of data.projects) {
    assert.deepEqual(project.external_links, [], 'no invented links in the offline fallback');
    assert.ok('repo_url' in project && 'doc_url' in project, 'existing link fields stay');
  }
});

test('the public query asks for external_links and retries the legacy column list without it', () => {
  const script = read('script.js');
  const columns = /const COLUMNS = \{([\s\S]*?)\n  \};/.exec(script)?.[1] || '';
  const legacy = /const LEGACY_COLUMNS = \{([\s\S]*?)\n  \};/.exec(script)?.[1] || '';
  const projects = /projects: '([^']+)'/.exec(columns)?.[1] || '';
  const legacyProjects = /projects: '([^']+)'/.exec(legacy)?.[1] || '';

  assert.ok(projects.includes('external_links'), 'COLUMNS.projects selects external_links');
  assert.ok(legacyProjects, 'LEGACY_COLUMNS.projects exists so a pre-migration database still loads');
  assert.ok(!legacyProjects.includes('external_links'));
  assert.equal(projects.replace(', external_links', ''), legacyProjects, 'the retry asks for exactly the old columns');
});

test('both pages load the shared project-links core before their own script', () => {
  for (const [page, main] of [['index.html', 'script.js'], ['admin.html', 'admin.js']]) {
    const html = read(page);
    const core = html.indexOf('src="project-links.js"');
    assert.ok(core !== -1, `${page} must load project-links.js`);
    assert.ok(core < html.indexOf(`src="${main}"`), `${page} must load the core before ${main}`);
  }
});

test('additional links are rendered as safe, accessible external links', () => {
  const script = read('script.js');
  const block = /function buildExtraLinksBlock[\s\S]*?\n  }\n/.exec(script)?.[0] || '';
  assert.ok(block, 'buildExtraLinksBlock exists');
  assert.match(block, /if \(!links\.length\) return null;/, 'no block without links');
  assert.match(block, /buildLinkChip\(link\.label, link\.href\)/, 'reuses the existing link chip');
  assert.match(script, /function buildLinkChip[\s\S]*?rel: 'noopener noreferrer'/);
  assert.match(script, /href: safeUrl\(link\.url\)/, 'every URL goes through safeUrl');
  assert.match(script, /\/\^https:\\\/\\\/\/\.test\(link\.href\)/, 'only https hrefs survive');
});

test('the admin link editor reuses the shared validation and the existing URL / text patterns', () => {
  const admin = read('admin.js');
  const core = read('project-links.js');
  assert.match(admin, /name: 'external_links', label: 'Additional links', type: 'projectLinks'/);
  assert.match(admin, /PL\.validateLinks\(collect\(\), \{ maxItems \}\)/);
  assert.match(admin, /api\.hasColumn\('projects', 'external_links'\)/);
  assert.match(admin, /else delete data\.external_links;/, 'never writes the column before the migration');

  const httpsRe = (src) => /const HTTPS_RE = (\/.+\/);/.exec(src)?.[1];
  assert.equal(httpsRe(core), httpsRe(admin), 'same https pattern as the other admin URL fields');
  const controlRe = (src) => /\.replace\((\/\[\\u0000-[^/]+\/g)/.exec(src)?.[1];
  assert.equal(controlRe(core), controlRe(admin), 'same control / bidi character stripping as admin.js');
});

test('the links migration is additive and idempotent, seeds nothing and leaves RLS alone', () => {
  const sql = read(LINKS_MIGRATION);
  const statements = withoutComments(sql);

  assert.match(statements, /^\s*begin;/i);
  assert.match(statements, /commit;\s*$/i);
  assert.match(statements, /add column if not exists external_links jsonb not null default '\[\]'::jsonb/i);
  assert.match(statements, /create or replace function public\.project_external_links_valid\(links jsonb\)/i);
  assert.match(statements, /drop constraint if exists projects_external_links_shape/i);
  assert.match(statements, /add constraint projects_external_links_shape\s+check \(public\.project_external_links_valid\(external_links\)\)/i);

  // SQL code only: string literals (e.g. the column comment, which may mention repo_url) are blanked.
  const code = statements.replace(/'(?:[^']|'')*'/g, "''");
  for (const forbidden of [/drop column/i, /drop table/i, /delete from/i, /truncate/i, /insert into/i, /alter column/i, /\bupdate\s+public\./i,
    /\bpolicy\b/i, /\bgrant\b/i, /\brevoke\b/i, /row level security/i, /storage\./i, /repo_url/i, /doc_url/i]) {
    assert.ok(!forbidden.test(code), `the migration must not contain ${forbidden}`);
  }
  assert.ok(!/ADMIN_UUID_HERE/.test(statements), 'this migration needs no admin UUID');
});

test('the links migration limits match the shared core limits', () => {
  const sql = read(LINKS_MIGRATION);
  const PL = createRequire(import.meta.url)('../project-links.js');
  const L = PL.LIMITS;

  assert.match(sql, new RegExp(`jsonb_array_length\\(links\\) <= ${L.items}`));
  assert.match(sql, new RegExp(`char_length\\(link ->> 'id'\\) between 1 and ${L.id}`));
  assert.match(sql, new RegExp(`char_length\\(link ->> 'label'\\) between 1 and ${L.label}`));
  assert.match(sql, new RegExp(`char_length\\(link ->> 'url'\\) <= ${L.url}`));
  assert.match(sql, new RegExp(`char_length\\(coalesce\\(link ->> 'description', ''\\)\\) <= ${L.description}`));
  assert.match(sql, /\(link ->> 'url'\) ~ '\^https:\/\//, 'https only, like the other url columns');
  assert.match(sql, /key_name not in \('id', 'label', 'url', 'description'\)/);
  assert.equal(PL.isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(PL.isHttpsUrl('https://example.com/'), true);
});

test('schema.sql defines the same column and validation function for new installations', () => {
  const fnBody = (sql) => /create or replace function public\.project_external_links_valid[\s\S]*?\$fn\$;/.exec(sql)?.[0];
  const schema = read('supabase/schema.sql');
  const migration = read(LINKS_MIGRATION);

  assert.ok(fnBody(schema), 'schema.sql contains the helper function');
  assert.equal(fnBody(schema), fnBody(migration), 'the two copies of the function are identical');
  assert.ok(schema.indexOf('function public.project_external_links_valid') < schema.indexOf('create table if not exists public.projects'),
    'the function exists before the table that uses it');
  const projectsTable = /create table if not exists public\.projects \(([\s\S]*?)\n\);/.exec(schema)?.[1] || '';
  assert.match(projectsTable, /external_links jsonb not null default '\[\]'::jsonb\s+constraint projects_external_links_shape check \(public\.project_external_links_valid\(external_links\)\)/);
  assert.match(projectsTable, /repo_url\s+text check/);
  assert.match(projectsTable, /doc_url\s+text check/);
});
