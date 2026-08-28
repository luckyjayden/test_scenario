'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const tabs = [
    { href: '/review/copy', label: '문구 검수' },
    { href: '/review/figma', label: '디자인 연동 검수' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--glass-border)' }}>
        {tabs.map((tab) => {
          const active = pathname?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
