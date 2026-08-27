'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

const STORAGE_BUCKET = 'test-scenario-files';

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
    const file = fileInput.files?.[0];
    if (!file) {
      setError('화면설계서 PDF 파일을 선택해주세요.');
      return;
    }

    setStatus('uploading');
    setFileName(file.name);

    try {
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // macOS reports Korean filenames in decomposed (NFD) Unicode form —
        // normalize to NFC so it renders correctly once it lands in the
        // generated xlsx (표지/변경 히스토리 sheets).
        body: JSON.stringify({ filename: file.name.normalize('NFC') }),
      });
      if (!urlRes.ok) {
        const body = await urlRes.json().catch(() => ({}));
        throw new Error(body.error || `업로드 준비 실패 (HTTP ${urlRes.status})`);
      }
      const { generationId, path, token } = await urlRes.json();

      const { error: uploadErr } = await supabaseBrowser.storage
        .from(STORAGE_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: 'application/pdf' });
      if (uploadErr) {
        throw new Error(`PDF 업로드 실패: ${uploadErr.message}`);
      }

      setStatus('generating');
      setProgress(null);

      // /api/generate is one long synchronous call (it processes the PDF
      // in page batches internally to stay under OpenAI's per-minute token
      // limit — see lib/ai/extract.ts), so progress has to be polled from
      // the side rather than read off the fetch itself.
      const pollId = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/status/${generationId}`);
          if (!statusRes.ok) return;
          const { progress_current, progress_total } = await statusRes.json();
          if (progress_current != null && progress_total != null) {
            setProgress({ current: progress_current, total: progress_total });
          }
        } catch {
          /* transient poll failure — next tick will retry */
        }
      }, 1500);

      let res: Response;
      try {
        res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ generationId, author: author || '작성자 미입력' }),
        });
      } finally {
        clearInterval(pollId);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `생성 실패 (HTTP ${res.status})`);
      }

      const scenarioCount = Number(res.headers.get('X-Scenario-Count') || '0');
      const stepCount = Number(res.headers.get('X-Step-Count') || '0');
      const outNameHeader = res.headers.get('X-Output-Filename');
      const outName = outNameHeader ? decodeURIComponent(outNameHeader) : 'test-scenario.xlsx';

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

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
        화면설계서(PPT를 PDF로 변환한 파일)를 업로드하면, 내부 가이드 규칙에 따라 테스트 시나리오를 추출하고
        고정 서식 파일에 맞춘 엑셀(.xlsx)을 생성해 바로 다운로드해드립니다.
      </p>

      <form onSubmit={handleSubmit} className="glass" style={{ padding: 28 }}>
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span className="label">화면설계서 PDF</span>
          <input type="file" name="pdf" accept="application/pdf" required className="input" />
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
          {status === 'uploading' && 'PDF 업로드 중...'}
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
