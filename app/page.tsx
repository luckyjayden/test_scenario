'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

const STORAGE_BUCKET = 'test-scenario-files';
const MAX_IMAGES = 30;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Status = 'idle' | 'uploading' | 'generating' | 'error' | 'done';

export default function UploadPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [author, setAuthor] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ scenarioCount: number; stepCount: number } | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSummary(null);

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('pdf') as HTMLInputElement;
    const files = Array.from(fileInput.files || []);

    if (files.length === 0) {
      setError('화면설계서 파일을 선택해주세요.');
      return;
    }
    if (files.some((f) => /\.(ppt|pptx)$/i.test(f.name))) {
      setError('PPT 파일은 직접 업로드할 수 없어요. PDF로 변환한 뒤 업로드해주세요.');
      return;
    }

    const isSinglePdf = files.length === 1 && files[0].type === 'application/pdf';
    const isImageSet = files.length > 0 && files.every((f) => IMAGE_TYPES.includes(f.type));

    if (!isSinglePdf && !isImageSet) {
      setError('PDF는 1개, 이미지(JPG/PNG/WEBP)는 여러 장을 함께 업로드할 수 있어요. 형식을 확인해주세요.');
      return;
    }
    if (isImageSet && files.length > MAX_IMAGES) {
      setError(`이미지는 최대 ${MAX_IMAGES}장까지 업로드할 수 있어요 (현재 ${files.length}장).`);
      return;
    }

    setStatus('uploading');
    setFileName(isSinglePdf ? files[0].name : `이미지 ${files.length}장`);

    try {
      let generationId: string | undefined;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const urlRes = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // macOS reports Korean filenames in decomposed (NFD) Unicode form —
          // normalize to NFC so it renders correctly once it lands in the
          // generated xlsx (표지/변경 히스토리 sheets).
          body: JSON.stringify({
            filename: file.name.normalize('NFC'),
            generationId,
            index: isImageSet ? i : undefined,
          }),
        });
        if (!urlRes.ok) {
          const body = await urlRes.json().catch(() => ({}));
          throw new Error(body.error || `업로드 준비 실패 (HTTP ${urlRes.status})`);
        }
        const { generationId: id, path, token } = await urlRes.json();
        generationId = id;

        const { error: uploadErr } = await supabaseBrowser.storage
          .from(STORAGE_BUCKET)
          .uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (uploadErr) {
          throw new Error(`파일 업로드 실패(${file.name}): ${uploadErr.message}`);
        }
      }

      setStatus('generating');
      setProgress(null);

      // app/api/generate processes exactly one OpenAI batch per request (see
      // lib/ai/extract.ts) so a single call never risks Vercel's function
      // duration limit no matter how large the document is — this loop is
      // what drives it through every batch, one sequential request at a
      // time, updating progress straight from each response.
      let scenarioCount = 0;
      let stepCount = 0;
      for (;;) {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ generationId, author: author || '작성자 미입력' }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `생성 실패 (HTTP ${res.status})`);
        }
        const data = await res.json();
        if (data.done) {
          scenarioCount = data.scenarioCount;
          stepCount = data.stepCount;
          break;
        }
        setProgress({ current: data.progress.current, total: data.progress.total });
      }

      // /api/download streams the finished xlsx with the correct
      // Content-Disposition filename (RFC 5987-encoded Korean name) — no
      // need to re-derive or decode a filename on the client.
      const a = document.createElement('a');
      a.href = `/api/download/${generationId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setSummary({ scenarioCount, stepCount });
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  const busy = status === 'uploading' || status === 'generating';

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 }}>테스트 시나리오 생성</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        화면설계서를 업로드하면, 내부 가이드 규칙에 따라 테스트 시나리오를 추출하고
        고정 서식 파일에 맞춘 엑셀(.xlsx)을 생성해 바로 다운로드해드립니다.
      </p>

      <form onSubmit={handleSubmit} className="glass" style={{ padding: 28, maxWidth: 560 }}>
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span className="label">화면설계서 파일</span>
          <input
            type="file"
            name="pdf"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            multiple
            required
            className="input"
          />
          <span style={{ display: 'block', marginTop: 6, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            PDF(1개) 또는 이미지(JPG/PNG/WEBP, 최대 {MAX_IMAGES}장)를 등록할 수 있어요. PPT 파일은 PDF로 변환한 뒤
            업로드해주세요.
          </span>
        </label>

        <label style={{ display: 'block', marginBottom: 24 }}>
          <span className="label">작성자 (표지/이력에 기록됩니다)</span>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="예: 김태훈"
            className="input"
          />
        </label>

        <button type="submit" disabled={busy} className="btn btn-primary" style={{ width: '100%' }}>
          {status === 'uploading' && '파일 업로드 중...'}
          {status === 'generating' &&
            (progress ? `생성 중... (배치 ${progress.current}/${progress.total} 처리 중)` : '생성 중... (수 십 초 ~ 수 분 소요될 수 있어요)')}
          {!busy && '시나리오 엑셀 생성'}
        </button>
      </form>

      {status === 'error' && error && <div className="banner banner-danger">{error}</div>}

      {status === 'done' && summary && (
        <div className="banner banner-success">
          &ldquo;{fileName}&rdquo; 분석 완료 — 시나리오 단계 {summary.scenarioCount}개, 테스트 스텝 {summary.stepCount}개를 생성해
          다운로드했습니다. 이력 페이지에서 다시 받을 수 있어요.
        </div>
      )}
    </div>
  );
}
