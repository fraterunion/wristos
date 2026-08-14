import { ImageResponse } from 'next/og';

// Route-handler icon (favicon + manifest icon). No brand asset exists yet in
// this repo — generated at request time so the manifest has a real icon to
// reference rather than shipping without one. Swap for a designed asset by
// replacing this file with a static icon.png later; the manifest reference
// (/icon) does not need to change.
export const size = { width: 192, height: 192 };
export const contentType = 'image/png';

export default function Icon() {
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
          borderRadius: 40,
        }}
      >
        <span
          style={{
            fontSize: 104,
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
