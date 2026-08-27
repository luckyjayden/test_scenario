import { NextRequest, NextResponse } from 'next/server';
import { extractTestScenarios, ExtractionError } from '@/lib/ai/extract';
import { buildScenarioWorkbook } from '@/lib/excel/build';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';

// Large PDFs + a vision-heavy Claude call can comfortably exceed the
// platform's default function timeout. This needs Vercel's Fluid Compute /
// a plan that allows a long maxDuration — see README "배포" section.
export const runtime = 'nodejs';
export const maxDuration = 300;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  let generationId: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get('pdf');
    const author = (formData.get('author') as string) || '작성자 미입력';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'PDF 파일이 필요합니다.' }, { status: 400 });
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'PDF 파일만 업로드할 수 있습니다.' }, { status: 400 });
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    // create the history row up front (status=processing) so a failure
    // partway through still leaves a traceable record.
    const { data: inserted, error: insertErr } = await supabase
      .from('generations')
      .insert({ source_filename: file.name, status: 'processing' })
      .select('id')
      .single();
    if (insertErr) {
      console.error('[generate] failed to create history row:', insertErr.message);
    } else {
      generationId = inserted.id;
    }

    const extraction = await extractTestScenarios(pdfBuffer);

    const { buffer, scenarioCount, stepCount } = await buildScenarioWorkbook({
      extraction,
      sourceFilename: file.name,
      author,
      today: todayISO(),
    });

    const outputFilename = `${extraction.service_name || '테스트'}_${extraction.screen_scope_name || '시나리오'}_테스트시나리오_v1.0.xlsx`;

    if (generationId) {
      const pdfPath = `${generationId}/source.pdf`;
      const xlsxPath = `${generationId}/${outputFilename}`;

      const [pdfUpload, xlsxUpload] = await Promise.all([
        supabase.storage.from(STORAGE_BUCKET).upload(pdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        }),
        supabase.storage.from(STORAGE_BUCKET).upload(xlsxPath, buffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: true,
        }),
      ]);

      if (pdfUpload.error) console.error('[generate] pdf upload failed:', pdfUpload.error.message);
      if (xlsxUpload.error) console.error('[generate] xlsx upload failed:', xlsxUpload.error.message);

      await supabase
        .from('generations')
        .update({
          status: 'success',
          service_name: extraction.service_name,
          screen_name: extraction.screen_scope_name,
          scenario_count: scenarioCount,
          step_count: stepCount,
          source_pdf_path: pdfUpload.error ? null : pdfPath,
          output_xlsx_path: xlsxUpload.error ? null : xlsxPath,
          output_filename: outputFilename,
        })
        .eq('id', generationId);
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(outputFilename)}"`,
        'X-Scenario-Count': String(scenarioCount),
        'X-Step-Count': String(stepCount),
        'X-Output-Filename': encodeURIComponent(outputFilename),
      },
    });
  } catch (err) {
    console.error('[generate] failed:', err);

    if (generationId) {
      await supabase
        .from('generations')
        .update({ status: 'failed', error_message: err instanceof Error ? err.message : String(err) })
        .eq('id', generationId);
    }

    const message = err instanceof ExtractionError ? err.message : '엑셀 생성 중 오류가 발생했습니다.';
    const status = err instanceof ExtractionError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
