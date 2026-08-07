/**
 * Playwright coverage for the conversational Assistant surface.
 *
 * Run against a locally running admin dev server (no real backend needed —
 * auth and the assistant endpoint are both mocked):
 *
 *   npx playwright test apps/admin/e2e/assistant-conversation.spec.ts
 *
 * Override the target with ADMIN_BASE_URL (defaults to the app's own
 * `npm run dev` port, 3001).
 *
 * The page renders both the mobile (`lg:hidden`) and desktop
 * (`hidden lg:block`) layouts in the DOM at once (only one is ever visible,
 * via CSS, at a given viewport) — every locator below is scoped to whichever
 * tree matches the test's viewport so it never resolves ambiguously.
 */
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

const BASE = process.env.ADMIN_BASE_URL ?? 'http://localhost:3001';

const FAKE_USER = { userId: 'u1', email: 'cesar@wristcaviar.test', tenantId: 't1', role: 'OWNER' };

function mobileScope(page: Page): Locator {
  return page.locator('div.space-y-4.lg\\:hidden').first();
}

function desktopScope(page: Page): Locator {
  return page.locator('div.hidden.space-y-5.lg\\:block').first();
}

function baseResponse(overrides: Record<string, unknown>) {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    conversationId: 'conv-1',
    workspaceId: 'ws-1',
    interactionState: 'ANSWERING',
    responseType: 'TEXT_ANSWER',
    payload: {},
    warnings: [],
    suggestedActions: [],
    traceId: 'trace-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Seeds a fake authenticated session and stubs auth + workspace lookups so
 * the real /assistant route renders without a real backend. */
async function signIn(page: Page) {
  await page.addInitScript(
    ([user]) => {
      window.localStorage.setItem('wristos.accessToken', 'test-access-token');
      window.localStorage.setItem('wristos.refreshToken', 'test-refresh-token');
      window.localStorage.setItem('wristos.user', JSON.stringify(user));
    },
    [FAKE_USER],
  );
  await page.route('**/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_USER) }));
  await page.route('**/ai/workspaces/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'ws-1', conversationId: 'conv-1', version: 1, deletedAt: null }) }),
  );
}

/** Tracks every request path so a test can assert nothing beyond the
 * expected allowlist was ever called (no surprise endpoints, no NLP calls). */
function trackRequests(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (request) => {
    try {
      paths.push(new URL(request.url()).pathname);
    } catch {
      // ignore malformed URLs
    }
  });
  return paths;
}

async function mockAssistant(page: Page, handler: (intent: string, body: Record<string, unknown>) => Record<string, unknown>) {
  await page.route('**/ai/assistant/structured', async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const resp = handler(body.intent, body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) });
  });
}

