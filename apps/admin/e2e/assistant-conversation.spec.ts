/**
 * Playwright coverage for the conversational Assistant surface (26UX Jarvis shell).
 *
 *   npx playwright test apps/admin/e2e/assistant-conversation.spec.ts
 */
import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

const BASE = process.env.ADMIN_BASE_URL ?? 'http://localhost:3001';

const FAKE_USER = { userId: 'u1', email: 'cesar@wristcaviar.test', tenantId: 't1', role: 'OWNER' };

function shell(page: Page): Locator {
  return page.getByTestId('assistant-chat-shell');
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
  await page.route('**/ai/workspaces/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'ws-1', conversationId: 'conv-1', version: 1, deletedAt: null }),
    }),
  );
}

function trackRequests(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (request) => {
    try {
      paths.push(new URL(request.url()).pathname);
    } catch {
      /* */
    }
  });
  return paths;
}

async function mockAssistant(
  page: Page,
  handler: (intent: string, body: Record<string, unknown>) => Record<string, unknown>,
) {
  await page.route('**/ai/assistant/structured', async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const resp = handler(body.intent, body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resp),
    });
  });
}

async function mockAssistantMessage(
  page: Page,
  handler: (
    text: string,
    body: Record<string, unknown>,
  ) => {
    resolvedIntent: string;
    response: Record<string, unknown>;
    resolvedEntities?: Record<string, unknown>;
  },
) {
  await page.route('**/ai/assistant/message', async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const result = handler(body.text, body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ resolvedEntities: {}, ...result }),
    });
  });
}

async function sendMessage(page: Page, text: string) {
  const scope = shell(page);
  await scope.getByLabel('Escribe o habla con WristOS').fill(text);
  await scope.getByLabel('Enviar').click();
}

