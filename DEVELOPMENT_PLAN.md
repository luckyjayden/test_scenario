# 검수하기(Review) 기능 개발 계획

> 기존 "테스트 시나리오 생성기" 웹앱(`/Users/vinylc/Documents/project/app`, Next.js 14 App Router +
> OpenAI API + Supabase)은 이미 구현되어 정상 동작 중이고, `OPENAI_API_KEY`·`SUPABASE_SERVICE_ROLE_KEY`
> 등 필요한 환경변수도 이미 설정되어 있다. 이 문서는 **그 위에 추가하는 검수하기 기능**만을
> 대상으로 하며, 기존 시나리오 생성 기능 자체는 변경 범위에 포함하지 않는다. CLI 환경(Claude
> Code 등)에서 바로 구현을 시작할 수 있도록 아키텍처·데이터 모델·API 계약·작업 순서를
> 정리한 실행 계획서다.

## 구현 현황 (2026-08-28)

- **완료**: Phase 0(네비게이션/라우트 골격), Phase 1~2(`review_runs` 테이블, Tab 1 문구 검수 업로드→API→리포트, 톤앤매너 입력/자동감지), Phase 6 일부(`/history`에 검수 이력 탭 추가).
- 아래 §1~§8의 원안과 달리, PDF/이미지 검수도 시나리오 생성기에서 겪은 메모리·타임아웃 이슈를 피하기 위해 **배치(12페이지) 단위 재개형 처리**(`app/api/review/copy`, `progress_current`/`review_partial`)로 구현했다 — 문서 하나를 한 번의 요청에서 통째로 처리하지 않는다.
- 톤앤매너 자동 감지는 "문서 전체"가 아니라 **첫 번째 배치(최대 12페이지)를 대표 샘플로** 사용해 한 번만 수행하고, 이후 모든 배치에 동일하게 적용한다 (배치마다 다시 감지하면 배치 간 기준이 어긋날 수 있음).
- **미착수**: Phase 3~5 (Figma 연동, 레이아웃 일관성 판단, 플러그인용 API/다운로드 UI) — §9의 확정 필요 항목이 아직 정리되지 않았다.

---

## 0. 요구사항 요약 (사용자 확정 사항)

- 기존 앱에 **검수하기** 탭 추가, 그 아래 서브탭 2개
  1. **문구 검수**: PDF·이미지 파일 업로드 → 컴포넌트(버튼/알럿/placeholder 등) 문구
     적절성 판단 + 대체 문구 제안
  2. **디자인 연동 검수**: Figma 파일 연동 → 문구 적절성 **+ 화면 내 위치/레이아웃
     일관성**을 좌표 기반으로 함께 판단
- 두 서브탭 공통: **톤앤매너를 사용자가 직접 입력**할 수 있어야 함(선택 입력).
  미입력 시 업로드된 문서 전체를 분석해 자동으로 톤앤매너를 판단해 사용.
- **Figma 플러그인은 별도로 개발**한다. 앱 본체(웹)는 플러그인을 만들지 않고,
  "디자인 연동 검수" 탭 화면에서 완성된 플러그인을 **다운로드해서 쓸 수 있도록 제공**만 한다.
- 새 기능의 LLM 호출도 기존 앱과 동일하게 **OpenAI API(`OPENAI_API_KEY`)**를 그대로
  사용한다 — 별도 키 발급이나 SDK 추가 설정이 필요 없다.

이 네 가지가 확정 요구사항이고, 그 외 세부 구현 방식(§9)은 이번 계획에서 잠정 결정하되
착수 직전 재확인이 필요한 항목으로 별도 표시했다.

---

## 1. 기존 앱에서 재사용할 것

