import { createClient } from '@supabase/supabase-js';

// Browser-safe client, used only to PUT a file straight to Supabase Storage
// via a signed upload URL minted server-side (see app/api/upload-url). This
// keeps large PDF uploads off Vercel's serverless request path entirely —
// Vercel Functions hard-cap request bodies at 4.5MB, which most PPT->PDF
// 화면설계서 exports exceed.
//
// The anon key is safe to ship to the client: this app's RLS policies are
// intentionally permissive (personal, single-user tool, no end-user auth —
// see supabase/schema.sql), and the signed-upload token (not this key) is
// what actually authorizes the write.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);
