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

const SCRIPTS = ['experience-bullets.js', 'script.js', 'admin.js', 'hero-meteors.js', 'section-gradients.js', 'config.js'];

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