| 기존 자산 | 위치 | 검수 기능에서의 재사용 방식 |
|---|---|---|
| OpenAI Responses API PDF 파일 입력 + Structured Outputs 패턴 | `lib/ai/extract.ts`, `lib/ai/schema.ts` | 동일 패턴으로 `lib/ai/reviewCopy.ts`, `lib/ai/reviewSchema.ts` 신설 |
| 프롬프트 규칙 분리 방식 | `lib/ai/guideRules.ts` | `lib/ai/reviewRules.ts`로 톤앤매너·검수 기준 프롬프트 분리 |
| Supabase 클라이언트 | `lib/supabase.ts` | 그대로 재사용 |
| 업로드 폼 → API → 결과 다운로드/저장 흐름 | `app/page.tsx`, `app/api/generate/route.ts` | 동일 흐름을 검수용으로 복제 (엑셀 대신 웹 리포트가 1차 산출물이라는 점만 다름) |
| 이력 테이블/페이지 패턴 | `supabase/schema.sql`(`generations`), `app/history/page.tsx` | `review_runs` 테이블 + `/history`에 탭 추가해 통합 |
| **`copy-audit.html` POC 리포트의 비주얼 시스템** | 이번 대화에서 만든 아티팩트 | 문구/레이아웃 리포트 화면(React)의 카드·톤 요약·일관성 표 디자인을 그대로 컴포넌트화 |

---

## 2. 정보구조(IA) / 라우팅

```
/                     기존 "시나리오 생성" (변경 없음)
/history              기존 이력 (탭 추가: 시나리오 생성 | 검수하기)
/review               검수하기 진입 (서브탭 라우팅)
  /review/copy         Tab 1. 문구 검수 (업로드형)
  /review/figma         Tab 2. 디자인 연동 검수 (Figma형)
/review/[runId]        검수 1건의 결과 리포트 상세 화면 (Tab 공통)
```

최상위 네비게이션(현재 헤더가 없다면 `app/layout.tsx`에 신설)에 **시나리오 생성 / 검수하기 / 이력**
3개 메뉴, `/review` 진입 시 그 안에 **문구 검수 / 디자인 연동 검수** 2개 서브탭.

---

## 3. 데이터 모델 확장 (Supabase)

기존 `generations` 테이블은 건드리지 않고 검수 전용 테이블을 신설한다 (관심사 분리, 마이그레이션 리스크 최소화).

```sql
-- supabase/migrations/xxxx_review_runs.sql

create table if not exists public.review_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  source_type text not null,              -- 'upload' | 'figma'
  source_filename text,                   -- upload: 원본 파일명
  figma_file_key text,                    -- figma: 파일 key (URL에서 추출)
  figma_node_id text,                     -- figma: 특정 프레임/페이지로 범위를 좁힌 경우

  tone_manner_input text,                 -- 사용자가 직접 입력한 톤앤매너 (없으면 null)
  tone_manner_detected text,              -- 자동 감지된 톤앤매너 요약 (input이 없을 때 채움)

  status text not null default 'processing', -- processing | success | failed
  error_message text,

  finding_count integer,
  layout_issue_count integer,             -- figma 타입에서만 사용

  result_json jsonb,                      -- reviewSchema 구조 그대로 저장 (리포트 재렌더링용)
  source_file_path text,                  -- upload 원본을 스토리지에 보관할 경우 경로

  updated_at timestamptz not null default now()
);

create index if not exists review_runs_created_at_idx on public.review_runs (created_at desc);

alter table public.review_runs enable row level security;

-- 개인용 단일 사용자 도구 전제 (기존 generations 테이블과 동일한 정책)
create policy "allow all to anon" on public.review_runs
  for all using (true) with check (true);
```

스토리지는 기존 `test-scenario-files` 버킷을 재사용하거나, 파일 성격이 다르므로
`review-files` 버킷을 새로 만드는 것을 권장 (업로드 원본 PDF/이미지 + Figma 스크린샷 캐시 보관).

---

## 4. Tab 1 — 문구 검수 (PDF·이미지 업로드)

### 흐름

1. 사용자가 PDF 또는 이미지(1장 이상) 업로드, 톤앤매너 텍스트 입력(선택)
2. **톤앤매너 미입력 시**: 별도 OpenAI 호출로 문서 전체를 훑어 톤앤매너를 먼저 요약
   (예: "짧고 발랄한 반말체, 이모지 사용 없음, 금융 안내는 존댓말 유지" 등) →
   `tone_manner_detected`에 저장하고 이후 검수 프롬프트의 기준으로 사용
