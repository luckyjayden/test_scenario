import OpenAI from 'openai';
import { ExtractionError, PageImage } from './extract';
import {
  COPY_REVIEW_SCHEMA,
  TONE_DETECT_SCHEMA,
  SERVICE_NAME_DETECT_SCHEMA,
  CONSISTENCY_SYNTHESIS_SCHEMA,
  CopyReviewBatchResult,
  ComponentInstance,
  ConsistencyNote,
} from './reviewSchema';
import {
  buildCopyReviewPrompt,
  TONE_DETECT_SYSTEM_PROMPT,
  SERVICE_NAME_DETECT_SYSTEM_PROMPT,
  CONSISTENCY_SYNTHESIS_SYSTEM_PROMPT,
} from './reviewRules';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
// Review is a judgment/consistency task, not a creative one — near-zero
// temperature favors the model repeating what it actually sees over
// plausible-sounding invention, and keeps repeated runs on the same input
// from drifting.
const TEMPERATURE = 0;
// Smaller than the scenario extractor's BATCH_SIZE (12): a review batch's
// output is per-page findings AND a full component_instances inventory
// (reasoning text for every issue, plus every repeatable component whether
// flagged or not) — on a busy real document this hit gpt-4o's ~16k output
// token ceiling mid-response, producing truncated/invalid JSON. Fewer pages
// per batch keeps the response comfortably under that ceiling.
export const REVIEW_BATCH_SIZE = 6;

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } };

function toPageContent(pages: PageImage[], startPage: number): ContentPart[] {
  return pages.flatMap((page, i) => [
    { type: 'text', text: `--- ${startPage + i}페이지 ---` },
    { type: 'image_url', image_url: { url: `data:${page.mime};base64,${page.buffer.toString('base64')}`, detail: 'high' } },
  ]);
}

// One-off call using a representative sample of pages (the first batch) to
// infer an overall tone/manner when the user leaves it blank — used once per
// review run, not per batch, so every batch judges copy against the same
// fixed standard.
export async function detectTone(pages: PageImage[]): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });
  const pageContent = toPageContent(pages, 1);

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: MODEL,
      temperature: TEMPERATURE,
      max_completion_tokens: 500,
      messages: [
        { role: 'system', content: TONE_DETECT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '아래 이미지들의 문구를 보고 톤앤매너를 요약해줘.' },
            ...pageContent,
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: TONE_DETECT_SCHEMA.name, strict: true, schema: TONE_DETECT_SCHEMA.input_schema },
      },
    });
  } catch (err) {
    if (err instanceof OpenAI.RateLimitError) {
      throw new ExtractionError(`OpenAI 요청 한도(또는 크레딧 부족)로 톤앤매너 자동 감지에 실패했습니다: ${err.message}`);
    }
    throw err;
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new ExtractionError('톤앤매너 자동 감지에 실패했습니다 (모델 응답 없음). 톤앤매너를 직접 입력해주세요.');

  try {
    const parsed = JSON.parse(raw) as { has_real_screen: boolean; tone_manner: string };
    // Gate in code, not prompt compliance — discard tone_manner outright
    // when the model itself classified this batch as having no real screen,
    // regardless of what string it also produced (see the schema comment).
    return parsed.has_real_screen ? parsed.tone_manner || '' : '';
  } catch {
    throw new ExtractionError('톤앤매너 자동 감지 응답을 해석하지 못했습니다. 톤앤매너를 직접 입력해주세요.');
  }
}

// One-off call (batch 0 only, like detectTone) so every batch's reviewer
// already knows the document's own brand name up front — a single batch's
// page range might not include the logo/header that would otherwise make it
// obvious (this is what caused a first-party login button, e.g. "땡겨요
// 로그인", to be misjudged as awkward filler copy).
export async function detectServiceName(pages: PageImage[]): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });
  const pageContent = toPageContent(pages, 1);

  // Best-effort: service name isn't required for the review to proceed
  // (unlike tone), so any failure here — including rate limits — just falls
  // back to an empty string rather than failing the whole batch.
  let completion;
  try {
    completion = await client.chat.completions.create({
      model: MODEL,
      temperature: TEMPERATURE,
      max_completion_tokens: 200,
      messages: [
        { role: 'system', content: SERVICE_NAME_DETECT_SYSTEM_PROMPT },
        { role: 'user', content: [{ type: 'text', text: '아래 이미지들에서 서비스/앱 이름을 찾아줘.' }, ...pageContent] },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: SERVICE_NAME_DETECT_SCHEMA.name, strict: true, schema: SERVICE_NAME_DETECT_SCHEMA.input_schema },
      },
    });
  } catch {
    return '';
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw) as { service_name: string };
    return parsed.service_name || '';
  } catch {
    return '';
  }
}

