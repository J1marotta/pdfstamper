import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test('large PDFs show load progress and open on the first page', async ({ page }) => {
  test.setTimeout(180000);

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
  for (let i = 0; i < 400; i += 1) {
    const pdfPage = document.addPage([595, 842]);
    pdfPage.drawText(`Bulk page ${i + 1} ${filler}`, {
      x: 40,
      y: 780,
      size: 10,
      font,
      maxWidth: 515,
    });
  }
  const bytes = await document.save();
  const filePath = join(tmpdir(), `pfdstamper-large-${Date.now()}.pdf`);
  await fs.writeFile(filePath, bytes);

  await page.goto('/');
  await page.evaluate(() => {
    (window as unknown as { __notices: Array<string | null> }).__notices = [];
    const status = document.querySelector('#status')!;
    new MutationObserver(() => {
      (window as unknown as { __notices: Array<string | null> }).__notices.push(
        status.textContent,
      );
    }).observe(status, { childList: true, characterData: true, subtree: true });
  });

  await page.setInputFiles('#file-input', filePath);
  await expect(page.locator('#topbar')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#preview-page-label')).toContainText('Page 1 1 / 400');

  const notices = await page.evaluate(
    () => (window as unknown as { __notices: Array<string | null> }).__notices,
  );
  const seen = notices.filter((notice): notice is string => Boolean(notice));
  expect(
    seen.some(
      (notice) =>
        /(%|Parsing the PDF|Reading form fields|Reading page text)/.test(notice),
    ),
  ).toBe(true);
});
