import type { Metadata, Viewport } from 'next';

import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Wrist Caviar',
    template: '%s',
  },
  description: 'Curated pre-owned luxury watches',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050505',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
