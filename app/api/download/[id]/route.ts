import { NextRequest, NextResponse } from 'next/server';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: row, error } = await supabase
    .from('generations')
    .select('output_xlsx_path, output_filename, status')
    .eq('id', params.id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
  }
  if (!row.output_xlsx_path) {
    return NextResponse.json({ error: '이 이력에는 저장된 파일이 없습니다 (생성 실패 건일 수 있어요).' }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(row.output_xlsx_path, 60, {
      download: row.output_filename || undefined,
    });

  if (signErr || !signed) {
    return NextResponse.json({ error: signErr?.message || '다운로드 링크 생성에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
