import type { MetadataRoute } from 'next';

/**
 * Served at /manifest.webmanifest. This is the primary, standards-based
 * mechanism for "installed to Home Screen stays inside the app" behavior —
 * scope + start_url + display: 'standalone' together tell the OS that every
 * same-origin, in-scope navigation belongs to the installed app, not to
 * Safari. iOS additionally needs the apple-mobile-web-app-* meta tags (see
 * app/layout.tsx's appleWebApp metadata) since Safari's manifest support has
 * historically lagged Chrome's — the two mechanisms are complementary, not
 * redundant, and this app previously had neither.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WristOS',
    short_name: 'WristOS',
    description: 'Panel de administración WristOS',
    // The known-good entry point — the same page that already proves
    // standalone mode works, and one hop closer than "/" (which itself only
    // server-redirects here).
    start_url: '/dashboard',
    // Every route under the app is in scope — /assistant included. A
    // narrower scope is exactly the kind of thing that makes the OS treat an
    // in-scope-but-excluded route as "leaving the app."
    scope: '/',
    display: 'standalone',
    display_override: ['standalone'],
    orientation: 'portrait',
    background_color: '#0A0A0A',
    theme_color: '#0A0A0A',
    icons: [
      { src: '/icon', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
