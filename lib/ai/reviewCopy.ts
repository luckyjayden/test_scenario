import OpenAI from 'openai';
import { ExtractionError, PageImage, BATCH_SIZE } from './extract';
import { COPY_REVIEW_SCHEMA, TONE_DETECT_SCHEMA, CopyReviewBatchResult, ConsistencyNote } from './reviewSchema';
import { buildCopyReviewPrompt, TONE_DETECT_SYSTEM_PROMPT } from './reviewRules';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

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

  const completion = await client.chat.completions.create({
    model: MODEL,
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

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new ExtractionError('톤앤매너 자동 감지에 실패했습니다 (모델 응답 없음). 톤앤매너를 직접 입력해주세요.');

  try {
    const parsed = JSON.parse(raw) as { tone_manner: string };
    return parsed.tone_manner || '';
  } catch {
    throw new ExtractionError('톤앤매너 자동 감지 응답을 해석하지 못했습니다. 톤앤매너를 직접 입력해주세요.');
  }
}

export async function reviewCopyBatch(params: {
  pages: PageImage[];
  batchIndex: number;
  totalBatches: number;
  toneManner: string;
}): Promise<CopyReviewBatchResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ExtractionError(
      'OPENAI_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 OpenAI API 키를 추가해주세요.'
    );
  }

  const { pages, batchIndex, totalBatches, toneManner } = params;
  const startPage = batchIndex * BATCH_SIZE + 1;
  const endPage = startPage + pages.length - 1;

  const instructionText =
    totalBatches > 1
      ? `이 화면설계서는 여러 배치로 나뉘어 전달되며, 이번 요청에는 ${startPage}~${endPage}페이지(총 ${totalBatches}개 배치 중 ${batchIndex + 1}번째)만 첨부되어 있어. 이 배치에 포함된 화면의 문구만 검수해줘.`
      : '이 화면설계서 전체의 문구를 검수해줘. 아래 이미지는 문서의 페이지 순서대로 첨부되어 있어.';

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });

  let completion;
  try {
    completion = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 16000,
      messages: [
        { role: 'system', content: buildCopyReviewPrompt(toneManner) },
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
    throw new ExtractionError(`모델 응답을 JSON으로 파싱하지 못했습니다 (배치 ${batchIndex + 1}/${totalBatches}). 다시 시도해주세요.`);
  }
}

// Batches produce independent consistency_notes since each only sees its own
// pages — merge by component_type: if every batch that mentions a type
// agrees it's consistent, keep it consistent; a single disagreement across
// batches means the pattern doesn't hold document-wide.
export function mergeConsistencyNotes(notes: ConsistencyNote[]): ConsistencyNote[] {
  const byType = new Map<string, ConsistencyNote[]>();
  for (const note of notes) {
    const list = byType.get(note.component_type) || [];
    list.push(note);
    byType.set(note.component_type, list);
  }

  return [...byType.entries()].map(([component_type, group]) => {
    const allConsistent = group.every((n) => n.consistent);
    return {
      component_type,
      pattern: group[0].pattern,
      consistent: allConsistent,
      note: allConsistent
        ? group[0].note
        : `배치별 관찰이 엇갈립니다: ${group.map((n) => n.note).join(' / ')}`,
    };
  });
}
