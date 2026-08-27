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

const statusColor: Record<HistoryItem['status'], string> = {
  processing: '#8a6d00',
  success: '#1c6b34',
  failed: '#902020',
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
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>생성 이력</h1>

      {error && <p style={{ color: '#902020' }}>{error}</p>}
      {!items && !error && <p style={{ color: '#666' }}>불러오는 중...</p>}
      {items && items.length === 0 && <p style={{ color: '#666' }}>아직 생성한 시나리오가 없습니다.</p>}

      {items && items.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e2e5', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f2f2f4', textAlign: 'left' }}>
                <th style={cellStyle}>생성 일시</th>
                <th style={cellStyle}>원본 파일</th>
                <th style={cellStyle}>상태</th>
                <th style={cellStyle}>단계 / 스텝</th>
                <th style={cellStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={cellStyle}>{new Date(item.created_at).toLocaleString('ko-KR')}</td>
                  <td style={cellStyle}>{item.source_filename}</td>
                  <td style={{ ...cellStyle, color: statusColor[item.status], fontWeight: 600 }}>
                    {statusLabel[item.status]}
                    {item.status === 'failed' && item.error_message && (
                      <div style={{ fontWeight: 400, color: '#999', fontSize: 12 }}>{item.error_message}</div>
                    )}
                  </td>
                  <td style={cellStyle}>
                    {item.scenario_count != null ? `${item.scenario_count}개 / ${item.step_count}개` : '-'}
                  </td>
                  <td style={cellStyle}>
                    {item.status === 'success' ? (
                      <a href={`/api/download/${item.id}`} style={{ color: '#0b57d0' }}>
                        다운로드
                      </a>
                    ) : (
                      '-'
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

const cellStyle: React.CSSProperties = { padding: '10px 14px' };
