import { NextRequest, NextResponse } from 'next/server';
import { extractTestScenarios, extractFromImages, ExtractionError, PageImage } from '@/lib/ai/extract';
import { buildScenarioWorkbook } from '@/lib/excel/build';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';

function mimeForExt(ext: string): string {
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

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

  try {
    // app/api/upload-url writes either a single `source.<ext>` (PDF flow) or
    // one or more `image-<n>.<ext>` files (image flow) under this prefix —
    // list rather than assume, since this route doesn't otherwise know which
    // path app/page.tsx took for a given generationId.
    const { data: files, error: listErr } = await supabase.storage.from(STORAGE_BUCKET).list(generationId);
    if (listErr || !files || files.length === 0) {
      throw new ExtractionError('업로드된 파일을 찾지 못했습니다. 다시 업로드해주세요.');
    }

    const sourceFile = files.find((f) => f.name.startsWith('source.'));
    const imageFiles = files
      .filter((f) => f.name.startsWith('image-'))
      .sort((a, b) => {
        const ai = parseInt(a.name.match(/image-(\d+)\./)?.[1] || '0', 10);
        const bi = parseInt(b.name.match(/image-(\d+)\./)?.[1] || '0', 10);
        return ai - bi;
      });

    const onProgress = async (current: number, total: number) => {
      await supabase.from('generations').update({ progress_current: current, progress_total: total }).eq('id', generationId);
    };

    let extraction;
    let sourcePath: string | null = null;

    if (sourceFile) {
      sourcePath = `${generationId}/${sourceFile.name}`;
      const { data: pdfBlob, error: downloadErr } = await supabase.storage.from(STORAGE_BUCKET).download(sourcePath);
      if (downloadErr || !pdfBlob) {
        throw new ExtractionError(downloadErr?.message || '업로드된 PDF를 찾지 못했습니다. 다시 업로드해주세요.');
      }
      const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
      extraction = await extractTestScenarios(pdfBuffer, onProgress);
    } else if (imageFiles.length > 0) {
      const images: PageImage[] = [];
      for (const f of imageFiles) {
        const path = `${generationId}/${f.name}`;
        const { data: imgBlob, error: downloadErr } = await supabase.storage.from(STORAGE_BUCKET).download(path);
        if (downloadErr || !imgBlob) {
          throw new ExtractionError(`이미지(${f.name}) 다운로드에 실패했습니다. 다시 업로드해주세요.`);
        }
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
        images.push({ buffer: Buffer.from(await imgBlob.arrayBuffer()), mime: mimeForExt(ext) });
      }
      sourcePath = `${generationId}/${imageFiles[0].name}`;
      extraction = await extractFromImages(images, onProgress);
    } else {
      throw new ExtractionError('업로드된 파일을 찾지 못했습니다. 다시 업로드해주세요.');
    }

    const { buffer, scenarioCount, stepCount } = await buildScenarioWorkbook({
      extraction,
      sourceFilename,
      author: (author as string) || '작성자 미입력',
      today: todayISO(),
    });

    // Appending the date + a short slice of generationId guarantees a unique
    // filename per generation — without it, regenerating for the same
    // service/screen combo (e.g. after fixing the source PDF) produces an
    // identical name and silently overwrites the earlier download in the
    // browser's Downloads folder.
    const datePart = todayISO().replace(/-/g, '');
    const idPart = generationId.slice(0, 8);
    const outputFilename = `${extraction.service_name || '테스트'}_${extraction.screen_scope_name || '시나리오'}_테스트시나리오_v1.0_${datePart}_${idPart}.xlsx`;
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
        source_pdf_path: sourcePath,
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
