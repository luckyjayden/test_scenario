// JSON schema for the structured output the extraction call must return.
// Mirrors the JSON intermediate format defined in the process guide
// (테스트시나리오_생성_가이드): one entry per 시나리오 단계, each with an
// ordered list of functional-unit test steps.
export const EXTRACTION_TOOL_NAME = 'submit_test_scenarios';

export const EXTRACTION_SCHEMA = {
  name: EXTRACTION_TOOL_NAME,
  description:
    '화면설계서 분석 결과로 도출한 테스트 시나리오 전체를 제출한다.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      service_name: {
        type: 'string',
        description: '화면설계서에서 확인되는 서비스/앱 이름 (예: 땡겨요). 확인 불가하면 빈 문자열.',
      },
      screen_scope_name: {
        type: 'string',
        description: '이 화면설계서가 다루는 기능 범위 이름 (예: 로그인/회원가입). 확인 불가하면 빈 문자열.',
      },
      stages: {
        type: 'array',
        description: '시나리오 단계 목록. 순번(1.1, 1.2 ...) 순서대로.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stage_name: {
              type: 'string',
              description: "'[순번]. [화면/슬라이드 제목]' 형식. 예: '1.1 로그인 진입'",
            },
            rows: {
              type: 'array',
              description: '이 단계에 속한 기능 단위 테스트 스텝들. 최소 3개 이상 권장(정말 단순한 화면은 예외).',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  page: {
                    type: 'string',
                    description: "'[화면ID]  [화면명]' 형식(화면ID와 화면명 사이 공백 2칸). 화면ID가 없으면 '[화면명]' 형식으로 표기한다.",
                  },
                  step: {
                    type: 'string',
                    description: '능동태·현재형의 한 문장. 예: "로그인 버튼을 터치한다."',
                  },
                  results: {
                    type: 'array',
                    description:
                      "이 스텝의 기대 결과 항목들. 정상 케이스 + 관련 예외 케이스. 설계서에 없는 내용은 지어내지 말고 '[추가 확인 필요]'로 시작하는 항목으로 표기.",
                    items: { type: 'string' },
                    minItems: 1,
                  },
                },
                required: ['page', 'step', 'results'],
              },
            },
          },
          required: ['stage_name', 'rows'],
        },
      },
    },
    required: ['service_name', 'screen_scope_name', 'stages'],
  },
} as const;

export type ExtractedRow = {
  page: string;
  step: string;
  results: string[];
};

export type ExtractedStage = {
  stage_name: string;
  rows: ExtractedRow[];
};

export type ExtractionResult = {
  service_name: string;
  screen_scope_name: string;
  stages: ExtractedStage[];
};
