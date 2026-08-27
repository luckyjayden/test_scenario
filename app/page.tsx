'use client';

import { useState } from 'react';

type Status = 'idle' | 'uploading' | 'error' | 'done';

export default function UploadPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [author, setAuthor] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ scenarioCount: number; stepCount: number } | null>(null);

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

    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('author', author || '작성자 미입력');

    setStatus('uploading');
    setFileName(file.name);

    try {
      const res = await fetch('/api/generate', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `생성 실패 (HTTP ${res.status})`);
      }

      const scenarioCount = Number(res.headers.get('X-Scenario-Count') || '0');
      const stepCount = Number(res.headers.get('X-Step-Count') || '0');
      const outName = res.headers.get('X-Output-Filename') || 'test-scenario.xlsx';

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

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>테스트 시나리오 생성</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>
        화면설계서(PPT를 PDF로 변환한 파일)를 업로드하면, 내부 가이드 규칙에 따라 테스트 시나리오를 추출하고
        고정 서식 파일에 맞춘 엑셀(.xlsx)을 생성해 바로 다운로드해드립니다.
      </p>

      <form onSubmit={handleSubmit} style={{ background: '#fff', border: '1px solid #e2e2e5', borderRadius: 10, padding: 24 }}>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>화면설계서 PDF</div>
          <input type="file" name="pdf" accept="application/pdf" required style={{ display: 'block' }} />
        </label>

        <label style={{ display: 'block', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>작성자 (표지/이력에 기록됩니다)</div>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="예: 김태훈"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d8d8dc', borderRadius: 6, fontSize: 14 }}
          />
        </label>

        <button
          type="submit"
          disabled={status === 'uploading'}
          style={{
            background: status === 'uploading' ? '#999' : '#111',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '10px 18px',
            fontSize: 14,
            cursor: status === 'uploading' ? 'default' : 'pointer',
          }}
        >
          {status === 'uploading' ? '생성 중... (수 십 초 ~ 수 분 소요될 수 있어요)' : '시나리오 엑셀 생성'}
        </button>
      </form>

      {status === 'error' && error && (
        <div style={{ marginTop: 16, padding: 14, background: '#fdeeee', border: '1px solid #f3c8c8', borderRadius: 8, color: '#902020', fontSize: 14 }}>
          {error}
        </div>
      )}

      {status === 'done' && summary && (
        <div style={{ marginTop: 16, padding: 14, background: '#eefaf0', border: '1px solid #c8ecd2', borderRadius: 8, color: '#1c6b34', fontSize: 14 }}>
          "{fileName}" 분석 완료 — 시나리오 단계 {summary.scenarioCount}개, 테스트 스텝 {summary.stepCount}개를 생성해 다운로드했습니다.
          이력 페이지에서 다시 받을 수 있어요.
        </div>
      )}
    </div>
  );
}
