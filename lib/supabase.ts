import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Server-only client. Prefer the service-role key if the deployer set one
// (more reliable for storage/RLS), otherwise fall back to the anon key —
// this app ships with a permissive RLS policy on its own tables/bucket
// (see supabase/schema.sql) because it's a personal, single-user tool with
// no end-user auth in scope. Never import this file from a client component.
//
// Built lazily (not at module load) so `next build`'s page-data collection
// — which imports every route file without real env vars present — doesn't
// crash on a missing SUPABASE_URL. Actual calls at request time still fail
// loudly if the deployer forgot to set the env vars.
let cached: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY(또는 SUPABASE_ANON_KEY) 환경변수가 설정되어 있지 않습니다. ' +
        'Vercel 프로젝트 설정에서 환경변수를 추가한 뒤 다시 배포해주세요.'
    );
  }

  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

// Proxy so existing call sites can keep writing `supabase.from(...)` /
// `supabase.storage...` — the real client is only constructed on first
// actual property access, not at import time.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export const STORAGE_BUCKET = 'test-scenario-files';
