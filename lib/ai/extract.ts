import OpenAI from 'openai';
import { EXTRACTION_SCHEMA, EXTRACTION_TOOL_NAME, ExtractionResult } from './schema';
import { EXTRACTION_SYSTEM_PROMPT } from './guideRules';

// Unlike Anthropic, OpenAI's chat models don't read PDFs natively as a
// vision input, so each page is rasterized to a JPEG (via pdfjs-dist, no
// native canvas dependency) and sent as a separate image — the model sees
// the same mockup + description-panel layout a human reviewer would, one
// page = one image.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
export const MAX_PDF_BYTES = 32 * 1024 * 1024;
// A "high" detail vision image on gpt-4o costs roughly 1,000-1,500 tokens
// depending on page dimensions. Some OpenAI orgs (Tier 1) cap gpt-4o at
// 30,000 tokens/minute total, and that's a hard per-request ceiling, not a
// transient "wait and retry" limit — a single call with ~25+ high-detail
// pages can permanently exceed it no matter how many times it's retried.
// Splitting into smaller sequential batches keeps every individual request
// safely under that ceiling regardless of account tier. There is no cap on
// total page count anymore — app/api/generate calls extractBatch once per
// batch across separate requests (see BatchExtraction below), so a document
// of any length just takes more requests instead of one that risks Vercel's
// function duration limit.
export const BATCH_SIZE = 12;
export const MAX_IMAGES = 30;

export class ExtractionError extends Error {}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } };

export type PageImage = { buffer: Buffer; mime: string };

export type BatchExtraction = {
  service_name: string;
  screen_scope_name: string;
  stages: ExtractionResult['stages'];
};

// Processes exactly one batch of already-loaded page images and returns that
// batch's raw (not yet renumbered) result. The caller — app/api/generate —
// owns fetching/rendering each batch's pages (from a PDF or from uploaded
// images), persisting accumulated results between batches, and renumbering
// stages once every batch is done (see finalizeStages below). Splitting the
// work this way means one HTTP request only ever pays for one OpenAI call,
// so total document size no longer risks Vercel's function duration limit —
// a 300-page PDF just takes 25 sequential requests instead of one huge one.
export async function extractBatch(params: {
  pages: PageImage[];
  batchIndex: number; // 0-indexed
  totalBatches: number;
  totalPages: number;
}): Promise<BatchExtraction> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }

  const { pages, batchIndex, totalBatches, totalPages } = params;
  const startPage = batchIndex * BATCH_SIZE + 1;
  const endPage = startPage + pages.length - 1;

  const pageContent: ContentPart[] = pages.flatMap((page, i) => [
    { type: 'text', text: `--- ${startPage + i}페이지 ---` },
    {
      type: 'image_url',
      image_url: { url: `data:${page.mime};base64,${page.buffer.toString('base64')}`, detail: 'high' },
    },
  ]);

  const instructionText =
    totalBatches > 1
      ? `이 화면설계서는 전체 ${totalPages}페이지이며, 이번 요청에는 그중 ${startPage}~${endPage}페이지(총 ${totalBatches}개 배치 중 ${batchIndex + 1}번째)만 첨부되어 있어. ` +
        '이 배치에 포함된 페이지만 분석해서 시나리오 단계를 추출해줘. 시나리오 단계 번호(순번)는 이 배치 안에서 1부터 새로 매겨도 돼 — 다른 배치와 합친 뒤 전체 기준으로 다시 번호를 매길 거야.'
      : '이 화면설계서 전체를 분석해서 테스트 시나리오를 추출해줘. 아래 이미지는 문서의 페이지 순서대로 첨부되어 있어.';

  // maxRetries covers ordinary transient 429s (a request that's briefly over
  // budget because of other concurrent usage) — not the "this single request
  // alone exceeds the TPM cap" case, which BATCH_SIZE avoids.
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

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
        `OpenAI 계정의 분당 토큰 사용량 한도를 초과했습니다 (배치 ${batchIndex + 1}/${totalBatches} 처리 중). 잠시 후 다시 시도해주세요. ` +
          '반복된다면 OpenAI 대시보드(platform.openai.com/settings/organization/limits)에서 사용량 한도를 확인해주세요.'
      );
    }
    throw err;
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new ExtractionError(`모델이 응답을 반환하지 않았습니다 (배치 ${batchIndex + 1}/${totalBatches}). 다시 시도해주세요.`);
  }

  let batchResult: ExtractionResult;
  try {
    batchResult = JSON.parse(raw) as ExtractionResult;
  } catch {
    throw new ExtractionError(`모델 응답을 JSON으로 파싱하지 못했습니다 (배치 ${batchIndex + 1}/${totalBatches}). 다시 시도해주세요.`);
  }

  return {
    service_name: batchResult.service_name || '',
    screen_scope_name: batchResult.screen_scope_name || '',
    stages: batchResult.stages || [],
  };
}

// Each batch numbers its own stages starting from 1 — renumber sequentially
// across the merged, full-document result (guide format: "1.<n> 제목", n
// incrementing continuously; see lib/ai/guideRules.ts). Call once after the
// last batch has been merged in.
export function finalizeStages(stages: ExtractionResult['stages']): ExtractionResult['stages'] {
  return stages.map((stage, i) => ({
    ...stage,
    stage_name: stage.stage_name.replace(/^\d+(\.\d+)*\.?\s*/, `1.${i + 1} `),
  }));
}
