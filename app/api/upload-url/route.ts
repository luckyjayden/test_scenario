import { NextRequest, NextResponse } from 'next/server';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';

// Mints a Supabase Storage signed upload URL so the browser can PUT the PDF
// directly to Storage, bypassing Vercel's 4.5MB serverless request body cap
// (see app/api/generate/route.ts for where the file is picked back up).
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // `generationId` + `index` let the browser call this endpoint once per
  // file when uploading multiple images (see app/page.tsx) — the first call
  // (no generationId) creates the history row, subsequent calls for the same
  // batch reuse it so all pages land under one `${id}/` storage prefix.
  const { filename, generationId, index } = await req.json().catch(() => ({}));

  if (!filename || typeof filename !== 'string') {
    return NextResponse.json({ error: '파일명이 필요합니다.' }, { status: 400 });
  }

  let id = typeof generationId === 'string' ? generationId : null;
  if (!id) {
    const { data: inserted, error: insertErr } = await supabase
      .from('generations')
      .insert({ source_filename: filename, status: 'processing' })
      .select('id')
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: insertErr?.message || '이력 생성에 실패했습니다.' },
        { status: 500 }
      );
    }
    id = inserted.id;
  }

  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  const path = typeof index === 'number' ? `${id}/image-${index}.${ext}` : `${id}/source.${ext}`;
  const { data: signed, error: signErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(path);

  if (signErr || !signed) {
    return NextResponse.json(
      { error: signErr?.message || '업로드 URL 생성에 실패했습니다.' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    generationId: id,
    path: signed.path,
    token: signed.token,
  });
}
