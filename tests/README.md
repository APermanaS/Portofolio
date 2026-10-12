# Tests

Plain Node tests, no dependencies and no build step. They never touch Supabase or
Storage: every database row, storage object and upload is a local mock.

```bash
node --test tests/
```

Requires Node 18 or newer (uses the built-in `node:test` runner).

| File | Covers |
| --- | --- |
| `experience-bullets.test.mjs` | `experience-bullets.js`: legacy `bullets` → items, `bullet_items` semantics (`null` vs `[]`), validation, reordering a bullet with its photos, what a save writes, storage references, and the upload session used by Save / failed Save / Cancel. |
| `static-checks.test.mjs` | Syntax check of every browser script, plus the invariants of this change: the public query asks for `bullet_items` and retries without it, both pages load the shared core, and the migration stays additive and idempotent. |
