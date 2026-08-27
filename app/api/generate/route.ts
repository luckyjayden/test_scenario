import { NextRequest, NextResponse } from 'next/server';
import { extractTestScenarios, ExtractionError } from '@/lib/ai/extract';
import { buildScenarioWorkbook } from '@/lib/excel/build';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';

// Large PDFs (rasterized to per-page images) + a vision-heavy OpenAI call
// can comfortably exceed the platform's default function timeout. This
// needs Vercel's Fluid Compute / a plan that allows a long maxDuration —
// see README "배포" section.
export const runtime = 'nodejs';
export const maxDuration = 300;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  // The PDF itself never passes through this function's request body — it's
  // uploaded straight to Supabase Storage via a signed URL from
  // app/api/upload-url (Vercel Functions hard-cap request bodies at 4.5MB,
  // which most PPT->PDF 화면설계서 exports exceed). This request just
  // carries the generationId + storage path created by that step.
  const { generationId, author } = await req.json().catch(() => ({}));

  if (!generationId || typeof generationId !== 'string') {
    return NextResponse.json({ error: 'generationId가 필요합니다.' }, { status: 400 });
  }

  const { data: row, error: rowErr } = await supabase
    .from('generations')
    .select('source_filename')
    .eq('id', generationId)
    .single();

  if (rowErr || !row) {
    return NextResponse.json({ error: '업로드 이력을 찾을 수 없습니다.' }, { status: 404 });
  }

  // Defensive NFC normalization in case this row's filename was written
  // before the client started normalizing (see app/page.tsx) — macOS
  // reports Korean filenames in decomposed (NFD) form, which renders as
  // broken jamo once it lands in the generated xlsx.
  const sourceFilename = (row.source_filename as string).normalize('NFC');
  const pdfPath = `${generationId}/source.pdf`;

  try {
    const { data: pdfBlob, error: downloadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(pdfPath);
    if (downloadErr || !pdfBlob) {
      throw new ExtractionError(downloadErr?.message || '업로드된 PDF를 찾지 못했습니다. 다시 업로드해주세요.');
    }
    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());

    const extraction = await extractTestScenarios(pdfBuffer);

    const { buffer, scenarioCount, stepCount } = await buildScenarioWorkbook({
      extraction,
      sourceFilename,
      author: (author as string) || '작성자 미입력',
      today: todayISO(),
    });

    const outputFilename = `${extraction.service_name || '테스트'}_${extraction.screen_scope_name || '시나리오'}_테스트시나리오_v1.0.xlsx`;
    // Supabase Storage rejects object keys containing non-ASCII characters
    // (outputFilename is Korean) — keep the storage key ASCII-only and pass
    // the real Korean filename separately via output_filename, which
    // app/api/download already uses as the signed URL's `download` name.
    const xlsxPath = `${generationId}/output.xlsx`;

    const { error: xlsxUploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(xlsxPath, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true,
      });
    if (xlsxUploadErr) console.error('[generate] xlsx upload failed:', xlsxUploadErr.message);

    await supabase
      .from('generations')
      .update({
        status: 'success',
        service_name: extraction.service_name,
        screen_name: extraction.screen_scope_name,
        scenario_count: scenarioCount,
        step_count: stepCount,
        source_pdf_path: pdfPath,
        output_xlsx_path: xlsxUploadErr ? null : xlsxPath,
        output_filename: outputFilename,
      })
      .eq('id', generationId);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // RFC 5987 encoding — a plain `filename="%ED..."` is not decoded by
        // browsers (the percent-encoded literal ends up as the filename).
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(outputFilename)}`,
        'X-Scenario-Count': String(scenarioCount),
        'X-Step-Count': String(stepCount),
        'X-Output-Filename': encodeURIComponent(outputFilename),
      },
    });
  } catch (err) {
    console.error('[generate] failed:', err);

    await supabase
      .from('generations')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : String(err) })
      .eq('id', generationId);

    const message = err instanceof ExtractionError ? err.message : '엑셀 생성 중 오류가 발생했습니다.';
    const status = err instanceof ExtractionError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
