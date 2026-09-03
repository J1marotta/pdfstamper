import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

import { buildFixturePdf } from './fixtures';

test('upload, fill, stamp, textbox, and export a stamped PDF', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  const fixturePdf = await buildFixturePdf();

  await page.goto('/');
  await expect(page.locator('#topbar')).toBeHidden();

  await page.setInputFiles('#file-input', fixturePdf);
  await expect(page.locator('#topbar')).toBeVisible();
  await expect(page.locator('#preview-page-label')).toContainText('Page 1');
  await expect(page.locator('#preview-canvas')).toBeVisible();

  // Place the stamp by clicking the page, then name a payee inline.
  await page.locator('#preview-canvas').click();
  await expect(page.locator('.preview-stamp-object')).toBeVisible();
  await page.locator('input[data-stamp-key="payee"]').fill('Acme Pty Ltd');

  // Fill the shared profile so export has nothing outstanding.
  await page.locator('[data-action="open-advanced"]').click();
  await expect(page.locator('#advanced-sheet')).toBeVisible();
  await page.locator('input[data-profile-key="fullName"]').fill('Taylor Smith');
  await expect(page.locator('#fill-stats')).toContainText('need attention');
  await page.locator('#advanced-sheet button:has-text("Close")').click();
  await expect(page.locator('#advanced-sheet')).toBeHidden();

  // Add a manual text box for the scanned-content path.
  await page.locator('#add-textbox-button').click();
  await page.locator('.textbox-input').fill('Sighted 20 May 2026');

  // Export and download the result (headless Chromium has no save picker,
  // so the app falls back to an anchor download).
  await page.locator('button:has-text("Generate stamped PDF")').click();
  const downloadButton = page.locator('button:has-text("Download stamped PDF")');
  await expect(downloadButton).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadButton.click(),
  ]);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  const exportedBytes = await download.createReadStream().then(
    (stream) =>
      new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      }),
  );
  const exported = await PDFDocument.load(exportedBytes);
  expect(exported.getPageCount()).toBe(2);

  expect(consoleErrors).toEqual([]);
});
