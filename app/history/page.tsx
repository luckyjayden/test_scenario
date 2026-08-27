'use client';

import { useEffect, useState } from 'react';

type HistoryItem = {
  id: string;
  created_at: string;
  source_filename: string;
  output_filename: string | null;
  status: 'processing' | 'success' | 'failed';
  error_message: string | null;
  scenario_count: number | null;
  step_count: number | null;
};

const statusLabel: Record<HistoryItem['status'], string> = {
  processing: '처리 중',
  success: '완료',
  failed: '실패',
};

const statusBadgeClass: Record<HistoryItem['status'], string> = {
  processing: 'badge badge-warning',
  success: 'badge badge-success',
  failed: 'badge badge-danger',
};

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/history')
      .then((res) => res.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setItems(body.items);
      })
      .catch((err) => setError(String(err)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 24, letterSpacing: -0.5 }}>생성 이력</h1>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!items && !error && <p style={{ color: 'var(--text-secondary)' }}>불러오는 중...</p>}
      {items && items.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>아직 생성한 시나리오가 없습니다.</p>}

      {items && items.length > 0 && (
        <div className="glass" style={{ overflow: 'hidden', padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>생성 일시</th>
                <th>원본 파일</th>
                <th>상태</th>
                <th>단계 / 스텝</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.created_at).toLocaleString('ko-KR')}</td>
                  <td>{item.source_filename}</td>
                  <td>
                    <span className={statusBadgeClass[item.status]}>{statusLabel[item.status]}</span>
                    {item.status === 'failed' && item.error_message && (
                      <div style={{ marginTop: 6, color: 'var(--text-tertiary)', fontSize: 12 }}>{item.error_message}</div>
                    )}
                  </td>
                  <td>{item.scenario_count != null ? `${item.scenario_count}개 / ${item.step_count}개` : '-'}</td>
                  <td>
                    {item.status === 'success' ? (
                      <a href={`/api/download/${item.id}`} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                        다운로드
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)' }}>-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
