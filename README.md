# 테스트 시나리오 생성기 (웹앱)

화면설계서(PPT를 PDF로 변환한 파일)를 업로드하면, 내부 QA 가이드 규칙을 그대로 따라 테스트 시나리오를 추출하고
고정 서식(`assets/template.xlsx`)에 맞춘 엑셀(.xlsx)을 생성해 바로 다운로드해주는 Next.js 앱입니다.
생성 결과(메타데이터 + 원본 PDF + 결과 xlsx)는 Supabase에 저장되어 `/history` 페이지에서 다시 받을 수 있습니다.

## 구조

- `app/page.tsx` — 업로드 화면
- `app/history/page.tsx` — 생성 이력 화면
- `app/api/generate/route.ts` — PDF 업로드 → OpenAI API로 시나리오 추출 → 엑셀 생성 → Supabase 저장 → 파일 응답
- `app/api/history/route.ts`, `app/api/download/[id]/route.ts` — 이력 조회/재다운로드
- `lib/ai/` — OpenAI API 호출(`extract.ts`, PDF를 페이지별 이미지로 변환해 vision 입력으로 전달), 추출 규칙 프롬프트(`guideRules.ts`), 구조화 출력 스키마(`schema.ts`)
- `lib/excel/build.ts` — 서식 파일에 맞춰 실제 엑셀을 만드는 핵심 로직 (기존에 Python(openpyxl)으로 수작업 검증한 로직을 ExcelJS로 그대로 이식)
- `lib/excel/templateData.ts` — 서식 파일(`assets/template.xlsx`)을 base64로 임베드한 것 (Vercel 서버리스 환경에서 런타임에 파일을 읽지 않고 모듈로 번들되도록)
- `supabase/schema.sql` — DB 테이블 + 스토리지 버킷 정의 (이미 아래 프로젝트에 적용되어 있음)

## 이미 준비된 것

이 세션에서 연결된 Supabase 계정에 전용 프로젝트를 새로 만들어 두었습니다 (무료 티어, 월 $0).

- 프로젝트: `ddangyo-test-scenario-generator` (`ap-northeast-2`)
- URL: `https://ranjexfefrfnhmbybffq.supabase.co`
- `generations` 테이블 + `test-scenario-files` 스토리지 버킷 생성 완료

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # 값 채우기 (아래 "환경변수" 참고)
npm run dev
```

엑셀 생성 로직만 따로 검증하고 싶다면 (OpenAI API 키 없이도 가능):

```bash
npm run test:excel   # fixture.json(땡겨요 로그인/회원가입 137개 스텝 샘플)로 test-output.xlsx 생성
```

## 환경변수

| 변수 | 설명 |
|---|---|
| `OPENAI_API_KEY` | **직접 발급 필요.** https://platform.openai.com/api-keys 에서 발급한 본인 API 키. 화면설계서 이미지 분석(추출) 호출에 사용되며, 사용한 만큼 요금이 청구됩니다. |
| `OPENAI_MODEL` | (선택) 기본값은 vision 지원 GPT-4o 모델. 보통 바꿀 필요 없음. |
| `SUPABASE_URL` | `https://ranjexfefrfnhmbybffq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 대시보드 → 이 프로젝트 → Project Settings → API → `service_role` 키를 복사 (비밀 키이므로 저는 조회할 수 없어 직접 가져오셔야 해요) |
| `SUPABASE_ANON_KEY` | (service_role 대신 써도 됨) `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhbmpleGZlZnJmbmhtYnliZmZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTIyNTQsImV4cCI6MjEwMzMyODI1NH0.EMOMMCEfKBoTQEyscvg3GQ2axjv_hwcsPWXakfQIe2U` |

`SUPABASE_SERVICE_ROLE_KEY`와 `SUPABASE_ANON_KEY` 중 하나만 있으면 됩니다 (service_role을 우선 사용). 이 앱의 RLS 정책이 이미 전체 허용으로 되어 있어(개인용 단일 사용자 도구라 별도 로그인 없음) anon 키로도 충분히 동작합니다. 나중에 여러 사람이 쓰는 도구로 키우실 거면, 이 RLS 정책과 인증을 반드시 강화해주세요.

## Vercel 배포

이 세션에서는 Vercel 계정에 직접 접근할 수 있는 권한이 없어서, 마지막 "가져오기(Import)" 단계는 직접 해주셔야 해요. 두 가지 방법이 있습니다.

### 방법 A — GitHub 연동 (추천)

1. 이 폴더로 새 GitHub 저장소를 만들고 푸시합니다.
   ```bash
   git init
   git add .
   git commit -m "init: test scenario generator"
   git branch -M main
   git remote add origin <내-저장소-URL>
   git push -u origin main
   ```
2. https://vercel.com/new 에서 방금 만든 저장소를 Import 합니다.
3. Vercel 프로젝트 설정 → Environment Variables에 위 표의 값들을 추가합니다.
4. Deploy.

### 방법 B — Vercel CLI로 폴더에서 바로 배포 (GitHub 없이)

```bash
npm i -g vercel
vercel login
vercel        # 폴더 안에서 실행, 질문에 답하면 됨
vercel env add OPENAI_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel --prod
```

### 함수 실행 시간 (중요)

페이지 수가 많은 화면설계서는 OpenAI API 분석 호출이 수십 초~수 분 걸릴 수 있습니다. Vercel Hobby(무료) 플랜은 서버리스 함수 실행시간 제한이 짧아서 큰 PDF에서 타임아웃이 날 수 있어요. 실제로 여러 번 타임아웃을 겪으신다면:

- Vercel Pro 플랜으로 올리거나,
- 프로젝트 설정에서 Fluid Compute를 켜서 `maxDuration`(현재 `app/api/generate/route.ts`에 300초로 설정됨)을 더 길게 활용하시는 걸 권장합니다.

## 알아두면 좋은 제약

- PDF는 페이지별로 이미지 변환 후 OpenAI vision 입력으로 전달됩니다. 업로드 용량은 32MB로 제한되며, 페이지 수는 60페이지를 넘으면 거부됩니다(공식 API 제한이 아니라, 한 번의 요청이 모델 컨텍스트/비용을 넘지 않도록 잡아둔 값 — `lib/ai/extract.ts`의 `MAX_PAGES`). 이보다 큰 화면설계서는 파일을 나눠서 업로드해야 합니다 — 이 MVP는 자동 분할을 하지 않습니다.
- 서식 파일(`assets/template.xlsx`)을 바꾸고 싶다면 그 파일을 교체한 뒤 `node scripts/regen-template-data.mjs`를 실행해서 `lib/excel/templateData.ts`를 다시 생성해주세요.
- 이 앱은 로그인/권한 분리가 없는 개인용 도구로 설계되었습니다. 여러 사람이 같이 쓰게 되면 이력이 전부 공유되니, 필요하면 인증을 추가해주세요.
