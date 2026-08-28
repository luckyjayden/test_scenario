import OpenAI from 'openai';
import { pdf } from 'pdf-to-img';
import { EXTRACTION_SCHEMA, EXTRACTION_TOOL_NAME, ExtractionResult } from './schema';
import { EXTRACTION_SYSTEM_PROMPT } from './guideRules';

// Unlike Anthropic, OpenAI's chat models don't read PDFs natively as a
// vision input, so each page is rasterized to a JPEG (via pdfjs-dist, no
// native canvas dependency) and sent as a separate image — the model sees
// the same mockup + description-panel layout a human reviewer would, one
// page = one image.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_PDF_BYTES = 32 * 1024 * 1024;
// Not an API-enforced limit — a practical ceiling so a single document
// doesn't take an unreasonable number of batches (see BATCH_SIZE below) or
// blow past Vercel's function duration.
const MAX_PAGES = 60;
// A "high" detail vision image on gpt-4o costs roughly 1,000-1,500 tokens
// depending on page dimensions. Some OpenAI orgs (Tier 1) cap gpt-4o at
// 30,000 tokens/minute total, and that's a hard per-request ceiling, not a
// transient "wait and retry" limit — a single call with ~25+ high-detail
// pages can permanently exceed it no matter how many times it's retried.
// Splitting into smaller sequential batches keeps every individual request
// safely under that ceiling regardless of account tier.
const BATCH_SIZE = 12;
export const MAX_IMAGES = 30;

export class ExtractionError extends Error {}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } };

export type PageImage = { buffer: Buffer; mime: string };

// Abstracts "get me pages [start, start+count)" so runExtraction can pull one
// batch at a time instead of requiring every page pre-loaded into memory —
// the PDF path (below) renders each batch on demand and lets it be
// garbage-collected once sent, instead of holding the whole document's
// rasterized pages (which OOM'd the function on a 79-page/30MB deck).
type PageSource = {
  total: number;
  getBatch: (start: number, count: number) => Promise<PageImage[]>;
};

