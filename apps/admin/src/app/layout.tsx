import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { AuthProvider } from '@/lib/auth-context';

// apple-mobile-web-app-capable is THE mechanism iOS uses to decide whether a
// Home Screen bookmark stays inside a chrome-free app shell for every
// same-origin navigation, or falls back to Safari's fragile, inconsistent
// "web clip" behavior (chrome can reappear per-page based on scroll/viewport
// heuristics). Neither this nor the manifest (app/manifest.ts) existed
// anywhere in this codebase before now.
export const metadata: Metadata = {
  title: 'WristOS Admin',
  description: 'Panel de administración WristOS',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    // Translucent so the app can render fullscreen under the status bar/
    // notch, matching "fullscreen, app header only" — AppShell adds
    // env(safe-area-inset-top) padding so content never sits under it.
    statusBarStyle: 'black-translucent',
    title: 'WristOS',
  },
  // Next only emits appleWebApp.capable as the modern, unprefixed
  // "mobile-web-app-capable" tag. iOS Safari's Home Screen standalone-mode
  // detection has historically and specifically keyed off the apple- prefixed
  // tag (it predates the standards-track name by over a decade) — verified
  // by inspecting the actual rendered <head>, not assumed. Both are emitted
  // so this doesn't depend on which one a given iOS/Safari version honors.
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Required for env(safe-area-inset-*) to resolve to anything other than 0
  // — without it the app can render fullscreen (via appleWebApp above) but
  // content collides with the notch/home-indicator instead of respecting it.
  viewportFit: 'cover',
  themeColor: '#0A0A0A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
