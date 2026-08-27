import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabase
    .from('generations')
    .select('id, created_at, source_filename, output_filename, status, error_message, scenario_count, step_count')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    items: data,
    _debug: {
      supabaseUrl: process.env.SUPABASE_URL,
      hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasAnon: !!process.env.SUPABASE_ANON_KEY,
      count: data?.length,
    },
  });
}
