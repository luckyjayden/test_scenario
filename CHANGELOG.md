# 변경 이력

이 프로젝트의 버전별 변경 사항을 기록합니다. [Keep a Changelog](https://keepachangelog.com/) 형식을 따르되, 개인 프로젝트 특성상 날짜/커밋 기준으로 단순화했습니다.

## [1.2.0] - 2026-08-27

### 변경
- PDF 추출을 페이지 12개 단위 배치로 나눠 순차 처리하도록 변경. OpenAI 계정의 분당 토큰 한도(TPM)를 한 번의 요청이 넘어서면(예: Tier 1의 30,000 TPM) 재시도해도 항상 실패하는 문제라, 요청 자체를 잘게 쪼개는 방식으로 해결.
- 배치별 결과를 합친 뒤 시나리오 단계 번호(`1.<n> 제목`)를 전체 문서 기준으로 다시 순서대로 부여.
- 업로드 화면에 배치 진행률("배치 N/M 처리 중")을 1.5초 간격 폴링으로 표시.

### 추가
- `app/api/status/[id]` — 생성 진행 상태(현재 배치/전체 배치) 조회용 엔드포인트.
- `generations` 테이블에 `progress_current`, `progress_total` 컬럼 추가.

## [1.1.6] - 2026-08-27

### 변경
- OpenAI 429(rate limit) 에러 시 SDK 재시도 횟수 증가(`maxRetries: 5`), 재시도로도 실패하면 원인을 명확히 설명하는 한글 에러 메시지로 대체.

## [1.1.5] - 2026-08-27

### 수정
- `pdf-to-img` 문서 객체를 `destroy()`하지 않아 pdfjs 내부 렌더링 버퍼가 요청이 끝날 때까지 메모리에 남아있던 문제 → 배치 렌더링 후 명시적으로 해제.
- 페이지 렌더링을 PNG·scale 2 → JPEG·scale 1.5로 낮춰 메모리 사용량 감소. 페이지 수가 많은 화면설계서에서 발생하던 Vercel 함수 OOM(메모리 초과) 해결.

## [1.1.4] - 2026-08-27

### 수정
- `/history`가 항상 빈 목록을 반환하던 문제. Next.js가 Supabase 클라이언트 내부 `fetch` 호출까지 자동 캐싱해서, 데이터가 없던 초기 시점의 빈 응답이 계속 캐시되어 나오고 있었음 → `cache: 'no-store'` 명시로 해결.
- 생성된 xlsx를 Supabase Storage에 올릴 때 한글 파일명을 그대로 저장 키로 써서 업로드가 거부되던 문제(`Invalid key`) → 저장 키는 ASCII 고정, 실제 한글 파일명은 별도 컬럼(`output_filename`)으로 분리해 재다운로드가 항상 실패하던 것을 해결.

## [1.1.3] - 2026-08-27

### 수정
- `pdf-to-img`가 런타임에 `require.resolve('pdfjs-dist/package.json')`로 참조하는 파일이 Vercel 배포 번들 추적(`@vercel/nft`)에서 빠져 있던 문제 → `outputFileTracingIncludes`로 `pdf-to-img`/`pdfjs-dist` 패키지 전체를 강제 포함.

## [1.1.2] - 2026-08-27

### 수정
- `@napi-rs/canvas`(pdfjs-dist가 PDF 페이지를 렌더링할 때 쓰는 네이티브 캔버스 모듈)가 프로덕션 번들에서 빠져 `DOMMatrix is not defined`로 실패하던 문제 → `serverComponentsExternalPackages`에 추가해 webpack이 네이티브 바이너리를 잘못 번들링하지 않도록 수정.

## [1.1.1] - 2026-08-27

### 변경
- PDF 업로드 방식을 서버 함수 경유(FormData) → 브라우저에서 Supabase Storage로 직접 업로드(서명된 URL)로 변경. Vercel 서버리스 함수의 요청 본문 4.5MB 하드 리밋 때문에 실제 크기의 화면설계서 PDF가 거의 항상 413로 실패하던 문제 해결.
- 새 API 라우트 `app/api/upload-url` 추가, `/api/generate`는 파일 대신 스토리지 경로(`generationId`)를 받도록 변경.
- 다운로드 파일명 한글 깨짐 수정 — 클라이언트가 `X-Output-Filename` 헤더를 디코딩하지 않고 그대로 쓰던 버그, macOS가 한글 파일명을 분해형(NFD) 유니코드로 보고하는 문제(→ NFC 정규화)를 함께 해결.
- 엑셀 내 시나리오 텍스트가 템플릿 예시 행의 기울임/회색 스타일을 그대로 물려받던 것을 고쳐, 새로 생성되는 내용은 항상 검은색·기울임 없이 출력.
- 화면ID가 없을 때의 표기 규칙을 템플릿 가이드 문구(`'[화면명]' 형식`)와 일치하도록 AI 추출 규칙/스키마 통일.

## [1.1.0] - 2026-08-27

### 변경
- 시나리오 추출 엔진을 Anthropic Claude(PDF 네이티브 입력) → OpenAI(`gpt-4o`, PDF를 페이지별 이미지로 변환 후 vision 입력 + structured output)로 전환.
- 환경변수 `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` → `OPENAI_API_KEY`/`OPENAI_MODEL`.

## [1.0.0] - 2026-08-27

### 추가
- 초기 스캐폴딩: 화면설계서(PDF) 업로드 → AI 시나리오 추출 → 고정 서식 엑셀 생성 → Supabase 저장/이력 조회 Next.js 앱.
