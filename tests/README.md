# Tests

Plain Node tests, no dependencies and no build step. They never touch Supabase or
Storage: every database row, storage object and upload is a local mock.

```bash
node --test tests/*.test.mjs
```

Requires Node 18 or newer (uses the built-in `node:test` runner). The shell expands the
pattern; on Node 21+ `node --test` no longer accepts a bare directory such as `tests/`.

| File | Covers |
| --- | --- |
| `experience-bullets.test.mjs` | `experience-bullets.js`: legacy `bullets` → items, `bullet_items` semantics (`null` vs `[]`), validation, reordering a bullet with its photos, what a save writes, storage references, and the upload session used by Save / failed Save / Cancel. |
| `project-links.test.mjs` | `project-links.js`: legacy projects (no `external_links`), empty links, saved order and reordering, validation (label + https URL required, length and count limits, ids), unsafe URLs (`javascript:`, `data:`, `http:`, relative …), and that the saved JSON matches the database CHECK. |
| `project-links-public.test.mjs` | The real `script.js` in `node:vm` with a tiny DOM (`helpers/mini-dom.mjs`) and a mocked Supabase client (`helpers/mock-supabase.mjs`): legacy retry without `external_links` keeps saved projects, order / labels / descriptions, `rel="noopener noreferrer"`, no area without links, unsafe URLs never reach an `href`, text stays text. |
| `project-links-admin.test.mjs` | The real `admin.js` the same way: add / edit / reorder / remove links, inline validation under the exact input, a failed Save keeps the drafts, `repo_url` / `doc_url` unchanged, nothing sent to a missing column, and storage files a link points at (Files page "used", kept on replace / project delete, link removal when the file is deleted). |
| `static-checks.test.mjs` | Syntax check of every browser script, plus the invariants of these changes: the public queries ask for the new columns and retry without them, both pages load the shared cores, the migrations stay additive and idempotent (no policies, grants or seeds), and `schema.sql` matches the links migration. |
