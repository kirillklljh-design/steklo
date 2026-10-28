// Network fixture for the real Supabase SDK. Live RLS is verified separately.
import { createClient } from '@supabase/supabase-js';
export const OWNER_ID = '8544b971-9916-4184-8df5-fd024b91eb5e';
export function backendFixture() {
  const state = { works: [], reviews: [], files: new Map(), owner: true, failUpload: false, failWrite: false, failImport: false };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = options.method || 'GET';
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    if (url.pathname.includes('/storage/v1/object/')) {
      const name = decodeURIComponent(url.pathname.split('/object/zerkalo-works/')[1] || '');
      if (method === 'POST') {
        if (state.failUpload) return json({ message: 'Upload failed' }, 400);
        state.files.set(name, body);
        return json({ Key: 'zerkalo-works/' + name });
      }
      if (method === 'DELETE') {
        for (const path of body.prefixes) state.files.delete(path);
        return json([]);
      }
    }
    if (url.pathname.endsWith('/rpc/zerkalo_import_content')) {
      if (state.failImport) return json({ message: 'Import failed' }, 400);
      state.works.push(...body.p_works);
      state.reviews.push(...body.p_reviews);
      return json({ works: body.p_works.length, reviews: body.p_reviews.length });
    }
    const table = url.pathname.split('/').pop();
    if (table === 'zerkalo_owners') return json(state.owner ? [{ user_id: OWNER_ID }] : []);
    const key = table === 'zerkalo_works' ? 'works' : 'reviews';
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    if (method !== 'GET' && (state.failWrite || !state.owner)) return json({ message: 'Write denied', code: '42501' }, 403);
    if (method === 'POST') state[key].push(...(Array.isArray(body) ? body : [body]));
    if (method === 'PATCH') state[key] = state[key].map(row => row.id === id ? { ...row, ...body } : row);
    let rows = method === 'POST' ? (Array.isArray(body) ? body : [body]) : state[key].filter(row => !id || row.id === id);
    if (method === 'DELETE') state[key] = state[key].filter(row => row.id !== id);
    const headers = new Headers(options.headers);
    if (headers.get('Accept')?.includes('vnd.pgrst.object')) {
      return rows.length === 1 ? json(rows[0]) : json({ message: 'Row missing', code: 'PGRST116' }, 406);
    }
    return json(rows);
  };
  const client = createClient('https://unit.supabase.co', 'sb_publishable_fixture', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  client.auth.getUser = async () => ({ data: { user: { id: OWNER_ID } }, error: null });
  return { state, client, fetch };
}
