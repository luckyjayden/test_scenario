// JSON schema for the copy-review structured output. Mirrors the
// EXTRACTION_SCHEMA pattern in lib/ai/schema.ts (OpenAI Structured Outputs,
// strict mode: every property required, every object additionalProperties:
// false, no minItems/maxItems on arrays).
export const COPY_REVIEW_TOOL_NAME = 'submit_copy_review';

export const COPY_REVIEW_SCHEMA = {
  name: COPY_REVIEW_TOOL_NAME,
  description: '화면설계서의 컴포넌트 문구를 검수한 결과를 제출한다.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      findings: {
        type: 'array',
        description: '문구 적절성 이슈 목록. 문제 없는 항목은 포함하지 않는다.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            screen: { type: 'string', description: "'[화면ID] 화면명' 형식. 화면ID가 없으면 화면명만." },
            component_type: { type: 'string', description: '예: 버튼, 알럿, placeholder, 안내문구, 토스트' },
            current_text: { type: 'string', description: '현재 문구 원문 (설계서에서 그대로 인용)' },
            issue: { type: 'string', description: '무엇이 왜 부적절한지 (톤앤매너 불일치, 어색한 표현, 일관성 위반 등)' },
            suggested_text: { type: 'string', description: '대체 문구 제안' },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['screen', 'component_type', 'current_text', 'issue', 'suggested_text', 'severity'],
        },
      },
      consistency_notes: {
        type: 'array',
        description:
          '동일 컴포넌트 유형의 문구 패턴이 이 배치에 포함된 화면들 사이에서 일관되는지 관찰한 내용. 패턴이 나타나지 않으면 빈 배열.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            component_type: { type: 'string' },
            pattern: { type: 'string', description: '관찰된 공통 패턴 (예: 버튼은 항상 2어절 명령형)' },
            consistent: { type: 'boolean' },
            note: { type: 'string' },
          },
          required: ['component_type', 'pattern', 'consistent', 'note'],
        },
      },
    },
    required: ['findings', 'consistency_notes'],
  },
} as const;

export type CopyFinding = {
  screen: string;
  component_type: string;
  current_text: string;
  issue: string;
  suggested_text: string;
  severity: 'high' | 'medium' | 'low';
};

export type ConsistencyNote = {
  component_type: string;
  pattern: string;
  consistent: boolean;
  note: string;
};

export type CopyReviewBatchResult = {
  findings: CopyFinding[];
  consistency_notes: ConsistencyNote[];
};

// Separate, minimal schema for the one-off tone-detection call (only used
// when the user leaves tone/manner blank) — kept as its own strict schema
// rather than a free-text completion so the response is reliably parseable.
export const TONE_DETECT_TOOL_NAME = 'submit_tone_manner';

export const TONE_DETECT_SCHEMA = {
  name: TONE_DETECT_TOOL_NAME,
  description: '화면설계서 문구에서 관찰되는 톤앤매너를 요약해 제출한다.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tone_manner: {
        type: 'string',
        description:
          "관찰된 톤앤매너를 한두 문장으로 요약 (예: '짧고 발랄한 반말체, 이모지 사용 없음, 오류 상황은 존댓말 유지').",
      },
    },
    required: ['tone_manner'],
  },
} as const;
