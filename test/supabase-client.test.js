import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const originalUrl = process.env.VITE_SUPABASE_URL;
const originalKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
let importNumber = 0;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.VITE_SUPABASE_URL;
  else process.env.VITE_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = originalKey;
});

async function loadClientModule() {
  importNumber += 1;
  return import(`../src/supabase-client.js?case=${importNumber}`);
}

test('valid public configuration creates one reusable Supabase client', async () => {
  process.env.VITE_SUPABASE_URL = 'https://zerkalo-test.supabase.co';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key';
  const { getSupabaseClient } = await loadClientModule();

  const first = getSupabaseClient();
  assert.ok(first?.auth, 'configured client exposes Supabase Auth');
  assert.strictEqual(getSupabaseClient(), first, 'client is reused after first initialization');
});

test('missing public URL leaves the client unavailable', async () => {
  delete process.env.VITE_SUPABASE_URL;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key';
  const { getSupabaseClient } = await loadClientModule();

  assert.equal(getSupabaseClient(), null);
});

test('missing public key leaves the client unavailable', async () => {
  process.env.VITE_SUPABASE_URL = 'https://zerkalo-test.supabase.co';
  delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const { getSupabaseClient } = await loadClientModule();

  assert.equal(getSupabaseClient(), null);
});

test('malformed URL reports a configuration error without exposing the key', async () => {
  const key = 'secret-that-must-not-appear-in-an-error';
  process.env.VITE_SUPABASE_URL = 'not a URL';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = key;
  const { getSupabaseClient } = await loadClientModule();

  assert.throws(getSupabaseClient, (error) => {
    assert.match(error.message, /supabase url/i);
    assert.equal(error.message.includes(key), false);
    return true;
  });
});
