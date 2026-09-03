import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';

/** Builds a small 2-page fillable PDF for E2E upload. */
export async function buildFixturePdf(): Promise<string> {
  const document = await PDFDocument.create();
  const first = document.addPage([595, 842]);
  const second = document.addPage([595, 842]);

  first.drawText('Claim form (page 1)', { x: 50, y: 780, size: 18 });
  second.drawText('Attachments (page 2)', { x: 50, y: 780, size: 18 });

  const form = document.getForm();
  const nameField = form.createTextField('full_name');
  nameField.addToPage(first, { x: 50, y: 700, width: 250, height: 20 });

  const bytes = await document.save();
  const filePath = join(tmpdir(), `pfdstamper-e2e-${Date.now()}.pdf`);
  await fs.writeFile(filePath, bytes);
  return filePath;
}
