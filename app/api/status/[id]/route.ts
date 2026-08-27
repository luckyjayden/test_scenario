import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Polled by the upload page while /api/generate is running (a single long
// synchronous call) to show batch-by-batch progress — see
// lib/ai/extract.ts's BATCH_SIZE splitting and the onProgress callback in
// app/api/generate/route.ts.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: row, error } = await supabase
    .from('generations')
    .select('status, progress_current, progress_total')
    .eq('id', params.id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json(row);
}