test.describe('Assistant conversation surface', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('user message renders immediately, typing indicator shows only while pending, then disappears', async ({ page }) => {
    await page.route('**/ai/assistant/structured', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } })) });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByRole('button', { name: 'Ver liquidez' }).click();

    await expect(scope.getByRole('status', { name: 'WristOS está preparando la respuesta.' })).toBeVisible();
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeVisible({ timeout: 3000 });
    await expect(scope.getByRole('status', { name: 'WristOS está preparando la respuesta.' })).toHaveCount(0);
  });

  test('liquidity read renders as intro + big summary + compact breakdown, never the raw backend summary string', async ({ page }) => {
    await mockAssistant(page, () =>
      baseResponse({
        interactionState: 'COMPLETED',
        responseType: 'METRIC_BREAKDOWN',
        payload: {
          data: { cashMxn: '480000.00', bankMxn: '3000000.00', cryptoMxn: '1053792.00', cesarMxn: '4000000.00', totalLiquidityMxn: '8533792.00' },
          summary: 'Total liquidity MXN 8533792.00',
        },
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByRole('button', { name: 'Ver liquidez' }).click();

    await expect(scope.getByText('Tu liquidez total es:')).toBeVisible();
    await expect(scope.getByText('$8,533,792 MXN')).toBeVisible();
    await expect(scope.getByText('Efectivo')).toBeVisible();
    await expect(scope.getByText('Cuenta César')).toBeVisible();
    await expect(page.getByText('Total liquidity', { exact: false })).toHaveCount(0);
  });

  test('client search renders conversational count plus choice chips with pending-balance context', async ({ page }) => {
    await mockAssistant(page, (intent) => {
      if (intent === 'SEARCH_CLIENT') {
        return baseResponse({
          interactionState: 'COMPLETED',
          responseType: 'ENTITY_LIST',
          payload: { data: { items: [{ id: 'c1', name: 'José Hernández', openReceivableCount: 1, openReceivableTotalByCurrency: { MXN: '225000.00', USD: '0.00' } }] } },
        });
      }
      return baseResponse({ payload: { message: 'Listo.' } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByRole('button', { name: 'Buscar cliente', exact: true }).click();
    await scope.locator('input[required]').fill('José');
    await scope.getByRole('button', { name: 'Consultar', exact: true }).click();

    await expect(scope.getByText('Encontré 1 cliente.')).toBeVisible();
    const choice = scope.getByRole('button', { name: /José Hernández/ });
    await expect(choice).toBeVisible();
    await expect(choice).toContainText('$225,000 MXN pendiente');
    await expect(scope.getByRole('button', { name: 'Otro cliente' })).toBeVisible();
  });

  test('write preview never says the write completed and its primary action is a truthful module link, not "Confirmar"', async ({ page }) => {
    await mockAssistant(page, () =>
      baseResponse({
        interactionState: 'READY_FOR_CONFIRMATION',
        responseType: 'ACTION_PREVIEW_CARD',
        payload: {
          preview: {
            title: 'Venta', fields: [{ label: 'Reloj', value: 'Rolex GMT Batman' }, { label: 'Precio', value: '$350,000 MXN' }],
            warnings: [], estimatedEffects: [{ area: 'INVENTORY', description: 'El reloj saldría del inventario disponible.' }],
          },
          message: 'Esta acción todavía no está habilitada para ejecución desde el asistente.',
        },
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByText('Preparar acciones', { exact: true }).click();
    await scope.getByRole('button', { name: 'Registrar venta' }).click();

    await expect(scope.getByText('Perfecto. Esto es lo que voy a preparar:')).toBeVisible();
    await expect(scope.getByRole('link', { name: 'Abrir Ventas' })).toHaveAttribute('href', '/ventas');
    await expect(scope.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
    for (const forbidden of ['Listo.', 'Registrado', 'Venta realizada', 'Pago registrado']) {
      await expect(scope.getByText(forbidden, { exact: false })).toHaveCount(0);
    }
  });

  test('a malformed write-completion response fails closed and never renders backend-supplied text', async ({ page }) => {
    await mockAssistant(page, () =>
      baseResponse({ interactionState: 'COMPLETED', responseType: 'SUCCESS_RECEIPT', payload: { message: 'Venta realizada y registrada exitosamente' } }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByText('Preparar acciones', { exact: true }).click();
    await scope.getByRole('button', { name: 'Registrar venta' }).click();

    await expect(scope.getByText('Esta operación no se ejecutó.')).toBeVisible();
    await expect(page.getByText('Venta realizada', { exact: false })).toHaveCount(0);
  });

  test('a 500-style failure renders a short conversational error with a working retry, and does not leak raw codes', async ({ page }) => {
    let attempt = 0;
    await page.route('**/ai/assistant/structured', async (route) => {
      attempt += 1;
      if (attempt === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal error' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } })) });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByRole('button', { name: 'Ver liquidez' }).click();

    await expect(scope.getByText('No pude completar la consulta. No se realizó ningún cambio.')).toBeVisible();
    await expect(scope.getByText('500', { exact: false })).toHaveCount(0);
    await scope.getByRole('button', { name: 'Reintentar' }).click();
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeVisible();
  });

  test('reduced motion disables the message reveal animation', async ({ page }) => {
    await mockAssistant(page, () => baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByRole('button', { name: 'Ver liquidez' }).click();
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeVisible();
    const animationName = await scope.locator('.ui-msg-in').first().evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe('none');
  });

  test('renders untrusted backend text as plain text, never as HTML', async ({ page }) => {
    await mockAssistant(page, () => baseResponse({ payload: { message: '<img src=x onerror="window.__xss=true">' } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByRole('button', { name: 'Ver liquidez' }).click();
    await expect(scope.getByText('<img src=x', { exact: false })).toBeVisible();
    const injected = await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss);
    expect(injected).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
  });

  test('freeform composer text never calls the assistant endpoint', async ({ page }) => {
    const paths = trackRequests(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByLabel('Solicitud en lenguaje natural, próximamente').fill('Vendí un reloj carísimo');
    await scope.getByLabel('Enviar').click();
    await expect(scope.getByText('La entrada libre estará disponible más adelante.')).toBeVisible();
    expect(paths.some((path) => path.includes('/ai/assistant/structured'))).toBe(false);
  });

  test('only the expected endpoints are ever called for a simple read', async ({ page }) => {
    const paths = trackRequests(page);
    await mockAssistant(page, () => baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await scope.getByRole('button', { name: 'Ver liquidez' }).click();
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeVisible();
    const allowed = /\/auth\/me$|\/ai\/assistant\/structured$|\/ai\/workspaces\//;
    const unexpected = paths.filter((path) => path.startsWith('/api') || path.includes('/ai/') || path.includes('/auth/')).filter((path) => !allowed.test(path));
    expect(unexpected).toEqual([]);
  });

  test('mobile home stays compact: greeting, composer, and suggestions all fit without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);
    await expect(scope.getByText('Buenos días, César.')).toBeInViewport();
    await expect(scope.getByRole('button', { name: 'Ver liquidez' })).toBeInViewport();
    await expect(scope.getByLabel('Solicitud en lenguaje natural, próximamente')).toBeInViewport();
  });

  test('desktop keeps the dashboard-first structure — sidebar and quick-query grid remain', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/assistant`);
    const scope = desktopScope(page);
    await expect(scope.getByRole('heading', { name: 'Consultas rápidas' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Panel|Dashboard/i }).first()).toBeVisible();
  });

  test('the very first reply reveals itself even on a desktop page already taller than one viewport', async ({ page }) => {
    // Regression: the sidebar + hero + quick-query grid alone exceed 900px,
    // so a naive "was the page already near the bottom" check would treat
    // the very first reply as if the user had scrolled away from it.
    await mockAssistant(page, () => baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/assistant`);
    const scope = desktopScope(page);
    await scope.getByRole('button', { name: 'Ver liquidez' }).click();
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeInViewport({ timeout: 3000 });
    await expect(scope.getByRole('button', { name: /Ir al mensaje más reciente/ })).toHaveCount(0);
  });

  test('the activity section is labeled Conversaciones, not Actividad reciente', async ({ page }) => {
    await mockAssistant(page, () => baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/assistant`);
    const scope = desktopScope(page);
    await scope.getByRole('button', { name: 'Ver liquidez' }).click();
    await expect(scope.getByRole('heading', { name: 'Conversaciones' })).toBeVisible();
    await expect(page.getByText('Actividad reciente')).toHaveCount(0);
  });

  test('does not yank a scrolled-up reader back down, and offers a jump-to-latest affordance that works', async ({ page }) => {
    let count = 0;
    await mockAssistant(page, () => {
      count += 1;
      return baseResponse({ payload: { message: `Respuesta número ${count}.` } });
    });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`${BASE}/assistant`);
    const scope = mobileScope(page);

    // Build enough scrollable history that the thread is taller than the viewport.
    for (let i = 0; i < 6; i += 1) {
      await scope.getByRole('button', { name: 'Ver liquidez' }).click();
      await expect(scope.getByText(`Respuesta número ${i + 1}.`)).toBeVisible();
    }

    // Deliberately scroll away from the bottom before the next message arrives.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);

    await scope.getByRole('button', { name: 'Ver liquidez' }).click();
    await expect(scope.getByText('Respuesta número 7.')).toBeAttached();

    const jumpButton = scope.getByRole('button', { name: /Ir al mensaje más reciente/ });
    await expect(jumpButton).toBeVisible();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeLessThan(50);

    await jumpButton.click();
    await expect(scope.getByText('Respuesta número 7.')).toBeInViewport();
    await expect(jumpButton).toHaveCount(0);
  });
});