// One raw OpenAI call over a specific, contiguous page range. Split out from
// reviewCopyBatch so a truncated response can retry on a smaller slice of
// the same batch instead of failing the whole batch outright (see below).
async function callReviewRange(params: {
  client: OpenAI;
  pages: PageImage[];
  startPage: number;
  endPage: number;
  totalPages: number;
  toneManner: string;
  serviceName: string;
  label: string; // for error messages, e.g. "배치 2/11" or "배치 2/11의 4~6페이지"
}): Promise<{ result: CopyReviewBatchResult | null; truncated: boolean }> {
  const { client, pages, startPage, endPage, totalPages, toneManner, serviceName, label } = params;

  const instructionText =
    totalPages > pages.length
      ? `이 화면설계서는 여러 배치로 나뉘어 전달되며, 이번 요청에는 ${startPage}~${endPage}페이지(전체 ${totalPages}페이지 중 일부)만 첨부되어 있어. 이 배치에 포함된 화면의 문구만 검수해줘. 화면 간 일관성은 판단하지 마 — component_instances만 빠짐없이 수집해줘.`
      : '이 화면설계서 전체의 문구를 검수해줘. 아래 이미지는 문서의 페이지 순서대로 첨부되어 있어.';

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: MODEL,
      temperature: TEMPERATURE,
      max_completion_tokens: 16000,
      messages: [
        { role: 'system', content: buildCopyReviewPrompt(toneManner, serviceName) },
        { role: 'user', content: [{ type: 'text', text: instructionText }, ...toPageContent(pages, startPage)] },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: COPY_REVIEW_SCHEMA.name, strict: true, schema: COPY_REVIEW_SCHEMA.input_schema },
      },
    });
  } catch (err) {
    if (err instanceof OpenAI.RateLimitError) {
      throw new ExtractionError(`OpenAI 계정의 분당 토큰 사용량 한도를 초과했습니다 (${label} 처리 중). 잠시 후 다시 시도해주세요.`);
    }
    throw err;
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new ExtractionError(`모델이 응답을 반환하지 않았습니다 (${label}). 다시 시도해주세요.`);
  }

  try {
    return { result: JSON.parse(raw) as CopyReviewBatchResult, truncated: false };
  } catch {
    // finish_reason 'length' means the response was cut off mid-JSON by
    // max_completion_tokens — a page with unusually many findings/instances
    // can still hit this even at REVIEW_BATCH_SIZE=6. Report it as truncated
    // rather than throwing here so the caller can retry on a smaller slice.
    if (completion.choices[0]?.finish_reason === 'length') {
      return { result: null, truncated: true };
    }
    throw new ExtractionError(`모델 응답을 JSON으로 파싱하지 못했습니다 (${label}). 다시 시도해주세요.`);
  }
}

// Phase 1 (per batch, vision): extract issues (findings) plus a full
// inventory of repeatable-component instances (component_instances). This
// batch does NOT judge cross-screen consistency — it can only see its own
// pages, so any consistency verdict it made could contradict another
// batch's. That judgment is deferred entirely to synthesizeConsistency below.
export async function reviewCopyBatch(params: {
  pages: PageImage[];
  batchIndex: number;
  totalBatches: number;
  totalPages: number;
  toneManner: string;
  serviceName: string;
}): Promise<CopyReviewBatchResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }

  const { pages, batchIndex, totalBatches, totalPages, toneManner, serviceName } = params;
  const batchStartPage = batchIndex * REVIEW_BATCH_SIZE + 1;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

  // Recursively halves the page range on truncation instead of failing the
  // batch and asking the user to manually split their file — a single
  // unusually dense page (lots of findings/component_instances) no longer
  // takes the whole 6-page batch down with it.
  async function reviewRangeWithSplit(rangePages: PageImage[], startPage: number): Promise<CopyReviewBatchResult> {
    const endPage = startPage + rangePages.length - 1;
    const label =
      totalBatches > 1
        ? `배치 ${batchIndex + 1}/${totalBatches}${rangePages.length < pages.length ? `의 ${startPage}~${endPage}페이지` : ''}`
        : `${startPage}~${endPage}페이지`;

    const { result, truncated } = await callReviewRange({
      client,
      pages: rangePages,
      startPage,
      endPage,
      totalPages,
      toneManner,
      serviceName,
      label,
    });

    if (!truncated) return result as CopyReviewBatchResult;

    if (rangePages.length === 1) {
      throw new ExtractionError(
        `${label}의 응답이 길이 제한으로 계속 잘립니다 (이슈가 유난히 많은 화면으로 보입니다). 해당 페이지만 별도 파일로 나눠서 업로드해주세요.`
      );
    }

    const mid = Math.ceil(rangePages.length / 2);
    // Sequential, not parallel — this only runs on the rare truncation path,
    // and staying sequential avoids adding extra concurrent load right when
    // a batch has already proven to be unusually token-heavy.
    const leftResult = await reviewRangeWithSplit(rangePages.slice(0, mid), startPage);
    const rightResult = await reviewRangeWithSplit(rangePages.slice(mid), startPage + mid);
    return {
      findings: [...leftResult.findings, ...rightResult.findings],
      component_instances: [...leftResult.component_instances, ...rightResult.component_instances],
    };
  }

  return reviewRangeWithSplit(pages, batchStartPage);
}

// Phase 2 (once, text-only — no images, so this is cheap and safe regardless
// of document size): a single call sees every component_instance collected
// across every batch and produces one coherent consistency judgment, instead
// of N independently-generated per-batch verdicts that could disagree with
// each other.
export async function synthesizeConsistency(instances: ComponentInstance[]): Promise<ConsistencyNote[]> {
  if (instances.length === 0) return [];
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }

  // De-dupe exact repeats (the same screen+component+text can appear more
  // than once if it spans a batch boundary or repeats verbatim on a screen).
  const seen = new Set<string>();
  const deduped = instances.filter((inst) => {
    const key = `${inst.screen} ${inst.component_type} ${inst.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    max_completion_tokens: 8000,
    messages: [
      { role: 'system', content: CONSISTENCY_SYNTHESIS_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(deduped) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: CONSISTENCY_SYNTHESIS_SCHEMA.name,
        strict: true,
        schema: CONSISTENCY_SYNTHESIS_SCHEMA.input_schema,
      },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new ExtractionError('일관성 판단에 실패했습니다 (모델 응답 없음).');

  try {
    const parsed = JSON.parse(raw) as { consistency_notes: ConsistencyNote[] };
    return parsed.consistency_notes || [];
  } catch {
    throw new ExtractionError('일관성 판단 응답을 해석하지 못했습니다.');
  }
}
