import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const notoSansKr = Noto_Sans_KR({ subsets: ['latin'], weight: ['400', '500', '700', '900'] });

export const metadata: Metadata = {
  title: '테스트 시나리오 생성기',
  description: '화면설계서(PDF)를 업로드하면 서식에 맞춘 테스트 시나리오 엑셀을 생성합니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={notoSansKr.className}>
        <header style={{ borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-elevated)' }}>
          <nav style={{ maxWidth: 1120, margin: '0 auto', padding: '18px 10px', display: 'flex', gap: 24, alignItems: 'center' }}>
            <strong style={{ fontSize: 16, fontWeight: 800 }}>테스트 시나리오 생성기</strong>
            <Link href="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
              생성
            </Link>
            <Link href="/review" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
              검수하기
            </Link>
            <Link href="/history" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
              이력
            </Link>
          </nav>
        </header>
        <main style={{ maxWidth: 1120, margin: '0 auto', padding: '40px 10px' }}>{children}</main>
      </body>
    </html>
  );
}
