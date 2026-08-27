# 디자인 시스템

토스증권(corp.tossinvest.com) 스타일 — 미니멀한 산세리프, 굵은 헤드라인, 넓은 여백, 절제된 포인트 컬러 —
을 기반으로, 블랙 배경 + 글래스모피즘을 결합한 다크 테마. `app/globals.css`에 토큰/클래스로 구현되어 있음.

## 컬러

| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#0a0a0c` | 페이지 배경 (순검정이 아닌 쿨톤 블랙) |
| `--bg-elevated` | `#141417` | 헤더 등 배경보다 한 단 위 |
| `--glass-bg` | `rgba(255,255,255,0.06)` | 글래스 패널 배경 |
| `--glass-bg-hover` | `rgba(255,255,255,0.09)` | 글래스 패널 hover |
| `--glass-border` | `rgba(255,255,255,0.10)` | 글래스 패널 테두리 |
| `--text-primary` | `#f5f6f8` | 본문/헤드라인 |
| `--text-secondary` | `#9aa0a8` | 보조 텍스트 |
| `--text-tertiary` | `#6b7280` | placeholder, 최하위 정보 |
| `--accent` | `#3182f6` | 토스 블루 — 주요 액션에만 사용 |
| `--accent-hover` | `#1b64da` | accent hover |
| `--success` | `#3ddc84` | 완료 상태 |
| `--danger` | `#ff5b5b` | 실패 상태 |
| `--warning` | `#ffc542` | 처리 중 상태 |

**원칙**: 포인트 컬러(`--accent`)는 버튼 1곳, 링크 등 정말 강조가 필요한 곳에만 쓴다. 나머지는 전부 흑백·회색 톤 + 글래스 투명도로 위계를 표현한다 (토스가 컬러를 남발하지 않는 방식 그대로).

## 타이포그래피

- 폰트: Noto Sans KR (`next/font/google`), 폴백 `-apple-system, "Malgun Gothic"`.
- 헤드라인은 굵게(700~900), 큼직하게 — 토스 특유의 "숫자/타이틀이 크고 진하다" 인상.

| 용도 | size / weight |
|---|---|
| 페이지 타이틀 | 28px / 800 |
| 섹션 타이틀 | 18px / 700 |
| 본문 | 14px / 400 |
| 보조 텍스트 | 13px / 400 |
| 라벨 | 13px / 600 |

## 여백 / 반경 / 그림자

- 스페이싱: 4px 배수 (4/8/12/16/20/24/32/40).
- 반경: 카드/패널 `20px`, 버튼/인풋 `12px`, 배지 `999px`(pill).
- 그림자: `0 8px 32px rgba(0,0,0,0.35)` — 글래스 패널을 배경에서 살짝 띄우는 용도로만.

## 글래스모피즘 레시피

```css
.glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}
```

배경에 은은한 블루 글로우(`radial-gradient`)를 깔아야 블러 효과가 실제로 보인다 — 순수 단색 배경 위에서는 글래스 패널이 그냥 회색 상자로 보임 (`app/globals.css`의 `body::before` 참고).

## 컴포넌트

- **버튼(Primary)**: `--accent` 배경, 흰 텍스트, 반경 12px, hover 시 `--accent-hover` + 살짝 위로(`translateY(-1px)`).
- **버튼(Disabled/진행중)**: 배경을 `--glass-bg-hover`로, 텍스트는 `--text-secondary`.
- **인풋**: 글래스 배경(`--glass-bg`), 포커스 시 테두리를 `--accent`로.
- **상태 배지**: pill 모양, 배경은 상태색의 15% 투명도, 텍스트는 상태색 그대로 (success/danger/warning 토큰).
- **카드/패널**: 전부 `.glass` 클래스 — 표지 폼, 이력 테이블 래퍼 등.

## 적용 범위

`app/layout.tsx`, `app/page.tsx`, `app/history/page.tsx`에 적용됨. 새 화면을 추가할 때도 인라인 스타일 대신 `app/globals.css`의 토큰/클래스(`.glass`, `.btn-primary`, `.badge-*` 등)를 재사용할 것.