test.describe('Assistant conversation surface', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('empty Jarvis state: greeting, no Solo lectura, no permanent quick actions', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = shell(page);
    await expect(scope.getByTestId('assistant-empty-state')).toBeVisible();
    await expect(scope.getByText('Buenos días, Cesar.')).toBeVisible();
    await expect(scope.getByText('¿Qué necesitas hacer?')).toBeVisible();
    await expect(page.getByText('Solo lectura')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ver liquidez' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ver utilidad' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Buscar reloj' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Buscar cliente' })).toHaveCount(0);
    await expect(page.getByText('Preparar acciones')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Consultas rápidas' })).toHaveCount(0);
    await expect(scope.getByLabel('Escribe o habla con WristOS')).toBeInViewport();
  });

  test('user message renders immediately, typing indicator shows only while pending, then disappears', async ({
    page,
  }) => {
    await page.route('**/ai/assistant/message', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resolvedIntent: 'GET_LIQUIDITY',
          resolvedEntities: {},
          response: baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } }),
        }),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'Muéstrame mi liquidez');

    const scope = shell(page);
    await expect(scope.getByRole('status', { name: 'WristOS está preparando la respuesta.' })).toBeVisible();
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeVisible({ timeout: 3000 });
    await expect(scope.getByRole('status', { name: 'WristOS está preparando la respuesta.' })).toHaveCount(0);
  });

  test('liquidity read renders as intro + big summary + compact breakdown', async ({ page }) => {
    await mockAssistantMessage(page, () => ({
      resolvedIntent: 'GET_LIQUIDITY',
      response: baseResponse({
        interactionState: 'COMPLETED',
        responseType: 'METRIC_BREAKDOWN',
        payload: {
          data: {
            cashMxn: '480000.00',
            bankMxn: '3000000.00',
            cryptoMxn: '1053792.00',
            cesarMxn: '4000000.00',
            totalLiquidityMxn: '8533792.00',
          },
          summary: 'Total liquidity MXN 8533792.00',
        },
      }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, '¿Cuánto tenemos de liquidez?');
    const scope = shell(page);
    await expect(scope.getByText('Tu liquidez total es:')).toBeVisible();
    await expect(scope.getByText('$8,533,792 MXN')).toBeVisible();
    await expect(scope.getByText('Efectivo')).toBeVisible();
    await expect(scope.getByText('Cuenta César')).toBeVisible();
    await expect(page.getByText('Total liquidity', { exact: false })).toHaveCount(0);
  });

  test('client search via natural language renders choice chips', async ({ page }) => {
    await mockAssistantMessage(page, () => ({
      resolvedIntent: 'SEARCH_CLIENT',
      response: baseResponse({
        interactionState: 'COMPLETED',
        responseType: 'ENTITY_LIST',
        payload: {
          data: {
            items: [
              {
                id: 'c1',
                name: 'José Hernández',
                openReceivableCount: 1,
                openReceivableTotalByCurrency: { MXN: '225000.00', USD: '0.00' },
              },
            ],
          },
        },
      }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'Busca a José');
    const scope = shell(page);
    await expect(scope.getByText('Encontré 1 cliente.')).toBeVisible();
    const choice = scope.getByRole('button', { name: /José Hernández/ });
    await expect(choice).toBeVisible();
    await expect(choice).toContainText('$225,000 MXN pendiente');
  });

  test('write preview from free text never says the write completed', async ({ page }) => {
    await mockAssistantMessage(page, () => ({
      resolvedIntent: 'REGISTER_SALE',
      response: baseResponse({
        interactionState: 'READY_FOR_CONFIRMATION',
        responseType: 'ACTION_PREVIEW_CARD',
        payload: {
          preview: {
            title: 'Venta',
            fields: [
              { label: 'Reloj', value: 'Rolex GMT Batman' },
              { label: 'Precio', value: '$350,000 MXN' },
            ],
            warnings: [],
            estimatedEffects: [
              { area: 'INVENTORY', description: 'El reloj saldría del inventario disponible.' },
            ],
          },
          message: 'Esta acción todavía no está habilitada para ejecución desde el asistente.',
        },
      }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'Vendí Batman en 350 mil');
    const scope = shell(page);
    await expect(scope.getByText('Perfecto. Esto es lo que voy a preparar:')).toBeVisible();
    await expect(scope.getByRole('link', { name: 'Abrir Ventas' })).toHaveAttribute('href', '/ventas');
    await expect(scope.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
  });

  test('malformed write-completion response fails closed', async ({ page }) => {
    await mockAssistantMessage(page, () => ({
      resolvedIntent: 'REGISTER_SALE',
      response: baseResponse({
        interactionState: 'COMPLETED',
        responseType: 'SUCCESS_RECEIPT',
        payload: { message: 'Venta realizada y registrada exitosamente' },
      }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'Vendí Batman');
    const scope = shell(page);
    await expect(scope.getByText('Esta operación no se ejecutó.')).toBeVisible();
    await expect(page.getByText('Venta realizada', { exact: false })).toHaveCount(0);
  });

  test('a 500-style failure renders a short conversational error with retry', async ({ page }) => {
    let attempt = 0;
    await page.route('**/ai/assistant/message', async (route) => {
      attempt += 1;
      if (attempt === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Internal error' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resolvedIntent: 'GET_LIQUIDITY',
          resolvedEntities: {},
          response: baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } }),
        }),
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'liquidez');
    const scope = shell(page);
    await expect(
      scope.getByText('No pude completar la consulta. No se realizó ningún cambio.'),
    ).toBeVisible();
    await expect(scope.getByText('500', { exact: false })).toHaveCount(0);
    await scope.getByRole('button', { name: 'Reintentar' }).click();
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeVisible();
  });

  test('reduced motion disables the message reveal animation', async ({ page }) => {
    await mockAssistantMessage(page, () => ({
      resolvedIntent: 'GET_LIQUIDITY',
      response: baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } }),
    }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'liquidez');
    const scope = shell(page);
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeVisible();
    const animationName = await scope
      .locator('.ui-msg-in')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe('none');
  });

  test('renders untrusted backend text as plain text, never as HTML', async ({ page }) => {
    await mockAssistantMessage(page, () => ({
      resolvedIntent: 'GET_LIQUIDITY',
      response: baseResponse({
        payload: { message: '<img src=x onerror="window.__xss=true">' },
      }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'liquidez');
    const scope = shell(page);
    await expect(scope.getByText('<img src=x', { exact: false })).toBeVisible();
    const injected = await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss);
    expect(injected).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
  });

  test('freeform composer text calls POST /ai/assistant/message', async ({ page }) => {
    const paths = trackRequests(page);
    await mockAssistantMessage(page, (text) => ({
      resolvedIntent: 'GET_LIQUIDITY',
      response: baseResponse({
        interactionState: 'COMPLETED',
        responseType: 'METRIC_BREAKDOWN',
        payload: { data: { cashMxn: '480000.00' }, echoedText: text },
      }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'Muéstrame mi liquidez');
    const scope = shell(page);
    await expect(scope.getByText('Muéstrame mi liquidez')).toBeVisible();
    await expect(scope.getByText('Efectivo')).toBeVisible();
    expect(paths.some((path) => path.includes('/ai/assistant/message'))).toBe(true);
    expect(paths.some((path) => path.includes('/ai/assistant/structured'))).toBe(false);
  });

  test('UNKNOWN intent renders a safe conversational error', async ({ page }) => {
    await mockAssistantMessage(page, () => ({
      resolvedIntent: 'UNKNOWN',
      response: baseResponse({
        interactionState: 'FAILED',
        responseType: 'ERROR_RECOVERY_CARD',
        payload: { message: 'No entendí la indicación con suficiente claridad.' },
      }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'asdkjfh qwer');
    await expect(shell(page).getByText('No entendí la indicación con suficiente claridad.')).toBeVisible();
  });

  test('desktop keeps conversation-first shell, not dashboard quick-query grid', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/assistant`);
    const scope = shell(page);
    await expect(scope.getByRole('heading', { name: 'Asistente' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Consultas rápidas' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Panel|Dashboard/i }).first()).toBeVisible();
    await expect(scope.getByLabel('Escribe o habla con WristOS')).toBeVisible();
  });

  test('first reply reveals itself on desktop without yanking', async ({ page }) => {
    await mockAssistantMessage(page, () => ({
      resolvedIntent: 'GET_LIQUIDITY',
      response: baseResponse({ payload: { message: 'Tienes $480,000 en Cash.' } }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/assistant`);
    await sendMessage(page, 'liquidez');
    const scope = shell(page);
    await expect(scope.getByText('Tienes $480,000 en Cash.')).toBeInViewport({ timeout: 3000 });
    await expect(scope.getByRole('button', { name: /Ir al mensaje más reciente/ })).toHaveCount(0);
  });

  test('does not yank a scrolled-up reader back down', async ({ page }) => {
    let count = 0;
    await mockAssistantMessage(page, () => {
      count += 1;
      const pad = Array.from({ length: 8 }, (_, i) => `Detalle ${count}.${i + 1} de la respuesta.`).join(' ');
      return {
        resolvedIntent: 'GET_LIQUIDITY',
        response: baseResponse({
          payload: { message: `Respuesta número ${count}. ${pad}` },
        }),
      };
    });
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto(`${BASE}/assistant`);
    const scope = shell(page);

    for (let i = 0; i < 8; i += 1) {
      await sendMessage(page, `liquidez ${i + 1}`);
      await expect(scope.getByText(`Respuesta número ${i + 1}.`)).toBeVisible();
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    await sendMessage(page, 'liquidez 9');
    await expect(scope.getByText('Respuesta número 9.')).toBeAttached();

    const jumpButton = scope.getByRole('button', { name: /Ir al mensaje más reciente/ });
    await expect(jumpButton).toBeVisible({ timeout: 8000 });

    await jumpButton.click();
    await expect(scope.getByText('Respuesta número 9.')).toBeInViewport();
    await expect(jumpButton).toHaveCount(0);
  });

  test('microphone control is present and does not bypass confirmation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/assistant`);
    const scope = shell(page);
    const mic = scope.getByRole('button', { name: /Hablar con WristOS|Micrófono no disponible/ });
    await expect(mic).toBeVisible();
    // Voice never auto-executes writes — only fills composer / same submit pipeline.
    await expect(page.getByRole('button', { name: 'Confirmar venta' })).toHaveCount(0);
  });
});
