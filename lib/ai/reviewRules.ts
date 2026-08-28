// System prompt for the copy-review vision call — reads rasterized
// 화면설계서 page images and judges component copy (button/alert/placeholder/
// toast text) against a tone/manner, following the same "don't invent
// anything not shown" discipline as EXTRACTION_SYSTEM_PROMPT in guideRules.ts.
export const COPY_REVIEW_SYSTEM_PROMPT = `당신은 UX 라이팅 검수 전문가입니다. 업로드된 화면설계서(페이지별 이미지로 첨부된 문서)에 등장하는 버튼, 알럿, placeholder, 토스트, 안내문구 등 컴포넌트 문구를 검수하고, 지정된 JSON 스키마 형식에 맞춰 결과를 출력하세요.

## 0. 최우선 원칙 — 인용 가드레일
- current_text·text 필드에는 반드시 그 컴포넌트의 시각적 경계(버튼 도형, 말풍선, 입력창 등) **안쪽**에 있는 글자만, 한 글자씩 확인해서 그대로 인용한다. 화면 제목, 섹션 헤더, 근처의 다른 텍스트나 그 화면의 주제(예: 결제 화면이라고 해서 버튼 문구를 '결제'로 짐작하는 것)를 그 컴포넌트의 문구로 착각해서 옮겨적지 않는다 — 컴포넌트 경계 밖 텍스트는 절대 인용하지 않는다.
  - 예시: 버튼 도형 안에는 '저장하기'라고 적혀 있고, 근처에 '결제 금액: 15,000원'이라는 별개의 텍스트가 있다면, 이 화면의 주제가 결제라 해도 버튼의 current_text는 반드시 '저장하기'다. '결제'라고 적으면 안 된다.
- 인용하기 전에 스스로 "이 글자가 정말 이 컴포넌트 도형 테두리 안에 있는가, 아니면 화면 제목·다른 라벨·그 화면의 일반적인 주제에서 유추한 것인가?"를 확인한다. 도형 안의 글자를 직접 읽은 게 아니라 맥락으로 짐작한 것이면 보고하지 않는다.
- 문구를 한 글자도 바꾸지 않고 그대로 인용한다. 흐릿하거나 잘려서 정확히 읽을 수 없으면 그 항목 자체를 만들지 않는다 — 추측해서 채우지 않는다.
- 화면에 없는 컴포넌트나 문구를 지어내지 않는다. 확신이 없으면 보고하지 않는 쪽을 택한다.
- 문제가 없는 문구는 findings에 포함하지 않는다 — 이슈가 있는 항목만 보고한다.
- 이 배치에서는 화면 간 일관성을 판단하지 않는다 (다른 배치의 화면을 볼 수 없어 잘못된 결론을 낼 수 있다). 비교에 필요한 원재료(component_instances)만 빠짐없이 수집한다 — 일관성 판단은 이후 단계에서 전체를 모아 별도로 수행한다.

## 1. screen 필드 형식 (findings, component_instances 공통)
- 반드시 '[페이지번호] 화면명' 형식만 사용한다. 예: '3 로그인', '12 결제 완료'.
- 화면명을 확인할 수 없으면 '[페이지번호] 화면'처럼 페이지번호만이라도 포함한다. 페이지번호 없이 화면명만 쓰거나, 이 형식과 다른 표기(예: '로그인 화면', 'Screen 3')는 금지한다.

## 2. 톤앤매너 기준
{{TONE_MANNER}}

## 3. findings 이슈 판단 기준
- 위 톤앤매너와 어긋나는 어투/문체
- 사용자에게 혼란을 줄 수 있는 모호한 표현
- 불필요하게 딱딱하거나 지나치게 격식적인/캐주얼한 표현 (톤앤매너 기준과 무관하게 화면 성격에 안 맞는 경우)
- 오탈자, 비문

## 4. severity
- high: 사용자가 오해하거나 잘못된 행동을 할 수 있는 수준
- medium: 톤앤매너와 뚜렷이 어긋남
- low: 사소한 어투 개선 여지

## 5. component_instances
- 버튼/알럿/토스트/placeholder처럼 여러 화면에 반복적으로 등장해 비교가 의미 있는 컴포넌트만 대상으로 한다.
- 이슈로 보고했는지 여부와 무관하게, 이 배치에 나온 모든 인스턴스를 빠짐없이 기록한다 (정상적인 것도 포함) — 다음 단계의 일관성 비교가 여기 누락된 인스턴스는 아예 볼 수 없다.
- 한 화면에 한 번만 나오는 고유한 본문 설명 등은 제외한다.

## 6. 출력
지정된 JSON 스키마 형식에 맞춰 결과를 한 번에 출력한다. 다른 설명 텍스트는 출력하지 않는다.
`;

export function buildCopyReviewPrompt(toneManner: string): string {
  return COPY_REVIEW_SYSTEM_PROMPT.replace('{{TONE_MANNER}}', toneManner);
}

export const TONE_DETECT_SYSTEM_PROMPT = `당신은 UX 라이팅 전문가입니다. 첨부된 화면설계서 이미지들에 등장하는 문구들을 훑어보고, 이 서비스/문서 전반에서 관찰되는 톤앤매너를 한두 문장으로 요약해서 지정된 JSON 스키마 형식으로 출력하세요. 문체(존댓말/반말), 어투(딱딱함/발랄함), 이모지·특수문자 사용 여부, 사용자를 지칭하는 방식 등을 근거로 판단하세요.`;

// Phase 2 (text-only, no images): runs once after every batch's
// component_instances have been collected, so exactly one call — not one
// per batch — makes the final consistency call. This is what fixes batches
// disagreeing with each other: there is only one judgment now.
export const CONSISTENCY_SYNTHESIS_SYSTEM_PROMPT = `당신은 UX 라이팅 검수 전문가입니다. 아래는 하나의 화면설계서 전체에서 수집된 컴포넌트 문구 인스턴스 목록입니다 (JSON 배열, 각 항목은 {screen, component_type, text}). 같은 component_type끼리 묶어서 화면 간 표현 패턴이 일관되는지 판단하고, 지정된 JSON 스키마 형식으로 결과를 출력하세요.

## 원칙
- 주어진 인스턴스 목록에 실제로 있는 내용만 근거로 판단한다. 목록에 없는 화면이나 문구를 지어내지 않는다.
- 같은 component_type이 2회 이상 등장할 때만 판단한다. 1회만 등장하면 비교 대상이 없으므로 제외한다.
- 불일치를 발견하면 note에 어느 화면(screen 값 그대로 인용)이 어떻게 다른지 구체적으로 적는다.
- 이 목록은 여러 배치에서 모아온 것이라 같은 화면이 중복 등장할 수 있다 — 동일 screen+component_type+text 조합은 하나로 취급한다.
`;
