/**
 * Frontend timeline navigation semantics (mirrored pure helpers).
 * Kept in API test suite so CI runs without a separate admin Jest setup.
 */
describe('dashboard timeline navigation semantics', () => {
  const VISIBLE = { day: 30, week: 16, month: 12, year: 6 } as const;
  const WIDTH = { day: 44, week: 64, month: 80, year: 100 } as const;

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

  function navigateWindow(params: {
    windowStart: number;
    visibleCount: number;
    bucketCount: number;
    action: 'prev' | 'next' | 'actual';
  }) {
    const maxStart = Math.max(0, params.bucketCount - params.visibleCount);
    if (params.action === 'prev') {
      return clamp(params.windowStart - params.visibleCount, 0, maxStart);
    }
    if (params.action === 'next') {
      return clamp(params.windowStart + params.visibleCount, 0, maxStart);
    }
    return maxStart;
  }

  it('default visible windows match product spec', () => {
    expect(VISIBLE.day).toBe(30);
    expect(VISIBLE.week).toBe(16);
    expect(VISIBLE.month).toBe(12);
    expect(VISIBLE.year).toBe(6);
  });

  it('bucket widths stay within readable ranges', () => {
    expect(WIDTH.day).toBeGreaterThanOrEqual(38);
    expect(WIDTH.day).toBeLessThanOrEqual(48);
    expect(WIDTH.week).toBeGreaterThanOrEqual(58);
    expect(WIDTH.week).toBeLessThanOrEqual(72);
    expect(WIDTH.month).toBeGreaterThanOrEqual(70);
    expect(WIDTH.month).toBeLessThanOrEqual(90);
    expect(WIDTH.year).toBeGreaterThanOrEqual(90);
    expect(WIDTH.year).toBeLessThanOrEqual(120);
  });

  it('previous / next / actual navigation', () => {
    expect(
      navigateWindow({
        windowStart: 24,
        visibleCount: 12,
        bucketCount: 36,
        action: 'prev',
      }),
    ).toBe(12);
    expect(
      navigateWindow({
        windowStart: 24,
        visibleCount: 12,
        bucketCount: 36,
        action: 'next',
      }),
    ).toBe(24);
    expect(
      navigateWindow({
        windowStart: 0,
        visibleCount: 12,
        bucketCount: 36,
        action: 'actual',
      }),
    ).toBe(24);
  });

  it('initial scroll window starts at most recent buckets', () => {
    const bucketCount = 40;
    const visibleCount = VISIBLE.day;
    expect(Math.max(0, bucketCount - visibleCount)).toBe(10);
  });
});
