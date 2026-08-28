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

  // Proxy the file instead of redirecting to a signed URL: Supabase Storage's
  // `download` filename option isn't RFC 5987 encoded, so a Korean
  // output_filename comes through the browser garbled. Streaming it back
  // ourselves lets us set Content-Disposition the same way /api/generate
  // does for the initial download, which renders correctly.
  const { data: fileBlob, error: downloadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(row.output_xlsx_path);

  if (downloadErr || !fileBlob) {
    return NextResponse.json({ error: downloadErr?.message || '파일 다운로드에 실패했습니다.' }, { status: 500 });
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const filename = row.output_filename || 'test-scenario.xlsx';

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
