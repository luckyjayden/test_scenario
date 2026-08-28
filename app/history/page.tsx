'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type GenerationItem = {
  id: string;
  created_at: string;
  source_filename: string;
  output_filename: string | null;
  status: 'processing' | 'success' | 'failed';
  error_message: string | null;
  scenario_count: number | null;
  step_count: number | null;
};

type ReviewItem = {
  id: string;
  created_at: string;
  source_type: 'upload' | 'figma';
  source_filename: string | null;
  figma_file_key: string | null;
  status: 'processing' | 'success' | 'failed';
  error_message: string | null;
  finding_count: number | null;
  layout_issue_count: number | null;
};

const statusLabel = {
  processing: '처리 중',
  success: '완료',
  failed: '실패',
} as const;

const statusBadgeClass = {
  processing: 'badge badge-warning',
  success: 'badge badge-success',
  failed: 'badge badge-danger',
} as const;

function GenerationHistory() {
  const [items, setItems] = useState<GenerationItem[] | null>(null);
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

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!items) return <p style={{ color: 'var(--text-secondary)' }}>불러오는 중...</p>;
  if (items.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>아직 생성한 시나리오가 없습니다.</p>;

  return (
    <div className="glass" style={{ overflow: 'hidden', padding: 0 }}>
      <table className="table">
        <colgroup>
          <col style={{ width: 100 }} />
          <col style={{ width: 240 }} />
          <col />
          <col style={{ width: 128 }} />
          <col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="col-narrow">생성 일시</th>
            <th>원본 파일</th>
            <th>상태</th>
            <th className="col-narrow">단계 / 스텝</th>
            <th className="col-narrow"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="col-narrow">
                <div>{new Date(item.created_at).toLocaleDateString('ko-KR')}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                  {new Date(item.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </td>
              <td className="col-wide" title={item.source_filename}>
                {item.source_filename}
              </td>
              <td>
                <span className={statusBadgeClass[item.status]}>{statusLabel[item.status]}</span>
                {item.status === 'failed' && item.error_message && (
                  <div style={{ marginTop: 6, color: 'var(--text-tertiary)', fontSize: 12 }}>{item.error_message}</div>
                )}
              </td>
              <td className="col-narrow">{item.scenario_count != null ? `${item.scenario_count}개 / ${item.step_count}개` : '-'}</td>
              <td className="col-narrow">
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
  );
}

function ReviewHistory() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/review/history')
      .then((res) => res.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setItems(body.items);
      })
      .catch((err) => setError(String(err)));
  }, []);

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!items) return <p style={{ color: 'var(--text-secondary)' }}>불러오는 중...</p>;
  if (items.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>아직 검수한 이력이 없습니다.</p>;

  return (
    <div className="glass" style={{ overflow: 'hidden', padding: 0 }}>
      <table className="table">
        <colgroup>
          <col style={{ width: 100 }} />
          <col style={{ width: 100 }} />
          <col />
          <col style={{ width: 128 }} />
          <col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="col-narrow">검수 일시</th>
            <th className="col-narrow">유형</th>
            <th>원본</th>
            <th className="col-narrow">이슈</th>
            <th className="col-narrow"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="col-narrow">
                <div>{new Date(item.created_at).toLocaleDateString('ko-KR')}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                  {new Date(item.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </td>
              <td className="col-narrow">{item.source_type === 'figma' ? 'Figma' : '문구 검수'}</td>
              <td className="col-wide" title={item.source_filename || item.figma_file_key || ''}>
                {item.source_filename || item.figma_file_key || '-'}
              </td>
              <td>
                <span className={statusBadgeClass[item.status]}>{statusLabel[item.status]}</span>
                {item.status === 'failed' && item.error_message && (
                  <div style={{ marginTop: 6, color: 'var(--text-tertiary)', fontSize: 12 }}>{item.error_message}</div>
                )}
              </td>
              <td className="col-narrow">{item.finding_count != null ? `${item.finding_count}건` : '-'}</td>
              <td className="col-narrow">
                {item.status === 'success' ? (
                  <Link href={`/review/${item.id}`} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                    보기
                  </Link>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HistoryPage() {
  const [tab, setTab] = useState<'generation' | 'review'>('generation');

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 24, letterSpacing: -0.5 }}>이력</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--glass-border)' }}>
        {(
          [
            ['generation', '시나리오 생성'],
            ['review', '검수하기'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="btn"
            style={{
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              color: tab === key ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'generation' ? <GenerationHistory /> : <ReviewHistory />}
    </div>
  );
}