3. 본 검수 호출: 문서 전체 + (입력 또는 감지된) 톤앤매너를 시스템 프롬프트에 포함해
   컴포넌트별 문구 적절성 판단 + 대체 문구 제안을 구조화 출력으로 받음
4. 결과를 `review_runs`에 저장하고 `/review/[runId]`에서 리포트 렌더링

### 구조화 출력 스키마 (신설: `lib/ai/reviewSchema.ts`)

`lib/ai/schema.ts`의 `EXTRACTION_SCHEMA` 패턴(OpenAI Structured Outputs, strict 모드)을
그대로 따른다. strict 모드 제약(모든 속성 `required`에 포함, 모든 object에
`additionalProperties: false`, `minItems` 등 배열 길이 제약 불가)도 동일하게 적용된다.

```ts
export const COPY_REVIEW_SCHEMA_NAME = 'copy_review';

export const COPY_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tone_manner_detected: {
      type: 'string',
      description: '문서 전체에서 자동 감지한 톤앤매너 요약. 사용자가 톤앤매너를 직접 입력한 경우 빈 문자열.',
    },
    findings: {
      type: 'array',
      description: '문구 적절성 이슈 목록. 문제 없는 항목은 포함하지 않는다.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          screen: { type: 'string', description: "'[화면ID] 화면명' 형식" },
          component_type: { type: 'string', description: '예: 버튼, 알럿, placeholder, 안내문구' },
          current_text: { type: 'string', description: '현재 문구 원문 (설계서에서 그대로 인용)' },
          issue: { type: 'string', description: '무엇이 왜 부적절한지 (톤앤매너 불일치, 어색한 표현, 일관성 위반 등)' },
          suggested_text: { type: 'string', description: '대체 문구 제안' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['screen', 'component_type', 'current_text', 'issue', 'suggested_text', 'severity'],
      },
    },
    consistency_summary: {
      type: 'array',
      description: '동일 컴포넌트 유형의 문구 패턴이 화면 간 잘 지켜지고 있는지 요약 (표 형태 렌더링용)',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          component_type: { type: 'string' },
          pattern: { type: 'string', description: '관찰된 공통 패턴' },
          consistent: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['component_type', 'pattern', 'consistent', 'note'],
      },
    },
  },
  required: ['tone_manner_detected', 'findings', 'consistency_summary'],
} as const;
```

`extractTestScenarios`와 동일하게 Responses API 호출의 `input` 배열에 `input_file`
블록(base64 PDF, `lib/ai/extract.ts` 참고)이나 `input_image` 블록(`image_url`에
`data:image/png;base64,...` 형태의 data URI)을 넣어 호출한다. 이미지가 여러 장이면
`content` 배열에 순서대로 추가하면 된다.

---

## 5. Tab 2 — 디자인 연동 검수 (Figma 연동)

### 인증 방식 (잠정 결정 — §9에서 재확인)

**Figma Personal Access Token(PAT) 직접 입력** 방식으로 시작한다. OAuth 앱 등록보다 구현이
훨씬 단순하고, 개인/소규모 팀 도구 성격에 맞는다. 사용자가 Figma 계정 설정에서 PAT를 발급해
연동 화면에 붙여넣으면, 서버(API route)에서만 사용하고 클라이언트에는 내려주지 않는다.
(암호화 저장이 필요하면 Supabase에 별도 `figma_tokens` 테이블 + 서버사이드 암복호화를 추후 추가.
MVP는 세션/요청 단위로만 사용하고 저장하지 않는 것도 선택지.)

### 흐름

1. 사용자가 Figma 파일 URL(또는 file key) 입력 + PAT 입력(최초 1회, 세션에 보관) + 톤앤매너 입력(선택)
2. 서버에서 Figma REST API `GET /v1/files/:file_key` (또는 특정 페이지만 필요하면
   `GET /v1/files/:file_key/nodes?ids=...`)로 문서 트리 가져오기
3. 트리를 순회하며 다음을 추출:
   - `type: "TEXT"` 노드 → `characters`(문구), `absoluteBoundingBox`(x, y, width, height), 상위 프레임(화면) 정보
   - 버튼/CTA/팝업 등으로 볼 수 있는 컴포넌트 인스턴스 노드 → `componentId`, `name`, `absoluteBoundingBox`
