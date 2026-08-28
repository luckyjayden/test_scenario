import { NextRequest, NextResponse } from 'next/server';
import { pdf } from 'pdf-to-img';
import { extractBatch, finalizeStages, ExtractionError, PageImage, BatchExtraction, BATCH_SIZE, MAX_PDF_BYTES, MAX_IMAGES } from '@/lib/ai/extract';
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

// Each request processes exactly one OpenAI batch (see lib/ai/extract.ts) and
// returns — a document of any page count just takes more sequential requests
// (driven by the client's loop in app/page.tsx) instead of one call whose
// duration scales with document size. 300s is generous headroom for a single
// batch; it's no longer the ceiling on how big a document can be.
export const runtime = 'nodejs';
export const maxDuration = 300;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type StoredPartial = { service_name: string; screen_scope_name: string; stages: BatchExtraction['stages'] };
const EMPTY_PARTIAL: StoredPartial = { service_name: '', screen_scope_name: '', stages: [] };

export async function POST(req: NextRequest) {
  // The source file itself never passes through this function's request
  // body — it's uploaded straight to Supabase Storage via a signed URL from
  // app/api/upload-url (Vercel Functions hard-cap request bodies at 4.5MB,
  // which most PPT->PDF 화면설계서 exports exceed). This request just
  // carries the generationId app/api/upload-url created.
  const { generationId, author } = await req.json().catch(() => ({}));

  if (!generationId || typeof generationId !== 'string') {
    return NextResponse.json({ error: 'generationId가 필요합니다.' }, { status: 400 });
  }

  const { data: row, error: rowErr } = await supabase
    .from('generations')
    .select('source_filename, progress_current, progress_total, extraction_partial')
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
  const partial: StoredPartial = (row.extraction_partial as StoredPartial | null) || EMPTY_PARTIAL;
  const batchIndex = row.progress_current ?? 0; // 0-indexed: which batch this request should process

  // Tracked outside the try block and always destroyed in `finally` below —
  // Fluid Compute can reuse this function instance for the client's next
  // sequential batch request, so leaving pdfjs's native canvas/rendering
  // resources alive past this one request's page fetch would leak across
  // invocations instead of just within one.
  let pdfDocument: Awaited<ReturnType<typeof pdf>> | null = null;

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

    let sourcePath: string;
    let totalPages: number;
    // Fetches just this request's batch of pages — for the PDF path, a fresh
    // pdf-to-img document is opened per request (see below) since function
    // instances aren't guaranteed to persist between the client's sequential
    // calls; getting the page count doesn't require rendering anything, and
    // getPage() only rasterizes the specific pages asked for.
    let getBatchPages: (start: number, count: number) => Promise<PageImage[]>;

    if (sourceFile) {
      sourcePath = `${generationId}/${sourceFile.name}`;
      const { data: pdfBlob, error: downloadErr } = await supabase.storage.from(STORAGE_BUCKET).download(sourcePath);
      if (downloadErr || !pdfBlob) {
        throw new ExtractionError(downloadErr?.message || '업로드된 PDF를 찾지 못했습니다. 다시 업로드해주세요.');
      }
      const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
      if (pdfBuffer.byteLength > MAX_PDF_BYTES) {
        throw new ExtractionError(
          `PDF 용량(${(pdfBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)이 처리 가능한 최대 크기(32MB)를 초과했습니다. 파일을 분할해서 업로드해주세요.`
        );
      }

      // jpg keeps per-page buffers small (unlike PNG, pdf-to-img never holds
      // an uncompressed bitmap the same size as the encoded output), but
      // scale controls the *transient* canvas pdfjs allocates while
      // rendering a page — measured locally at scale 1.5, a single
      // image-heavy slide in a real 화면설계서 spiked RSS to ~1.7GB mid-batch
      // (confirmed as the cause of two production OOM kills on Vercel
      // Hobby's 2GB cap). 1.0 cut that same page's peak to ~1GB while
      // keeping mockup text legible for the vision model.
      const document = await pdf(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`, {
        scale: 1.0,
        format: 'jpg',
      });
      pdfDocument = document;
      if (document.length === 0) {
        throw new ExtractionError('PDF에서 페이지를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해주세요.');
      }
      totalPages = document.length;
      getBatchPages = async (start, count) => {
        const buffers: PageImage[] = [];
        for (let i = 0; i < count; i++) {
          // getPage is 1-indexed.
          buffers.push({ buffer: await document.getPage(start + i + 1), mime: 'image/jpeg' });
        }
        return buffers;
      };
    } else if (imageFiles.length > 0) {
      if (imageFiles.length > MAX_IMAGES) {
        throw new ExtractionError(
          `이미지 개수(${imageFiles.length}장)가 처리 가능한 최대(${MAX_IMAGES}장)를 초과했습니다. 파일을 나눠서 업로드해주세요.`
        );
      }
      sourcePath = `${generationId}/${imageFiles[0].name}`;
      totalPages = imageFiles.length;
      getBatchPages = async (start, count) => {
        const slice = imageFiles.slice(start, start + count);
        const buffers: PageImage[] = [];
        for (const f of slice) {
          const path = `${generationId}/${f.name}`;
          const { data: imgBlob, error: downloadErr } = await supabase.storage.from(STORAGE_BUCKET).download(path);
          if (downloadErr || !imgBlob) {
            throw new ExtractionError(`이미지(${f.name}) 다운로드에 실패했습니다. 다시 업로드해주세요.`);
          }
          const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
          buffers.push({ buffer: Buffer.from(await imgBlob.arrayBuffer()), mime: mimeForExt(ext) });
        }
        return buffers;
      };
    } else {
      throw new ExtractionError('업로드된 파일을 찾지 못했습니다. 다시 업로드해주세요.');
    }

    const totalBatches = Math.max(1, Math.ceil(totalPages / BATCH_SIZE));
    if (batchIndex >= totalBatches) {
      return NextResponse.json({ error: '이미 처리가 완료된 요청입니다.' }, { status: 409 });
    }

    const start = batchIndex * BATCH_SIZE;
    const count = Math.min(BATCH_SIZE, totalPages - start);
    const pages = await getBatchPages(start, count);
    const batchResult = await extractBatch({ pages, batchIndex, totalBatches, totalPages });

    const mergedPartial: StoredPartial = {
      service_name: partial.service_name || batchResult.service_name,
      screen_scope_name: partial.screen_scope_name || batchResult.screen_scope_name,
      stages: [...partial.stages, ...batchResult.stages],
    };

    const nextBatchIndex = batchIndex + 1;
    if (nextBatchIndex < totalBatches) {
      await supabase
        .from('generations')
        .update({ progress_current: nextBatchIndex, progress_total: totalBatches, extraction_partial: mergedPartial })
        .eq('id', generationId);
      return NextResponse.json({ done: false, progress: { current: nextBatchIndex, total: totalBatches } });
    }

    // Last batch — finalize: renumber stages across the whole document, build
    // the xlsx, and upload it, exactly as the old single-request flow did.
    if (mergedPartial.stages.length === 0) {
      throw new ExtractionError(
        '화면설계서에서 유효한 화면(시나리오 단계)을 찾지 못했습니다. 업로드한 파일이 실제 화면 설계 슬라이드를 포함하는지 확인해주세요.'
      );
    }
    const extraction = {
      service_name: mergedPartial.service_name,
      screen_scope_name: mergedPartial.screen_scope_name,
      stages: finalizeStages(mergedPartial.stages),
    };

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
    // app/api/download already uses when it streams the file back.
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
        progress_current: totalBatches,
        progress_total: totalBatches,
        extraction_partial: null,
      })
      .eq('id', generationId);

    return NextResponse.json({ done: true, scenarioCount, stepCount });
  } catch (err) {
    console.error('[generate] failed:', err);

    await supabase
      .from('generations')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : String(err) })
      .eq('id', generationId);

    const message = err instanceof ExtractionError ? err.message : '엑셀 생성 중 오류가 발생했습니다.';
    const status = err instanceof ExtractionError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (pdfDocument) await pdfDocument.destroy();
  }
}
