import OpenAI from 'openai';
import { pdf } from 'pdf-to-img';
import { EXTRACTION_SCHEMA, EXTRACTION_TOOL_NAME, ExtractionResult } from './schema';
import { EXTRACTION_SYSTEM_PROMPT } from './guideRules';

// Unlike Anthropic, OpenAI's chat models don't read PDFs natively as a
// vision input, so each page is rasterized to a PNG (via pdfjs-dist, no
// native canvas dependency) and sent as a separate image in one request —
// the model sees the same mockup + description-panel layout a human
// reviewer would, one page = one image.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_PDF_BYTES = 32 * 1024 * 1024;
// Not an API-enforced limit (there's no per-request page cap for OpenAI
// vision the way Anthropic caps PDFs at 100 pages) — this is a practical
// ceiling so one request doesn't blow past the model's context window once
// every page becomes a few hundred~1-2k vision tokens each at "high" detail.
const MAX_PAGES = 60;

export class ExtractionError extends Error {}

export async function extractTestScenarios(pdfBuffer: Buffer): Promise<ExtractionResult> {
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

  const pageImages: Buffer[] = [];
  const document = await pdf(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`, {
    scale: 2,
  });
  for await (const page of document) {
    pageImages.push(page);
  }

  if (pageImages.length === 0) {
    throw new ExtractionError('PDF에서 페이지를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해주세요.');
  }
  if (pageImages.length > MAX_PAGES) {
    throw new ExtractionError(
      `페이지 수(${pageImages.length})가 처리 가능한 최대(${MAX_PAGES}페이지)를 초과했습니다. 파일을 분할해서 업로드해주세요.`
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const pageContent = pageImages.flatMap((page, i) => [
    { type: 'text' as const, text: `--- ${i + 1}페이지 ---` },
    {
      type: 'image_url' as const,
      image_url: { url: `data:image/png;base64,${page.toString('base64')}`, detail: 'high' as const },
    },
  ]);

  const completion = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 16000,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '이 화면설계서 전체를 분석해서 테스트 시나리오를 추출해줘. 아래 이미지는 문서의 페이지 순서대로 첨부되어 있어.',
          },
          ...pageContent,
        ],
      },
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

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new ExtractionError('모델이 응답을 반환하지 않았습니다. 다시 시도해주세요.');
  }

  let result: ExtractionResult;
  try {
    result = JSON.parse(raw) as ExtractionResult;
  } catch {
    throw new ExtractionError('모델 응답을 JSON으로 파싱하지 못했습니다. 다시 시도해주세요.');
  }

  if (!result.stages || result.stages.length === 0) {
    throw new ExtractionError(
      '화면설계서에서 유효한 화면(시나리오 단계)을 찾지 못했습니다. 업로드한 파일이 실제 화면 설계 슬라이드를 포함하는지 확인해주세요.'
    );
  }

  return result;
}