export async function extractTestScenarios(
  pdfBuffer: Buffer,
  onProgress?: (current: number, total: number) => void | Promise<void>
): Promise<ExtractionResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }
  if (pdfBuffer.byteLength > MAX_PDF_BYTES) {
    throw new ExtractionError(
      `PDF 용량(${(pdfBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)이 처리 가능한 최대 크기(32MB)를 초과했습니다. 파일을 분할해서 업로드해주세요.`
    );
  }

  // jpg + a moderate scale keeps per-page buffers small enough to fit within
  // Vercel Hobby's 2GB function memory cap — UI mockup text stays legible at
  // this quality, and unlike PNG, pdf-to-img never holds an uncompressed
  // bitmap the same size as the encoded output.
  const document = await pdf(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`, {
    scale: 1.5,
    format: 'jpg',
  });

  try {
    // document.length comes from the PDF's page tree, not from rendering —
    // this rejects an oversized deck instantly instead of burning memory (and
    // OpenAI batches) rasterizing 60 pages before finding out.
    if (document.length === 0) {
      throw new ExtractionError('PDF에서 페이지를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해주세요.');
    }
    if (document.length > MAX_PAGES) {
      throw new ExtractionError(
        `페이지 수(${document.length}페이지)가 처리 가능한 최대(${MAX_PAGES}페이지)를 초과했습니다. 파일을 분할해서 업로드해주세요.`
      );
    }

    const source: PageSource = {
      total: document.length,
      getBatch: async (start, count) => {
        const buffers: PageImage[] = [];
        for (let i = 0; i < count; i++) {
          // getPage is 1-indexed.
          buffers.push({ buffer: await document.getPage(start + i + 1), mime: 'image/jpeg' });
        }
        return buffers;
      },
    };

    return await runExtraction(source, onProgress);
  } finally {
    // pdf-to-img keeps the underlying pdfjs document (and its rendering
    // buffers) alive until explicitly destroyed — without this, that memory
    // sticks around for the rest of the request.
    await document.destroy();
  }
}

// Images (JPG/PNG/WEBP) skip PDF rasterization and go straight to the model
// one-image-per-page, capped lower than MAX_PAGES since each is uploaded
// individually by hand rather than exported as a single batch document.
export async function extractFromImages(
  images: PageImage[],
  onProgress?: (current: number, total: number) => void | Promise<void>
): Promise<ExtractionResult> {
  if (images.length === 0) {
    throw new ExtractionError('이미지를 찾지 못했습니다. 파일이 손상되지 않았는지 확인해주세요.');
  }
  if (images.length > MAX_IMAGES) {
    throw new ExtractionError(
      `이미지 개수(${images.length}장)가 처리 가능한 최대(${MAX_IMAGES}장)를 초과했습니다. 파일을 나눠서 업로드해주세요.`
    );
  }

  return runExtraction(
    { total: images.length, getBatch: async (start, count) => images.slice(start, start + count) },
    onProgress
  );
}

async function runExtraction(
  source: PageSource,
  onProgress?: (current: number, total: number) => void | Promise<void>
): Promise<ExtractionResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }

  const totalBatches = Math.max(1, Math.ceil(source.total / BATCH_SIZE));

  // maxRetries covers ordinary transient 429s (a request that's briefly
  // over budget because of other concurrent usage) — not the "this single
  // request alone exceeds the TPM cap" case, which BATCH_SIZE avoids.
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

  const allStages: ExtractionResult['stages'] = [];
  let serviceName = '';
  let screenScopeName = '';

  for (let b = 0; b < totalBatches; b++) {
    const startPage = b * BATCH_SIZE + 1;
    const count = Math.min(BATCH_SIZE, source.total - b * BATCH_SIZE);
    const endPage = startPage + count - 1;
    // Rendered/fetched just-in-time per batch, not for the whole document up
    // front — `batch` falls out of scope (and is GC-eligible) once this loop
    // iteration finishes, so peak memory is bounded by one batch, not by how
    // many pages the source document has.
    const batch = await source.getBatch(b * BATCH_SIZE, count);

    const pageContent: ContentPart[] = batch.flatMap((page, i) => [
      { type: 'text', text: `--- ${startPage + i}페이지 ---` },
      {
        type: 'image_url',
        image_url: { url: `data:${page.mime};base64,${page.buffer.toString('base64')}`, detail: 'high' },
      },
    ]);

    const instructionText =
      totalBatches > 1
        ? `이 화면설계서는 전체 ${source.total}페이지이며, 이번 요청에는 그중 ${startPage}~${endPage}페이지(총 ${totalBatches}개 배치 중 ${b + 1}번째)만 첨부되어 있어. ` +
          '이 배치에 포함된 페이지만 분석해서 시나리오 단계를 추출해줘. 시나리오 단계 번호(순번)는 이 배치 안에서 1부터 새로 매겨도 돼 — 다른 배치와 합친 뒤 전체 기준으로 다시 번호를 매길 거야.'
        : '이 화면설계서 전체를 분석해서 테스트 시나리오를 추출해줘. 아래 이미지는 문서의 페이지 순서대로 첨부되어 있어.';

    let completion;
    try {
      completion = await client.chat.completions.create({
        model: MODEL,
        max_completion_tokens: 16000,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: [{ type: 'text', text: instructionText }, ...pageContent] },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: EXTRACTION_TOOL_NAME,
            strict: true,
            schema: EXTRACTION_SCHEMA.input_schema,
          },
        },
      });
    } catch (err) {
      if (err instanceof OpenAI.RateLimitError) {
        throw new ExtractionError(
          `OpenAI 계정의 분당 토큰 사용량 한도를 초과했습니다 (배치 ${b + 1}/${totalBatches} 처리 중). 잠시 후 다시 시도해주세요. ` +
            '반복된다면 OpenAI 대시보드(platform.openai.com/settings/organization/limits)에서 사용량 한도를 확인해주세요.'
        );
      }
      throw err;
    }

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new ExtractionError(`모델이 응답을 반환하지 않았습니다 (배치 ${b + 1}/${totalBatches}). 다시 시도해주세요.`);
    }

    let batchResult: ExtractionResult;
    try {
      batchResult = JSON.parse(raw) as ExtractionResult;
    } catch {
      throw new ExtractionError(`모델 응답을 JSON으로 파싱하지 못했습니다 (배치 ${b + 1}/${totalBatches}). 다시 시도해주세요.`);
    }

    if (!serviceName && batchResult.service_name) serviceName = batchResult.service_name;
    if (!screenScopeName && batchResult.screen_scope_name) screenScopeName = batchResult.screen_scope_name;
    allStages.push(...(batchResult.stages || []));

    await onProgress?.(b + 1, totalBatches);
  }

  if (allStages.length === 0) {
    throw new ExtractionError(
      '화면설계서에서 유효한 화면(시나리오 단계)을 찾지 못했습니다. 업로드한 파일이 실제 화면 설계 슬라이드를 포함하는지 확인해주세요.'
    );
  }

  // Each batch numbers its own stages starting from 1 — renumber
  // sequentially across the merged, full-document result (guide format:
  // "1.<n> 제목", n incrementing continuously; see lib/ai/guideRules.ts).
  const stages = allStages.map((stage, i) => ({
    ...stage,
    stage_name: stage.stage_name.replace(/^\d+(\.\d+)*\.?\s*/, `1.${i + 1} `),
  }));

  return { service_name: serviceName, screen_scope_name: screenScopeName, stages };
}
