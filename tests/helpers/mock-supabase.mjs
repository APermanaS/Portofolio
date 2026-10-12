/**
 * In-memory stand-in for the parts of supabase-js the site and the admin panel use.
 * Nothing here touches the network or a real Supabase project.
 *
 *   createMockSupabase({
 *     tables: { projects: [...rows] },        // the "database"
 *     missingColumns: { projects: ['external_links'] },  // simulate "migration not run"
 *     onWrite: ({ table, op, values, id }) => error | null  // inject a failure
 *   })
 *
 * Every request is logged in `calls`, so a test can see exactly which columns were
 * asked for and what a save sent.
 */

/**
 * Independent JS mirror of public.project_external_links_valid (the SQL CHECK in
 * supabase/migrations/20261012_project_custom_links.sql). Written from the SQL, not
 * from project-links.js, so it double-checks what the admin panel actually sends.
 */
export function sqlExternalLinksValid(links) {
  if (!Array.isArray(links)) return false;
  if (links.length > 8) return false;
  if (Buffer.byteLength(JSON.stringify(links)) > 32000) return false;
  const ids = links.map((link) => (link && typeof link === 'object' && !Array.isArray(link) ? link.id : undefined));
  if (new Set(ids.filter((id) => id != null).map(String)).size !== links.length) return false;
  return links.every((link) => {
    if (!link || typeof link !== 'object' || Array.isArray(link)) return false;
    if (Object.keys(link).some((key) => !['id', 'label', 'url', 'description'].includes(key))) return false;
    if (typeof link.id !== 'string' || link.id.length < 1 || link.id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(link.id)) return false;
    if (typeof link.label !== 'string' || [...link.label].length < 1 || [...link.label].length > 60 || !/\S/.test(link.label)) return false;
    if (typeof link.url !== 'string' || [...link.url].length > 500 || !/^https:\/\/[^\s<>"'`]+$/.test(link.url)) return false;
    if ('description' in link && (typeof link.description !== 'string' || [...link.description].length > 160)) return false;
    return true;
  });
}

const CHECKS = {
  projects: { external_links: sqlExternalLinksValid }
};

export function createMockSupabase({
  tables = {},
  missingColumns = {},
  onWrite = null,
  storageFiles = {}, // { images: ['a.png'], docs: ['b.pdf'] } — names in the mocked bucket
  user = { id: 'admin-uuid', email: 'admin@example.com' }
} = {}) {
  const db = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => structuredClone(row))]));
  const calls = [];
  let nextId = 1000;

  const missing = (table) => new Set(missingColumns[table] || []);
  const visible = (table, row) => {
    const out = { ...row };
    missing(table).forEach((column) => delete out[column]);
    return out;
  };

  function builder(table) {
    const state = { table, op: 'select', columns: '*', values: null, filters: [], single: false, maybe: false, limit: null, returning: false };

    const run = () => {
      const call = { table, op: state.op, columns: state.columns, values: state.values ? structuredClone(state.values) : null, filters: [...state.filters] };
      calls.push(call);
      const rows = db[table];
      if (!rows) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}'` }, status: 404 };

      // Asking for a column that does not exist (yet) fails like PostgREST does.
      const asked = state.op === 'select' && state.columns !== '*' ? state.columns.split(',').map((c) => c.trim()).filter(Boolean) : [];
      const unknown = asked.find((column) => missing(table).has(column));
      if (unknown) return { data: null, error: { code: '42703', message: `column ${table}.${unknown} does not exist` }, status: 400 };

      const matches = (row) => state.filters.every(([column, value]) => String(row[column]) === String(value));

      if (state.op === 'update' || state.op === 'insert' || state.op === 'upsert') {
        const values = state.values || {};
        const unknownWrite = Object.keys(values).find((column) => missing(table).has(column));
        if (unknownWrite) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${unknownWrite}' column of '${table}' in the schema cache` }, status: 400 };
        for (const [column, check] of Object.entries(CHECKS[table] || {})) {
          if (column in values && !check(values[column])) {
            return { data: null, error: { code: '23514', message: `new row for relation "${table}" violates check constraint "${table}_${column}_shape"` }, status: 400 };
          }
        }
        const injected = onWrite?.({ table, op: state.op, values: structuredClone(values), id: state.filters.find(([c]) => c === 'id')?.[1] });
        if (injected) return { data: null, error: injected, status: injected.status || 400 };
      }

      let data;
      if (state.op === 'select') {
        data = rows.filter(matches).map((row) => visible(table, row));
        if (asked.length) data = data.map((row) => Object.fromEntries(asked.map((column) => [column, row[column]])));
      } else if (state.op === 'update') {
        const target = rows.filter(matches);
        target.forEach((row) => Object.assign(row, structuredClone(state.values)));
        data = target.map((row) => visible(table, row));
      } else if (state.op === 'insert') {
        const row = { id: (nextId += 1), ...structuredClone(state.values) };
        if (table === 'projects' && !missing(table).has('external_links') && !('external_links' in row)) row.external_links = [];
        rows.push(row);
        data = [visible(table, row)];
      } else if (state.op === 'delete') {
        const target = rows.filter(matches);
        db[table] = rows.filter((row) => !matches(row));
        data = target.map((row) => ({ id: row.id }));
      } else {
        data = [];
      }

      if (state.op === 'select') {
        data.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));
        if (state.limit != null) data = data.slice(0, state.limit);
      }
      if (state.single || state.maybe) {
        if (!data.length && state.single) return { data: null, error: { code: 'PGRST116', message: 'no rows' }, status: 406 };
        data = data[0] || null;
      }
      return { data, error: null, status: 200 };
    };

    const api = {
      select(columns = '*') {
        if (state.op === 'select') state.columns = String(columns).replace(/\s+/g, ' ').trim();
        else state.returning = true;
        return api;
      },
      insert(values) {
        state.op = 'insert';
        state.values = values;
        return api;
      },
      upsert(values) {
        state.op = 'upsert';
        state.values = values;
        return api;
      },
      update(values) {
        state.op = 'update';
        state.values = values;
        return api;
      },
      delete() {
        state.op = 'delete';
        return api;
      },
      eq(column, value) {
        state.filters.push([column, value]);
        return api;
      },
      order: () => api,
      abortSignal: () => api,
      limit(n) {
        state.limit = n;
        return api;
      },
      single() {
        state.single = true;
        return api;
      },
      maybeSingle() {
        state.maybe = true;
        return api;
      },
      then(resolve, reject) {
        return Promise.resolve().then(run).then(resolve, reject);
      }
    };
    return api;
  }

  const session = { access_token: 'mock-token', user };
  const client = {
    from: (table) => builder(table),
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: { user, session }, error: null })
    },
    storage: {
      from: () => ({
        remove: async (paths) => {
          calls.push({ table: 'storage', op: 'remove', values: paths });
          return { data: paths.map((name) => ({ name })), error: null };
        },
        list: async (folder) => ({
          data: (storageFiles[folder] || []).map((name, i) => ({
            id: `${folder}-${i}`,
            name,
            created_at: '2026-10-12T00:00:00Z',
            metadata: { size: 1024, mimetype: folder === 'docs' ? 'application/pdf' : 'image/png' }
          })),
          error: null
        })
      })
    }
  };

  return {
    db,
    calls,
    supabase: { createClient: () => client }
  };
}
