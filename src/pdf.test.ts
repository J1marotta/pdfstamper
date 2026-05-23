import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { DocumentPageModel, StampSettings } from './types';

class MockDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
}

if (!('DOMMatrix' in globalThis)) {
  Object.assign(globalThis, {
    DOMMatrix: MockDOMMatrix,
  });
}

function makeStamp(overrides: Partial<StampSettings> = {}): StampSettings {
  return {
    mode: 'text',
    payee: 'Acme Pty Ltd',
    totalAmount: '$100.00',
    gstAmount: '$9.09',
    movementNumber: 'MOVE-42',
    signedBy: 'Taylor Smith',
    coSignedBy: 'Jordan Smith',
    approvedBy1: 'Approver One',
    approvedBy2: 'Approver Two',
    date: '2026-05-20',
    placement: {
      pageId: 'pdf-1',
      x: 0.5,
      y: 0.72,
      width: 0.5,
      rotation: 0,
    },
    flatten: false,
    imageBytes: null,
    imageMime: null,
    imageName: null,
    ...overrides,
  };
}

describe('exportFilledPdf', () => {
  it('returns a valid PDF blob header', async () => {
    const { exportFilledPdf } = await import('./pdf');
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const sourceBytes = new Uint8Array(await source.save());
    const pages: DocumentPageModel[] = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
    ];

    const blob = await exportFilledPdf(sourceBytes, [], makeStamp(), pages);
    const header = await blob.slice(0, 8).text();

    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
    expect(header).toContain('%PDF-');
  });

  it('inserts blank pages into the exported document order', async () => {
    const { exportFilledPdf } = await import('./pdf');
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const sourceBytes = new Uint8Array(await source.save());
    const pages: DocumentPageModel[] = [
      {
        id: 'pdf-1',
        kind: 'pdf',
        pageNumber: 1,
        width: 595,
        height: 842,
        label: 'Page 1',
      },
      {
        id: 'blank-1',
        kind: 'blank',
        width: 595,
        height: 842,
        label: 'Blank 1',
      },
    ];

    const blob = await exportFilledPdf(
      sourceBytes,
      [],
      makeStamp({
        placement: {
          pageId: 'blank-1',
          x: 0.5,
          y: 0.5,
          width: 0.44,
          rotation: 12,
        },
      }),
      pages,
    );
    const exported = await PDFDocument.load(await blob.arrayBuffer());

    expect(exported.getPageCount()).toBe(2);
  });

  it('omits deleted source pages while preserving the requested output order', async () => {
    const { exportFilledPdf } = await import('./pdf');
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    source.addPage([612, 792]);
    const sourceBytes = new Uint8Array(await source.save());
    const pages: DocumentPageModel[] = [
      {
        id: 'pdf-2',
        kind: 'pdf',
        pageNumber: 2,
        width: 612,
        height: 792,
        label: 'Page 2',
      },
      {
        id: 'blank-1',
        kind: 'blank',
        width: 612,
        height: 792,
        label: 'Blank 1',
      },
    ];

    const blob = await exportFilledPdf(
      sourceBytes,
      [],
      makeStamp({
        placement: {
          pageId: 'blank-1',
          x: 0.5,
          y: 0.5,
          width: 0.44,
          rotation: 0,
        },
      }),
      pages,
    );
    const exported = await PDFDocument.load(await blob.arrayBuffer());
    const exportedPages = exported.getPages();

    expect(exportedPages).toHaveLength(2);
    expect(exportedPages[0]?.getWidth()).toBe(612);
    expect(exportedPages[0]?.getHeight()).toBe(792);
    expect(exportedPages[1]?.getWidth()).toBe(612);
    expect(exportedPages[1]?.getHeight()).toBe(792);
  });
});
