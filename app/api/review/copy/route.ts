import { NextRequest, NextResponse } from 'next/server';
import { pdf } from 'pdf-to-img';
import { ExtractionError, PageImage, MAX_PDF_BYTES, MAX_IMAGES } from '@/lib/ai/extract';
import { detectTone, detectServiceName, reviewCopyBatch, synthesizeConsistency, REVIEW_BATCH_SIZE } from '@/lib/ai/reviewCopy';
import { CopyFinding, ComponentInstance } from '@/lib/ai/reviewSchema';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';
import { mimeForExt } from '@/lib/files';

// Same resumable-per-batch design as app/api/generate/route.ts — see that
// file's comments for the full rationale (Vercel function duration/memory
// limits scale with document size if processed in one request).
export const runtime = 'nodejs';
export const maxDuration = 300;

type StoredPartial = { findings: CopyFinding[]; component_instances: ComponentInstance[] };
const EMPTY_PARTIAL: StoredPartial = { findings: [], component_instances: [] };

export async function POST(req: NextRequest) {
  const { runId, toneManner } = await req.json().catch(() => ({}));

  if (!runId || typeof runId !== 'string') {
    return NextResponse.json({ error: 'runId가 필요합니다.' }, { status: 400 });
  }

  const { data: row, error: rowErr } = await supabase
    .from('review_runs')
    .select('progress_current, progress_total, review_partial, tone_manner_input, tone_manner_detected, service_name_detected')
    .eq('id', runId)
    .single();

  if (rowErr || !row) {
    return NextResponse.json({ error: '업로드 이력을 찾을 수 없습니다.' }, { status: 404 });
  }

  const partial: StoredPartial = (row.review_partial as StoredPartial | null) || EMPTY_PARTIAL;
  const batchIndex = row.progress_current ?? 0;

  let pdfDocument: Awaited<ReturnType<typeof pdf>> | null = null;

  try {
    const prefix = `review/${runId}`;
    const { data: files, error: listErr } = await supabase.storage.from(STORAGE_BUCKET).list(prefix);
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

    let totalPages: number;
    let getBatchPages: (start: number, count: number) => Promise<PageImage[]>;

    if (sourceFile) {
      const sourcePath = `${prefix}/${sourceFile.name}`;
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

      const document = await pdf(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`, { scale: 1.0, format: 'jpg' });
      pdfDocument = document;
      if (document.length === 0) {
        throw new ExtractionError('PDF에서 페이지를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해주세요.');
      }
      totalPages = document.length;
      getBatchPages = async (start, count) => {
        const buffers: PageImage[] = [];
        for (let i = 0; i < count; i++) {
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
      totalPages = imageFiles.length;
      getBatchPages = async (start, count) => {
        const slice = imageFiles.slice(start, start + count);
        const buffers: PageImage[] = [];
        for (const f of slice) {
          const { data: imgBlob, error: downloadErr } = await supabase.storage.from(STORAGE_BUCKET).download(`${prefix}/${f.name}`);
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

    const totalBatches = Math.max(1, Math.ceil(totalPages / REVIEW_BATCH_SIZE));
    if (batchIndex >= totalBatches) {
      return NextResponse.json({ error: '이미 처리가 완료된 요청입니다.' }, { status: 409 });
    }

    const start = batchIndex * REVIEW_BATCH_SIZE;
    const count = Math.min(REVIEW_BATCH_SIZE, totalPages - start);
    const pages = await getBatchPages(start, count);

    // Tone/manner and service name are each fixed once — as soon as
    // detection succeeds — and reused for every later batch, so every batch
    // judges against the same standard. A real document can open with many
    // pages of policy/reference tables before any actual screen (e.g. 20
    // pages of 배달/포장 정책 설명), and if batch 0 lands entirely in that
    // zone, inferring tone from documentation prose produces a confidently
    // wrong baseline that then makes every real screen's normal copy look
    // like a violation. detectTone/detectServiceName return an empty string
    // when the given pages aren't real screens, so this keeps retrying on
    // each early batch (capped, so a document with no real screens at all
    // doesn't retry forever) until one actually succeeds.
    const DETECTION_RETRY_CAP = 5;
    let toneMannerFinal = row.tone_manner_input || row.tone_manner_detected || '';
    let serviceNameFinal = row.service_name_detected || '';
    const dbUpdate: Record<string, unknown> = {};
    if (!toneMannerFinal && typeof toneManner === 'string' && toneManner.trim()) {
      toneMannerFinal = toneManner.trim();
      dbUpdate.tone_manner_input = toneMannerFinal;
    } else if (!toneMannerFinal && batchIndex < DETECTION_RETRY_CAP) {
      toneMannerFinal = await detectTone(pages);
      if (toneMannerFinal) dbUpdate.tone_manner_detected = toneMannerFinal;
    }
    if (!serviceNameFinal && batchIndex < DETECTION_RETRY_CAP) {
      serviceNameFinal = await detectServiceName(pages);
      if (serviceNameFinal) dbUpdate.service_name_detected = serviceNameFinal;
    }

    const batchResult = await reviewCopyBatch({
      pages,
      batchIndex,
      totalBatches,
      toneManner: toneMannerFinal,
      serviceName: serviceNameFinal,
    });

    const mergedPartial: StoredPartial = {
      findings: [...partial.findings, ...batchResult.findings],
      component_instances: [...partial.component_instances, ...batchResult.component_instances],
    };

    const nextBatchIndex = batchIndex + 1;
    if (nextBatchIndex < totalBatches) {
      await supabase
        .from('review_runs')
        .update({ ...dbUpdate, progress_current: nextBatchIndex, progress_total: totalBatches, review_partial: mergedPartial })
        .eq('id', runId);
      return NextResponse.json({ done: false, progress: { current: nextBatchIndex, total: totalBatches } });
    }

    // Last batch — finalize. Consistency is judged exactly once, in a single
    // text-only call over every component_instance collected across every
    // batch (see synthesizeConsistency) — not per-batch, so there is no way
    // for it to contradict itself the way independently-generated per-batch
    // verdicts could.
    const finalConsistency = await synthesizeConsistency(mergedPartial.component_instances);
    const resultJson = {
      tone_manner: toneMannerFinal,
      findings: mergedPartial.findings,
      consistency_notes: finalConsistency,
    };

    await supabase
      .from('review_runs')
      .update({
        ...dbUpdate,
        status: 'success',
        finding_count: mergedPartial.findings.length,
        result_json: resultJson,
        progress_current: totalBatches,
        progress_total: totalBatches,
        review_partial: null,
      })
      .eq('id', runId);

    return NextResponse.json({ done: true, findingCount: mergedPartial.findings.length });
  } catch (err) {
    console.error('[review/copy] failed:', err);

    await supabase
      .from('review_runs')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : String(err) })
      .eq('id', runId);

    const message = err instanceof ExtractionError ? err.message : '검수 중 오류가 발생했습니다.';
    const status = err instanceof ExtractionError ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (pdfDocument) await pdfDocument.destroy();
  }
}