4. **문구 적절성 판단**: Tab 1과 동일 스키마·로직 재사용 (텍스트 노드 목록 + 톤앤매너를 프롬프트에 구성해 전달)
5. **위치/레이아웃 일관성 판단** (신규 로직, LLM 호출이 아니라 우선 **결정적 규칙 기반 계산**으로 구현 권장):
   - 컴포넌트 그룹핑: `componentId`가 같거나 `name`이 같은 패턴(예: "back_button", "popup_close")인
     노드들을 화면(최상위 프레임) 단위로 그룹핑
   - 각 그룹 내에서 부모 프레임 기준 상대 좌표로 정규화: `rel_x = (x - frame.x) / frame.width` 등
   - 그룹 내 상대 좌표의 표준편차/최대편차가 임계값(예: 프레임 너비의 2%)을 넘으면 "위치 불일치" 플래그
   - 편차가 발견된 항목만 LLM에 다시 넘겨 사람이 읽을 설명 문장(예: "3번 화면의 뒤로가기 버튼이
     다른 화면보다 12px 아래에 위치")을 생성 — 좌표 계산 자체는 LLM에 맡기지 않는다 (환각 방지, 재현성 확보)
6. 문구 findings + 레이아웃 findings를 통합한 리포트로 저장/렌더링, 각 항목에 **Figma node ID**를 포함
   (플러그인이 해당 노드로 바로 이동/선택할 수 있도록)

### 레이아웃 검토 결과 스키마 (신설: 위 `reviewSchema.ts`에 추가)

```ts
export type LayoutFinding = {
  component_group: string;        // 예: "뒤로가기 버튼"
  frame_name: string;             // 이슈가 발견된 화면명
  node_id: string;                // Figma node ID (플러그인 연동용)
  expected_position: { x: number; y: number };   // 그룹 내 기준값(중앙값)
  actual_position: { x: number; y: number };
  deviation_px: number;
  description: string;            // LLM이 생성한 설명 문장
};
```

### 코드 위치

- `lib/figma/client.ts` — Figma REST API 호출 래퍼 (`getFile`, `getFileNodes`)
- `lib/figma/extractNodes.ts` — 트리 순회 → TEXT/컴포넌트 노드 평탄화
- `lib/figma/layoutConsistency.ts` — 그룹핑 + 좌표 편차 계산 (순수 함수, 유닛 테스트 용이)
- `lib/ai/reviewCopy.ts` — Tab 1/2 공통 문구 판단 호출 (입력 소스만 PDF or 텍스트 노드 배열로 분기)

---

## 6. 톤앤매너 입력 UI (공통 컴포넌트)

`components/ToneMannerInput.tsx` 하나를 만들어 두 탭에서 공용으로 쓴다.

- `<textarea>` + placeholder: "예: 짧고 발랄한 반말체, 사용자를 '고객님'으로 지칭하지 않음.
  비워두면 업로드한 문서 전체를 분석해 자동으로 판단합니다."
- 값이 비어 있으면 API에 `tone_manner_input: null`로 전달 → 서버에서 자동 감지 단계 실행 →
  응답의 `tone_manner_detected`를 리포트 상단에 "자동 감지된 톤앤매너"로 표시 (기존
  `copy-audit.html`의 `#tone` 섹션과 동일한 자리)
- 값이 있으면 그대로 프롬프트에 고정 기준으로 삽입, 리포트 상단에는 "적용된 톤앤매너(사용자 지정)"로 표시

---

## 7. Figma 플러그인 (별도 개발 — 이 앱 리포지토리 밖)

**결정 사항: 웹앱은 플러그인을 만들지 않는다.** 웹앱의 역할은 (a) 검수 결과를 만들어 API로
제공하는 것, (b) "디자인 연동 검수" 탭에 완성된 플러그인 배포물(zip 또는 설치 안내)을
다운로드할 수 있게 두는 것, 두 가지뿐이다. 플러그인 자체 구현은 별도 리포지토리
(`figma-review-plugin/`)에서 독립적으로 진행한다.

### 웹앱에서 준비해야 할 것 (이번 계획의 범위)

- `/review/figma` 화면에 "플러그인 다운로드" 카드: 배포 zip 링크(또는 Figma Community/조직 배포
  링크) + 설치 안내(레이어 → 플러그인 → 개발 → 매니페스트 가져오기) 텍스트
- 플러그인이 검수 결과를 가져올 수 있는 **읽기 전용 API 엔드포인트** 신설:
  `GET /api/review/[runId]` → `result_json` 그대로 반환 (플러그인 UI thread에서 fetch)
  - 플러그인 manifest의 `networkAccess.allowedDomains`에 이 앱의 배포 도메인을 등록해야 하므로,
    엔드포인트 경로/도메인이 확정되면 플러그인 쪽에 전달 필요
- 사용자가 플러그인에 어떤 검수 결과를 불러올지 지정할 수 있도록, 리포트 화면에 **runId를
  복사할 수 있는 버튼** 제공 (플러그인 UI에 runId 입력 → 해당 결과 fetch)

### 플러그인 쪽 참고 (별도 리포지토리 착수 시)

- `create-figma-plugin` 스캐폴딩 사용 권장
- `code.ts`(메인 스레드, `figma.*` API로 노드 탐색/수정) + `ui.html`(runId 입력, findings
  목록 표시, 항목별 "적용"/"건너뛰기")
- 텍스트 교체 전 `await figma.loadFontAsync(node.fontName)` 필수
- 좌표 이동은 `node.x`, `node.y` 직접 대입 (Auto Layout 프레임 내부 노드는 좌표 대신 순서/패딩
  속성을 조정해야 할 수 있음 — 실제 파일 구조 확인 후 분기 처리)
- 배포는 우선 Figma "Development" 상태로 팀 공유(심사 없음)로 시작

---

## 8. 개발 순서 (Phase)

| Phase | 내용 | 산출물 |
|---|---|---|
| 0 | 상위 네비게이션 추가, `/review` 라우트 골격(빈 페이지 2개) | 탭 이동만 가능한 상태 |
| 1 | `review_runs` 마이그레이션 + Tab 1(문구 검수) 업로드 폼 → API → 리포트 화면 | 문구 검수 단독 동작 |
| 2 | 톤앤매너 입력 컴포넌트 + 자동 감지 로직을 Tab 1에 통합 | 톤앤매너 입력/자동감지 반영 |
| 3 | Figma REST API 클라이언트 + 노드 추출 + Tab 2 문구 판단(레이아웃 제외) | Figma 연동 문구 검수 동작 |
| 4 | 좌표 정규화·그룹핑·편차 계산(레이아웃 판단 로직) + 통합 리포트 | Tab 2 완성 (문구+레이아웃) |
| 5 | `/api/review/[runId]` 읽기 전용 엔드포인트 + 플러그인 다운로드 카드 UI | 플러그인 연동 준비 완료 |
| 6 | 이력(`/history`) 페이지에 검수 이력 탭 추가, 통합 QA | 배포 준비 완료 |

(플러그인 자체 개발은 이 Phase들과 별도 트랙으로 병행 가능 — Phase 5의 API 계약만 먼저
확정해서 공유하면 됨.)

---

## 9. 착수 전 재확인이 필요한 항목

- **Figma 인증**: PAT 직접 입력(위 잠정안)으로 확정할지, 처음부터 OAuth로 갈지
- **레이아웃 판단 대상 컴포넌트 정의**: 노드 이름 패턴 매칭으로 자동 그룹핑할지, 아니면
  Figma 파일에 이미 컴포넌트/컴포넌트 세트가 잘 정리되어 있다는 전제로
  `componentId` 기준만 쓸지 (전자가 더 유연하지만 오탐 가능성 있음)
- **편차 임계값**: "위치 불일치"로 플래그할 기준(프레임 너비의 몇 %, 또는 절대 px)
- **플러그인 배포 범위**: 조직 내부 전용(Development 공유)인지, 나중에 Figma Community
  공개까지 염두에 두는지 (배포 방식·심사 여부가 달라짐)
- **`review-files` 스토리지 버킷 신설 여부** vs 기존 `test-scenario-files` 재사용

이 5가지만 확정되면 위 Phase 순서대로 바로 구현 착수 가능.
