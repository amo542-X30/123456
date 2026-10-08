import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __AM0SP_SUPABASE_CONFIG__?: {
      url?: string;
      anonKey?: string;
    };
  }
}

const runtimeConfig = typeof window !== 'undefined' ? window.__AM0SP_SUPABASE_CONFIG__ : undefined;
const usesWorkerSupabaseConfig =
  import.meta.env.VITE_SUPABASE_ANON_KEY === '__WORKER_SUPABASE_ANON_KEY__';
const supabaseUrl =
  runtimeConfig?.url?.trim() ??
  (usesWorkerSupabaseConfig ? '' : import.meta.env.VITE_SUPABASE_URL?.trim() ?? '');
const supabaseAnonKey =
  runtimeConfig?.anonKey?.trim() ??
  (usesWorkerSupabaseConfig ? '' : import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '');

const isValidSupabaseUrl = (() => {
  try {
    const url = new URL(supabaseUrl);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
})();

export const isSupabaseConfigured = Boolean(isValidSupabaseUrl && supabaseAnonKey);

const configuredClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const supabase: SupabaseClient = configuredClient ?? new Proxy({} as SupabaseClient, {
  get() {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect the new project.'
    );
  },
});

export const STORAGE_BUCKET = 'am0sp-vault';
