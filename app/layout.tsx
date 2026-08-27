import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '테스트 시나리오 생성기',
  description: '화면설계서(PDF)를 업로드하면 서식에 맞춘 테스트 시나리오 엑셀을 생성합니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif', background: '#f7f7f8', color: '#1a1a1a' }}>
        <header style={{ borderBottom: '1px solid #e2e2e5', background: '#fff' }}>
          <nav style={{ maxWidth: 880, margin: '0 auto', padding: '16px 20px', display: 'flex', gap: 20, alignItems: 'center' }}>
            <strong style={{ fontSize: 16 }}>테스트 시나리오 생성기</strong>
            <Link href="/" style={{ color: '#444', textDecoration: 'none', fontSize: 14 }}>
              생성
            </Link>
            <Link href="/history" style={{ color: '#444', textDecoration: 'none', fontSize: 14 }}>
              이력
            </Link>
          </nav>
        </header>
        <main style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px' }}>{children}</main>
      </body>
    </html>
  );
}
