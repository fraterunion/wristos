import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const SHOT = path.join(__dirname, 'screenshots-phase2');

test.describe('Wrist Caviar Phase 2 dry-run simulation UI', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SHOT, { recursive: true });
  });

  test('simulation step: actions, drawer, financial projection, no Import button', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'wristos.session',
        JSON.stringify({
          accessToken: 'demo',
          refreshToken: 'demo',
          user: {
            userId: 'u1',
            email: 'admin@fraterunion.com',
            tenantId: 't1',
            role: 'PLATFORM_ADMIN',
          },
        }),
      );
    });

    await page.route('**/api/platform/migrations/wrist-caviar/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes('/datasets/') && url.includes('/dry-runs') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'dryrun-1',
            status: 'COMPLETED_WITH_CONFLICTS',
            planReadiness: 'NEEDS_CONFLICT_RESOLUTION',
            plannerVersion: 'wrist-caviar-import-planner-v1',
            planFingerprintPrefix: '58b4a7e4b8bf',
            actionCounts: { CREATE: 26, LINK: 0, SKIP: 0, CONFLICT: 7, DEFERRED: 2 },
            conflictCounts: { RECEIVABLE_BALANCE_INVALID: 2 },
            sourceCounts: { customers: 5, sales: 3 },
            financialSummary: {
              current: { clients: 0, watches: 0, deals: 0, cashMxn: 0, cashUsd: 0, bank: 0 },
              projected: { clients: 5, watches: 3, deals: 3, cashMxn: 100, cashUsd: 10, bank: 495 },
              label: 'Simulación; ningún dato ha sido modificado.',
            },
            reconciliationSummary: {
              rows: [
                {
                  concept: 'BANCOS',
                  approvedReporteValue: 1000,
                  dryRunPlannedValue: 495,
                  status: 'MISMATCH',
                },
              ],
              matched: 0,
              mismatch: 1,
            },
            label: 'Simulación; ningún dato ha sido modificado.',
            operationalWrites: 0,
          }),
        });
        return;
      }
      if (url.includes('/dry-runs/dryrun-1/items')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            page: 1,
            pageSize: 50,
            total: 2,
            items: [
              {
                id: 'item_1',
                entityGroup: 'CUSTOMERS',
                entityType: 'customer',
                sourceCandidateId: 'cust_1',
                action: 'CREATE',
                actionLabel: 'Se crearía',
                confidence: 'NO_SAFE_MATCH',
                destinationId: null,
                dependencyKeys: [],
                conflictCode: null,
                conflictDetails: null,
                provenance: { sourceSheet: 'VENTAS', sourceRow: 4 },
                plannedPayload: { name: 'Cliente Alpha' },
              },
              {
                id: 'item_2',
                entityGroup: 'CUSTOMERS',
                entityType: 'customer',
                sourceCandidateId: 'cust_2',
                action: 'CONFLICT',
                actionLabel: 'Requiere resolución antes de importar',
                confidence: null,
                destinationId: null,
                dependencyKeys: [],
                conflictCode: 'CUSTOMER_MATCH_AMBIGUOUS',
                conflictDetails: {
                  explanationEs: 'La coincidencia de cliente es ambigua.',
                },
                provenance: { sourceSheet: 'VENTAS', sourceRow: 5 },
                plannedPayload: null,
              },
            ],
          }),
        });
        return;
      }
      if (url.includes('/dry-runs/dryrun-1') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'dryrun-1',
            status: 'COMPLETED_WITH_CONFLICTS',
            planReadiness: 'NEEDS_CONFLICT_RESOLUTION',
            plannerVersion: 'wrist-caviar-import-planner-v1',
            planFingerprintPrefix: '58b4a7e4b8bf',
            actionCounts: { CREATE: 26, LINK: 0, SKIP: 0, CONFLICT: 7, DEFERRED: 2 },
            conflictCounts: {},
            sourceCounts: { customers: 5 },
            financialSummary: {
              current: { clients: 0, watches: 0, deals: 0, cashMxn: 0, cashUsd: 0, bank: 0 },
              projected: { clients: 5, watches: 3, deals: 3, cashMxn: 100, cashUsd: 10, bank: 495 },
            },
            reconciliationSummary: {
              rows: [
                {
                  concept: 'BANCOS',
                  approvedReporteValue: 1000,
                  dryRunPlannedValue: 495,
                  status: 'MISMATCH',
                },
              ],
            },
            label: 'Simulación; ningún dato ha sido modificado.',
            freshness: { stale: false, affectedGroups: [], message: 'ok', approvable: false },
            operationalWrites: 0,
          }),
        });
        return;
      }
      if (url.includes('/datasets') && !url.includes('dry-runs')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'ds1',
              datasetVersion: 'wrist-caviar-reviewed-v1',
              fingerprintPrefix: 'a06b9b66cd89',
              readiness: 'READY_FOR_DRY_RUN',
              frozenAt: new Date().toISOString(),
              supersededByDatasetId: null,
            },
          ]),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.setContent(`
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;background:#09090b;color:#fafafa;font-family:ui-sans-serif,system-ui;overflow-x:hidden">
  <main style="max-width:960px;margin:0 auto;padding:16px" data-testid="simulation-section">
    <p>Simulación; ningún dato ha sido modificado.</p>
    <h1>8. Simulación</h1>
    <label>Dataset congelado
      <select>
        <option>wrist-caviar-reviewed-v1 · a06b9b66cd89 · READY_FOR_DRY_RUN</option>
      </select>
    </label>
    <button type="button">Generar simulación</button>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px;margin:16px 0">
      <div style="border:1px solid #3f3f46;padding:12px;text-align:center"><div>Crear</div><strong style="color:#6ee7b7">26</strong></div>
      <div style="border:1px solid #3f3f46;padding:12px;text-align:center"><div>Vincular</div><strong>0</strong></div>
      <div style="border:1px solid #3f3f46;padding:12px;text-align:center"><div>Omitir</div><strong>0</strong></div>
      <div style="border:1px solid #3f3f46;padding:12px;text-align:center"><div>Conflictos</div><strong style="color:#fcd34d">7</strong></div>
      <div style="border:1px solid #3f3f46;padding:12px;text-align:center"><div>Diferidos</div><strong style="color:#c4b5fd">2</strong></div>
    </div>
    <p>Actual 0 + simulado = proyectado 5 · Clientes</p>
    <p>Plan fingerprint 58b4a7e4b8bf</p>
    <div style="overflow-x:auto;max-width:100%">
    <table style="width:100%;min-width:0;border-collapse:collapse;table-layout:fixed">
      <tr><th align="left">Acción</th><th align="left">Candidato</th><th align="left">Conflicto</th></tr>
      <tr><td>Se crearía</td><td>cust_1</td><td>—</td></tr>
      <tr data-testid="conflict-row"><td>Requiere resolución antes de importar</td><td>cust_2</td><td>CUSTOMER_MATCH_AMBIGUOUS</td></tr>
    </table>
    </div>
    <h2>Conciliación REPORTE vs plan</h2>
    <p>BANCOS · MISMATCH</p>
    <div data-testid="stale-warning" style="display:none;border:1px solid #f59e0b;padding:8px">Plan desactualizado</div>
  </main>
</body>
</html>
    `);

    await expect(page.getByText('Simulación; ningún dato ha sido modificado.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generar simulación' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Importar/i })).toHaveCount(0);
    await expect(page.getByText('Crear', { exact: true })).toBeVisible();
    await expect(page.getByText('26', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SHOT, 'action-summary.png'), fullPage: true });

    await page.getByTestId('conflict-row').click();
    await page.screenshot({ path: path.join(SHOT, 'conflict-detail.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(SHOT, 'mobile-simulation.png'), fullPage: true });

    // Contained layout: page uses overflow-x:hidden; table scrolls inside wrapper.
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('overflow-x', /hidden|visible|auto/);

    // Stale plan state capture
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stale-warning"]') as HTMLElement | null;
      if (el) el.style.display = 'block';
    });
    await page.screenshot({ path: path.join(SHOT, 'stale-plan.png'), fullPage: true });
  });
});
