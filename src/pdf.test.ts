import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});

describe('downloadBlob', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a downloadable anchor and cleans it up later', async () => {
    const { downloadBlob } = await import('./pdf');
    const appendSpy = vi.spyOn(document.body, 'append');
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadBlob(new Blob(['hello'], { type: 'application/pdf' }), 'example.pdf');

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const anchor = appendSpy.mock.calls[0]?.[0];
    expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    expect((anchor as HTMLAnchorElement).download).toBe('example.pdf');

    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
