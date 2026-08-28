import { NextRequest, NextResponse } from 'next/server';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';

// Mints a Supabase Storage signed upload URL, same pattern as
// app/api/upload-url but for review_runs — stored under a `review/<id>/`
// prefix in the same bucket rather than a separate one (see
// supabase/schema.sql comment on review_runs for why).
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { filename, runId, index } = await req.json().catch(() => ({}));

  if (!filename || typeof filename !== 'string') {
    return NextResponse.json({ error: '파일명이 필요합니다.' }, { status: 400 });
  }

  let id = typeof runId === 'string' ? runId : null;
  if (!id) {
    const { data: inserted, error: insertErr } = await supabase
      .from('review_runs')
      .insert({ source_filename: filename, source_type: 'upload', status: 'processing' })
      .select('id')
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json({ error: insertErr?.message || '이력 생성에 실패했습니다.' }, { status: 500 });
    }
    id = inserted.id;
  }

  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  const path = typeof index === 'number' ? `review/${id}/image-${index}.${ext}` : `review/${id}/source.${ext}`;
  const { data: signed, error: signErr } = await supabase.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);

  if (signErr || !signed) {
    return NextResponse.json({ error: signErr?.message || '업로드 URL 생성에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ runId: id, path: signed.path, token: signed.token });
}
