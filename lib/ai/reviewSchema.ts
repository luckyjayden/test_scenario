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
            screen: { type: 'string', description: "반드시 '[페이지번호] 화면명' 형식. 예: '3 로그인'. 다른 표기 금지." },
            component_type: { type: 'string', description: '예: 버튼, 알럿, placeholder, 안내문구, 토스트' },
            current_text: {
              type: 'string',
              description: '설계서 화면에 실제로 보이는 문구 원문을 한 글자도 바꾸지 않고 그대로 인용. 확인 불가하면 이 항목 자체를 만들지 않는다.',
            },
            issue: { type: 'string', description: '무엇이 왜 부적절한지 (톤앤매너 불일치, 어색한 표현 등 — 일관성 판단은 여기서 하지 않는다)' },
            suggested_text: { type: 'string', description: '대체 문구 제안' },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['screen', 'component_type', 'current_text', 'issue', 'suggested_text', 'severity'],
        },
      },
      component_instances: {
        type: 'array',
        description:
          '이 배치에서 관찰된, 화면 간 비교가 의미 있는 반복 컴포넌트(버튼/알럿/토스트/placeholder 등)의 문구 인스턴스 전부. 이슈 여부와 무관하게 전부 기록한다 — 화면 전체를 다시 살펴본 뒤 일관성만 재판단하는 다음 단계에서 사용되므로, findings에 없는 정상 항목도 반드시 포함한다. 한 화면에 1개만 등장하는 고유 텍스트(본문 설명 등)는 제외.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            screen: { type: 'string', description: "반드시 '[페이지번호] 화면명' 형식." },
            component_type: { type: 'string' },
            text: { type: 'string', description: '설계서에 실제로 보이는 문구 원문 그대로.' },
          },
          required: ['screen', 'component_type', 'text'],
        },
      },
    },
    required: ['findings', 'component_instances'],
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

export type ComponentInstance = {
  screen: string;
  component_type: string;
  text: string;
};

export type CopyReviewBatchResult = {
  findings: CopyFinding[];
  component_instances: ComponentInstance[];
};

export type ConsistencyNote = {
  component_type: string;
  pattern: string;
  consistent: boolean;
  note: string;
};

// Phase 2: a single text-only call sees every component_instance collected
// across every batch at once, so it produces one coherent judgment instead
// of N independently-generated (and sometimes contradictory) per-batch ones.
export const CONSISTENCY_SYNTHESIS_TOOL_NAME = 'submit_consistency_synthesis';

export const CONSISTENCY_SYNTHESIS_SCHEMA = {
  name: CONSISTENCY_SYNTHESIS_TOOL_NAME,
  description: '문서 전체에서 수집된 컴포넌트 문구 인스턴스를 비교해 화면 간 일관성을 판단한 결과를 제출한다.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      consistency_notes: {
        type: 'array',
        description: '2회 이상 등장한 컴포넌트 유형에 대해서만 작성. 1회만 등장한 유형은 판단할 수 없으므로 제외.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            component_type: { type: 'string' },
            pattern: { type: 'string', description: '관찰된 공통 패턴 (예: 확인 버튼은 항상 2어절 명령형)' },
            consistent: { type: 'boolean' },
            note: { type: 'string', description: '불일치하면 어느 화면이 어떻게 다른지 구체적으로 명시.' },
          },
          required: ['component_type', 'pattern', 'consistent', 'note'],
        },
      },
    },
    required: ['consistency_notes'],
  },
} as const;

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

// Also a one-off call (batch 0 only) — without knowing the document's own
// service/app name up front, the per-batch reviewer has no way to tell a
// first-party brand-name button ("땡겨요 로그인" next to "카카오 로그인" etc.)
// apart from genuinely awkward copy, since any single batch might not
// contain the logo/header that would otherwise make the brand obvious.
export const SERVICE_NAME_DETECT_TOOL_NAME = 'submit_service_name';

export const SERVICE_NAME_DETECT_SCHEMA = {
  name: SERVICE_NAME_DETECT_TOOL_NAME,
  description: '화면설계서가 다루는 서비스/앱 자체의 이름을 식별해 제출한다.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      service_name: {
        type: 'string',
        description:
          '로고, 헤더, 타이틀 등에 반복적으로 등장하는 이 문서의 서비스/앱 이름 (예: 땡겨요). 식별할 수 없으면 빈 문자열.',
      },
    },
    required: ['service_name'],
  },
} as const;
