# Setup — Supabase admin mode

The public site stays static (GitHub Pages). It reads content from Supabase using the **public anon key**. If Supabase is not set up yet, can't be reached, or a table is empty, it uses `data.json` instead. Only your admin account can change data. Row Level Security (RLS) enforces this inside Supabase.

You need about 15 minutes and a free Supabase account.

---

## 1. Create the project and your admin user

1. Create a new project at [supabase.com](https://supabase.com). The free tier is enough.
2. **Authentication → Users → Add user → Create new user**
   - Enter your email and a strong password.
   - Tick **Auto Confirm User**.
3. Open the new user and copy its **User UID** (for example `3f2b…-…`). This is your admin UUID.
4. **Turn off sign-ups:** go to **Authentication → Sign In / Providers** and switch **Allow new users to sign up** OFF.
   The admin page has no sign-up form. Turning this off also stops people from creating accounts through the API. Even if someone did create an account, RLS would still block them from writing.

## 2. Run `supabase/schema.sql`

1. Open `supabase/schema.sql` in a text editor.
2. Use **Find & Replace** to change **every** `ADMIN_UUID_HERE` to your User UID. Keep the quotes, for example `'3f2b…'::uuid`.
3. In Supabase, open **SQL Editor → New query**, paste the whole file and click **Run**.
   - Expected result: *Success. No rows returned.*
   - If you see *replace the admin UUID placeholder…* or *invalid input syntax for type uuid*, the placeholder was not replaced correctly. Nothing is created in that case, because the whole script runs in one transaction. Fix the file and run it again.

The script creates:

- The tables `profile`, `skills`, `projects` and `certificates`, each with RLS **enabled**.
- Policies: anyone can read visible rows. Only your UUID can insert, update or delete.
- Explicit `GRANT`s for the `anon` and `authenticated` roles, plus `USAGE` on the id sequences. This is needed because *Automatically expose new tables* is disabled in your project. `anon` gets `SELECT` only.
- The storage bucket **`portfolio-assets`**. It has public URLs, a hard 10 MB cap, and only allows JPEG, PNG, WebP and PDF (no SVG). Only your UUID can list, upload or delete files.

> Don't commit your edited copy of the file. The UUID is not a secret, but there is no need to publish it, and the repo version should keep the placeholder.

## 3. Run `supabase/seed.sql`

Paste `supabase/seed.sql` into a new SQL Editor query and click **Run**. It fills in the current portfolio text. All file fields stay empty (`NULL`). It only seeds tables that are still empty, so running it twice does no harm.

Check the result in **Table Editor**: you should see 1 profile row, 9 skills, 2 projects and 1 certificate.

**Already seeded before 2026-10-11?** `seed.sql` skips tables that already have rows, so run `supabase/migrations/20261011120000_skills_update.sql` once in the SQL Editor instead. It changes skill data only (no schema changes): it adds the missing skills, moves the existing ones into place with an empty level, and hides the older seeded skills without deleting them.

## 4. Fill in `config.js`

1. In Supabase, open **Project Settings → API Keys** (on some dashboards it is **Settings → API**).
2. Copy the **Project URL** and the **anon / publishable** key. This key is meant to be public.
   **Never** use a secret key. A secret key bypasses RLS and must never be put in a browser file.
3. Edit `config.js` (see `config.example.js` for the template):

   ```js
   window.PORTFOLIO_CONFIG = Object.freeze({
     supabaseUrl: 'https://abcdefghijkl.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi…' // or sb_publishable_…
   });
   ```

4. Commit `config.js`. GitHub Pages needs it, and it only contains public values.

If you use a **custom Supabase domain** (not `*.supabase.co`), add it to `img-src` and `connect-src` in the Content-Security-Policy `<meta>` tag in `admin.html`.

## 5. Test locally

The pages use `fetch`, so they don't work from `file://`. Serve the folder instead, for example:

```bash
python3 -m http.server 8000
```

- Public site: `http://localhost:8000/index%20(1).html`, or `/` once the file is renamed to `index.html` (see step 6).
- Admin: `http://localhost:8000/admin.html`

Checklist:

1. **Login:** sign in with your admin email and password. A wrong password shows *Email or password is incorrect.*
2. **Edit:** change the tagline under **Profile**, save, then reload the public site. The new text appears.
3. **Hide:** switch a skill to hidden. It disappears from the public site but stays in the admin list.
4. **Upload:** upload a profile photo and a CV, then save. The photo and the *Download CV* button work on the site.
5. **Validation:** try an `.svg` file, or an image larger than 5 MB. You get a plain-English error and nothing is uploaded.
6. **Fallback:** temporarily set a wrong `supabaseUrl` in `config.js`. The site still shows everything from `data.json`.
7. **Anonymous writes are blocked:** run this in a terminal. Use your URL and anon key.

   ```bash
   URL=https://abcdefghijkl.supabase.co; KEY=your-anon-key
   # must fail with 401/403 (permission denied / row-level security)
   curl -s -X POST "$URL/rest/v1/skills" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
        -H "Content-Type: application/json" -d '{"category":"x","name":"y"}'
   # must return [] (hidden rows are never public)
   curl -s "$URL/rest/v1/skills?select=name&is_visible=eq.false" -H "apikey: $KEY"
   ```

## 6. Deploy

- GitHub Pages serves `index.html`. The homepage file is currently named `index (1).html`, so rename it to `index.html` before publishing (`git mv "index (1).html" index.html`).
- The admin page is at `https://<user>.github.io/<repo>/admin.html`. Nothing on the public site links to it, and it is marked `noindex, nofollow`. Its security comes from Supabase Auth and RLS, not from being hidden.

## Optional hardening

- **Subresource Integrity:** both pages load `@supabase/supabase-js@2.116.0` from jsDelivr, pinned to that exact version. To add an SRI hash, open the file's page on jsdelivr.com, copy its SRI hash, and add `integrity="sha384-…"` to the two `<script>` tags. The hash must match exactly, otherwise the browser blocks the script.
- **Free-tier pausing:** Supabase pauses free projects after a period of inactivity. While a project is paused, the public site keeps working from `data.json`. Restore the project from the dashboard to edit again.

## Troubleshooting

| Message / symptom | Fix |
| --- | --- |
| Admin says *Supabase is not configured yet* | Fill in `config.js` (step 4) and reload. |
| *You don't have permission to make this change* | `ADMIN_UUID_HERE` was not replaced with **your** User UID. Re-run the fixed `schema.sql`. |
| *The database tables are missing* | Run `schema.sql`. |
| *permission denied for table …* in the browser console | The grants are missing. Re-run `schema.sql`. |
| Public site still shows old text | It uses `data.json` whenever a table is empty or Supabase can't be reached. Check the browser console for `Supabase:` warnings. |
| Upload: *This file type is not allowed by the storage bucket* | The bucket settings were changed by hand. Re-run `schema.sql`. |
