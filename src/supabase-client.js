import { createClient } from '@supabase/supabase-js';

let client = null;

function configuredEnvironment() {
  const buildEnvironment = { VITE_SUPABASE_URL: import.meta.env?.VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY };
  const runtimeEnvironment = globalThis.process?.env ?? {};
  return {
    url: buildEnvironment.VITE_SUPABASE_URL ?? runtimeEnvironment.VITE_SUPABASE_URL,
    key: buildEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY ?? runtimeEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

function validateProjectUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Supabase URL configuration is invalid.');
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('Supabase URL configuration is invalid.');
  }

  return url.origin;
}

export function getSupabaseClient() {
  const { url: configuredUrl, key } = configuredEnvironment();
  if (!configuredUrl || !key) return null;
  if (client) return client;

  const url = validateProjectUrl(configuredUrl);
  client = createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      persistSession: true,
    },
  });
  return client;
}
