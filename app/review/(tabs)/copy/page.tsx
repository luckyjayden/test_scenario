'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import ToneMannerInput from '@/components/ToneMannerInput';

const STORAGE_BUCKET = 'test-scenario-files';
const MAX_IMAGES = 30;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Status = 'idle' | 'uploading' | 'reviewing' | 'error';

export default function CopyReviewPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [toneManner, setToneManner] = useState('');
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('source') as HTMLInputElement;
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

    try {
      let runId: string | undefined;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const urlRes = await fetch('/api/review/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name.normalize('NFC'),
            runId,
            index: isImageSet ? i : undefined,
          }),
        });
        if (!urlRes.ok) {
          const body = await urlRes.json().catch(() => ({}));
          throw new Error(body.error || `업로드 준비 실패 (HTTP ${urlRes.status})`);
        }
        const { runId: id, path, token } = await urlRes.json();
        runId = id;

        const { error: uploadErr } = await supabaseBrowser.storage
          .from(STORAGE_BUCKET)
          .uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (uploadErr) {
          throw new Error(`파일 업로드 실패(${file.name}): ${uploadErr.message}`);
        }
      }

      setStatus('reviewing');
      setProgress(null);

      for (;;) {
        const res = await fetch('/api/review/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, toneManner }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `검수 실패 (HTTP ${res.status})`);
        }
        const data = await res.json();
        if (data.done) break;
        setProgress({ current: data.progress.current, total: data.progress.total });
      }

      router.push(`/review/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  const busy = status === 'uploading' || status === 'reviewing';

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 }}>문구 검수</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        화면설계서를 업로드하면 버튼·알럿·placeholder 등 컴포넌트 문구의 적절성을 검수하고 대체 문구를 제안해드립니다.
      </p>

      <form onSubmit={handleSubmit} className="glass" style={{ padding: 28, maxWidth: 560 }}>
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span className="label">화면설계서 파일</span>
          <input
            type="file"
            name="source"
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

        <ToneMannerInput value={toneManner} onChange={setToneManner} />

        <button type="submit" disabled={busy} className="btn btn-primary" style={{ width: '100%' }}>
          {status === 'uploading' && '파일 업로드 중...'}
          {status === 'reviewing' &&
            (progress ? `검수 중... (배치 ${progress.current}/${progress.total} 처리 중)` : '검수 중... (수 십 초 ~ 수 분 소요될 수 있어요)')}
          {!busy && '문구 검수 시작'}
        </button>
      </form>

      {status === 'error' && error && <div className="banner banner-danger">{error}</div>}
    </div>
  );
}
