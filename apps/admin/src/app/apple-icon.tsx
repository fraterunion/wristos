import { ImageResponse } from 'next/og';

// iOS Home Screen icon (apple-touch-icon) — must NOT be transparent/rounded
// (iOS applies its own mask), unlike icon.tsx's maskable variant.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0A0A',
        }}
      >
        <span
          style={{
            fontSize: 98,
            fontWeight: 700,
            color: '#34D399',
            letterSpacing: -2,
          }}
        >
          W
        </span>
      </div>
    ),
    { ...size },
  );
}
