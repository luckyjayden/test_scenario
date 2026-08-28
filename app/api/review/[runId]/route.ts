import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Read-only: used by the report page (app/review/[runId]/page.tsx) and,
// later, by the Figma plugin to fetch a finished review's result_json
// (see DEVELOPMENT_PLAN.md §7 — the plugin calls this same shape).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const { data: row, error } = await supabase
    .from('review_runs')
    .select(
      'id, created_at, source_type, source_filename, figma_file_key, tone_manner_input, tone_manner_detected, service_name_detected, status, error_message, finding_count, layout_issue_count, result_json, progress_current, progress_total'
    )
    .eq('id', params.runId)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: '검수 이력을 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json(row);
}
