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

// Phase 1 (per batch, vision): extract issues (findings) plus a full
// inventory of repeatable-component instances (component_instances). This
// batch does NOT judge cross-screen consistency — it can only see its own
// pages, so any consistency verdict it made could contradict another
// batch's. That judgment is deferred entirely to synthesizeConsistency below.
export async function reviewCopyBatch(params: {
  pages: PageImage[];
  batchIndex: number;
  totalBatches: number;
  toneManner: string;
  serviceName: string;
}): Promise<CopyReviewBatchResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }

  const { pages, batchIndex, totalBatches, toneManner, serviceName } = params;
  const startPage = batchIndex * REVIEW_BATCH_SIZE + 1;
  const endPage = startPage + pages.length - 1;

  const instructionText =
    totalBatches > 1
      ? `이 화면설계서는 여러 배치로 나뉘어 전달되며, 이번 요청에는 ${startPage}~${endPage}페이지(총 ${totalBatches}개 배치 중 ${batchIndex + 1}번째)만 첨부되어 있어. 이 배치에 포함된 화면의 문구만 검수해줘. 화면 간 일관성은 판단하지 마 — component_instances만 빠짐없이 수집해줘.`
      : '이 화면설계서 전체의 문구를 검수해줘. 아래 이미지는 문서의 페이지 순서대로 첨부되어 있어.';

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

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
      throw new ExtractionError(
        `OpenAI 계정의 분당 토큰 사용량 한도를 초과했습니다 (배치 ${batchIndex + 1}/${totalBatches} 처리 중). 잠시 후 다시 시도해주세요.`
      );
    }
    throw err;
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new ExtractionError(`모델이 응답을 반환하지 않았습니다 (배치 ${batchIndex + 1}/${totalBatches}). 다시 시도해주세요.`);
  }

  try {
    return JSON.parse(raw) as CopyReviewBatchResult;
  } catch {
    // finish_reason 'length' means the response was cut off mid-JSON by
    // max_completion_tokens — a busy page with many findings can still hit
    // this even at REVIEW_BATCH_SIZE=6, so surface it distinctly from a
    // genuine malformed-output case.
    if (completion.choices[0]?.finish_reason === 'length') {
      throw new ExtractionError(
        `이 배치(${batchIndex + 1}/${totalBatches})의 응답이 길이 제한으로 잘렸습니다. 재시도해도 반복되면 화면 수가 적은 파일로 나눠서 업로드해주세요.`
      );
    }
    throw new ExtractionError(`모델 응답을 JSON으로 파싱하지 못했습니다 (배치 ${batchIndex + 1}/${totalBatches}). 다시 시도해주세요.`);
  }
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
