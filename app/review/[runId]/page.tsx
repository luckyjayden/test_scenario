'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type CopyFinding = {
  screen: string;
  component_type: string;
  current_text: string;
  issue: string;
  suggested_text: string;
  severity: 'high' | 'medium' | 'low';
};

type ConsistencyNote = {
  component_type: string;
  pattern: string;
  consistent: boolean;
  note: string;
};

type ReviewRun = {
  id: string;
  created_at: string;
  source_type: 'upload' | 'figma';
  source_filename: string | null;
  status: 'processing' | 'success' | 'failed';
  error_message: string | null;
  finding_count: number | null;
  result_json: { tone_manner: string; findings: CopyFinding[]; consistency_notes: ConsistencyNote[] } | null;
};

const severityBadgeClass: Record<CopyFinding['severity'], string> = {
  high: 'badge badge-danger',
  medium: 'badge badge-warning',
  low: 'badge badge-success',
};

const severityLabel: Record<CopyFinding['severity'], string> = {
  high: '높음',
  medium: '중간',
  low: '낮음',
};

export default function ReviewReportPage({ params }: { params: { runId: string } }) {
  const [run, setRun] = useState<ReviewRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/review/${params.runId}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setRun(body);
      })
      .catch((err) => setError(String(err)));
  }, [params.runId]);

  if (error) return <div className="banner banner-danger">{error}</div>;
  if (!run) return <p style={{ color: 'var(--text-secondary)' }}>불러오는 중...</p>;

  if (run.status !== 'success' || !run.result_json) {
    return (
      <div>
        <Link href="/review/copy" style={{ color: 'var(--accent)', fontSize: 14 }}>
          ← 문구 검수로 돌아가기
        </Link>
        <div className="banner banner-danger" style={{ marginTop: 16 }}>
          {run.status === 'failed' ? run.error_message || '검수에 실패했습니다.' : '아직 처리 중입니다.'}
        </div>
      </div>
    );
  }

  const { tone_manner, findings, consistency_notes } = run.result_json;

  return (
    <div>
      <Link href="/review/copy" style={{ color: 'var(--accent)', fontSize: 14 }}>
        ← 문구 검수로 돌아가기
      </Link>

      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '12px 0 8px', letterSpacing: -0.5 }}>
        {run.source_filename || '검수 결과'}
      </h1>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 24 }}>
        {new Date(run.created_at).toLocaleString('ko-KR')} · 이슈 {findings.length}건
      </p>

      <div className="glass" style={{ padding: 20, marginBottom: 24 }}>
        <div className="label" style={{ marginBottom: 8 }}>적용된 톤앤매너</div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{tone_manner || '(감지되지 않음)'}</div>
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>문구 이슈</h2>
      {findings.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>발견된 이슈가 없습니다.</p>
      ) : (
        <div className="glass" style={{ overflow: 'hidden', padding: 0, marginBottom: 32 }}>
          <table className="table">
            <colgroup>
              <col style={{ width: 160 }} />
              <col style={{ width: 100 }} />
              <col />
              <col />
              <col style={{ width: 84 }} />
            </colgroup>
            <thead>
              <tr>
                <th>화면</th>
                <th>컴포넌트</th>
                <th>현재 문구 / 이슈</th>
                <th>제안 문구</th>
                <th>심각도</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f, i) => (
                <tr key={i}>
                  <td>{f.screen}</td>
                  <td>{f.component_type}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>&ldquo;{f.current_text}&rdquo;</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 12.5, marginTop: 4 }}>{f.issue}</div>
                  </td>
                  <td>{f.suggested_text}</td>
                  <td>
                    <span className={severityBadgeClass[f.severity]}>{severityLabel[f.severity]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>일관성 요약</h2>
      {consistency_notes.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>비교 가능한 반복 컴포넌트가 없었습니다.</p>
      ) : (
        <div className="glass" style={{ overflow: 'hidden', padding: 0 }}>
          <table className="table">
            <colgroup>
              <col style={{ width: 160 }} />
              <col />
              <col style={{ width: 96 }} />
            </colgroup>
            <thead>
              <tr>
                <th>컴포넌트</th>
                <th>관찰된 패턴 / 비고</th>
                <th>일관성</th>
              </tr>
            </thead>
            <tbody>
              {consistency_notes.map((n, i) => (
                <tr key={i}>
                  <td>{n.component_type}</td>
                  <td>
                    <div>{n.pattern}</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 12.5, marginTop: 4 }}>{n.note}</div>
                  </td>
                  <td>
                    <span className={n.consistent ? 'badge badge-success' : 'badge badge-danger'}>
                      {n.consistent ? '일관됨' : '불일치'}
                    </span>
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
