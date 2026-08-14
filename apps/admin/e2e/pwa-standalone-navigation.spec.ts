/**
 * Verifies the specific mechanism behind the reported iOS PWA bug: does
 * clicking "Asistente" / "Panel" in the mobile bottom nav trigger a real,
 * top-level page navigation (which iOS Home Screen "web clip" mode can
 * reveal Safari chrome for), or does it stay a soft, client-side History API
 * transition (which iOS Home Screen bookmarks always keep chrome-free)?
 *
 * Method: stamp a JS marker on window after the first paint, then click
 * through the nav. A hard navigation destroys the JS heap and the marker
 * with it; a soft (SPA) navigation never touches it. This is checkable in a
 * normal headless browser — real iOS standalone-chrome visibility is not,
 * but "did the JS context survive this click" is the exact, testable
 * proxy for "was this a real page load."
 *
 *   npx playwright test apps/admin/e2e/pwa-standalone-navigation.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.ADMIN_BASE_URL ?? 'http://localhost:3001';
const FAKE_USER = { userId: 'u1', email: 'cesar@wristcaviar.test', tenantId: 't1', role: 'OWNER' };

async function signIn(page: Page) {
  await page.addInitScript(
    ([user]) => {
      window.localStorage.setItem('wristos.accessToken', 'test-access-token');
      window.localStorage.setItem('wristos.refreshToken', 'test-refresh-token');
      window.localStorage.setItem('wristos.user', JSON.stringify(user));
    },
    [FAKE_USER],
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_USER) }),
  );
  // Broad catch-all so dashboard/assistant data fetches don't hang the page —
  // this test only cares about navigation mechanics, not rendered content.
  await page.route('**/ai/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  );
  // Dashboard's KPI widgets fetch several /analytics/* endpoints expecting
  // array-shaped time series — an empty array renders an empty chart
  // instead of throwing, unlike a blunt {} which crashes .map() calls.
  await page.route('**/analytics/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  );
}

async function stampSoftNavMarker(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __softNavProbe?: string }).__softNavProbe = 'still-here';
  });
}

async function markerSurvived(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __softNavProbe?: string }).__softNavProbe === 'still-here');
}

test.describe('Mobile bottom nav: Asistente <-> Panel stays client-side routed', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone-sized, so the mobile bottom nav renders

  test('Asistente -> Panel never triggers a hard page reload', async ({ page }) => {
    await signIn(page);
    // Starts on /assistant (renders cleanly off the sparse route mocks above
    // — it only fetches a workspace when a stored resume hint exists, which
    // a fresh session has none of) rather than /dashboard, whose real KPI
    // widgets need a much richer mocked data shape than this test is about
    // (a pre-existing e2e-fixture gap, orthogonal to navigation mechanics).
    await page.goto(`${BASE}/assistant`);
    await expect(page).toHaveURL(/\/assistant/);
    await expect(page.getByRole('link', { name: 'Panel' })).toBeVisible();

    await stampSoftNavMarker(page);
    await page.getByRole('link', { name: 'Panel' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    // Checked immediately after the URL changes, independent of whether
    // dashboard's own KPI widgets then render successfully against the
    // sparse mocks above — a React error boundary catching a downstream
    // render error does not reload the page or clear `window`, so this
    // still isolates exactly one thing: was this a client-side History API
    // transition (marker survives) or a real top-level navigation (marker
    // is gone, JS heap reset)?
    expect(await markerSurvived(page)).toBe(true);
  });

  test('the Asistente link itself has no target/rel that would force a new browsing context', async ({ page }) => {
    await signIn(page);
    await page.goto(`${BASE}/dashboard`);
    const link = page.getByRole('link', { name: 'Asistente' });
    await expect(link).toHaveAttribute('href', '/assistant');
    expect(await link.getAttribute('target')).toBeNull();
    expect(await link.getAttribute('rel')).toBeNull();
  });
});
