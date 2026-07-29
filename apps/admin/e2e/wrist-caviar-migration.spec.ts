/**
 * Playwright smoke checklist for Wrist Caviar workbook migration UI.
 * Run with local API + admin and PLATFORM_ADMIN_EMAILS set:
 *
 *   npx playwright test apps/admin/e2e/wrist-caviar-migration.spec.ts
 *
 * Screenshots land in apps/admin/e2e/screenshots/
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const BASE = process.env.ADMIN_BASE_URL ?? 'http://localhost:3000';
const SHOT = path.join(__dirname, 'screenshots');

test.describe('Wrist Caviar migration Phase 1', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SHOT, { recursive: true });
  });

  test.skip(!process.env.E2E_PLATFORM_ADMIN_EMAIL, 'Requires E2E_PLATFORM_ADMIN_EMAIL');

  test('platform admin can analyze synthetic workbook through preview', async ({ page }) => {
    // Assumes an already-authenticated storage state or login helper in the environment.
    await page.goto(`${BASE}/platform/migrations/wrist-caviar`);
    await expect(page.getByRole('heading', { name: 'Migración inicial de Wrist Caviar' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOT, 'upload.png'), fullPage: true });

    // File input is hidden — set via locator
    const fixture = process.env.E2E_SYNTHETIC_XLSX;
    test.skip(!fixture || !fs.existsSync(fixture), 'Requires E2E_SYNTHETIC_XLSX');

    await page.locator('input[type="file"]').setInputFiles(fixture!);
    await page.getByRole('button', { name: 'Analizar workbook' }).click();
    await page.screenshot({ path: path.join(SHOT, 'processing.png'), fullPage: true });

    await expect(page.getByText('VENTAS')).toBeVisible({ timeout: 120_000 });
    await page.screenshot({ path: path.join(SHOT, 'analysis-dashboard.png'), fullPage: true });

    await page.getByRole('button', { name: 'Ver validaciones' }).click();
    await page.screenshot({ path: path.join(SHOT, 'validation-issues.png'), fullPage: true });

    await page.getByRole('button', { name: '4. Conciliación' }).click();
    await page.screenshot({ path: path.join(SHOT, 'reconciliation.png'), fullPage: true });

    await page.getByRole('button', { name: 'Vista previa' }).click();
    await page.screenshot({ path: path.join(SHOT, 'sales-preview.png'), fullPage: true });

    await page.getByRole('button', { name: 'CXC' }).click();
    await page.screenshot({ path: path.join(SHOT, 'cxc-preview.png'), fullPage: true });

    await expect(page.getByRole('button', { name: /Importar/i })).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
  });
});
