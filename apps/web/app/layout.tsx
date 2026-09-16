import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Budget Bot // Contractor Expense & Margin OS',
  description:
    'Swiss-inspired financial tracking platform for solo handyman contractors. Track materials vs labor, profit margins, cash flow, and credit card transactions.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Read by the browser chrome before any stylesheet loads, so this cannot be
            var(--bg-main); it is that token's value, kept in step by test/design-tokens. */}
        <meta name="theme-color" content="#0a0d14" />
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
