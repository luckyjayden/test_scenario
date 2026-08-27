import Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_SCHEMA, EXTRACTION_TOOL_NAME, ExtractionResult } from './schema';
import { EXTRACTION_SYSTEM_PROMPT } from './guideRules';

// Claude's native PDF support reads both the text AND the visual layout of
// each page (mockup image + description panel), so we send the whole PDF as
// a single document block instead of rasterizing pages ourselves — this is
// the same thing a human reviewer does when reading the 화면설계서 slide by
// slide, just done in one API call instead of four manual batches.
//
// Known limits (Anthropic API, as of writing): ~100 pages / 32MB per PDF.
// A screen-design doc larger than that needs to be split before upload —
// this MVP does not auto-chunk large PDFs.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_PDF_BYTES = 32 * 1024 * 1024;

export class ExtractionError extends Error {}

export async function extractTestScenarios(pdfBuffer: Buffer): Promise<ExtractionResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionError(
      'ANTHROPIC_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트 환경변수에 본인의 Anthropic API 키를 추가해주세요.'
    );
  }
  if (pdfBuffer.byteLength > MAX_PDF_BYTES) {
    throw new ExtractionError(
      `PDF 용량(${(pdfBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)이 처리 가능한 최대 크기(32MB)를 초과했습니다. 파일을 분할해서 업로드해주세요.`
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: [EXTRACTION_SCHEMA as unknown as Anthropic.Tool],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: '이 화면설계서 전체를 분석해서 테스트 시나리오를 추출하고 submit_test_scenarios 도구를 호출해줘.',
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === EXTRACTION_TOOL_NAME
  );

  if (!toolUse) {
    throw new ExtractionError('모델이 예상된 도구 호출을 반환하지 않았습니다. 다시 시도해주세요.');
  }

  const result = toolUse.input as ExtractionResult;

  if (!result.stages || result.stages.length === 0) {
    throw new ExtractionError(
      '화면설계서에서 유효한 화면(시나리오 단계)을 찾지 못했습니다. 업로드한 파일이 실제 화면 설계 슬라이드를 포함하는지 확인해주세요.'
    );
  }

  return result;
}
